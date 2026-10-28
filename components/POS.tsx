
import React, { useState, useEffect } from 'react';
import { Product, CartItem, Sale, Language, User } from '../types';
import { TRANSLATIONS } from '../constants';
import { Search, Plus, Trash2, ShoppingCart, User as UserIcon, Phone, Smartphone, CreditCard, Banknote, PackageOpen, AlertCircle, ScanBarcode } from 'lucide-react';
import { StorageService } from '../services/storage';
import { useApiData } from '../hooks/useApiData';
import SubscriptionModal from './SubscriptionModal';
import { calculateSaleTotals, parseMoneyInput } from '../shared/finance';

interface POSProps {
  lang: Language;
  onCheckout: (sale: Sale) => void;
}

const POS: React.FC<POSProps> = ({ lang, onCheckout }) => {
  const t = TRANSLATIONS[lang];
  const { data: productsData } = useApiData(() => StorageService.getProducts(), []);
  const products = productsData || [];
  const [user, setUser] = useState<User | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);
  
  // Mobile Tab State
  const [activeMobileTab, setActiveMobileTab] = useState<'products' | 'cart'>('products');

  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paidAmountInput, setPaidAmountInput] = useState<string>('');
  const [discountInput, setDiscountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bkash' | 'nagad' | 'card'>('cash');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    StorageService.getCurrentUser().then(setUser);
  }, [showUpsell]);

  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
        alert("Out of stock!");
        return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
            return prev;
        }
        return prev.map(item => 
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && search.trim()) {
          // Barcode scan logic: exact match prioritized
          const exactMatch = products.find(p => p.barcode === search.trim());
          if (exactMatch) {
              addToCart(exactMatch);
              setSearch(''); // Clear search after scan
          }
      }
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(0.1, item.quantity + delta);
        if (newQty > item.stock) return item; 
        return { ...item, quantity: parseFloat(newQty.toFixed(2)) };
      }
      return item;
    }));
  };

  const handleManualQuantityChange = (id: string, val: string) => {
      const numVal = parseFloat(val);
      if (isNaN(numVal) || numVal < 0) return;

      setCart(prev => prev.map(item => {
        if(item.id === id) {
             if(numVal > item.stock) {
                 return {...item, quantity: item.stock};
             }
             return {...item, quantity: numVal};
        }
        return item;
      }));
  };

  const handlePriceChange = (id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal) || numVal < 0) return;

    setCart(prev => prev.map(item => {
        if (item.id === id) {
            return { ...item, price: numVal };
        }
        return item;
    }));
  };

  const vatRate = user?.defaultVatRate ?? 0;
  let calculation: ReturnType<typeof calculateSaleTotals> | null = null;
  let calculationError = '';
  try {
      const discount = discountInput.trim() === '' ? 0 : parseMoneyInput(discountInput, 'discount');
      const amountReceived = paidAmountInput.trim() === '' ? null : parseMoneyInput(paidAmountInput, 'payment');
      calculation = calculateSaleTotals(cart, discount, vatRate, amountReceived, paymentMethod);
  } catch (error) {
      calculationError = error instanceof Error ? error.message : 'Invalid sale details';
  }

  const subTotal = calculation?.subTotal ?? 0;
  const discount = calculation?.discount ?? 0;
  const vatAmount = calculation?.vat ?? 0;
  const totalAmount = calculation?.totalAmount ?? 0;
  const paidAmount = calculation?.paidAmount ?? 0;
  const dueAmount = calculation?.dueAmount ?? 0;
  const changeAmount = calculation?.changeAmount ?? 0;

  const handleCheckout = async () => {
    if (isSubmitting || cart.length === 0 || !calculation) return;
    
    if (dueAmount > 0 && !customerName.trim()) {
        alert(lang === 'bn' ? 'বাকি থাকলে ক্রেতার নাম অবশ্যই দিতে হবে।' : 'Customer name is required for due payment.');
        return;
    }

    const sale: Sale = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      items: cart,
      subTotal: calculation.subTotal,
      discount: calculation.discount,
      vat: calculation.vat,
      totalAmount: calculation.totalAmount,
      totalProfit: calculation.totalProfit,
      paymentMethod: paymentMethod,
      customerName: customerName,
      customerPhone: customerPhone,
      paidAmount: calculation.paidAmount,
      cashReceived: calculation.cashReceived,
      changeAmount: calculation.changeAmount,
      dueAmount: calculation.dueAmount,
    };

    try {
        setIsSubmitting(true);
        const savedSale = await StorageService.addSale(sale);
        onCheckout(savedSale);
        // Reset Form
        setCart([]);
        setCustomerName('');
        setCustomerPhone('');
        setPaidAmountInput('');
        setDiscountInput('');
        setPaymentMethod('cash');
        setActiveMobileTab('products'); // Return to products view
    } catch (error: any) {
        if (error.message === 'FREE_LIMIT_REACHED') {
            setShowUpsell(true);
        } else {
            console.error("Checkout Error:", error);
            alert("Checkout Failed: " + (error.message || "Unknown error"));
        }
    } finally {
        setIsSubmitting(false);
    }
  };

  const filteredProducts = products.filter(p => {
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || 
           p.nameBn.includes(search) ||
           (p.barcode && p.barcode.includes(search)) ||
           (p.genericName && p.genericName.toLowerCase().includes(q)) || // Search by Generic
           (p.serialNumber && p.serialNumber.toLowerCase().includes(q)); // Search by Serial
  });

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden bg-gray-50 relative">
      {showUpsell && (
        <SubscriptionModal 
            lang={lang} 
            onClose={() => setShowUpsell(false)} 
            onSuccess={() => StorageService.getCurrentUser().then(setUser)} 
        />
      )}

      {/* Mobile Tab Switcher */}
      <div className="md:hidden flex border-b bg-white shadow-sm z-30 shrink-0">
          <button 
            onClick={() => setActiveMobileTab('products')}
            className={`flex-1 py-3 font-semibold text-sm flex items-center justify-center gap-2 ${activeMobileTab === 'products' ? 'text-emerald-600 border-b-2 border-emerald-600 bg-emerald-50' : 'text-gray-500'}`}
          >
              <PackageOpen size={18} /> Products
          </button>
          <button 
            onClick={() => setActiveMobileTab('cart')}
            className={`flex-1 py-3 font-semibold text-sm flex items-center justify-center gap-2 ${activeMobileTab === 'cart' ? 'text-emerald-600 border-b-2 border-emerald-600 bg-emerald-50' : 'text-gray-500'}`}
          >
              <ShoppingCart size={18} /> Cart ({cart.length})
          </button>
      </div>

      {/* Product Grid - Left Side */}
      <div className={`flex-1 flex flex-col h-full overflow-hidden ${activeMobileTab === 'products' ? 'block' : 'hidden md:flex'}`}>
        <div className="p-4 bg-white border-b shadow-sm z-10 shrink-0">
          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input 
                type="text" 
                placeholder={t.searchPlaceholder}
                className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 pb-20 md:pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {filteredProducts.map(product => (
              <div 
                key={product.id} 
                onClick={() => addToCart(product)}
                className={`bg-white rounded-xl shadow-sm border border-gray-100 p-3 md:p-4 cursor-pointer hover:shadow-md hover:border-emerald-200 transition group flex flex-col justify-between min-h-[120px] relative ${product.stock === 0 ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {/* Expiry Warning Overlay (Medicine Only) */}
                {user?.storeCategory === 'medicine' && product.expiryDate && new Date(product.expiryDate) < new Date() && (
                    <div className="absolute top-2 right-2 text-red-500" title="Expired">
                        <AlertCircle size={16} />
                    </div>
                )}

                <div>
                    <div className="flex justify-between items-start gap-2">
                        <div>
                            <h3 className="font-semibold text-gray-800 text-sm line-clamp-2 leading-snug">
                                {lang === 'bn' ? product.nameBn : product.name}
                            </h3>
                            {/* Generic Name / Brand Display */}
                            {user?.storeCategory === 'medicine' && product.genericName && (
                                <p className="text-[10px] text-gray-500 italic">{product.genericName}</p>
                            )}
                            {user?.storeCategory === 'clothing' && product.brand && (
                                <p className="text-[10px] text-gray-500 font-bold">{product.brand}</p>
                            )}
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold whitespace-nowrap ${product.stock < 10 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                            {product.stock} {product.unit}
                        </span>
                    </div>
                    {/* Smart Inventory Details */}
                    <div className="mt-2 text-xs text-gray-500 flex flex-wrap gap-1">
                        {product.color && <span className="bg-gray-100 px-1 rounded">{product.color}</span>}
                        {product.size && <span className="bg-gray-100 px-1 rounded font-bold">{product.size}</span>}
                        {product.expiryDate && user?.storeCategory === 'medicine' && (
                            <span className={`${new Date(product.expiryDate) < new Date() ? 'text-red-500 font-bold' : 'text-orange-600'}`}>
                                Exp: {new Date(product.expiryDate).toLocaleDateString(undefined, {month:'short', year: '2-digit'})}
                            </span>
                        )}
                        {product.serialNumber && <span className="font-mono text-[10px] bg-slate-100 px-1">{product.serialNumber}</span>}
                    </div>
                </div>
                
                <div className="flex justify-between items-end mt-2 md:mt-3 pt-2 border-t border-dashed border-gray-100">
                    <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">{product.category}</span>
                        <span className="text-emerald-600 font-bold text-base md:text-lg">৳{product.price}</span>
                    </div>
                    <button className="bg-emerald-50 text-emerald-600 p-1.5 md:p-2 rounded-lg group-hover:bg-emerald-600 group-hover:text-white transition">
                      <Plus size={18} />
                    </button>
                </div>
              </div>
            ))}
          </div>
          <div className="h-10 md:hidden"></div>
        </div>
      </div>

      {/* Cart - Right Side */}
      <div className={`w-full md:w-[400px] bg-white border-l shadow-xl flex flex-col h-full z-20 ${activeMobileTab === 'cart' ? 'block absolute inset-0 md:static' : 'hidden md:flex'}`}>
        {/* Cart Header Mobile */}
        <div className="md:hidden bg-gray-100 p-2 flex justify-between items-center border-b">
             <button onClick={() => setActiveMobileTab('products')} className="px-3 py-1 text-sm text-gray-600">Back</button>
             <span className="font-bold text-gray-700">Current Order</span>
             <button onClick={() => setCart([])} className="px-3 py-1 text-sm text-red-500">Clear</button>
        </div>

        {/* Customer Info Section */}
        <div className="p-3 bg-emerald-50 border-b space-y-2 shrink-0">
            <div className="flex gap-2">
                <div className="flex flex-1 items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2">
                    <UserIcon size={16} className="text-gray-400" />
                    <input 
                        type="text"
                        placeholder={t.customerName}
                        className="flex-1 outline-none text-sm bg-transparent"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                    />
                </div>
                <div className="flex flex-1 items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2">
                    <Phone size={16} className="text-gray-400" />
                    <input 
                        type="tel"
                        placeholder={t.customerPhone}
                        className="flex-1 outline-none text-sm bg-transparent"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                    />
                </div>
            </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50/50">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <ShoppingCart size={48} className="mb-2 opacity-20" />
              <p className="text-sm">Cart is empty</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="flex items-center gap-2 bg-white border border-gray-100 p-2 rounded-lg shadow-sm">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-800 text-sm truncate">{lang === 'bn' ? item.nameBn : item.name}</h4>
                  
                  {/* Category Wise Cart Details */}
                  <div className="text-[10px] text-gray-500 flex flex-wrap gap-2 mt-0.5">
                      {item.genericName && user?.storeCategory === 'medicine' && <span>{item.genericName}</span>}
                      {item.brand && (user?.storeCategory === 'clothing' || user?.storeCategory === 'electronics') && <span className="font-bold">{item.brand}</span>}
                      {item.size && <span>Size: {item.size}</span>}
                      {item.color && <span>{item.color}</span>}
                  </div>

                  <div className="flex items-center text-emerald-600 font-bold text-sm mt-1">
                    <span>৳</span>
                    <input 
                      type="number"
                      value={item.price}
                      onChange={(e) => handlePriceChange(item.id, e.target.value)}
                      className="w-16 bg-transparent border-b border-dashed border-emerald-300 focus:border-emerald-600 outline-none px-1 text-emerald-600 font-bold"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-1 border border-gray-200">
                  <button onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, -1); }} className="w-8 h-8 md:w-6 md:h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-red-500 border border-gray-100">-</button>
                  <div className="flex items-center px-1">
                    <input 
                        type="number" 
                        value={item.quantity}
                        onChange={(e) => handleManualQuantityChange(item.id, e.target.value)}
                        className="w-10 md:w-8 text-center text-sm font-medium outline-none py-1 appearance-none bg-transparent"
                    />
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, 1); }} className="w-8 h-8 md:w-6 md:h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-emerald-600 border border-gray-100">+</button>
                </div>
                <button onClick={() => removeFromCart(item.id)} className="text-gray-400 hover:text-red-500 p-2 md:p-1">
                  <Trash2 className="w-[18px] h-[18px] md:w-4 md:h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Totals & Checkout Section */}
        <div className="p-4 border-t bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] shrink-0">
            {/* Calculation Rows */}
            <div className="space-y-2 mb-3 text-sm">
                <div className="flex justify-between text-gray-500">
                    <span>{t.subTotal}</span>
                    <span>৳{subTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-gray-500">
                    <span className="text-emerald-600 font-medium">{t.discount} (-)</span>
                    <div className="flex items-center border-b border-gray-300 w-20 justify-end">
                        <span className="text-xs mr-1">৳</span>
                        <input 
                            type="number" 
                            min="0"
                            step="0.01"
                            value={discountInput}
                            onChange={(e) => setDiscountInput(e.target.value)}
                            aria-label={t.discount}
                            aria-invalid={!!calculationError}
                            className="w-full text-right outline-none text-emerald-600 font-bold"
                            placeholder="0"
                        />
                    </div>
                </div>
                {/* VAT Row */}
                <div className="flex justify-between items-center text-gray-500">
                    <span className="font-medium">{t.vat} ({vatRate}%)</span>
                    <span>৳{vatAmount.toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-center text-lg font-bold text-gray-800 border-t border-dashed pt-2">
                    <span>{t.total}</span>
                    <span>৳{totalAmount.toFixed(2)}</span>
                </div>
            </div>

            {/* Payment Method Selector */}
            <div className="grid grid-cols-4 gap-2 mb-3">
                <button 
                    onClick={() => setPaymentMethod('cash')}
                    className={`flex flex-col items-center justify-center py-2 rounded-lg border transition ${paymentMethod === 'cash' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-gray-200 text-gray-500'}`}
                >
                    <Banknote size={18} />
                    <span className="text-[10px] font-bold mt-1">Cash</span>
                </button>
                <button 
                    onClick={() => setPaymentMethod('bkash')}
                    className={`flex flex-col items-center justify-center py-2 rounded-lg border transition ${paymentMethod === 'bkash' ? 'bg-pink-50 border-pink-500 text-pink-700' : 'bg-white border-gray-200 text-gray-500'}`}
                >
                    <Smartphone size={18} />
                    <span className="text-[10px] font-bold mt-1">Bkash</span>
                </button>
                <button 
                    onClick={() => setPaymentMethod('nagad')}
                    className={`flex flex-col items-center justify-center py-2 rounded-lg border transition ${paymentMethod === 'nagad' ? 'bg-orange-50 border-orange-500 text-orange-700' : 'bg-white border-gray-200 text-gray-500'}`}
                >
                    <Smartphone size={18} />
                    <span className="text-[10px] font-bold mt-1">Nagad</span>
                </button>
                <button 
                    onClick={() => setPaymentMethod('card')}
                    className={`flex flex-col items-center justify-center py-2 rounded-lg border transition ${paymentMethod === 'card' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-gray-200 text-gray-500'}`}
                >
                    <CreditCard size={18} />
                    <span className="text-[10px] font-bold mt-1">Card</span>
                </button>
            </div>

            {/* Paid Amount Input */}
             <div className="mb-3">
                 <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-gray-500">{t.paidAmount}</label>
                 </div>
                 <div className="flex items-center bg-gray-50 border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500 transition-all">
                    <span className="pl-3 text-gray-500 font-bold">৳</span>
                    <input 
                        type="number"
                         min="0"
                         step="0.01"
                        className="w-full p-2 outline-none font-bold text-gray-800 bg-transparent"
                        placeholder={totalAmount.toString()}
                        value={paidAmountInput}
                        onChange={(e) => setPaidAmountInput(e.target.value)}
                         aria-label={t.paidAmount}
                         aria-invalid={!!calculationError}
                    />
                 </div>
             </div>

             {calculationError && (
                 <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                     {lang === 'bn'
                       ? 'টাকার পরিমাণ, ছাড়, কর ও পরিশোধের তথ্য যাচাই করুন।'
                       : calculationError.startsWith('INVALID_PAYMENT:')
                         ? 'Payment must be valid. Non-cash payment cannot exceed the invoice total.'
                         : 'Check prices, quantities, discount, VAT, and payment amounts.'}
                 </div>
             )}

             {/* Due / Change Display */}
             {dueAmount > 0 ? (
                 <div className="flex justify-between items-center text-red-600 bg-red-50 p-2 rounded-lg border border-red-100 mb-3">
                     <span className="text-sm font-semibold">{t.dueAmount}</span>
                     <span className="font-bold">৳{dueAmount.toFixed(2)}</span>
                 </div>
             ) : (
                <div className="flex justify-between items-center text-emerald-600 bg-emerald-50 p-2 rounded-lg border border-emerald-100 mb-3">
                     <span className="text-sm font-semibold">{t.changeAmount}</span>
                     <span className="font-bold">৳{changeAmount.toFixed(2)}</span>
                </div>
             )}

          <button 
            onClick={handleCheckout}
            disabled={cart.length === 0 || !calculation || isSubmitting}
            aria-busy={isSubmitting}
            className="w-full bg-emerald-600 text-white py-3 md:py-3.5 rounded-xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            {isSubmitting ? (lang === 'bn' ? 'প্রসেস হচ্ছে…' : 'Processing…') : t.checkout}
          </button>
        </div>
      </div>
    </div>
  );
};

export default POS;
