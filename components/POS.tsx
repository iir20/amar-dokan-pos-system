import React, { useState, useEffect } from 'react';
import { Product, CartItem, Sale, Language, User } from '../types';
import { TRANSLATIONS } from '../constants';
import {
  Search,
  Plus,
  Trash2,
  ShoppingCart,
  User as UserIcon,
  Phone,
  Smartphone,
  CreditCard,
  Banknote,
  PackageOpen,
  AlertCircle,
  ScanBarcode,
  CloudOff,
} from 'lucide-react';
import { StorageService } from '../services/storage';
import { useApiData } from '../hooks/useApiData';
import SubscriptionModal from './SubscriptionModal';
import VoicePos from './VoicePos';
import CheckoutSheet from './CheckoutSheet';
import { calculateSaleTotals, parseMoneyInput } from '../shared/finance';
import { cacheProducts, getCachedProducts, enqueueOfflineSale } from '../services/amarSync';
import { speakBangla, speakTotal as speakTotalService, isVoiceAnnouncementOn } from '../services/voice';
import { toBanglaDigits } from '../shared/phase3';
import { getTheme, setTheme, getFontScale, setFontScale, nextFontScale } from '../services/theme';
import type { ThemeName } from '../design/tokens';

interface POSProps {
  lang: Language;
  onCheckout: (sale: Sale) => void;
}

