
import React, { useState, useEffect, useCallback } from 'react';
import { StorageService } from '../../services/storage';
import { RestaurantTable, Product, CartItem, GuestOrder, Language } from '../../types';
import { ShoppingCart, Plus, Minus, X, ChefHat, Leaf, Clock, ArrowLeft, Send, ClipboardList, Home, WifiOff, AlertTriangle } from 'lucide-react';
import { TRANSLATIONS } from '../../constants';
import GuestOrderTracking from './GuestOrderTracking';

interface GuestMenuProps {
  lang: Language;
  tableId: string;
  storeId: string | null;
  onExit: () => void;
}

type GuestView = 'menu' | 'status';

const GUEST_ORDERS_KEY = 'pos_guest_order_ids';

const GuestMenu: React.FC<GuestMenuProps> = ({ lang, tableId, storeId, onExit }) => {
  const t = TRANSLATIONS[lang];
  const pendingRequestStorageKey = `${GUEST_ORDERS_KEY}:pending:${storeId || 'unknown'}:${tableId}`;

  const [products, setProducts] = useState<Product[]>([]);
  const [table, setTable] = useState<RestaurantTable | undefined>(undefined);

  // Local Guest State
  const [view, setView] = useState<GuestView>('menu');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [activeOrders, setActiveOrders] = useState<GuestOrder[]>([]);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(() => {
      try {
          return sessionStorage.getItem(pendingRequestStorageKey);
      } catch {
          return null;
      }
  });
  const [guestOrderIds, setGuestOrderIds] = useState<string[]>(() => {
      try {
          const parsed = JSON.parse(localStorage.getItem(GUEST_ORDERS_KEY) || '[]');
          return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
      } catch {
          return [];
      }
  });
  const [trackingError, setTrackingError] = useState('');
  const [isLoadingMenu, setIsLoadingMenu] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
      try {
          setPendingRequestId(sessionStorage.getItem(pendingRequestStorageKey));
      } catch {
          setPendingRequestId(null);
      }
  }, [pendingRequestStorageKey]);

  useEffect(() => {
      let cancelled = false;
      setIsLoadingMenu(true);
      setMenuError(null);
      Promise.all([
          storeId ? StorageService.getPublicMenu(storeId) : Promise.reject(new Error('Restaurant not found.')),
          StorageService.getPublicTable(tableId),
      ]).then(([menu, resolvedTable]) => {
          if (cancelled) return;
          setProducts(menu);
          setTable(resolvedTable);
      }).catch((error) => {
          if (cancelled) return;
          setProducts([]);
          setTable(undefined);
          setMenuError(error instanceof Error ? error.message : 'Could not connect to the restaurant.');
      }).finally(() => {
          if (!cancelled) setIsLoadingMenu(false);
      });
      return () => { cancelled = true; };
  }, [storeId, tableId]);

  const refreshActiveOrders = useCallback(async () => {
      const results = await Promise.all(guestOrderIds.map(async (id) => {
          try {
              return { order: await StorageService.getGuestOrder(id) };
          } catch (error) {
              return { error };
          }
      }));
      if (results.some((result) => 'error' in result)) {
          setTrackingError('Could not refresh order status. Your last status is still shown.');
          return;
      }
      const filtered = results
          .flatMap((result) => 'order' in result ? [result.order] : [])
          .filter((order): order is GuestOrder => !!order && order.tableId === tableId && order.status !== 'served' && order.status !== 'cancelled')
          .reverse();
      setActiveOrders(filtered);
      setTrackingError('');
  }, [guestOrderIds, tableId]);

  useEffect(() => {
      refreshActiveOrders();
      const interval = setInterval(refreshActiveOrders, 8000);
      return () => clearInterval(interval);
  }, [refreshActiveOrders]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => 
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
    setIsCartOpen(true);
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(0, item.quantity + delta);
        if (newQty === 0) return item; 
        return { ...item, quantity: newQty };
      }
      return item;
    }).filter(i => i.quantity > 0));
  };

  const updateNote = (id: string, note: string) => {
      setCart(prev => prev.map(item => item.id === id ? { ...item, note } : item));
  };

  const placeOrder = async () => {
      if (cart.length === 0 || isSubmitting || !table || !storeId) return;
      setIsSubmitting(true);
      setOrderError(null);

      try {
          const newOrder: Omit<GuestOrder, 'id'> = {
              storeId,
              tableId,
              items: cart,
              status: 'pending',
              createdAt: new Date().toISOString(),
              totalAmount: cart.reduce((acc, i) => acc + (i.price * i.quantity), 0)
          };

          const requestId = pendingRequestId || crypto.randomUUID();
          setPendingRequestId(requestId);
          try {
              sessionStorage.setItem(pendingRequestStorageKey, requestId);
          } catch {}
          const created = await StorageService.createGuestOrder({ ...newOrder, idempotencyKey: requestId });
          try {
              sessionStorage.removeItem(pendingRequestStorageKey);
          } catch {}
          setPendingRequestId(null);

          try {
              const raw = localStorage.getItem(GUEST_ORDERS_KEY);
              const ids: string[] = raw ? JSON.parse(raw) : [];
              const nextIds = [...new Set([...ids, created.id])];
              setGuestOrderIds(nextIds);
              localStorage.setItem(GUEST_ORDERS_KEY, JSON.stringify(nextIds));
          } catch {}

          setGuestOrderIds(previous => previous.includes(created.id) ? previous : [...previous, created.id]);
          setActiveOrders(previous => [created, ...previous.filter(order => order.id !== created.id)]);
          setCart([]);
          setIsCartOpen(false);
          setView('status');
      } catch (error) {
          if ((error as any)?.body?.error === 'IDEMPOTENCY_KEY_REUSED' && pendingRequestId) {
              const nextIds = [...new Set([...guestOrderIds, pendingRequestId])];
              setGuestOrderIds(nextIds);
              try {
                  localStorage.setItem(GUEST_ORDERS_KEY, JSON.stringify(nextIds));
                  sessionStorage.removeItem(pendingRequestStorageKey);
              } catch {}
              setPendingRequestId(null);
              setTrackingError('An earlier order may already have reached the kitchen. Check its status before placing another order.');
              setView('status');
              return;
          }
          setOrderError(error instanceof Error ? error.message : 'The order could not be submitted.');
      } finally {
          setIsSubmitting(false);
      }
  };

  // Explicitly type categories to avoid 'unknown' type inference issues
  const categories: string[] = Array.from(new Set(products.map(p => p.category)));
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const filteredProducts = selectedCategory === 'All' 
    ? products 
    : products.filter(p => p.category === selectedCategory);

  // --- Render Status View (Tracking) ---
  if (view === 'status') {
      return (
          <div className="fixed inset-0 z-50 bg-white">
            {trackingError && <div role="status" className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">{trackingError}</div>}
            <GuestOrderTracking
              orders={activeOrders}
              table={table}
              lang={lang}
              onOrderMore={() => setView('menu')}
            />
          </div>
      );
  }

  // --- Render Menu View ---
  return (
    <div className="fixed inset-0 bg-white z-50 overflow-hidden flex flex-col font-sans">
      {trackingError && <div role="status" className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">{trackingError}</div>}
      {/* Header */}
      <div className="bg-white border-b shadow-sm p-4 flex justify-between items-center z-20">
          <div className="flex items-center gap-3">
              <button onClick={onExit} className="p-1 text-gray-500 hover:bg-gray-100 rounded-full"><Home size={20} /></button>
              <div>
                  <h1 className="font-bold text-gray-800 leading-none">{table?.name || 'Guest'}</h1>
                  <p className="text-xs text-gray-500">Tap + to add items</p>
              </div>
          </div>
          
          <div className="flex gap-3">
              {/* Order History Button */}
              {activeOrders.length > 0 && (
                  <button 
                    onClick={() => setView('status')}
                    className="relative p-2 bg-orange-50 text-orange-600 rounded-full border border-orange-100 animate-pulse-slow"
                  >
                      <ClipboardList size={22} />
                      <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold border-2 border-white">
                          {activeOrders.length}
                      </span>
                  </button>
              )}

              {/* Cart Button */}
              <button 
                onClick={() => setIsCartOpen(true)}
                className="relative p-2 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100"
              >
                  <ShoppingCart size={22} />
                  {cart.length > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold border-2 border-white">
                          {cart.reduce((a,c) => a+c.quantity, 0)}
                      </span>
                  )}
              </button>
          </div>
      </div>

      {/* Categories */}
      <div className="bg-gray-50 p-2 overflow-x-auto whitespace-nowrap border-b flex gap-2 no-scrollbar">
          <button 
             onClick={() => setSelectedCategory('All')}
             className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${selectedCategory === 'All' ? 'bg-orange-600 text-white shadow' : 'bg-white text-gray-600 border'}`}
          >
              All
          </button>
          {categories.map((cat: string) => (
              <button 
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${selectedCategory === cat ? 'bg-orange-600 text-white shadow' : 'bg-white text-gray-600 border'}`}
              >
                  {cat}
              </button>
          ))}
      </div>

      {/* Menu List */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50 pb-24">
         {isLoadingMenu && (
             <div className="p-8 text-center text-gray-500">Loading restaurant menu…</div>
         )}

         {!isLoadingMenu && products.length === 0 && (
             <div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-70">
                 <div className="bg-orange-100 p-4 rounded-full mb-4 text-orange-600">
                     <AlertTriangle size={32} />
                 </div>
                 <h3 className="font-bold text-gray-800 text-lg mb-2">Menu Not Found</h3>
                 <p className="text-gray-500 text-sm mb-4">{menuError || 'This restaurant has no online menu available.'}</p>
                 <button onClick={() => window.location.reload()} className="text-sm font-semibold text-orange-700 underline">
                     Try again
                 </button>
             </div>
         )}

         <div className="grid grid-cols-1 gap-4">
             {filteredProducts.map(product => (
                 <div key={product.id} className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex gap-4">
                     <div className="w-24 h-24 bg-gray-100 rounded-lg shrink-0 overflow-hidden relative">
                         {product.image ? (
                             <img src={product.image} className="w-full h-full object-cover" alt={product.name} />
                         ) : (
                             <div className="w-full h-full flex items-center justify-center text-gray-300">
                                 <ChefHat size={32} />
                             </div>
                         )}
                         {/* Dietary Badge */}
                         {product.dietaryType && (
                             <div className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-0.5 shadow-sm ${product.dietaryType === 'veg' ? 'bg-white text-green-700' : 'bg-white text-red-700'}`}>
                                 <div className={`w-2 h-2 rounded-full ${product.dietaryType === 'veg' ? 'bg-green-600' : 'bg-red-600'}`} />
                                 {product.dietaryType === 'veg' ? 'Veg' : 'Non'}
                             </div>
                         )}
                     </div>
                     <div className="flex-1 flex flex-col justify-between">
                         <div>
                             <h3 className="font-bold text-gray-800 line-clamp-1">{lang==='bn' ? product.nameBn : product.name}</h3>
                             <p className="text-xs text-gray-500 line-clamp-2 mt-1">{product.category}</p>
                             {product.preparationTime && (
                                 <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-1">
                                     <Clock size={10} /> ~{product.preparationTime} mins
                                 </div>
                             )}
                         </div>
                         <div className="flex justify-between items-end mt-2">
                             <span className="font-bold text-gray-900 text-lg">৳{product.price}</span>
                             <button 
                                onClick={() => addToCart(product)}
                                className="bg-orange-100 text-orange-700 px-4 py-1.5 rounded-lg text-sm font-bold active:scale-95 transition hover:bg-orange-200"
                             >
                                 ADD +
                             </button>
                         </div>
                     </div>
                 </div>
             ))}
         </div>
      </div>

      {/* Cart Modal / Bottom Sheet */}
      {isCartOpen && (
          <div className="absolute inset-0 z-50 bg-black/50 flex flex-col justify-end">
              <div onClick={() => setIsCartOpen(false)} className="flex-1" />
              <div className="bg-white rounded-t-2xl shadow-xl overflow-hidden max-h-[85vh] flex flex-col animate-in slide-in-from-bottom duration-300">
                  <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                      <h2 className="font-bold text-lg">Current Order</h2>
                      <button onClick={() => setIsCartOpen(false)}><X size={24} className="text-gray-500" /></button>
                  </div>
                  
                  <div className="p-4 overflow-y-auto flex-1 space-y-4">
                      {cart.length === 0 ? (
                          <div className="text-center py-10 text-gray-400">Cart is empty</div>
                      ) : (
                          cart.map(item => (
                              <div key={item.id} className="border-b pb-4 last:border-0">
                                  <div className="flex justify-between items-start mb-2">
                                      <div className="font-medium text-gray-800">{lang==='bn' ? item.nameBn : item.name}</div>
                                      <div className="font-bold text-gray-800">৳{item.price * item.quantity}</div>
                                  </div>
                                  <div className="flex justify-between items-center">
                                      <div className="flex items-center gap-3 bg-gray-100 rounded-lg p-1">
                                          <button onClick={() => updateQuantity(item.id, -1)} className="w-8 h-8 bg-white rounded shadow text-gray-600 flex items-center justify-center font-bold">-</button>
                                          <span className="font-bold text-gray-800 w-4 text-center">{item.quantity}</span>
                                          <button onClick={() => updateQuantity(item.id, 1)} className="w-8 h-8 bg-white rounded shadow text-emerald-600 flex items-center justify-center font-bold">+</button>
                                      </div>
                                      <input 
                                        type="text" 
                                        placeholder="Note (e.g. no spice)"
                                        className="text-xs border rounded px-2 py-1.5 bg-gray-50 w-32 outline-none focus:border-orange-500"
                                        value={item.note || ''}
                                        onChange={(e) => updateNote(item.id, e.target.value)}
                                      />
                                  </div>
                              </div>
                          ))
                      )}
                  </div>

                  <div className="p-4 border-t bg-gray-50">
                      <div className="flex justify-between items-center mb-4 text-lg font-bold">
                          <span>Total</span>
                          <span>৳{cart.reduce((a, c) => a + (c.price * c.quantity), 0)}</span>
                      </div>
                      {orderError && <p role="alert" className="mb-3 text-sm text-red-700">{orderError}</p>}
                      <p className="mb-3 text-xs text-gray-500">
                        The restaurant receives this order from its server. Payment is handled separately by staff.
                      </p>
                      <button 
                        onClick={placeOrder}
                        disabled={cart.length === 0 || isSubmitting || isLoadingMenu || !table}
                        className="w-full bg-orange-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-orange-200 flex items-center justify-center gap-2 text-lg active:scale-95 transition disabled:opacity-50"
                      >
                          <Send size={20} /> {isSubmitting ? 'Sending…' : 'Place Order'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default GuestMenu;
