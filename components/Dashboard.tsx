
import React, { useMemo, useState, useEffect } from 'react';
import { Sale, Language, User } from '../types';
import { TRANSLATIONS } from '../constants';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line
} from 'recharts';
import { TrendingUp, DollarSign, ShoppingBag, AlertTriangle, UserMinus, Download, CreditCard, Lock, Banknote, Smartphone, Megaphone, X, Globe, Truck, PackageCheck, Clock3 } from 'lucide-react';
import { useApiData } from '../hooks/useApiData';
import { StorageService } from '../services/storage';
import SubscriptionModal from './SubscriptionModal';
import InventoryInsights from './InventoryInsights';

interface DashboardProps {
  sales: Sale[];
  lang: Language;
}

const Dashboard: React.FC<DashboardProps> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const [user, setUser] = useState<User | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);
  
  // Realtime Data Hooks
  const { data: productsData } = useApiData(() => StorageService.getProducts(), []);
  const products = productsData || [];
  const { data: salesData } = useApiData(() => StorageService.getSales(), []);
  const sales = salesData || [];
  const { data: expensesData } = useApiData(() => StorageService.getExpenses(), []);
  const expenses = expensesData || [];
  const { data: announcementsData } = useApiData(() => StorageService.getAnnouncements(), []);
  const allAnnouncements = announcementsData || [];
  const { data: onlineOrdersData, loading: onlineOrdersLoading, refetch: refetchOnlineOrders } = useApiData(() => StorageService.getStoreOnlineOrders(), []);
  const onlineOrders = onlineOrdersData || [];

  useEffect(() => {
    StorageService.getCurrentUser().then(setUser);
  }, [showUpsell]);

  // Keep online order stats fresh without requiring a manual refresh
  useEffect(() => {
    const interval = setInterval(() => {
      refetchOnlineOrders();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetchOnlineOrders]);

  // Filter Active Announcements for this User
  const activeNotices = useMemo(() => {
      if (!user) return [];
      const now = new Date().toISOString().split('T')[0];
      return allAnnouncements.filter(ann => {
          if (!ann.isActive) return false;
          if (ann.endDate < now) return false;
          if (ann.startDate > now) return false;
          
          if (ann.target === 'all') return true;
          if (Array.isArray(ann.target) && ann.target.includes(user.id)) return true;
          return false;
      });
  }, [allAnnouncements, user]);

  const [dismissedNotices, setDismissedNotices] = useState<string[]>([]);

  // Calculate stats
  const stats = useMemo(() => {
    const totalSales = sales.reduce((acc, curr) => acc + curr.totalAmount, 0);
    const totalDue = sales.reduce((acc, curr) => acc + (curr.dueAmount || 0), 0);
    const lowStockCount = products.filter(p => p.stock < 10).length;
    
    // Profit Calculation (Real Net Profit)
    const grossProfit = sales.reduce((acc, curr) => acc + curr.totalProfit, 0);
    const totalExp = expenses.reduce((acc, curr) => acc + curr.amount, 0);
    const netProfit = grossProfit - totalExp;

    const cashSales = sales
        .filter(s => s.paymentMethod === 'cash' || !s.paymentMethod)
        .reduce((acc, s) => acc + s.paidAmount, 0);

    const digitalSales = sales
        .filter(s => s.paymentMethod !== 'cash' && !!s.paymentMethod)
        .reduce((acc, s) => acc + s.paidAmount, 0);

    const cashInHand = cashSales - totalExp;

    return { 
        totalSales, 
        totalProfit: netProfit, 
        count: sales.length, 
        lowStockCount, 
        totalDue, 
        totalExpenses: totalExp,
        cashInHand,
        digitalSales
    };
  }, [sales, products, expenses]);

  // Online (marketplace) order stats — kept separate from in-store POS stats above,
  // then combined for the owner's total revenue picture.
  const onlineStats = useMemo(() => {
    const activeOrders = onlineOrders.filter(o => o.status !== 'cancelled');
    const totalOnlineRevenue = activeOrders.reduce((acc, o) => acc + o.totalAmount, 0);
    const pending = onlineOrders.filter(o => o.status === 'placed').length;
    const confirmed = onlineOrders.filter(o => o.status === 'confirmed').length;
    const outForDelivery = onlineOrders.filter(o => o.status === 'out_for_delivery').length;
    const delivered = onlineOrders.filter(o => o.status === 'delivered').length;
    const cancelled = onlineOrders.filter(o => o.status === 'cancelled').length;
    const needsAttention = pending + confirmed + outForDelivery;
    const recent = [...onlineOrders]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 5);
    return { totalOnlineRevenue, pending, confirmed, outForDelivery, delivered, cancelled, needsAttention, recent, count: activeOrders.length };
  }, [onlineOrders]);

  const combinedRevenue = stats.totalSales + onlineStats.totalOnlineRevenue;

  const statusLabel: Record<string, string> = {
    placed: 'Placed',
    confirmed: 'Confirmed',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };
  const statusColor: Record<string, string> = {
    placed: 'bg-amber-100 text-amber-700',
    confirmed: 'bg-blue-100 text-blue-700',
    out_for_delivery: 'bg-purple-100 text-purple-700',
    delivered: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  // Prepare Chart Data
  const chartData = useMemo(() => {
    const data: any = {};
    sales.forEach(sale => {
      const date = new Date(sale.date).toLocaleDateString('en-US', { weekday: 'short' });
      if (!data[date]) data[date] = { name: date, sales: 0, profit: 0 };
      data[date].sales += sale.totalAmount;
      data[date].profit += sale.totalProfit; 
    });
    return Object.values(data).slice(-7); 
  }, [sales]);

  // Generate Monthly Report CSV
  const downloadReport = () => {
    if (user?.plan === 'free') {
        setShowUpsell(true);
        return;
    }
    alert("Report download started");
  };

  return (
    <div className="p-6 space-y-8 bg-slate-50 min-h-full">
      {showUpsell && (
        <SubscriptionModal 
            lang={lang} 
            onClose={() => setShowUpsell(false)} 
            onSuccess={() => StorageService.getCurrentUser().then(setUser)} 
        />
      )}

      {/* Announcements Banner */}
      {activeNotices.filter(n => !dismissedNotices.includes(n.id)).map(notice => (
          <div key={notice.id} className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl p-4 text-white shadow-md relative animate-in fade-in slide-in-from-top-2">
              <div className="flex items-start gap-4 pr-8">
                  <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm shrink-0">
                      <Megaphone size={24} className="text-white animate-pulse" />
                  </div>
                  <div>
                      <h4 className="font-bold text-lg mb-1">{notice.title}</h4>
                      <p className="text-blue-50 text-sm whitespace-pre-wrap">{notice.message}</p>
                  </div>
              </div>
              <button 
                  onClick={() => setDismissedNotices(prev => [...prev, notice.id])}
                  className="absolute top-2 right-2 p-1 text-blue-200 hover:text-white hover:bg-white/10 rounded-full transition"
              >
                  <X size={20} />
              </button>
          </div>
      ))}

      <div className="flex justify-between items-center mb-6">
         <div className="flex items-center gap-4">
             {user?.profilePicture ? (
                 <img src={user.profilePicture} className="w-12 h-12 rounded-full border-2 border-emerald-500 shadow-sm object-cover" />
             ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-400 font-bold border-2 border-white shadow-sm">
                    {user?.storeName?.charAt(0) || 'S'}
                </div>
             )}
             <div>
                <h2 className="text-2xl font-bold text-gray-800">{t.dashboard}</h2>
                {user?.plan === 'premium' && (
                    <span className="text-xs bg-gradient-to-r from-yellow-200 to-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 w-fit mt-1">
                        <span className="text-[10px]">👑</span> {t.premium}
                    </span>
                )}
             </div>
         </div>
         <button 
            onClick={downloadReport} 
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition ${user?.plan === 'free' ? 'bg-gray-200 text-gray-500' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
         >
             {user?.plan === 'free' ? <Lock size={16} /> : <Download size={18} />} 
             {t.downloadReport}
         </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-3 col-span-1 md:col-span-2">
          <div className="p-3 bg-emerald-100 text-emerald-600 rounded-full"><DollarSign size={20} /></div>
          <div><p className="text-xs text-gray-500">{t.totalSales}</p><p className="text-lg font-bold text-gray-800">৳{stats.totalSales.toLocaleString()}</p></div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-3 col-span-1 md:col-span-2">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-full"><TrendingUp size={20} /></div>
          <div><p className="text-xs text-gray-500">{t.netProfit}</p><p className="text-lg font-bold text-gray-800">৳{stats.totalProfit.toLocaleString()}</p></div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-teal-200 flex items-center space-x-3 col-span-1 md:col-span-2 bg-teal-50">
          <div className="p-3 bg-teal-100 text-teal-700 rounded-full"><Banknote size={20} /></div>
          <div><p className="text-xs text-teal-700 font-semibold">{t.cashInHand}</p><p className="text-lg font-bold text-teal-900">৳{stats.cashInHand.toLocaleString()}</p></div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-pink-200 flex items-center space-x-3 col-span-1 md:col-span-2 bg-pink-50">
          <div className="p-3 bg-pink-100 text-pink-700 rounded-full"><Smartphone size={20} /></div>
          <div><p className="text-xs text-pink-700 font-semibold">{t.digitalSales}</p><p className="text-lg font-bold text-pink-900">৳{stats.digitalSales.toLocaleString()}</p></div>
        </div>
      </div>

      {/* --- ONLINE SALES OVERVIEW (Marketplace orders integrated into the owner dashboard) --- */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gradient-to-r from-indigo-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 text-indigo-600 rounded-full"><Globe size={20} /></div>
            <div>
              <h3 className="text-lg font-bold text-gray-800">Online Store Sales</h3>
              <p className="text-xs text-gray-500">Live orders from your marketplace storefront</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs text-gray-500">Online Revenue</p>
              <p className="text-xl font-bold text-indigo-700">৳{onlineStats.totalOnlineRevenue.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Combined Revenue</p>
              <p className="text-xl font-bold text-emerald-700">৳{combinedRevenue.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-100">
            <Clock3 size={18} className="text-amber-600" />
            <div><p className="text-xs text-amber-700 font-semibold">Placed</p><p className="text-lg font-bold text-amber-900">{onlineStats.pending}</p></div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
            <PackageCheck size={18} className="text-blue-600" />
            <div><p className="text-xs text-blue-700 font-semibold">Confirmed</p><p className="text-lg font-bold text-blue-900">{onlineStats.confirmed}</p></div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-purple-50 border border-purple-100">
            <Truck size={18} className="text-purple-600" />
            <div><p className="text-xs text-purple-700 font-semibold">Out for Delivery</p><p className="text-lg font-bold text-purple-900">{onlineStats.outForDelivery}</p></div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
            <ShoppingBag size={18} className="text-emerald-600" />
            <div><p className="text-xs text-emerald-700 font-semibold">Delivered</p><p className="text-lg font-bold text-emerald-900">{onlineStats.delivered}</p></div>
          </div>
        </div>

        {onlineStats.needsAttention > 0 && (
          <div className="mx-5 mb-4 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium flex items-center gap-2">
            <AlertTriangle size={16} />
            {onlineStats.needsAttention} online order{onlineStats.needsAttention > 1 ? 's' : ''} need{onlineStats.needsAttention === 1 ? 's' : ''} your attention — go to "Online Orders" to update delivery status.
          </div>
        )}

        <div className="px-5 pb-5">
          <h4 className="text-sm font-bold text-gray-600 mb-3">Recent Online Orders</h4>
          {onlineOrdersLoading ? (
            <div className="text-center py-6 text-gray-400 text-sm">Loading online orders...</div>
          ) : onlineStats.recent.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">No online orders yet. Enable "Online Visibility" on your products so customers can order from the marketplace.</div>
          ) : (
            <div className="space-y-2">
              {onlineStats.recent.map(order => (
                <div key={order.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-gray-50">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">#{order.id.slice(-6)} · {order.customerName}</p>
                    <p className="text-xs text-gray-500">{new Date(order.createdAt || Date.now()).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-700">৳{order.totalAmount.toLocaleString()}</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${statusColor[order.status] || 'bg-gray-100 text-gray-600'}`}>
                      {statusLabel[order.status] || order.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* --- NEW INVENTORY INSIGHTS SECTION --- */}
      <InventoryInsights products={products} sales={sales} lang={lang} />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-80">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">{t.totalSales} (Last 7 Days)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => `৳${value}`} />
              <Bar dataKey="sales" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-80">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">Gross Profit (Trend)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => `৳${value}`} />
              <Line type="monotone" dataKey="profit" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
