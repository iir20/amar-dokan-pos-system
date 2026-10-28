
import React, { useMemo } from 'react';
import { Product, Sale, Language } from '../types';
import { TRANSLATIONS } from '../constants';
import { AlertCircle, TrendingUp, TrendingDown, Package, PieChart, Activity, Zap, RefreshCw } from 'lucide-react';

interface Props {
  products: Product[];
  sales: Sale[];
  lang: Language;
}

const InventoryInsights: React.FC<Props> = ({ products, sales, lang }) => {
  const t = TRANSLATIONS[lang];

  const insights = useMemo(() => {
    // 1. Calculate Stock Value
    const totalStockValue = products.reduce((acc, p) => acc + (p.cost * p.stock), 0);
    
    // 2. Calculate Sales Frequency (Velocity)
    const productVelocity: Record<string, number> = {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    sales.forEach(sale => {
      const saleDate = new Date(sale.date);
      if (saleDate >= thirtyDaysAgo) {
        sale.items.forEach(item => {
          productVelocity[item.id] = (productVelocity[item.id] || 0) + item.quantity;
        });
      }
    });

    // 3. High Demand Products (Top Velocity)
    const highDemand = Object.entries(productVelocity)
      .map(([id, qty]) => ({ product: products.find(p => p.id === id), qty }))
      .filter(item => item.product)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 4);

    // 4. Stagnant Stock (No sales in 30 days but has stock > 0)
    const stagnant = products
      .filter(p => p.stock > 0 && !productVelocity[p.id])
      .sort((a, b) => (b.stock * b.cost) - (a.stock * a.cost)) // Sort by tied capital
      .slice(0, 4);

    // 5. Critical Stock (Low Stock + High Velocity)
    const critical = products
      .filter(p => p.stock < 10)
      .sort((a, b) => (productVelocity[b.id] || 0) - (productVelocity[a.id] || 0))
      .slice(0, 4);

    return { totalStockValue, highDemand, stagnant, critical };
  }, [products, sales]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Activity className="text-emerald-500" size={24} />
            {t.inventoryAlerts}
        </h3>
        <div className="bg-emerald-50 border border-emerald-100 px-4 py-2 rounded-xl flex items-center gap-3">
            <Package className="text-emerald-600" size={18} />
            <div>
                <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">{t.stockValue}</p>
                <p className="text-sm font-bold text-emerald-800">৳{insights.totalStockValue.toLocaleString()}</p>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* CRITICAL STOCK COLUMN */}
        <div className="bg-white rounded-2xl shadow-sm border border-red-100 overflow-hidden">
            <div className="bg-red-50 p-4 border-b border-red-100 flex items-center justify-between">
                <span className="font-bold text-red-700 flex items-center gap-2">
                    <AlertCircle size={18} /> {t.criticalStock}
                </span>
                <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full animate-pulse">{insights.critical.length}</span>
            </div>
            <div className="p-2 space-y-1">
                {insights.critical.length === 0 ? (
                    <p className="text-center py-8 text-gray-400 text-sm">Stock levels are healthy</p>
                ) : insights.critical.map(item => (
                    <div key={item!.id} className="p-3 hover:bg-red-50 rounded-xl transition flex justify-between items-center group">
                        <div className="min-w-0">
                            <p className="font-bold text-gray-800 text-sm truncate">{lang === 'bn' ? item!.nameBn : item!.name}</p>
                            <p className="text-[10px] text-gray-400 uppercase">{item!.category}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm font-bold text-red-600">{item!.stock} {item!.unit}</p>
                            <p className="text-[10px] text-gray-400">Restock Soon</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>

        {/* HIGH DEMAND COLUMN */}
        <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-hidden">
            <div className="bg-emerald-50 p-4 border-b border-emerald-100 flex items-center justify-between">
                <span className="font-bold text-emerald-700 flex items-center gap-2">
                    <TrendingUp size={18} /> {t.highDemand}
                </span>
                <Zap size={16} className="text-yellow-500 fill-yellow-500" />
            </div>
            <div className="p-2 space-y-1">
                {insights.highDemand.length === 0 ? (
                    <p className="text-center py-8 text-gray-400 text-sm">Need more sales data</p>
                ) : insights.highDemand.map(({ product, qty }) => (
                    <div key={product!.id} className="p-3 hover:bg-emerald-50 rounded-xl transition flex justify-between items-center">
                        <div className="min-w-0">
                            <p className="font-bold text-gray-800 text-sm truncate">{lang === 'bn' ? product!.nameBn : product!.name}</p>
                            <p className="text-[10px] text-gray-500">{t.moneyMakers}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm font-bold text-emerald-600">+{qty}</p>
                            <p className="text-[10px] text-gray-400">Last 30 days</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>

        {/* STAGNANT STOCK COLUMN */}
        <div className="bg-white rounded-2xl shadow-sm border border-orange-100 overflow-hidden">
            <div className="bg-orange-50 p-4 border-b border-orange-100 flex items-center justify-between">
                <span className="font-bold text-orange-700 flex items-center gap-2">
                    <TrendingDown size={18} /> {t.stagnantStock}
                </span>
                <PieChart size={16} className="text-orange-400" />
            </div>
            <div className="p-2 space-y-1">
                {insights.stagnant.length === 0 ? (
                    <p className="text-center py-8 text-gray-400 text-sm">No stagnant stock detected</p>
                ) : insights.stagnant.map(item => (
                    <div key={item!.id} className="p-3 hover:bg-orange-50 rounded-xl transition flex justify-between items-center">
                        <div className="min-w-0">
                            <p className="font-bold text-gray-800 text-sm truncate">{lang === 'bn' ? item!.nameBn : item!.name}</p>
                            <p className="text-[10px] text-gray-400 capitalize">{item!.unit} • In Stock</p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm font-bold text-orange-600">৳{(item!.stock * item!.cost).toLocaleString()}</p>
                            <p className="text-[10px] text-gray-400 tracking-tighter uppercase font-bold">Capital Tied</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>

      </div>

      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-4 rounded-2xl text-white shadow-lg flex items-center justify-between">
          <div className="flex items-center gap-4">
              <div className="bg-white/20 p-3 rounded-xl backdrop-blur-md">
                  <RefreshCw size={24} />
              </div>
              <div>
                  <h4 className="font-bold text-lg">Smart Reordering Active</h4>
                  <p className="text-emerald-100 text-sm opacity-90">Analysis updated based on latest real-time transactions.</p>
              </div>
          </div>
          <button className="bg-white text-emerald-700 px-6 py-2 rounded-xl font-bold text-sm shadow-sm hover:bg-emerald-50 transition active:scale-95">
              Refine Strategy
          </button>
      </div>
    </div>
  );
};

export default InventoryInsights;
