
import React, { useState, useEffect, useMemo } from 'react';
import { Language, Customer, Product, CartItem, OnlineOrder, StoreDirectoryEntry, DeliveryStatus } from '../../types';
import { StorageService } from '../../services/storage';
import { useApiData } from '../../hooks/useApiData';
import { APP_LOGO } from '../../constants';
import {
  Search, ShoppingCart, Store, ArrowLeft, Plus, Minus, X, MapPin, Phone,
  Package, Clock, CheckCircle2, Truck, XCircle, LogOut, ClipboardList, Languages, Lock
} from 'lucide-react';
import Loader from '../Loader';

interface MarketplaceAppProps {
  lang: Language;
  setLang: (lang: Language) => void;
  onExitToStoreLogin: () => void;
}

type MarketView = 'stores' | 'store' | 'search' | 'orders' | 'orderDetail';

const STATUS_FLOW: DeliveryStatus[] = ['placed', 'confirmed', 'out_for_delivery', 'delivered'];

const STATUS_META: Record<DeliveryStatus, { label: string; color: string; icon: any }> = {
  placed: { label: 'Order Placed', color: 'text-amber-600 bg-amber-100', icon: Clock },
  confirmed: { label: 'Confirmed', color: 'text-blue-600 bg-blue-100', icon: CheckCircle2 },
  out_for_delivery: { label: 'Out for Delivery', color: 'text-purple-600 bg-purple-100', icon: Truck },
  delivered: { label: 'Delivered', color: 'text-emerald-600 bg-emerald-100', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', color: 'text-red-600 bg-red-100', icon: XCircle },
};

const MarketplaceApp: React.FC<MarketplaceAppProps> = ({ lang, setLang, onExitToStoreLogin }) => {
  const [booted, setBooted] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [authForm, setAuthForm] = useState({ name: '', phone: '', pin: '', address: '' });
  const [authError, setAuthError] = useState('');

  const [view, setView] = useState<MarketView>('stores');
  const [selectedStore, setSelectedStore] = useState<StoreDirectoryEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrder | null>(null);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [checkoutIdempotencyKey, setCheckoutIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    StorageService.getCurrentCustomer().then(c => {
      setCustomer(c);
      setBooted(true);
    });
  }, []);

  const { data: storesData } = useApiData(() => StorageService.getMarketplaceStores(), [], []);
  const stores = storesData || [];

  const { data: storeProductsData, refetch: refetchStoreProducts } = useApiData(
    () => (selectedStore ? StorageService.getMarketplaceStoreProducts(selectedStore.id) : Promise.resolve([])),
    [selectedStore?.id]
  );
  const storeProducts = storeProductsData || [];

  const { data: searchResultsData } = useApiData(
    () => (view === 'search' && searchQuery.trim() ? StorageService.searchMarketplaceProducts(searchQuery.trim()) : Promise.resolve([])),
    [view, searchQuery]
  );
  const searchResults = searchResultsData || [];

  const { data: myOrdersData, refetch: refetchOrders } = useApiData(
    () => (customer ? StorageService.getMyMarketplaceOrders() : Promise.resolve([])),
    [customer?.id]
  );
  const myOrders = (myOrdersData || []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  useEffect(() => {
    if (view === 'orderDetail' && selectedOrder) {
      const interval = setInterval(async () => {
        try {
          const fresh = await StorageService.getMarketplaceOrder(selectedOrder.id);
          setSelectedOrder(fresh);
        } catch {}
      }, 8000);
      return () => clearInterval(interval);
    }
  }, [view, selectedOrder?.id]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (isRegistering) {
      if (!authForm.name || !authForm.phone || !authForm.pin) {
        setAuthError('Name, phone and PIN are required');
        return;
      }
      try {
        const c = await StorageService.registerCustomer(authForm);
        setCustomer(c);
        setDeliveryAddress(c.address || '');
      } catch (err: any) {
        setAuthError(err.body?.error === 'PHONE_TAKEN' ? 'This phone number is already registered' : 'Registration failed');
      }
    } else {
      const result = await StorageService.loginCustomer(authForm.phone, authForm.pin);
      if (result.success) {
        const c = await StorageService.getCurrentCustomer();
        setCustomer(c);
        setDeliveryAddress(c?.address || '');
      } else {
        setAuthError('Invalid phone number or PIN');
      }
    }
  };

  const handleLogout = async () => {
    await StorageService.logout();
    setCustomer(null);
    setCart([]);
    setView('stores');
  };

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev
      .map(item => item.id === id ? { ...item, quantity: item.quantity + delta } : item)
      .filter(item => item.quantity > 0));
  };

  const cartTotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const cartStoreId = cart[0]?.storeId;

  const placeOrder = async () => {
    if (cart.length === 0 || !cartStoreId) return;
    if (!deliveryAddress.trim()) {
      alert('Please enter a delivery address');
      return;
    }
    setPlacingOrder(true);
    try {
      const order = await StorageService.createMarketplaceOrder({
        idempotencyKey: checkoutIdempotencyKey,
        storeId: cartStoreId,
        items: cart,
        deliveryAddress: deliveryAddress.trim(),
        paymentMethod: 'cod',
      });
      setCart([]);
      setIsCartOpen(false);
      setSelectedOrder(order);
      setView('orderDetail');
      setCheckoutIdempotencyKey(crypto.randomUUID());
      refetchOrders();
    } catch (e: any) {
      alert('Failed to place order: ' + (e.message || 'Unknown error'));
    } finally {
      setPlacingOrder(false);
    }
  };

  const openOrder = (order: OnlineOrder) => {
    setSelectedOrder(order);
    setView('orderDetail');
  };

  if (!booted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-slate-100 p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
          <div className="p-6 text-center border-b bg-gradient-to-r from-emerald-50 to-white">
            <img src={APP_LOGO} alt="Logo" className="w-14 h-14 mx-auto mb-2 object-contain" />
            <h1 className="text-xl font-bold text-emerald-700">Amar Dokan Marketplace</h1>
            <p className="text-xs text-gray-500 mt-1">Shop from local stores near you</p>
          </div>
          <form onSubmit={handleAuthSubmit} className="p-6 space-y-4">
            {isRegistering && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text" required
                  className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                  value={authForm.name}
                  onChange={e => setAuthForm({ ...authForm, name: e.target.value })}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <input
                type="tel" required
                className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="01XXXXXXXXX"
                value={authForm.phone}
                onChange={e => setAuthForm({ ...authForm, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PIN</label>
              <input
                type="password" required inputMode="numeric"
                className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                value={authForm.pin}
                onChange={e => setAuthForm({ ...authForm, pin: e.target.value })}
              />
            </div>
            {isRegistering && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Address (optional)</label>
                <input
                  type="text"
                  className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                  value={authForm.address}
                  onChange={e => setAuthForm({ ...authForm, address: e.target.value })}
                />
              </div>
            )}
            {authError && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg flex items-center gap-2">
                <Lock size={14} /> {authError}
              </div>
            )}
            <button type="submit" className="w-full bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700 transition">
              {isRegistering ? 'Create Account' : 'Login'}
            </button>
            <button
              type="button"
              onClick={() => { setIsRegistering(!isRegistering); setAuthError(''); }}
              className="w-full text-center text-sm text-emerald-600 font-medium"
            >
              {isRegistering ? 'Already have an account? Login' : "New here? Create an account"}
            </button>
            <button
              type="button"
              onClick={onExitToStoreLogin}
              className="w-full text-center text-xs text-gray-400 hover:text-gray-600 pt-2 border-t mt-2"
            >
              I'm a store owner — go to store login
            </button>
          </form>
        </div>
      </div>
    );
  }

  const activeOrdersCount = myOrders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length;

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-30 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <button onClick={() => { setView('stores'); setSelectedStore(null); }} className="flex items-center gap-2">
            <img src={APP_LOGO} alt="Logo" className="w-8 h-8 object-contain" />
            <span className="font-bold text-emerald-700 hidden sm:inline">Amar Dokan</span>
          </button>

          <div className="flex-1 max-w-md relative">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search products across stores..."
              className="w-full pl-9 pr-3 py-2 border rounded-full text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setView('search'); }}
              onFocus={() => searchQuery && setView('search')}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setLang(lang === 'en' ? 'bn' : 'en')}
              className="p-2 text-gray-500 hover:text-emerald-600"
              title="Language"
            >
              <Languages size={18} />
            </button>
            <button onClick={() => setView('orders')} className="relative p-2 text-gray-500 hover:text-emerald-600" title="My Orders">
              <ClipboardList size={20} />
              {activeOrdersCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {activeOrdersCount}
                </span>
              )}
            </button>
            <button onClick={() => setIsCartOpen(true)} className="relative p-2 text-gray-500 hover:text-emerald-600" title="Cart">
              <ShoppingCart size={20} />
              {cart.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {cart.reduce((a, i) => a + i.quantity, 0)}
                </span>
              )}
            </button>
            <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-500" title="Logout">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4">
        {/* STORE DIRECTORY */}
        {view === 'stores' && (
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-4">Browse Stores</h2>
            {stores.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Store size={40} className="mx-auto mb-3 opacity-30" />
                <p>No stores available yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {stores.map(store => (
                  <button
                    key={store.id}
                    onClick={() => { setSelectedStore(store); setView('store'); }}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md transition flex items-center gap-3"
                  >
                    <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg shrink-0 overflow-hidden">
                      {store.profilePicture
                        ? <img src={store.profilePicture} alt={`${store.storeName} profile`} className="w-full h-full object-cover" />
                        : store.storeName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 truncate">{store.storeName}</p>
                      <p className="text-xs text-gray-500 capitalize">{store.storeCategory}</p>
                      {(store.zila || store.thana) && (
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5 truncate">
                          <MapPin size={10} /> {[store.thana, store.zila].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SINGLE STORE PRODUCTS */}
        {view === 'store' && selectedStore && (
          <div>
            <button onClick={() => { setView('stores'); setSelectedStore(null); }} className="flex items-center gap-1 text-gray-600 font-medium mb-4">
              <ArrowLeft size={16} /> Back to Stores
            </button>
            <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-4 mb-4">
              {selectedStore.profilePicture
                ? <img src={selectedStore.profilePicture} alt={`${selectedStore.storeName} profile`} className="w-14 h-14 rounded-full object-cover" />
                : <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-bold">{selectedStore.storeName.charAt(0)}</div>}
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-800">{selectedStore.storeName}</h2>
                <p className="text-sm text-gray-500 capitalize">{selectedStore.storeCategory}</p>
                <p className="text-xs text-gray-500">{[selectedStore.address, selectedStore.thana, selectedStore.zila].filter(Boolean).join(', ')}</p>
                {selectedStore.phone && <p className="text-xs text-gray-500">{selectedStore.phone}</p>}
              </div>
            </div>
            <ProductGrid products={storeProducts} lang={lang} onAdd={addToCart} />
          </div>
        )}

        {/* SEARCH RESULTS */}
        {view === 'search' && (
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-4">
              {searchQuery.trim() ? `Results for "${searchQuery}"` : 'Search Products'}
            </h2>
            <ProductGrid products={searchResults} lang={lang} onAdd={addToCart} showStore />
          </div>
        )}

        {/* MY ORDERS */}
        {view === 'orders' && (
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-4">My Orders</h2>
            {myOrders.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Package size={40} className="mx-auto mb-3 opacity-30" />
                <p>No orders yet. Start shopping!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myOrders.map(order => {
                  const meta = STATUS_META[order.status];
                  const StatusIcon = meta.icon;
                  return (
                    <button
                      key={order.id}
                      onClick={() => openOrder(order)}
                      className="w-full bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center justify-between text-left hover:shadow-md transition"
                    >
                      <div>
                        <p className="font-bold text-gray-800">{order.storeName || 'Store'}</p>
                        <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleString()}</p>
                        <p className="text-sm text-gray-600 mt-1">৳{order.totalAmount}</p>
                      </div>
                      <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${meta.color}`}>
                        <StatusIcon size={13} /> {meta.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ORDER DETAIL / TRACKING */}
        {view === 'orderDetail' && selectedOrder && (
          <div>
            <button onClick={() => setView('orders')} className="flex items-center gap-1 text-gray-600 font-medium mb-4">
              <ArrowLeft size={16} /> Back to Orders
            </button>
            <OrderTrackingCard order={selectedOrder} lang={lang} />
          </div>
        )}
      </div>

      {/* CART DRAWER */}
      {isCartOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsCartOpen(false)} />
          <div className="relative bg-white w-full max-w-sm h-full shadow-2xl flex flex-col animate-in slide-in-from-right">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-bold text-gray-800 flex items-center gap-2"><ShoppingCart size={18} /> Your Cart</h3>
              <button onClick={() => setIsCartOpen(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.length === 0 ? (
                <p className="text-center text-gray-400 py-10">Your cart is empty</p>
              ) : (
                cart.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-2 border-b pb-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 text-sm truncate">{lang === 'bn' ? item.nameBn : item.name}</p>
                      <p className="text-xs text-gray-400">৳{item.price} each</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => updateQty(item.id, -1)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center"><Minus size={14} /></button>
                      <span className="w-5 text-center font-bold text-sm">{item.quantity}</span>
                      <button onClick={() => updateQty(item.id, 1)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center"><Plus size={14} /></button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {cart.length > 0 && (
              <div className="p-4 border-t space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Delivery Address</label>
                  <input
                    type="text"
                    className="w-full p-2.5 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    placeholder="House, Road, Area..."
                    value={deliveryAddress}
                    onChange={e => setDeliveryAddress(e.target.value)}
                  />
                </div>
                <div className="flex justify-between font-bold text-gray-800">
                  <span>Subtotal</span>
                  <span>৳{cartTotal}</span>
                </div>
                <button
                  onClick={placeOrder}
                  disabled={placingOrder}
                  className="w-full bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {placingOrder ? 'Placing Order...' : 'Place Order (Cash on Delivery)'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ProductGrid: React.FC<{ products: Product[]; lang: Language; onAdd: (p: Product) => void; showStore?: boolean }> = ({ products, lang, onAdd, showStore }) => {
  if (products.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <Package size={40} className="mx-auto mb-3 opacity-30" />
        <p>No products found.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {products.map(product => (
        <div key={product.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
            {product.image ? (
              <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <Package className="text-gray-300" size={32} />
            )}
          </div>
          <div className="p-3 flex-1 flex flex-col">
            <p className="text-sm font-medium text-gray-800 line-clamp-2 flex-1">{lang === 'bn' ? product.nameBn || product.name : product.name}</p>
            {showStore && (product as any).storeName && (
              <p className="text-[10px] text-gray-400 mt-0.5 truncate">{(product as any).storeName}</p>
            )}
            <div className="flex items-center justify-between mt-2">
              <span className="font-bold text-emerald-700">৳{product.price}</span>
              <button
                onClick={() => onAdd(product)}
                className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const OrderTrackingCard: React.FC<{ order: OnlineOrder; lang: Language }> = ({ order, lang }) => {
  const currentIdx = order.status === 'cancelled' ? -1 : STATUS_FLOW.indexOf(order.status);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b bg-gray-50/50">
        <p className="text-xs font-mono text-gray-400">Order #{order.id.slice(-6)}</p>
        <p className="font-bold text-gray-800">{order.storeName || 'Store'}</p>
        <p className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleString()}</p>
      </div>

      <div className="p-6">
        {order.status === 'cancelled' ? (
          <div className="flex items-center gap-3 text-red-600 font-bold justify-center py-6">
            <XCircle size={28} /> Order Cancelled
          </div>
        ) : (
          <div className="flex items-center justify-between mb-6">
            {STATUS_FLOW.map((status, idx) => {
              const meta = STATUS_META[status];
              const StatusIcon = meta.icon;
              const reached = idx <= currentIdx;
              return (
                <React.Fragment key={status}>
                  <div className="flex flex-col items-center gap-1 flex-1">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${reached ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-300'}`}>
                      <StatusIcon size={16} />
                    </div>
                    <span className={`text-[10px] font-bold text-center ${reached ? 'text-emerald-700' : 'text-gray-300'}`}>{meta.label}</span>
                  </div>
                  {idx < STATUS_FLOW.length - 1 && (
                    <div className={`h-0.5 flex-1 -mt-4 ${idx < currentIdx ? 'bg-emerald-500' : 'bg-gray-100'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        <div className="space-y-2 mb-4">
          <div className="flex items-start gap-2 text-sm text-gray-600">
            <MapPin size={14} className="mt-0.5 shrink-0" /> {order.deliveryAddress}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Phone size={14} /> {order.customerPhone}
          </div>
        </div>

        <ul className="space-y-1 pt-3 border-t border-dashed">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between text-sm">
              <span className="text-gray-700"><span className="font-bold">{item.quantity}x</span> {lang === 'bn' ? item.nameBn : item.name}</span>
              <span className="text-gray-500">৳{item.price * item.quantity}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between items-center pt-3 mt-2 border-t text-sm text-gray-500">
          <span>Delivery Fee</span>
          <span>৳{order.deliveryFee}</span>
        </div>
        <div className="flex justify-between items-center font-bold text-gray-800 text-lg mt-1">
          <span>Total</span>
          <span>৳{order.totalAmount}</span>
        </div>
      </div>
    </div>
  );
};

export default MarketplaceApp;
