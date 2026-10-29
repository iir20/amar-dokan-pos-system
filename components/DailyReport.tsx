
import React, { useState, useMemo, useEffect } from 'react';
import { useApiData } from '../hooks/useApiData';
import { StorageService } from '../services/storage';
import { api } from '../services/api';
import { getOutbox, subscribeToSync } from '../services/amarSync';
import { Language, Sale } from '../types';
import { TRANSLATIONS, APP_LOGO } from '../constants';
import ReceiptView from './ReceiptView';
import { formatTakaForLang } from '../utils/currency';
import {
  Calendar, Printer, TrendingUp, TrendingDown, DollarSign, CreditCard,
  Banknote, Package, BarChart as BarChartIcon, ArrowRightLeft, Target,
  Percent, ShoppingBag, Clock, Flame, Award, HeartPulse, ArrowUpRight,
  ArrowDownRight, Zap, Coffee, Wallet, Activity, Star, Receipt, BookOpen, Eye
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, 
  CartesianGrid, AreaChart, Area, BarChart, Bar 
} from 'recharts';

interface DailyReportProps {
  lang: Language;
}

// Wave 2 (second addition) — server hisab closing summary, served by
// GET /api/hisab?date=YYYY-MM-DD (integer paisa, server-recalculated).
// duesCollected is null by design until a due-collection endpoint
// exists: showing 0 would pretend collections were counted.
interface HisabSummary {
  date: string;
  salesCount: number;
  salesTotal: number;
  cashPaid: number;
  digitalPaid: number;
  duesCreated: number;
  duesOutstandingTotal: number;
  duesCollected: number | null;
  duesCollectedAvailable: boolean;
  expensesTotal: number;
  expensesCount: number;
  cashInHand: number;
  byMethod: Record<string, number>;
}