const POS: React.FC<POSProps> = ({ lang, onCheckout }) => {
  const t = TRANSLATIONS[lang];
  const { data: productsData } = useApiData(() => StorageService.getProducts(), []);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);

  useEffect(() => {
    if (productsData && productsData.length > 0) {
      cacheProducts(productsData);
    }
  }, [productsData]);

  const products = productsData && productsData.length > 0 ? productsData : getCachedProducts();
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
  // Phase 3 — coupon + loyalty are sent as requests only. The server
  // re-validates the coupon and the points balance and recalculates the
  // bill; the client never trusts its own promo math.
  const [couponInput, setCouponInput] = useState<string>('');
  const [loyaltyInput, setLoyaltyInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bkash' | 'nagad' | 'card'>('cash');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Phase 5 — two-tap checkout: tap 1 opens the receipt preview sheet,
  // tap 2 (confirm) completes the sale. Nothing here changes sale math.
  const [showCheckoutSheet, setShowCheckoutSheet] = useState(false);
  const [saleNotice, setSaleNotice] = useState<string | null>(null);
  // Phase 5 — recent items (one-thumb re-order), persisted locally.
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('amar-recent-items') || '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    StorageService.getCurrentUser().then(setUser);
  }, [showUpsell]);

  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
      alert('Out of stock!');
      return;
    }
    // Phase 5 — remember for the Recent row (max 8, most recent first).
    setRecentIds((prev) => {
      const next = [product.id, ...prev.filter((id) => id !== product.id)].slice(0, 8);
      try {
        localStorage.setItem('amar-recent-items', JSON.stringify(next));
      } catch {}
      return next;
    });

    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          return prev;
        }
        return prev.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      // Barcode scan logic: exact match prioritized
      const exactMatch = products.find((p) => p.barcode === search.trim());
      if (exactMatch) {
        addToCart(exactMatch);
        setSearch(''); // Clear search after scan
      }
    }
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  // Phase 3 voice actions — text fallbacks live in VoicePos itself.
  const handleVoiceAdd = (query: string, quantity: number) => {
    const q = query.toLowerCase();
    const match = products.find(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.nameBn.includes(query) ||
        (p.genericName && p.genericName.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.includes(query)),
    );
    if (!match) return;
    for (let i = 0; i < Math.max(1, Math.floor(quantity)); i += 1) addToCart(match);
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const newQty = Math.max(0.1, item.quantity + delta);
          if (newQty > item.stock) return item;
          return { ...item, quantity: parseFloat(newQty.toFixed(2)) };
        }
        return item;
      }),
    );
  };

  const handleManualQuantityChange = (id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal) || numVal < 0) return;

    setCart((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          if (numVal > item.stock) {
            return { ...item, quantity: item.stock };
          }
          return { ...item, quantity: numVal };
        }
        return item;
      }),
    );
  };

  const handlePriceChange = (id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal) || numVal < 0) return;

    setCart((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return { ...item, price: numVal };
        }
        return item;
      }),
    );
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

  // Phase 5 — tap 1: validate, then show the receipt preview sheet.
  const openCheckoutSheet = () => {
    if (isSubmitting || cart.length === 0 || !calculation) return;
    if (dueAmount > 0 && !customerName.trim()) {
      alert(lang === 'bn' ? 'বাকি থাকলে ক্রেতার নাম অবশ্যই দিতে হবে।' : 'Customer name is required for due payment.');
      return;
    }
    setShowCheckoutSheet(true);
  };

  // Phase 5 — tap 2: the original checkout logic, unchanged sale math.
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
      couponCode: couponInput.trim() || undefined,
      loyaltyPointsRedeem: loyaltyInput.trim() === '' ? undefined : Math.floor(Number(loyaltyInput)) || undefined,
      paidAmount: calculation.paidAmount,
      cashReceived: calculation.cashReceived,
      changeAmount: calculation.changeAmount,
      dueAmount: calculation.dueAmount,
    };

    const completeSaleReset = (finalSale: Sale) => {
      // Phase 5 — Bangla voice + text confirmation for a completed sale
      // (text is always shown; voice is a bonus, never a gate).
      const notice =
        lang === 'bn'
          ? `বিক্রি সম্পন্ন হয়েছে — মোট ৳${toBanglaDigits(finalSale.totalAmount.toFixed(2))}`
          : `Sale completed — total ৳${finalSale.totalAmount.toFixed(2)}`;
      setSaleNotice(notice);
      if (lang === 'bn') speakBangla(`বিক্রি সম্পন্ন হয়েছে, মোট ${Math.round(finalSale.totalAmount)} টাকা`);
      setShowCheckoutSheet(false);
      onCheckout(finalSale);
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setPaidAmountInput('');
      setDiscountInput('');
      setCouponInput('');
      setLoyaltyInput('');
      setPaymentMethod('cash');
      setActiveMobileTab('products');
    };

    if (!navigator.onLine) {
      enqueueOfflineSale(sale);
      setOfflineNotice(
        lang === 'bn'
          ? 'অফলাইন সেল সংরক্ষিত হয়েছে। ইন্টারনেট পেলে স্বয়ংক্রিয়ভাবে সিঙ্ক হবে।'
          : 'Offline sale saved to AmarSync queue. Will sync automatically when connected.',
      );
      completeSaleReset(sale);
      return;
    }

    try {
      setIsSubmitting(true);
      const savedSale = await StorageService.addSale(sale);
      completeSaleReset(savedSale || sale);
    } catch (error: any) {
      if (error.message === 'FREE_LIMIT_REACHED') {
        setShowUpsell(true);
      } else if (
        !navigator.onLine ||
        error.message?.includes('fetch') ||
        error.message?.includes('network') ||
        error.status >= 500
      ) {
        // Enqueue offline
        enqueueOfflineSale(sale);
        setOfflineNotice(
          lang === 'bn'
            ? 'সার্ভার পাওয়া যায়নি। সেলটি অফলাইন কিউতে সংরক্ষিত হয়েছে।'
            : 'Server unavailable. Sale queued in AmarSync for background reconciliation.',
        );
        completeSaleReset(sale);
      } else {
        console.error('Checkout Error:', error);
        alert('Checkout Failed: ' + (error.message || 'Unknown error'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.nameBn.includes(search) ||
      (p.barcode && p.barcode.includes(search)) ||
      (p.genericName && p.genericName.toLowerCase().includes(q)) || // Search by Generic
      (p.serialNumber && p.serialNumber.toLowerCase().includes(q))
    ); // Search by Serial
  });

  // Phase 5 — POS toggles now drive the GLOBAL theme (services/theme),
  // so the setting persists and applies app-wide, not just on POS.
  // Legacy pos_* keys are migrated by getTheme()/getFontScale().
  const [theme, setThemeState] = useState<ThemeName>(() => getTheme());
  const [fontScale, setFontScaleState] = useState(() => getFontScale());
  const highContrast = theme === 'high-contrast';
  const largeFont = fontScale === 'large' || fontScale === 'xlarge';

  const toggleHighContrast = () => {
    const next: ThemeName = highContrast ? 'light' : 'high-contrast';
    setTheme(next);
    setThemeState(next);
  };

  const toggleLargeFont = () => {
    const next = nextFontScale(fontScale);
    setFontScale(next);
    setFontScaleState(next);
  };

  // Keyboard Shortcuts (F2: Focus Search, F4: Clear Cart, F8: Checkout)
  // Phase 5: F8 opens the receipt preview on first press and confirms on
  // the second press while the sheet is open — desktop cashier flow kept.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        document.getElementById('pos-search-input')?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setCart([]);
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0 && !isSubmitting && calculation) {
          if (showCheckoutSheet) handleCheckout();
          else openCheckoutSheet();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, isSubmitting, calculation, showCheckoutSheet]);

  // DISTINCTIVE FEATURES (2026-10-29) — speaker mode: the cart total
  // + change are spoken aloud in Bangla through the gated voice
  // service (services/voice.ts consults amar-voice-confirm; when the
  // toggle is off this is a silent no-op and the total stays visible
  // as text). Previously this function bypassed the toggle entirely
  // with a direct speechSynthesis call. Change comes from the
  // checkout calculation when cash is tendered, else 0.
  const speakTotal = () => {
    if (totalAmount <= 0 || !isVoiceAnnouncementOn()) return;
    const change = calculation?.changeAmount || 0;
    if (lang === 'bn') {
      speakTotalService(totalAmount, change);
      return;
    }
    // English UI: same toggle gate, English utterance (the Bangla
    // service phrase is Bangla-only, so en uses its own utterance).
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(
        `Total amount ${Math.round(totalAmount)} Taka${change > 0 ? `, change ${Math.round(change)} Taka` : ''}`,
      );
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  };

  const favoriteProducts = products.slice(0, 5);
  const recentProducts = recentIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));
  const bigTotalText = lang === 'bn' ? `৳${toBanglaDigits(totalAmount.toFixed(2))}` : `৳${totalAmount.toFixed(2)}`;

  return (
    <div
      className={`flex flex-col md:flex-row h-full overflow-hidden relative ${
        highContrast ? 'bg-black text-yellow-300' : 'bg-gray-50'
      } ${largeFont ? 'text-lg' : 'text-sm'}`}
    >
      {showUpsell && (
        <SubscriptionModal
          lang={lang}
          onClose={() => setShowUpsell(false)}
          onSuccess={() => StorageService.getCurrentUser().then(setUser)}
        />
      )}

      {/* Phase 5 — sale-completed text confirmation (voice is a bonus). */}
      {saleNotice && (
        <div
          role="status"
          data-testid="pos-sale-notice"
          className="absolute top-0 left-0 right-0 z-40 bg-emerald-700 text-white px-4 py-2 text-xs flex justify-between items-center shadow-md animate-fade-in"
        >
          <span>{saleNotice}</span>
          <button
            onClick={() => setSaleNotice(null)}
            className="font-bold underline ml-2"
            aria-label="Dismiss sale notice"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Offline notification banner if any */}
      {offlineNotice && (
        <div className="absolute top-0 left-0 right-0 z-40 bg-emerald-700 text-white px-4 py-2 text-xs flex justify-between items-center shadow-md animate-fade-in">
          <span>{offlineNotice}</span>
          <button onClick={() => setOfflineNotice(null)} className="font-bold underline ml-2">
            Dismiss
          </button>
        </div>
      )}

      {/* Mobile Tab Switcher */}
      <div className="md:hidden flex border-b bg-white shadow-sm z-30 shrink-0">
        <button
          onClick={() => setActiveMobileTab('products')}
          aria-label="Show products"
          className={`ad-tap flex-1 py-3 font-semibold text-sm flex items-center justify-center gap-2 ${activeMobileTab === 'products' ? 'text-emerald-600 border-b-2 border-emerald-600 bg-emerald-50' : 'text-gray-500'}`}
        >
          <PackageOpen size={18} /> Products
        </button>
        <button
          onClick={() => setActiveMobileTab('cart')}
          aria-label={`Show cart, ${cart.length} items`}
          className={`ad-tap flex-1 py-3 font-semibold text-sm flex items-center justify-center gap-2 ${activeMobileTab === 'cart' ? 'text-emerald-600 border-b-2 border-emerald-600 bg-emerald-50' : 'text-gray-500'}`}
        >
          <ShoppingCart size={18} /> Cart ({cart.length})
        </button>
      </div>

      {/* Product Grid - Left Side */}
      <div
        className={`flex-1 flex flex-col h-full overflow-hidden ${activeMobileTab === 'products' ? 'block' : 'hidden md:flex'}`}
      >
        <div className="p-3 md:p-4 bg-white border-b shadow-sm z-10 shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                id="pos-search-input"
                type="text"
                aria-label={lang === 'bn' ? 'পণ্য খুঁজুন বা বারকোড স্ক্যান করুন' : 'Search products or scan barcode'}
                placeholder={`${t.searchPlaceholder} (F2)`}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50 text-sm min-h-[48px]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
            {/* Accessibility Toggles */}
            <button
              onClick={toggleHighContrast}
              aria-label="Toggle high contrast mode"
              aria-pressed={highContrast}
              title="Toggle High Contrast Mode (for elder shopkeepers)"
              className={`ad-tap px-2 rounded-lg border text-xs font-bold transition ${highContrast ? 'bg-yellow-400 text-black border-yellow-500' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              👁 Contrast
            </button>
            <button
              onClick={toggleLargeFont}
              aria-label={`Increase text size, current: ${fontScale}`}
              title="Toggle Large Font Size"
              className={`ad-tap px-2 rounded-lg border text-xs font-bold transition ${largeFont ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              A+
            </button>
          </div>

          {/* Quick-Add / Fast Tap Favorites Row (One-Thumb POS) */}
          {favoriteProducts.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                {lang === 'bn' ? 'পছন্দ:' : 'Favorites:'}
              </span>
              {favoriteProducts.map((p) => (
                <button
                  key={`fav-${p.id}`}
                  onClick={() => addToCart(p)}
                  aria-label={`${lang === 'bn' ? 'কার্টে যোগ করুন' : 'Add to cart'}: ${lang === 'bn' ? p.nameBn : p.name}, ৳${p.price}`}
                  className="ad-tap px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full font-medium whitespace-nowrap transition active:scale-95 flex items-center gap-1"
                >
                  <span>{lang === 'bn' ? p.nameBn : p.name}</span>
                  <span className="font-bold opacity-75">৳{p.price}</span>
                </button>
              ))}
            </div>
          )}
          {/* Phase 5 — Recent items row (re-order with one thumb tap). */}
          {recentProducts.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                {lang === 'bn' ? 'সাম্প্রতিক:' : 'Recent:'}
              </span>
              {recentProducts.map((p) => (
                <button
                  key={`recent-${p.id}`}
                  onClick={() => addToCart(p)}
                  aria-label={`${lang === 'bn' ? 'আবার কার্টে যোগ করুন' : 'Add to cart again'}: ${lang === 'bn' ? p.nameBn : p.name}, ৳${p.price}`}
                  className="ad-tap px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-full font-medium whitespace-nowrap transition active:scale-95 flex items-center gap-1"
                >
                  <span>{lang === 'bn' ? p.nameBn : p.name}</span>
                  <span className="font-bold opacity-75">৳{p.price}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 pb-20 md:pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                data-testid={`pos-product-${product.id}`}
                role="button"
                tabIndex={product.stock === 0 ? -1 : 0}
                aria-label={`${lang === 'bn' ? 'কার্টে যোগ করুন' : 'Add to cart'}: ${lang === 'bn' ? product.nameBn : product.name}, ${lang === 'bn' ? 'দাম' : 'price'} ৳${product.price}, ${lang === 'bn' ? 'মজুদ' : 'stock'} ${product.stock}`}
                onClick={() => addToCart(product)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    addToCart(product);
                  }
                }}
                className={`bg-white rounded-xl shadow-sm border border-gray-100 p-3 md:p-4 cursor-pointer ad-card-interactive transition-all duration-200 group flex flex-col justify-between min-h-[120px] relative hover:border-emerald-300 hover:shadow-md ${product.stock === 0 ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {/* Expiry Warning Overlay (Medicine Only) */}
                {user?.storeCategory === 'medicine' &&
                  product.expiryDate &&
                  new Date(product.expiryDate) < new Date() && (
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
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-bold whitespace-nowrap ${product.stock < 10 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}
                    >
                      {product.stock} {product.unit}
                    </span>
                  </div>
                  {/* Smart Inventory Details */}
                  <div className="mt-2 text-xs text-gray-500 flex flex-wrap gap-1">
                    {product.color && <span className="bg-gray-100 px-1 rounded">{product.color}</span>}
                    {product.size && <span className="bg-gray-100 px-1 rounded font-bold">{product.size}</span>}
                    {product.expiryDate && user?.storeCategory === 'medicine' && (
                      <span
                        className={`${new Date(product.expiryDate) < new Date() ? 'text-red-500 font-bold' : 'text-orange-600'}`}
                      >
                        Exp:{' '}
                        {new Date(product.expiryDate).toLocaleDateString(undefined, {
                          month: 'short',
                          year: '2-digit',
                        })}
                      </span>
                    )}
                    {product.serialNumber && (
                      <span className="font-mono text-[10px] bg-slate-100 px-1">{product.serialNumber}</span>
                    )}
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

        {/* Phase 5 — persistent totals bar (one-thumb phone layout): the
            total is always visible on the products tab, with big Bangla
            numerals, and checkout is one tap away (tap 2 is the confirm
            in the receipt-preview sheet). */}
        {cart.length > 0 && (
          <div className="md:hidden shrink-0 bg-white border-t shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] px-3 py-2 flex items-center gap-2 z-30">
            <button
              onClick={() => setActiveMobileTab('cart')}
              aria-label={`${lang === 'bn' ? 'কার্ট দেখুন' : 'View cart'}: ${cart.length} ${lang === 'bn' ? 'টি পণ্য' : 'items'}`}
              className="ad-tap flex-1 flex flex-col items-start justify-center px-2 rounded-lg bg-emerald-50 border border-emerald-200"
            >
              <span className="text-[10px] font-bold text-emerald-700 uppercase">
                {cart.length} {lang === 'bn' ? 'টি পণ্য' : 'items'} · {lang === 'bn' ? 'মোট' : 'Total'}
              </span>
              <span data-testid="pos-totals-bar" className="text-xl font-bold text-emerald-700 leading-tight">
                {bigTotalText}
              </span>
            </button>
            <button
              data-testid="pos-speak-total"
              onClick={speakTotal}
              aria-label={t.speakTotalLabel}
              title={isVoiceAnnouncementOn() ? t.speakTotalLabel : t.speakerOffNote}
              className="ad-tap px-3 rounded-xl bg-white border border-emerald-200 text-emerald-700 font-bold shadow"
            >
              🔊
            </button>
            <button
              data-testid="pos-checkout-bar"
              onClick={openCheckoutSheet}
              aria-label={lang === 'bn' ? 'চেকআউট করুন' : 'Checkout'}
              className="ad-tap px-5 rounded-xl bg-emerald-600 text-white font-bold shadow-lg"
            >
              {lang === 'bn' ? 'চেকআউট' : 'Checkout'}
            </button>
          </div>
        )}
      </div>

      {/* Cart - Right Side */}
      <div
        className={`w-full md:w-[400px] bg-white border-l shadow-xl flex flex-col h-full z-20 ${activeMobileTab === 'cart' ? 'block absolute inset-0 md:static' : 'hidden md:flex'}`}
      >
        {/* Cart Header Mobile */}
        <div className="md:hidden bg-gray-100 p-2 flex justify-between items-center border-b">
          <button onClick={() => setActiveMobileTab('products')} className="px-3 py-1 text-sm text-gray-600">
            Back
          </button>
          <span className="font-bold text-gray-700">Current Order</span>
          <button onClick={() => setCart([])} className="px-3 py-1 text-sm text-red-500">
            Clear
          </button>
        </div>

        {/* Customer Info Section */}
        <div className="p-3 bg-emerald-50 border-b space-y-2 shrink-0">
          <div className="flex gap-2">
            <div className="flex flex-1 items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2">
              <UserIcon size={16} className="text-gray-400" />
              <input
                type="text"
                aria-label={t.customerName}
                placeholder={t.customerName}
                className="flex-1 outline-none text-sm bg-transparent min-h-[40px]"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="flex flex-1 items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2">
              <Phone size={16} className="text-gray-400" />
              <input
                type="tel"
                aria-label={t.customerPhone}
                placeholder={t.customerPhone}
                className="flex-1 outline-none text-sm bg-transparent min-h-[40px]"
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
            cart.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 bg-white border border-gray-100 p-2 rounded-xl shadow-sm animate-slide-up-fade transition-all hover:shadow-md hover:border-emerald-100"
              >
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-800 text-sm truncate">
                    {lang === 'bn' ? item.nameBn : item.name}
                  </h4>

                  {/* Category Wise Cart Details */}
                  <div className="text-[10px] text-gray-500 flex flex-wrap gap-2 mt-0.5">
                    {item.genericName && user?.storeCategory === 'medicine' && <span>{item.genericName}</span>}
                    {item.brand && (user?.storeCategory === 'clothing' || user?.storeCategory === 'electronics') && (
                      <span className="font-bold">{item.brand}</span>
                    )}
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
                  <button
                    aria-label={`Decrease quantity of ${lang === 'bn' ? item.nameBn : item.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateQuantity(item.id, -1);
                    }}
                    className="w-8 h-8 md:w-6 md:h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-red-500 border border-gray-100"
                  >
                    -
                  </button>
                  <div className="flex items-center px-1">
                    <input
                      type="number"
                      aria-label={`Quantity of ${lang === 'bn' ? item.nameBn : item.name}`}
                      value={item.quantity}
                      onChange={(e) => handleManualQuantityChange(item.id, e.target.value)}
                      className="w-10 md:w-8 text-center text-sm font-medium outline-none py-1 appearance-none bg-transparent"
                    />
                  </div>
                  <button
                    aria-label={`Increase quantity of ${lang === 'bn' ? item.nameBn : item.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateQuantity(item.id, 1);
                    }}
                    className="w-8 h-8 md:w-6 md:h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-emerald-600 border border-gray-100"
                  >
                    +
                  </button>
                </div>
                <button
                  aria-label={`Remove ${lang === 'bn' ? item.nameBn : item.name} from cart`}
                  onClick={() => removeFromCart(item.id)}
                  className="text-gray-400 hover:text-red-500 p-2 md:p-1"
                >
                  <Trash2 className="w-[18px] h-[18px] md:w-4 md:h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Phase 3 — Bangla Voice POS (text fallbacks included). */}
        <VoicePos
          lang={lang}
          cart={cart}
          total={totalAmount}
          change={changeAmount}
          onVoiceAdd={handleVoiceAdd}
          onVoiceCheckout={() => {
            if (cart.length > 0 && calculation && !isSubmitting) openCheckoutSheet();
          }}
          onVoiceClear={() => setCart([])}
        />

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
              <span className="font-medium">
                {t.vat} ({vatRate}%)
              </span>
              <span>৳{vatAmount.toFixed(2)}</span>
            </div>
            {/* Phase 3 — coupon + loyalty are requests only; the server
                    re-validates and recalculates. The preview above does not
                    include them; the final invoice shows the server total. */}
            <div className="flex justify-between items-center text-gray-500">
              <span className="font-medium">{t.coupons}</span>
              <input
                data-testid="pos-coupon-code"
                type="text"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                placeholder={lang === 'bn' ? 'কুপন কোড (যদি থাকে)' : 'Coupon code (optional)'}
                className="w-36 text-right outline-none border-b border-gray-300 focus:border-emerald-600 font-bold text-gray-800"
              />
            </div>
            <div className="flex justify-between items-center text-gray-500">
              <span className="font-medium">
                {t.loyalty} ({lang === 'bn' ? 'পয়েন্ট' : 'points'})
              </span>
              <input
                data-testid="pos-loyalty-points"
                type="number"
                min="0"
                step="1"
                value={loyaltyInput}
                onChange={(e) => setLoyaltyInput(e.target.value)}
                placeholder="0"
                className="w-20 text-right outline-none border-b border-gray-300 focus:border-emerald-600 font-bold text-gray-800"
              />
            </div>
            {(couponInput.trim() || loyaltyInput.trim()) && (
              <p className="text-[11px] text-amber-700">
                {lang === 'bn'
                  ? 'কুপন/পয়েন্ট ছাড় সার্ভার যাচাই করে চূড়ান্ত বিলে প্রয়োগ হবে।'
                  : 'Coupon/points discount is validated by the server and applied to the final bill.'}
              </p>
            )}

            <div className="flex justify-between items-center text-lg font-bold text-gray-800 border-t border-dashed pt-2">
              <span>{t.total}</span>
              <span>৳{totalAmount.toFixed(2)}</span>
            </div>
            <button
              data-testid="pos-speak-total-desktop"
              onClick={speakTotal}
              title={isVoiceAnnouncementOn() ? t.speakTotalLabel : t.speakerOffNote}
              className="w-full mt-2 py-2 rounded-lg bg-white border border-emerald-200 text-emerald-700 font-medium text-sm"
            >
              🔊 {t.speakTotalLabel}
              {!isVoiceAnnouncementOn() && (
                <span className="block text-[11px] font-normal text-gray-500">{t.speakerOffNote}</span>
              )}
            </button>
          </div>

          {/* Payment Method Selector */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            <button
              aria-pressed={paymentMethod === 'cash'}
              aria-label="Pay with cash"
              onClick={() => setPaymentMethod('cash')}
              className={`flex flex-col items-center justify-center py-2 rounded-lg border transition ${paymentMethod === 'cash' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-gray-200 text-gray-500'}`}
            >
              <Banknote size={18} />
              <span className="text-[10px] font-bold mt-1">Cash</span>
            </button>
            <button
              aria-pressed={paymentMethod === 'bkash'}
              aria-label="Pay with bkash"
              onClick={() => setPaymentMethod('bkash')}
              className={`flex flex-col items-center justify-center py-2 rounded-lg border transition ${paymentMethod === 'bkash' ? 'bg-pink-50 border-pink-500 text-pink-700' : 'bg-white border-gray-200 text-gray-500'}`}
            >
              <Smartphone size={18} />
              <span className="text-[10px] font-bold mt-1">Bkash</span>
            </button>
            <button
              aria-pressed={paymentMethod === 'nagad'}
              aria-label="Pay with nagad"
              onClick={() => setPaymentMethod('nagad')}
              className={`flex flex-col items-center justify-center py-2 rounded-lg border transition ${paymentMethod === 'nagad' ? 'bg-orange-50 border-orange-500 text-orange-700' : 'bg-white border-gray-200 text-gray-500'}`}
            >
              <Smartphone size={18} />
              <span className="text-[10px] font-bold mt-1">Nagad</span>
            </button>
            <button
              aria-pressed={paymentMethod === 'card'}
              aria-label="Pay with card"
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
                data-testid="pos-paid-amount"
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
            <div
              data-testid="pos-change"
              className="flex justify-between items-center text-emerald-600 bg-emerald-50 p-2 rounded-lg border border-emerald-100 mb-3"
            >
              <span className="text-sm font-semibold">{t.changeAmount}</span>
              <span className="font-bold">৳{changeAmount.toFixed(2)}</span>
            </div>
          )}

          <button
            data-testid="pos-checkout"
            onClick={openCheckoutSheet}
            disabled={cart.length === 0 || !calculation || isSubmitting}
            aria-busy={isSubmitting}
            aria-label={lang === 'bn' ? 'চেকআউট — রশিদ প্রিভিউ দেখুন' : 'Checkout — show receipt preview'}
            className="ad-tap w-full bg-emerald-600 text-white py-3 md:py-3.5 rounded-xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            {isSubmitting ? (lang === 'bn' ? 'প্রসেস হচ্ছে…' : 'Processing…') : t.checkout}
          </button>
        </div>
      </div>

      {/* Phase 5 — two-tap checkout, step 1: receipt preview sheet. */}
      {showCheckoutSheet && calculation && (
        <CheckoutSheet
          lang={lang}
          items={cart}
          subTotal={subTotal}
          discount={discount}
          vat={vatAmount}
          totalAmount={totalAmount}
          paidAmount={paidAmount}
          changeAmount={changeAmount}
          dueAmount={dueAmount}
          paymentMethod={paymentMethod}
          isSubmitting={isSubmitting}
          onConfirm={handleCheckout}
          onCancel={() => setShowCheckoutSheet(false)}
        />
      )}
    </div>
  );
};

export default POS;
