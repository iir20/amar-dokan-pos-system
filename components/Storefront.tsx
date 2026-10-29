// Per-store Smart QR storefront (public, no login).
//
// Opened by the QR URL /s/<storeCode> (App.tsx renders this screen
// before the login gate) or embedded after an in-app scan. It shows
// ONLY the resolved store's public info and online products: the
// server resolves the code to exactly one store, strips internal
// fields (see server/publicView.ts), and an unknown code renders the
// not-found panel — never another store, never a store list.
//
// Guest ordering reuses the existing guest-order pipeline scoped to
// this store (POST /api/public/guest-orders with storeCode): the
// server re-validates every item against this store, checks online
// visibility and quantities, and recomputes the total from its own
// product prices. The total shown in the cart is a display sum only;
// the confirmed total is the server's response.
//
// OFFLINE: a failed load with no connection renders the offline panel
// (Retry), never a broken or wrong store view.
import React, { useCallback, useEffect, useState } from 'react';
import { StorageService } from '../services/storage';
import { Language, Product } from '../types';
import { TRANSLATIONS } from '../constants';
import { ShoppingCart, Plus, Minus, WifiOff, AlertTriangle, Store } from 'lucide-react';

interface PublicStore {
  storeCode: string | null;
  storeName: string | null;
  storeCategory: string | null;
  address: string | null;
  phone: string | null;
  zila: string | null;
  upozila: string | null;
  thana: string | null;
  profilePicture: string | null;
}

interface StorefrontProps {
  lang: Language;
  code: string;
  onExit?: () => void;
}

type LoadStatus = 'loading' | 'ready' | 'notfound' | 'offline' | 'error';

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function isOfflineError(err: any): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  return err?.status === 0 || err?.code === 'BACKEND_UNREACHABLE';
}

