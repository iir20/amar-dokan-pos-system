
import React, { useState, useEffect } from 'react';
import { Product, Language, User, StoreCategory } from '../types';
import { TRANSLATIONS, LIMITS, STORE_THEMES } from '../constants';
import { StorageService } from '../services/storage';
import { Plus, Edit2, Trash2, X, Save, Crown, ScanBarcode, Image as ImageIcon, Zap, Shirt, Pill, Utensils, TrendingUp, AlertCircle, Search } from 'lucide-react';
import { useApiData } from '../hooks/useApiData';
import SubscriptionModal from './SubscriptionModal';

interface InventoryProps {
  lang: Language;
}

const Inventory: React.FC<InventoryProps> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const { data: productsData, loading, error, refetch: refetchProducts } = useApiData(() => StorageService.getProducts(), []);
  const products = productsData || [];
  const [user, setUser] = useState<User | null>(null);
  const [query, setQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showUpsell, setShowUpsell] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({});
  
  // Real-time Profit Calculation for the Form
  const [calculatedMargin, setCalculatedMargin] = useState<{profit: number, percent: number} | null>(null);

  useEffect(() => {
    StorageService.getCurrentUser().then(setUser);
  }, [showUpsell]);

  // Update margin whenever price or cost changes
  useEffect(() => {
      const price = Number(formData.price) || 0;
      const cost = Number(formData.cost) || 0;
      if (price > 0) {
          const profit = price - cost;
          const percent = (profit / price) * 100;
          setCalculatedMargin({ profit, percent });
      } else {
          setCalculatedMargin(null);
      }
  }, [formData.price, formData.cost]);

  // Determine current Store Theme
  const currentCategory: StoreCategory = user?.storeCategory || 'grocery';
  const theme = STORE_THEMES[currentCategory] || STORE_THEMES['grocery'];
  const ThemeIcon = theme.icon;
  const filteredProducts = products.filter((product) => {
    const search = query.trim().toLocaleLowerCase();
    return !search || [
      product.name,
      product.nameBn,
      product.category,
      product.barcode,
    ].some((value) => value?.toLocaleLowerCase().includes(search));
  });
  const lowStockCount = products.filter((product) => product.stock < 10).length;

  const handleOpenModal = (product?: Product) => {
    setSaveError('');
    if (!product) {
        if (user?.plan === 'free' && products.length >= LIMITS.FREE_PRODUCT_LIMIT) {
            setShowUpsell(true);
            return;
        }
    }

    if (product) {
      setEditingProduct(product);
      setFormData({ ...product });
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        nameBn: '',
        category: 'General',
        price: 0,
        cost: 0,
        stock: 0,
        unit: currentCategory === 'medicine' ? 'strip' : 'pcs',
        image: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          if (file.size > 1024 * 1024) { 
              alert("Image size must be less than 1MB.");
              return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
              setFormData({ ...formData, image: reader.result as string });
          };
          reader.readAsDataURL(file);
      }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t.confirmDelete)) {
      try {
        await StorageService.deleteProduct(id);
        await refetchProducts();
      } catch (error: any) {
        alert(error?.body?.message || error?.message || 'Could not delete this product.');
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setSaveError('');
    
    // --- STORE-WISE SYSTEM RULES VALIDATION ---
    if (currentCategory === 'medicine') {
        if (!formData.expiryDate) {
            alert("⚠️ Pharmacy System Alert:\nExpiry Date is required for medicines to ensure patient safety.");
            return;
        }
    }
    
    if (currentCategory === 'clothing') {
        if (!formData.size && !formData.color) {
             if(!window.confirm("⚠️ Fashion System Alert:\nYou haven't specified Size or Color. Are you sure?")) return;
        }
    }

    if (Number(formData.cost) > Number(formData.price)) {
        if(!window.confirm("⚠️ Profit Alert:\nBuying Price is higher than Selling Price. You will make a LOSS. Continue?")) return;
    }
    if (!formData.name?.trim() || !Number.isFinite(Number(formData.price)) ||
        !Number.isFinite(Number(formData.cost)) || !Number.isFinite(Number(formData.stock)) ||
        Number(formData.price) < 0 || Number(formData.cost) < 0 || Number(formData.stock) < 0) {
        setSaveError('Enter a product name and valid non-negative price, cost, and stock values.');
        return;
    }
    // -------------------------------------------

    const productToSave: any = {
      id: editingProduct ? editingProduct.id : crypto.randomUUID(),
      name: formData.name.trim(),
      nameBn: formData.nameBn || formData.name || '',
      category: formData.category || 'General',
      price: Number(formData.price) || 0,
      cost: Number(formData.cost) || 0,
      stock: Number(formData.stock) || 0,
      unit: formData.unit || 'pcs',
      image: formData.image,
      barcode: formData.barcode,
      supplier: formData.supplier,
    };

    // Store specific fields injection
    if (currentCategory === 'medicine') {
        productToSave.expiryDate = formData.expiryDate;
        productToSave.batchNumber = formData.batchNumber;
        productToSave.genericName = formData.genericName;
    }
    if (currentCategory === 'clothing') {
        productToSave.color = formData.color;
        productToSave.size = formData.size;
        productToSave.style = formData.style;
        productToSave.brand = formData.brand;
    }
    if (currentCategory === 'electronics') {
        productToSave.warranty = formData.warranty;
        productToSave.serialNumber = formData.serialNumber;
        productToSave.brand = formData.brand;
    }
    if (currentCategory === 'restaurant') {
        productToSave.dietaryType = formData.dietaryType;
        productToSave.preparationTime = formData.preparationTime;
    }
    if (currentCategory === 'grocery') {
        productToSave.expiryDate = formData.expiryDate;
    }

    setIsSaving(true);
    try {
        await StorageService.saveProduct(productToSave as Product);
        setIsModalOpen(false);
        await refetchProducts();
    } catch (error: any) {
        if (error.message === 'FREE_LIMIT_REACHED') {
            setIsModalOpen(false);
            setShowUpsell(true);
        } else {
            setSaveError(error?.body?.message || error?.message || 'Could not save this product. Please try again.');
        }
    } finally {
        setIsSaving(false);
    }
  };

  const isExpired = (dateString?: string) => {
      if(!dateString) return false;
      return new Date(dateString) < new Date();
  };

  // Helper styles based on theme color
  const getThemeColorClass = (type: 'text' | 'bg' | 'border' | 'button') => {
      const c = theme.color;
      if (type === 'text') return `text-${c}-600`;
      if (type === 'bg') return `bg-${c}-50`;
      if (type === 'border') return `border-${c}-200`;
      if (type === 'button') return `bg-${c}-600 hover:bg-${c}-700 text-white`;
      return '';
  };

  return (
    <div className="p-4 md:p-6 h-full flex flex-col">
      {showUpsell && (
        <SubscriptionModal 
            lang={lang} 
            onClose={() => setShowUpsell(false)} 
            onSuccess={() => StorageService.getCurrentUser().then(setUser)} 
        />
      )}

      {/* Header with Dynamic Theme */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                {t.inventory}
            </h2>
            <div className={`mt-1 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase ${getThemeColorClass('bg')} ${getThemeColorClass('text')} border ${getThemeColorClass('border')}`}>
                <ThemeIcon size={14} />
                {theme.label} System
            </div>
            
            {user?.plan === 'free' && (
                <div className="text-xs text-gray-500 mt-2 flex items-center gap-2">
                    <span className="font-medium">Limit: {products.length}/{LIMITS.FREE_PRODUCT_LIMIT}</span>
                    <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                            className={`h-full ${products.length >= LIMITS.FREE_PRODUCT_LIMIT ? 'bg-red-500' : 'bg-gray-500'}`} 
                            style={{width: `${(products.length/LIMITS.FREE_PRODUCT_LIMIT)*100}%`}}
                        />
                    </div>
                </div>
            )}
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition font-medium shadow-sm ${
              user?.plan === 'free' && products.length >= LIMITS.FREE_PRODUCT_LIMIT 
              ? 'bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-200'
              : getThemeColorClass('button')
          }`}
        >
          {user?.plan === 'free' && products.length >= LIMITS.FREE_PRODUCT_LIMIT 
            ? <><Crown size={18} /> {t.upgradeToPremium}</> 
            : <><Plus size={18} /> {t.addProduct}</>
          }
        </button>
      </div>

      <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <label className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by product, Bengali name, category, or barcode"
            aria-label="Search inventory"
            className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </label>
        <div className="text-sm text-gray-600 whitespace-nowrap">
          {filteredProducts.length} items · {lowStockCount} low stock
        </div>
      </div>
      {loading && <p role="status" className="mb-3 text-sm text-gray-500">Loading inventory…</p>}
      {error && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>Could not refresh inventory. Your last loaded list is kept on screen.</span>
          <button onClick={() => refetchProducts()} className="font-semibold underline">Retry</button>
        </div>
      )}
      {saveError && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 overflow-auto">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead className="bg-gray-50 text-gray-600 font-medium text-sm sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="p-4">{t.item}</th>
              
              {/* ISOLATED COLUMNS */}
              {currentCategory === 'medicine' && <th className="p-4">{t.genericName}</th>}
              {currentCategory === 'medicine' && <th className="p-4">{t.expiryDate}</th>}

              {currentCategory === 'clothing' && <th className="p-4">{t.size} / {t.color}</th>}
              {currentCategory === 'clothing' && <th className="p-4">{t.brand}</th>}

              {currentCategory === 'electronics' && <th className="p-4">{t.serialNumber}</th>}
              {currentCategory === 'electronics' && <th className="p-4">{t.warranty}</th>}

              {currentCategory === 'restaurant' && <th className="p-4">{t.dietaryType}</th>}
              {currentCategory === 'restaurant' && <th className="p-4">{t.prepTime}</th>}

              <th className="p-4 text-right">{t.cost}</th>
              <th className="p-4 text-right">{t.price}</th>
              <th className="p-4 text-center">{t.stockLevel}</th>
              <th className="p-4 text-center">{t.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredProducts.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="p-10 text-center text-gray-500">
                  {query ? 'No products match that search.' : 'No products yet. Use “Add Product” to start your inventory.'}
                </td>
              </tr>
            )}
            {filteredProducts.map(p => (
              <tr key={p.id} className={`hover:bg-gray-50 transition-colors`}>
                <td className="p-4 font-medium text-gray-800">
                  <div className="flex items-center gap-3">
                     <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center overflow-hidden hidden sm:block border border-gray-200 shrink-0">
                        {p.image ? <img src={p.image} className="w-full h-full object-cover" /> : <ThemeIcon size={20} className="text-gray-400" />}
                     </div>
                     <div>
                        <div>{lang === 'bn' ? p.nameBn : p.name}</div>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                             <span>{p.category}</span>
                             {p.barcode && <span className="bg-gray-100 px-1 rounded flex items-center gap-0.5"><ScanBarcode size={10} />{p.barcode}</span>}
                        </div>
                     </div>
                  </div>
                </td>
                
                {/* MEDICINE COLUMNS */}
                {currentCategory === 'medicine' && (
                    <>
                        <td className="p-4 text-sm text-gray-600 font-mono">{p.genericName || '-'}</td>
                        <td className="p-4 text-sm">
                            {p.expiryDate ? (
                                <span className={isExpired(p.expiryDate) ? 'text-red-600 font-bold' : 'text-gray-600'}>
                                    {new Date(p.expiryDate).toLocaleDateString()}
                                </span>
                            ) : '-'}
                        </td>
                    </>
                )}

                {/* CLOTHING COLUMNS */}
                {currentCategory === 'clothing' && (
                    <>
                        <td className="p-4 text-sm text-gray-600">
                            {p.size && <span className="bg-gray-100 px-1.5 rounded font-bold mr-1">{p.size}</span>}
                            {p.color}
                        </td>
                        <td className="p-4 text-sm text-gray-600">{p.brand}</td>
                    </>
                )}

                 {/* ELECTRONICS COLUMNS */}
                 {currentCategory === 'electronics' && (
                    <>
                        <td className="p-4 text-sm font-mono text-gray-600">{p.serialNumber || '-'}</td>
                        <td className="p-4 text-sm text-gray-600">{p.warranty}</td>
                    </>
                )}

                {/* RESTAURANT COLUMNS */}
                {currentCategory === 'restaurant' && (
                    <>
                        <td className="p-4 text-sm">
                            {p.dietaryType && (
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${p.dietaryType === 'veg' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {p.dietaryType.toUpperCase()}
                                </span>
                            )}
                        </td>
                        <td className="p-4 text-sm text-gray-600">{p.preparationTime ? `${p.preparationTime} min` : '-'}</td>
                    </>
                )}

                <td className="p-4 text-right text-gray-500 text-sm">৳{p.cost}</td>
                <td className="p-4 text-right font-medium text-gray-900">৳{p.price}</td>
                <td className="p-4 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${p.stock < 10 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                      {p.stock} {p.unit}
                    </span>
                </td>
                <td className="p-4">
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={() => handleOpenModal(p)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"><Edit2 size={16} /></button>
                    <button onClick={() => handleDelete(p.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dynamic Modal based on Category */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                {editingProduct ? <Edit2 size={18} /> : <Plus size={18} />}
                {editingProduct ? t.actions : t.addProduct}
              </h3>
              <button onClick={() => setIsModalOpen(false)}><X size={20} className="text-gray-500" /></button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-6">
              
              {/* --- Basic Info Section --- */}
              <div className="space-y-4">
                  <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider border-b pb-1">Basic Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                        <input type="text" required className="input-field" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Bangla Name</label>
                        <input type="text" className="input-field" value={formData.nameBn || ''} onChange={e => setFormData({...formData, nameBn: e.target.value})} />
                    </div>
                     <div>
                       <label className="block text-sm font-medium text-gray-700 mb-1">Stock Quantity</label>
                       <input type="number" required className="input-field" value={formData.stock || ''} onChange={e => setFormData({...formData, stock: Number(e.target.value)})} />
                    </div>
                    <div>
                       <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                       <input type="text" className="input-field" value={formData.unit || ''} onChange={e => setFormData({...formData, unit: e.target.value})} placeholder="pcs, kg, box"/>
                    </div>
                    <div>
                       <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                       <input type="text" className="input-field" value={formData.category || ''} onChange={e => setFormData({...formData, category: e.target.value})} />
                    </div>
                     <div>
                       <label className="block text-sm font-medium text-gray-700 mb-1">Barcode (Optional)</label>
                       <div className="relative">
                            <ScanBarcode size={16} className="absolute top-3 left-3 text-gray-400"/>
                            <input type="text" className="input-field pl-9" value={formData.barcode || ''} onChange={e => setFormData({...formData, barcode: e.target.value})} />
                       </div>
                    </div>
                  </div>
              </div>

              {/* --- Pricing & Profit Section (Enhanced) --- */}
              <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                  <h4 className="text-sm font-bold text-emerald-800 uppercase tracking-wider border-b border-emerald-200 pb-1 mb-3 flex items-center gap-2">
                      <TrendingUp size={16} /> Pricing & Profit
                  </h4>
                  <div className="grid grid-cols-2 gap-6">
                      <div>
                          <label className="block text-xs font-bold text-gray-600 mb-1">Buying Price (Cost)</label>
                          <div className="relative">
                              <span className="absolute left-3 top-2.5 text-gray-400 font-bold">৳</span>
                              <input 
                                type="number" 
                                required 
                                min="0" 
                                className="input-field pl-7 bg-white border-gray-300 focus:border-emerald-500 focus:ring-emerald-500" 
                                value={formData.cost || ''} 
                                onChange={e => setFormData({...formData, cost: Number(e.target.value)})} 
                                placeholder="0.00"
                              />
                          </div>
                          <p className="text-[10px] text-gray-500 mt-1">Cost to purchase/produce</p>
                      </div>
                      
                      <div>
                          <label className="block text-xs font-bold text-emerald-700 mb-1">Selling Price</label>
                          <div className="relative">
                              <span className="absolute left-3 top-2.5 text-emerald-600 font-bold">৳</span>
                              <input 
                                type="number" 
                                required 
                                min="0" 
                                className="input-field pl-7 font-bold text-emerald-900 bg-white border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500" 
                                value={formData.price || ''} 
                                onChange={e => setFormData({...formData, price: Number(e.target.value)})} 
                                placeholder="0.00"
                              />
                          </div>
                      </div>
                  </div>

                  {/* Margin Indicator */}
                  {calculatedMargin && (
                      <div className={`mt-3 flex items-center justify-between p-2 rounded-lg ${calculatedMargin.profit > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          <div className="text-xs font-bold uppercase">Estimated Profit:</div>
                          <div className="text-sm font-bold flex items-center gap-2">
                              <span>৳{calculatedMargin.profit.toFixed(2)}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${calculatedMargin.profit > 0 ? 'bg-white/50' : 'bg-red-200'}`}>
                                  {calculatedMargin.percent.toFixed(1)}%
                              </span>
                          </div>
                      </div>
                  )}
              </div>

              {/* --- STORE SPECIFIC FIELDS (ISOLATED) --- */}
              
              {currentCategory === 'medicine' && (
                  <div className="bg-cyan-50 p-4 rounded-lg border border-cyan-100">
                      <h4 className="text-sm font-bold text-cyan-700 mb-3 flex items-center gap-1"><Pill size={14} /> Medicine Details</h4>
                      <div className="grid grid-cols-2 gap-4">
                          <div className="col-span-2">
                              <label className="block text-xs font-bold text-gray-600 mb-1">Generic Name</label>
                              <input type="text" className="input-field" value={formData.genericName || ''} onChange={e => setFormData({...formData, genericName: e.target.value})} placeholder="e.g. Paracetamol" />
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-gray-600 mb-1">Batch No</label>
                              <input type="text" className="input-field" value={formData.batchNumber || ''} onChange={e => setFormData({...formData, batchNumber: e.target.value})} />
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-red-600 mb-1 flex items-center gap-1">Expiry Date <AlertCircle size={10}/></label>
                              <input type="date" className="input-field border-red-200 focus:border-red-500" value={formData.expiryDate || ''} onChange={e => setFormData({...formData, expiryDate: e.target.value})} />
                          </div>
                      </div>
                  </div>
              )}

              {currentCategory === 'clothing' && (
                  <div className="bg-violet-50 p-4 rounded-lg border border-violet-100">
                       <h4 className="text-sm font-bold text-violet-700 mb-3 flex items-center gap-1"><Shirt size={14} /> Apparel Details</h4>
                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="block text-xs font-bold text-gray-600 mb-1">Brand</label>
                               <input type="text" className="input-field" value={formData.brand || ''} onChange={e => setFormData({...formData, brand: e.target.value})} />
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-violet-700 mb-1">Size</label>
                               <input type="text" className="input-field border-violet-200" value={formData.size || ''} onChange={e => setFormData({...formData, size: e.target.value})} placeholder="S, M, L, XL"/>
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-violet-700 mb-1">Color</label>
                               <input type="text" className="input-field border-violet-200" value={formData.color || ''} onChange={e => setFormData({...formData, color: e.target.value})} />
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-gray-600 mb-1">Style Code</label>
                               <input type="text" className="input-field" value={formData.style || ''} onChange={e => setFormData({...formData, style: e.target.value})} />
                           </div>
                       </div>
                  </div>
              )}

              {currentCategory === 'electronics' && (
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                       <h4 className="text-sm font-bold text-blue-700 mb-3 flex items-center gap-1"><Zap size={14} /> Device Details</h4>
                       <div className="grid grid-cols-1 gap-4">
                           <div>
                               <label className="block text-xs font-bold text-blue-700 mb-1">Serial / IMEI Number</label>
                               <input type="text" className="input-field font-mono border-blue-200" value={formData.serialNumber || ''} onChange={e => setFormData({...formData, serialNumber: e.target.value})} />
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-gray-600 mb-1">Warranty Period</label>
                               <input type="text" className="input-field" value={formData.warranty || ''} onChange={e => setFormData({...formData, warranty: e.target.value})} placeholder="e.g. 1 Year Official"/>
                           </div>
                       </div>
                  </div>
              )}

              {currentCategory === 'restaurant' && (
                  <div className="bg-orange-50 p-4 rounded-lg border border-orange-100">
                       <h4 className="text-sm font-bold text-orange-700 mb-3 flex items-center gap-1"><Utensils size={14} /> Menu Details</h4>
                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="block text-xs font-bold text-gray-600 mb-1">Dietary Type</label>
                               <select className="input-field bg-white" value={formData.dietaryType || ''} onChange={e => setFormData({...formData, dietaryType: e.target.value as any})}>
                                   <option value="">None</option>
                                   <option value="veg">Vegetarian</option>
                                   <option value="non-veg">Non-Veg</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-gray-600 mb-1">Prep Time (min)</label>
                               <input type="number" className="input-field" value={formData.preparationTime || ''} onChange={e => setFormData({...formData, preparationTime: Number(e.target.value)})} />
                           </div>
                       </div>
                  </div>
              )}

              {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
              <div className="pt-2 flex gap-3 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium">{t.cancel}</button>
                <button type="submit" disabled={isSaving} className={`flex-1 py-2.5 text-white rounded-lg flex justify-center items-center gap-2 font-bold shadow-md disabled:opacity-60 ${getThemeColorClass('button')}`}>
                    <Save size={18} /> {isSaving ? 'Saving…' : t.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
          .input-field {
              width: 100%;
              padding: 0.6rem;
              border: 1px solid #e2e8f0;
              border-radius: 0.5rem;
              outline: none;
              font-size: 0.95rem;
              transition: all 0.2s;
          }
          .input-field:focus {
              border-color: #cbd5e1;
              box-shadow: 0 0 0 3px rgba(226, 232, 240, 0.4);
          }
      `}</style>
    </div>
  );
};

export default Inventory;