// New UI strings for the history + hisab tabs live here (EN + BN);
// types.ts / constants.ts are owned by the merge coordinator.
const DR2: Record<string, { en: string; bn: string }> = {
  history: { en: 'Sales history', bn: 'বিক্রির হিস্ট্রি' },
  hisab: { en: 'Daily hisab (closing)', bn: 'দিনের হিসাব (ক্লোজিং)' },
  tapToReceipt: { en: 'Tap a sale to open its full receipt.', bn: 'যেকোনো বিক্রিতে ট্যাপ করলে পুরো রশিদ খুলবে।' },
  noSalesDay: { en: 'No sales on this day.', bn: 'এই দিনে কোনো বিক্রি নেই।' },
  syncPending: { en: 'Sync pending', bn: 'সিঙ্ক বাকি' },
  viewReceipt: { en: 'View receipt', bn: 'রশিদ দেখুন' },
  hisabNote: {
    en: 'Cash in hand = cash received today minus expenses today. Dues collected is not counted yet: due-collection recording needs its own endpoint (see report) — it is shown as unavailable, never as 0.',
    bn: 'হাতে নগদ = আজকের নগদ প্রাপ্তি বিয়োগ আজকের খরচ। বাকি আদায় এখনো গোনা হয় না: বাকি আদায় রেকর্ডের জন্য আলাদা এন্ডপয়েন্ট লাগবে — তাই এটিকে অনুপলব্ধ দেখানো হয়েছে, ০ নয়।',
  },
  hisabLoadFailed: { en: 'Could not load the hisab summary. Check connection and retry.', bn: 'হিসাব লোড করা যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।' },
  salesToday: { en: "Today's sales", bn: 'আজকের বিক্রি' },
  cashPaid: { en: 'Cash received', bn: 'নগদ প্রাপ্তি' },
  digitalPaid: { en: 'Digital received', bn: 'ডিজিটাল প্রাপ্তি' },
  duesCreated: { en: 'New dues today', bn: 'আজকের নতুন বাকি' },
  duesOutstanding: { en: 'Total dues outstanding', bn: 'মোট বাকি (সব দিন)' },
  duesCollected: { en: 'Dues collected today', bn: 'আজকের বাকি আদায়' },
  notAvailable: { en: 'Not available yet', bn: 'এখনো চালু হয়নি' },
  expensesToday: { en: "Today's expenses", bn: 'আজকের খরচ' },
  cashInHand: { en: 'Cash in hand', bn: 'হাতে নগদ' },
  byMethod: { en: 'Received by method', bn: 'মাধ্যম অনুযায়ী প্রাপ্তি' },
  retry: { en: 'Retry', bn: 'আবার চেষ্টা করুন' },
};

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const DailyReport: React.FC<DailyReportProps> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [activeTab, setActiveTab] = useState<'financial' | 'inventory' | 'analysis' | 'history' | 'hisab'>('financial');
  const [receiptSale, setReceiptSale] = useState<{ sale: Sale; syncPending: boolean } | null>(null);
  const [hisab, setHisab] = useState<HisabSummary | null>(null);
  const [hisabError, setHisabError] = useState('');
  const [hisabLoading, setHisabLoading] = useState(false);
  const [, setSyncTick] = useState(0);
  const s2 = (key: keyof typeof DR2) => DR2[key][lang];
  const tk2 = (n: number) => formatTakaForLang(n, lang);

  // Outbox changes (offline sale queued / flushed) re-render history.
  useEffect(() => subscribeToSync(() => setSyncTick((v) => v + 1)), []);

  const loadHisab = async () => {
    setHisabLoading(true);
    setHisabError('');
    try {
      setHisab(await api.get(`/hisab?date=${selectedDate}`));
    } catch {
      setHisab(null);
      setHisabError(s2('hisabLoadFailed'));
    } finally {
      setHisabLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'hisab') void loadHisab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedDate]);

  // Fetch data
  const { data: allSalesData } = useApiData(() => StorageService.getSales(), []);
  const allSales = allSalesData || [];
  const { data: allExpensesData } = useApiData(() => StorageService.getExpenses(), []);
  const allExpenses = allExpensesData || [];
  const { data: inventoryLogsData } = useApiData(() => StorageService.getInventoryLogs(), []);
  const inventoryLogs = inventoryLogsData || [];

  // Data Processing Logic
  const reportData = useMemo(() => {
    const safeSales = Array.isArray(allSales) ? allSales : [];
    const safeExpenses = Array.isArray(allExpenses) ? allExpenses : [];
    
    const yesterday = new Date(selectedDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const sales = safeSales.filter(s => s.date && s.date.startsWith(selectedDate));
    const yesterdaySales = safeSales.filter(s => s.date && s.date.startsWith(yesterdayStr));
    
    const expenses = safeExpenses.filter(e => e.date && e.date.startsWith(selectedDate));
    const logs = inventoryLogs.filter(l => l.date && l.date.startsWith(selectedDate));
    
    // Core Financials
    const totalSales = sales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
    const totalYesterdaySales = yesterdaySales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
    const totalExpenses = expenses.reduce((acc, e) => acc + (e.amount || 0), 0);
    const grossProfit = sales.reduce((acc, s) => acc + (s.totalProfit || 0), 0);
    const netProfit = grossProfit - totalExpenses;
    
    // Performance Metrics
    const transactionCount = sales.length;
    const avgBasketValue = transactionCount > 0 ? totalSales / transactionCount : 0;
    const profitMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;
    const totalQtySold = sales.reduce((acc, s) => acc + s.items.reduce((sum, item) => sum + item.quantity, 0), 0);

    // Cash Reconciliation
    const cashSales = sales.filter(s => s.paymentMethod === 'cash' || !s.paymentMethod).reduce((acc, s) => acc + s.paidAmount, 0);
    const digitalSales = totalSales - cashSales;
    const drawerCash = cashSales - totalExpenses;

    // Time Analysis
    const hourlySales = new Array(24).fill(0);
    sales.forEach(s => {
        const hour = new Date(s.date).getHours();
        hourlySales[hour] += s.totalAmount;
    });
    
    let peakHour = 0;
    let maxHourlySales = 0;
    hourlySales.forEach((val, hour) => {
        if (val > maxHourlySales) {
            maxHourlySales = val;
            peakHour = hour;
        }
    });

    const largestSale = sales.reduce((max, s) => s.totalAmount > max ? s.totalAmount : max, 0);
    const growth = totalYesterdaySales > 0 ? ((totalSales - totalYesterdaySales) / totalYesterdaySales) * 100 : 0;

    // Chart Data
    const paymentMethods: Record<string, number> = {};
    sales.forEach(s => {
        const method = s.paymentMethod || 'cash';
        paymentMethods[method] = (paymentMethods[method] || 0) + s.paidAmount;
    });
    const paymentChartData = Object.keys(paymentMethods).map(k => ({ name: k.toUpperCase(), value: paymentMethods[k] }));

    const hourlyChartData = hourlySales.map((amount, hour) => ({ 
      time: `${hour}:00`, 
      sales: amount 
    })).filter((item, index) => index >= 8 && index <= 23); // Show business hours

    // Top Profit-Making Products
    const profitByProduct: Record<string, { name: string, profit: number, qty: number }> = {};
    sales.forEach(s => {
      s.items.forEach(item => {
        if (!profitByProduct[item.id]) {
          profitByProduct[item.id] = { name: lang === 'bn' ? item.nameBn : item.name, profit: 0, qty: 0 };
        }
        const itemProfit = (item.price - (item.cost || 0)) * item.quantity;
        profitByProduct[item.id].profit += itemProfit;
        profitByProduct[item.id].qty += item.quantity;
      });
    });

    const topMoneyMakers = Object.values(profitByProduct)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    const expenseCats: Record<string, number> = {};
    expenses.forEach(e => {
        expenseCats[e.category] = (expenseCats[e.category] || 0) + e.amount;
    });

    return {
        sales, expenses, logs, totalSales, totalExpenses, netProfit, 
        avgBasketValue, profitMargin, totalQtySold, peakHour, largestSale, growth,
        paymentChartData, hourlyChartData, topMoneyMakers, transactionCount,
        cashSales, digitalSales, drawerCash, expenseCats
    };
  }, [allSales, allExpenses, inventoryLogs, selectedDate, lang]);

  // History for the selected day: server sales + not-yet-synced
  // outbox sales (server wins on id collision). An offline sale is
  // therefore tappable to its receipt BEFORE it syncs, and after sync
  // the same id resolves to the server record — never a dead end.
  const historySales = useMemo(() => {
    const byId = new Map<string, { sale: Sale; syncPending: boolean }>();
    for (const item of getOutbox()) {
      const s = item.sale as Sale | undefined;
      if (s && s.date && s.date.startsWith(selectedDate)) {
        byId.set(s.id, { sale: s, syncPending: item.status !== 'synced' });
      }
    }
    for (const s of allSales) {
      if (s.date && s.date.startsWith(selectedDate)) byId.set(s.id, { sale: s, syncPending: false });
    }
    return [...byId.values()].sort(
      (a, b) => new Date(b.sale.date).getTime() - new Date(a.sale.date).getTime(),
    );
  }, [allSales, selectedDate]);

  const handlePrint = () => window.print();

  return (
    <div className="p-4 md:p-6 h-full overflow-y-auto bg-slate-50 no-scrollbar space-y-6">
       
       {/* 1. SMART HEADER */}
       <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 no-print bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
           <div className="flex items-center gap-4">
               <div className="bg-emerald-600 p-3 rounded-2xl text-white shadow-lg shadow-emerald-200">
                    <Activity size={28} />
               </div>
               <div>
                   <h1 className="text-2xl font-black text-gray-800 tracking-tight">{t.dailyReport}</h1>
                   <p className="text-gray-500 text-sm font-medium flex items-center gap-1">
                        <Target size={14} className="text-emerald-500" />
                        {new Date(selectedDate).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', { day:'numeric', month:'long', year:'numeric' })}
                   </p>
               </div>
           </div>
           
           <div className="flex items-center gap-3 w-full md:w-auto">
               <input 
                type="date"
                className="flex-1 md:w-48 px-4 py-2.5 border rounded-xl shadow-inner focus:ring-2 focus:ring-emerald-500 outline-none bg-slate-50 font-bold text-gray-700 transition-all"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
               />
               <button 
                onClick={handlePrint}
                className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-xl hover:bg-black transition shadow-md font-bold text-sm"
               >
                   <Printer size={18} /> {t.printReport}
               </button>
           </div>
       </div>

       {/* 2. TAB SWITCHER */}
       <div className="flex gap-2 no-print overflow-x-auto no-scrollbar border-b">
            {[
                { id: 'financial', label: t.cashFlow, icon: Wallet },
                { id: 'analysis', label: t.salesAnalysis, icon: BarChartIcon },
                { id: 'inventory', label: t.inventoryLogs, icon: ArrowRightLeft },
                { id: 'history', label: s2('history'), icon: Receipt },
                { id: 'hisab', label: s2('hisab'), icon: BookOpen }
            ].map(tab => (
                <button
                    key={tab.id}
                    data-testid={`reports-tab-${tab.id}`}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`pb-3 px-6 font-bold transition flex items-center gap-2 whitespace-nowrap text-sm border-b-2 ${
                        activeTab === tab.id ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-400 hover:text-gray-600'
                    }`}
                >
                    <tab.icon size={18} /> {tab.label}
                </button>
            ))}
       </div>

       {/* 3. DYNAMIC CONTENT */}
       <div className="space-y-6">
            {activeTab === 'financial' && (
                <div className="animate-fade-in space-y-6">
                    {/* TOP PERFORMANCE GRID */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white p-5 rounded-3xl shadow-sm border border-emerald-100 flex flex-col justify-between group">
                            <div className="flex justify-between items-start">
                                <div className="p-2 bg-emerald-100 text-emerald-600 rounded-xl"><TrendingUp size={20} /></div>
                                <div className={`flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full ${reportData.growth >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                                    {reportData.growth >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                                    {Math.abs(reportData.growth).toFixed(1)}% {t.vsYesterday}
                                </div>
                            </div>
                            <div className="mt-4">
                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-1">{t.totalIncome}</p>
                                <p className="text-3xl font-black text-gray-900">৳{reportData.totalSales.toLocaleString()}</p>
                            </div>
                        </div>

                        <div className="bg-white p-5 rounded-3xl shadow-sm border border-blue-100 flex flex-col justify-between group">
                            <div className="flex justify-between items-start">
                                <div className="p-2 bg-blue-100 text-blue-600 rounded-xl"><Percent size={20} /></div>
                                <div className="text-[10px] text-blue-600 font-black uppercase">{t.profitMargin}: {reportData.profitMargin.toFixed(1)}%</div>
                            </div>
                            <div className="mt-4">
                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-1">{t.netProfit}</p>
                                <p className="text-3xl font-black text-blue-600">৳{reportData.netProfit.toLocaleString()}</p>
                            </div>
                        </div>

                        <div className="bg-white p-5 rounded-3xl shadow-sm border border-orange-100 flex flex-col justify-between group">
                            <div className="flex justify-between items-start">
                                <div className="p-2 bg-orange-100 text-orange-600 rounded-xl"><ShoppingBag size={20} /></div>
                                <div className="text-[10px] text-orange-600 font-black uppercase">{reportData.transactionCount} Orders</div>
                            </div>
                            <div className="mt-4">
                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-1">{t.avgBasketValue}</p>
                                <p className="text-3xl font-black text-gray-900">৳{Math.round(reportData.avgBasketValue).toLocaleString()}</p>
                            </div>
                        </div>

                        <div className="bg-slate-900 p-5 rounded-3xl shadow-xl flex flex-col justify-between relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-125 transition duration-500"><DollarSign size={80} /></div>
                            <div className="flex justify-between items-start relative z-10">
                                <div className="p-2 bg-white/10 text-emerald-400 rounded-xl"><Wallet size={20} /></div>
                                <div className="text-[10px] text-white/50 font-black uppercase">{t.netCash}</div>
                            </div>
                            <div className="mt-4 relative z-10">
                                <p className="text-[10px] text-emerald-300 font-black uppercase tracking-widest mb-1">Cash in Drawer</p>
                                <p className="text-3xl font-black text-white">৳{reportData.drawerCash.toLocaleString()}</p>
                            </div>
                        </div>
                    </div>

                    {/* CHART & INSIGHTS BENTO */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 bg-white p-6 rounded-3xl border shadow-sm">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-black text-gray-800 flex items-center gap-2"><Clock size={18} className="text-emerald-500" /> {t.hourlySales}</h3>
                                <div className="text-[10px] font-black text-gray-400 uppercase">Sales Velocity (Last 16 Hours)</div>
                            </div>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={reportData.hourlyChartData}>
                                        <defs>
                                            <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="time" fontSize={10} axisLine={false} tickLine={false} tick={{fill:'#94a3b8'}} />
                                        <YAxis fontSize={10} axisLine={false} tickLine={false} tick={{fill:'#94a3b8'}} tickFormatter={(v) => `৳${v}`} />
                                        <Tooltip 
                                            contentStyle={{borderRadius:'16px', border:'none', boxShadow:'0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                                            formatter={(value) => [`৳${value}`, 'Revenue']}
                                        />
                                        <Area type="monotone" dataKey="sales" stroke="#10b981" strokeWidth={3} fill="url(#colorSales)" dot={{r:4, fill:'#10b981'}} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="bg-white p-6 rounded-3xl border shadow-sm flex flex-col justify-between">
                                <h3 className="font-black text-gray-800 text-sm uppercase tracking-widest mb-4 flex items-center gap-2"><CreditCard size={16} className="text-blue-500" /> {t.incomeBreakdown}</h3>
                                <div className="h-40">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie 
                                              data={reportData.paymentChartData} 
                                              cx="50%" cy="50%" 
                                              innerRadius={45} 
                                              outerRadius={60} 
                                              paddingAngle={8} 
                                              dataKey="value"
                                            >
                                                {reportData.paymentChartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="grid grid-cols-2 gap-2 mt-4">
                                    {reportData.paymentChartData.map((item, idx) => (
                                        <div key={item.name} className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS[idx % COLORS.length]}} />
                                            <span className="text-[10px] font-bold text-gray-600 truncate">{item.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-white p-6 rounded-3xl border shadow-sm flex-1">
                                <h3 className="font-black text-gray-800 text-sm uppercase tracking-widest mb-4 flex items-center gap-2"><Coffee size={16} className="text-orange-500" /> Pulse Analysis</h3>
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center group">
                                        <div className="flex items-center gap-2 text-gray-500 text-xs font-bold">
                                            <Clock size={14} /> Peak Store Traffic
                                        </div>
                                        <span className="text-sm font-black text-gray-900">{reportData.peakHour}:00</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2 text-gray-500 text-xs font-bold">
                                            <Zap size={14} className="text-yellow-500" /> Largest Bill
                                        </div>
                                        <span className="text-sm font-black text-gray-900">৳{reportData.largestSale.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2 text-gray-500 text-xs font-bold">
                                            <Award size={14} className="text-emerald-500" /> Items Dispatched
                                        </div>
                                        <span className="text-sm font-black text-gray-900">{reportData.totalQtySold}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'analysis' && (
                <div className="animate-fade-in space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* PROFIT MAKERS */}
                        <div className="bg-white p-6 rounded-3xl border shadow-sm">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-black text-gray-800 flex items-center gap-2"><Flame size={20} className="text-orange-500" /> {t.moneyMakers}</h3>
                                <span className="text-[10px] font-black text-gray-400">By Total Profit</span>
                            </div>
                            <div className="space-y-4">
                                {reportData.topMoneyMakers.map((p, idx) => (
                                    <div key={idx} className="flex items-center justify-between group hover:bg-slate-50 p-2 rounded-2xl transition">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center font-black text-slate-400 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition">
                                                {idx + 1}
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-800 text-sm">{p.name}</p>
                                                <p className="text-[10px] text-gray-400">{p.qty} Sold today</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-black text-emerald-600">+৳{Math.round(p.profit).toLocaleString()}</p>
                                            <div className="w-24 h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                                                <div 
                                                    className="h-full bg-emerald-500" 
                                                    style={{width: `${(p.profit / reportData.topMoneyMakers[0].profit) * 100}%`}}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {reportData.topMoneyMakers.length === 0 && <p className="text-center py-10 text-gray-400 italic">No sales data yet.</p>}
                            </div>
                        </div>

                        {/* EXPENSE LEAKAGE */}
                        <div className="bg-white p-6 rounded-3xl border shadow-sm">
                             <div className="flex justify-between items-center mb-6">
                                <h3 className="font-black text-gray-800 flex items-center gap-2"><TrendingDown size={20} className="text-red-500" /> {t.expenseBreakdown}</h3>
                                <span className="text-[10px] font-black text-gray-400">Daily Outflow</span>
                            </div>
                            <div className="space-y-4">
                                {Object.entries(reportData.expenseCats).map(([cat, amount], idx) => (
                                    <div key={cat} className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl border border-slate-100 hover:border-red-100 transition group">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-white rounded-xl text-red-400 group-hover:scale-110 transition"><Package size={16} /></div>
                                            <span className="font-bold text-slate-700 capitalize">{cat}</span>
                                        </div>
                                        <span className="font-black text-red-600">৳{amount.toLocaleString()}</span>
                                    </div>
                                ))}
                                {reportData.totalExpenses === 0 && (
                                    <div className="text-center py-12 flex flex-col items-center gap-3 opacity-30">
                                        <Star size={48} className="text-gray-400" />
                                        <p className="text-sm font-bold">No expenses logged today. <br/> Excellent capital control!</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'inventory' && (
                <div className="animate-fade-in bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b bg-gray-50/50 flex justify-between items-center">
                        <h3 className="font-black text-gray-800 text-sm uppercase tracking-widest">{t.inventoryLogs}</h3>
                        <div className="text-[10px] font-bold text-gray-400">{reportData.logs.length} Movements</div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b">
                              <tr>
                                  <th className="p-4">{t.date}</th>
                                  <th className="p-4">{t.item}</th>
                                  <th className="p-4">Type</th>
                                  <th className="p-4 text-center">{t.qty}</th>
                                  <th className="p-4">{t.description}</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                              {reportData.logs.slice().reverse().map(log => (
                                  <tr key={log.id} className="hover:bg-slate-50 transition group">
                                      <td className="p-4 font-bold text-gray-400 text-xs">{new Date(log.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                                      <td className="p-4 font-black text-gray-800 text-sm">{log.productName}</td>
                                      <td className="p-4">
                                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                              log.type === 'in' ? 'bg-emerald-100 text-emerald-700' :
                                              log.type === 'sale' ? 'bg-blue-100 text-blue-700' :
                                              'bg-orange-100 text-orange-700'
                                          }`}>
                                              {log.type}
                                          </span>
                                      </td>
                                      <td className="p-4 text-center font-black text-gray-900">{log.type === 'in' ? '+' : '-'}{log.quantity}</td>
                                      <td className="p-4 text-gray-400 font-medium italic text-xs">{log.reason}</td>
                                  </tr>
                              ))}
                              {reportData.logs.length === 0 && (
                                  <tr><td colSpan={5} className="p-12 text-center text-gray-400 font-bold italic">No stock movements today.</td></tr>
                              )}
                          </tbody>
                      </table>
                    </div>
                </div>
            )}
       </div>

            {activeTab === 'history' && (
                <div className="animate-fade-in bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b bg-gray-50/50">
                        <h3 className="font-black text-gray-800 text-sm uppercase tracking-widest">{s2('history')}</h3>
                        <p className="text-xs text-gray-500 mt-1">{s2('tapToReceipt')}</p>
                    </div>
                    {historySales.length === 0 ? (
                        <p className="p-12 text-center text-gray-400 font-bold italic">{s2('noSalesDay')}</p>
                    ) : (
                        <ul className="divide-y divide-gray-50">
                            {historySales.map(({ sale, syncPending }) => (
                                <li key={sale.id}>
                                    <button
                                        type="button"
                                        data-testid={`history-sale-${sale.id}`}
                                        onClick={() => setReceiptSale({ sale, syncPending })}
                                        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 text-left transition"
                                    >
                                        <div className="min-w-0">
                                            <div className="text-sm font-bold text-gray-800 truncate">
                                                {sale.items.map((i) => (lang === 'bn' ? i.nameBn || i.name : i.name)).join(', ')}
                                            </div>
                                            <div className="text-xs text-gray-400 mt-0.5">
                                                {new Date(sale.date).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}
                                                {sale.customerName ? ` · ${sale.customerName}` : ''}
                                                {sale.servedBy ? ` · ${sale.servedBy}` : ''}
                                                {' · '}ID {sale.id.slice(0, 8)}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {sale.dueAmount > 0 && (
                                                <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full">
                                                    {s2('duesCreated')}: {tk2(sale.dueAmount)}
                                                </span>
                                            )}
                                            {syncPending && (
                                                <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded-full">{s2('syncPending')}</span>
                                            )}
                                            <span className="font-black text-gray-900">{tk2(sale.totalAmount)}</span>
                                            <span className="text-emerald-600 flex items-center gap-1 text-xs font-bold">
                                                <Eye size={14} /> {s2('viewReceipt')}
                                            </span>
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {activeTab === 'hisab' && (
                <div data-testid="hisab-summary" className="animate-fade-in space-y-6">
                    <div className="bg-white p-6 rounded-3xl border shadow-sm">
                        <div className="flex flex-wrap justify-between items-center gap-3">
                            <h3 className="font-black text-gray-800">{s2('hisab')}</h3>
                            <button
                                data-testid="hisab-print"
                                onClick={handlePrint}
                                className="no-print flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-xl hover:bg-black transition shadow-md font-bold text-sm"
                            >
                                <Printer size={18} /> {t.printReport}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">{s2('hisabNote')}</p>
                        {hisabLoading && <p className="mt-4 text-sm text-gray-500">…</p>}
                        {hisabError && (
                            <div className="mt-4 bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-800">
                                {hisabError}{' '}
                                <button onClick={loadHisab} className="font-bold underline ml-1">{s2('retry')}</button>
                            </div>
                        )}
                        {hisab && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                                {[
                                    { label: s2('salesToday'), value: `${hisab.salesCount} × ${tk2(hisab.salesTotal)}` },
                                    { label: s2('cashPaid'), value: tk2(hisab.cashPaid) },
                                    { label: s2('digitalPaid'), value: tk2(hisab.digitalPaid) },
                                    { label: s2('duesCreated'), value: tk2(hisab.duesCreated) },
                                    { label: s2('expensesToday'), value: `${hisab.expensesCount} × ${tk2(hisab.expensesTotal)}` },
                                    { label: s2('cashInHand'), value: tk2(hisab.cashInHand) },
                                    { label: s2('duesOutstanding'), value: tk2(hisab.duesOutstandingTotal) },
                                    { label: s2('duesCollected'), value: hisab.duesCollectedAvailable ? tk2(hisab.duesCollected ?? 0) : s2('notAvailable') },
                                ].map((card) => (
                                    <div key={card.label} className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">{card.label}</div>
                                        <div className="text-xl font-black text-gray-900 mt-1">{card.value}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {hisab && Object.keys(hisab.byMethod).length > 0 && (
                            <div className="mt-4">
                                <div className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">{s2('byMethod')}</div>
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(hisab.byMethod).map(([method, amount]) => (
                                        <span key={method} className="bg-emerald-50 text-emerald-800 px-3 py-1.5 rounded-full text-sm font-bold">
                                            {method}: {tk2(amount)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

       {receiptSale && (
           <ReceiptView
               sale={receiptSale.sale}
               lang={lang}
               syncPending={receiptSale.syncPending}
               onClose={() => setReceiptSale(null)}
           />
       )}

       {/* 4. PRINT VERSION FOOTER */}
       <div className="hidden print:block mt-20 pt-10 border-t-2 border-dashed border-gray-300 text-center">
            <div className="flex justify-center items-center gap-2 mb-4">
                <img src={APP_LOGO} className="w-8 h-8 grayscale" />
                <h2 className="text-xl font-black text-gray-800 uppercase tracking-widest">Business Report Summary</h2>
            </div>
            <div className="grid grid-cols-3 gap-8 text-sm font-black text-gray-900 border p-6 rounded-xl">
                <div>Total Income: <br/> ৳{reportData.totalSales.toLocaleString()}</div>
                <div>Total Expense: <br/> ৳{reportData.totalExpenses.toLocaleString()}</div>
                <div>Net Profit: <br/> ৳{reportData.netProfit.toLocaleString()}</div>
            </div>
            <p className="text-[10px] text-gray-400 mt-8 font-mono">Verified System Report • Generated at {new Date().toLocaleString()}</p>
       </div>

       <style>{`
          @media print {
            .no-print { display: none !important; }
            body { background: white !important; }
            .bg-slate-50 { background: white !important; }
            .shadow-sm, .shadow-xl { box-shadow: none !important; }
            .border { border: 1px solid #ccc !important; }
            .rounded-3xl { border-radius: 8px !important; }
            .text-emerald-600, .text-blue-600, .text-red-600 { color: black !important; }
            .bg-slate-900 { background: white !important; border: 2px solid black !important; color: black !important; }
            .bg-slate-900 p, .bg-slate-900 div { color: black !important; }
          }
       `}</style>
    </div>
  );
};

export default DailyReport;