const Storefront: React.FC<StorefrontProps> = ({ lang, code, onExit }) => {
  const [displayLang, setDisplayLang] = useState<Language>(lang);
  const t = TRANSLATIONS[displayLang];
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [store, setStore] = useState<PublicStore | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [placedOrder, setPlacedOrder] = useState<any | null>(null);
  const [placedStatus, setPlacedStatus] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [info, menu] = await Promise.all([
        StorageService.getPublicStoreByCode(code),
        StorageService.getPublicStoreMenuByCode(code),
      ]);
      setStore(info);
      setProducts(menu || []);
      setStatus('ready');
    } catch (err: any) {
      if (err?.status === 404 || err?.body?.error === 'STORE_NOT_FOUND') {
        setStatus('notfound');
      } else if (isOfflineError(err)) {
        setStatus('offline');
      } else {
        setStatus('error');
      }
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const cartEntries = Object.entries(cart).filter(([, qty]) => qty > 0);
  const cartTotal = cartEntries.reduce((sum, [id, qty]) => {
    const product = products.find((p) => p.id === id);
    return sum + (product ? product.price * qty : 0);
  }, 0);

  const changeQty = (id: string, delta: number) => {
    setCart((prev) => {
      const next = Math.max(0, (prev[id] || 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  };

  const placeOrder = async () => {
    if (cartEntries.length === 0 || placing) return;
    setPlacing(true);
    setOrderError('');
    try {
      const created = await StorageService.createPickupGuestOrder({
        idempotencyKey: newIdempotencyKey(),
        storeCode: code,
        items: cartEntries.map(([id, quantity]) => ({ id, quantity })),
        note: note.trim() || undefined,
      });
      setPlacedOrder(created);
      setPlacedStatus(created?.status || 'pending');
      setCart({});
      setNote('');
    } catch (err: any) {
      setOrderError(err?.message || t.storefrontOrderFailed);
    } finally {
      setPlacing(false);
    }
  };

  const refreshPlacedStatus = async () => {
    if (!placedOrder?.id) return;
    try {
      const fresh = await StorageService.getGuestOrder(placedOrder.id);
      setPlacedStatus(fresh?.status || placedStatus);
    } catch {
      // Keep the last known status; the guest can retry.
    }
  };

  if (status === 'loading') {
    return (
      <div data-testid="storefront-screen" className="p-8 text-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (status === 'notfound') {
    return (
      <div data-testid="storefront-not-found" className="p-8 text-center">
        <AlertTriangle size={40} className="mx-auto text-amber-500 mb-3" />
        <p className="font-bold text-gray-800">{t.storefrontNotFound}</p>
        {onExit && (
          <button onClick={onExit} className="mt-4 text-sm font-bold text-emerald-700 underline">
            {t.storefrontTryAgain}
          </button>
        )}
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div data-testid="storefront-offline" className="p-8 text-center">
        <WifiOff size={40} className="mx-auto text-amber-500 mb-3" />
        <p className="font-bold text-gray-800">{t.storefrontOffline}</p>
        <button
          data-testid="storefront-retry"
          onClick={() => void load()}
          className="mt-4 px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold text-sm"
        >
          {t.storefrontTryAgain}
        </button>
      </div>
    );
  }

  if (status === 'error' || !store) {
    return (
      <div data-testid="storefront-error" className="p-8 text-center">
        <p className="font-bold text-gray-800">{t.storeQrLoadFailed}</p>
        <button
          data-testid="storefront-retry"
          onClick={() => void load()}
          className="mt-4 px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold text-sm"
        >
          {t.storefrontTryAgain}
        </button>
      </div>
    );
  }

  return (
    <div data-testid="storefront-screen" className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button
              data-testid="storefront-lang-en"
              onClick={() => setDisplayLang('en')}
              className={`px-3 py-1 rounded-lg font-bold text-xs ${displayLang === 'en' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 border'}`}
            >
              English
            </button>
            <button
              data-testid="storefront-lang-bn"
              onClick={() => setDisplayLang('bn')}
              className={`px-3 py-1 rounded-lg font-bold text-xs ${displayLang === 'bn' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 border'}`}
            >
              বাংলা
            </button>
          </div>
          {onExit && (
            <button onClick={onExit} className="text-sm font-bold text-gray-600 underline">
              ✕
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-5 text-center">
          {store.profilePicture ? (
            <img src={store.profilePicture} alt="" className="w-20 h-20 object-cover rounded-full mx-auto mb-3" />
          ) : (
            <Store size={40} className="mx-auto text-emerald-600 mb-3" />
          )}
          <h1 data-testid="storefront-name" className="text-2xl font-bold text-gray-800">
            {store.storeName}
          </h1>
          {store.storeCategory && <p className="text-sm text-gray-500">{store.storeCategory}</p>}
          {[store.address, [store.zila, store.upozila, store.thana].filter(Boolean).join(', '), store.phone]
            .filter(Boolean)
            .map((line, i) => (
              <p key={i} className="text-sm text-gray-600">
                {line}
              </p>
            ))}
          <p className="text-xs text-gray-400 mt-2">{t.storefrontPickup}</p>
        </div>

        {placedOrder && (
          <div
            data-testid="storefront-order-confirmation"
            className="bg-emerald-50 border border-emerald-200 rounded-xl p-4"
          >
            <p className="font-bold text-emerald-800">{t.storefrontOrderPlaced}</p>
            <p className="text-sm text-emerald-800 mt-1">
              {t.storefrontTotal}: ৳{placedOrder.totalAmount} · {placedStatus}
            </p>
            <button
              onClick={() => void refreshPlacedStatus()}
              className="mt-2 text-sm font-bold text-emerald-700 underline"
            >
              {t.storefrontTryAgain}
            </button>
          </div>
        )}

        {products.length === 0 ? (
          <p data-testid="storefront-empty" className="text-center text-gray-500 py-8">
            {t.storefrontEmpty}
          </p>
        ) : (
          <div className="space-y-3">
            {products.map((product) => (
              <div key={product.id} className="bg-white p-3 rounded-xl shadow-sm border flex gap-4 items-center">
                {product.image ? (
                  <img src={product.image} alt="" className="w-16 h-16 object-cover rounded-lg shrink-0" />
                ) : null}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-800 line-clamp-1">
                    {displayLang === 'bn' ? product.nameBn || product.name : product.name}
                  </h3>
                  <p className="text-xs text-gray-500">{product.category}</p>
                  <p className="font-bold text-gray-900 mt-1">৳{product.price}</p>
                </div>
                <div className="flex items-center gap-2">
                  {(cart[product.id] || 0) > 0 && (
                    <button
                      data-testid={`storefront-dec-${product.id}`}
                      onClick={() => changeQty(product.id, -1)}
                      className="w-8 h-8 rounded-lg bg-gray-100 font-bold"
                    >
                      <Minus size={16} className="mx-auto" />
                    </button>
                  )}
                  {(cart[product.id] || 0) > 0 && <span className="font-bold w-6 text-center">{cart[product.id]}</span>}
                  <button
                    data-testid={`storefront-add-${product.id}`}
                    onClick={() => changeQty(product.id, 1)}
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white font-bold text-sm flex items-center gap-1"
                  >
                    <Plus size={14} /> ADD
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {cartEntries.length > 0 && (
          <div data-testid="storefront-cart" className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              <ShoppingCart size={18} /> {t.storefrontCart}
            </h2>
            {cartEntries.map(([id, qty]) => {
              const product = products.find((p) => p.id === id);
              if (!product) return null;
              return (
                <div key={id} className="flex justify-between text-sm text-gray-700">
                  <span>
                    {displayLang === 'bn' ? product.nameBn || product.name : product.name} × {qty}
                  </span>
                  <span className="font-bold">৳{product.price * qty}</span>
                </div>
              );
            })}
            <div className="flex justify-between font-bold text-gray-900 border-t pt-2">
              <span>{t.storefrontTotal}</span>
              <span>৳{cartTotal}</span>
            </div>
            <input
              data-testid="storefront-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              maxLength={500}
              className="w-full p-2 border rounded-lg text-sm"
            />
            {orderError && (
              <p data-testid="storefront-order-error" className="text-sm text-red-600">
                {orderError}
              </p>
            )}
            <button
              data-testid="storefront-place-order"
              onClick={() => void placeOrder()}
              disabled={placing}
              className="w-full py-3 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-50"
            >
              {t.storefrontOrder} · ৳{cartTotal}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Storefront;
