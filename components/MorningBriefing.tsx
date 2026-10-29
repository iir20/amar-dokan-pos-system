// Morning shop briefing — one section the owner opens at shop-open
// time. Every number comes from a real API already in the app
// (sales, expenses, forecast, expiry, dues); nothing is invented, and
// a failed source shows "unavailable" instead of a guessed number.
// Each row is one tap to its action screen via onNavigate.
import React, { useMemo } from 'react';
import { Language } from '../types';
import { TRANSLATIONS } from '../constants';
import { StorageService } from '../services/storage';
import { useApiData } from '../hooks/useApiData';
import { computeYesterdaySummary } from '../shared/distinctive';
import { Sunrise, ShoppingCart, AlertTriangle, Users, Package, TrendingUp } from 'lucide-react';

interface MorningBriefingProps {
  lang: Language;
  onNavigate: (view: string) => void;
}

const MorningBriefing: React.FC<MorningBriefingProps> = ({ lang, onNavigate }) => {
  const t = TRANSLATIONS[lang];
  const { data: salesData, error: salesError } = useApiData(() => StorageService.getSales(), []);
  const { data: expensesData, error: expensesError } = useApiData(() => StorageService.getExpenses(), []);
  const { data: productsData } = useApiData(() => StorageService.getProducts(), []);
  const { data: forecastData } = useApiData(() => StorageService.getForecast(30, 7), []);
  const { data: expiryData } = useApiData(() => StorageService.getExpiryAlerts(), []);

  const sales = salesData || [];
  const expenses = expensesData || [];
  const products = productsData || [];
  const forecastItems: Array<{ suggestedQty: number }> = (forecastData as any)?.items || [];
  const expiryAlerts: Array<{ severity: string }> = (expiryData as any)?.alerts || [];

  const yesterday = useMemo(
    () => computeYesterdaySummary(sales, expenses, new Date()),
    [sales, expenses],
  );
  const lowStock = useMemo(() => products.filter((p) => p.stock < 10).length, [products]);
  const orderItems = useMemo(
    () => forecastItems.filter((i) => (i.suggestedQty || 0) > 0).length,
    [forecastItems],
  );
  const orderQty = useMemo(
    () => forecastItems.reduce((a, i) => a + Math.max(0, i.suggestedQty || 0), 0),
    [forecastItems],
  );
  const expiringCritical = useMemo(
    () => expiryAlerts.filter((a) => a.severity === 'critical' || a.severity === 'expired').length,
    [expiryAlerts],
  );
  const dues = useMemo(() => {
    const dueSales = sales.filter((s) => (s.dueAmount || 0) > 0);
    const total = dueSales.reduce((a, s) => a + (s.dueAmount || 0), 0);
    const oldest = dueSales.length
      ? dueSales.reduce((a, s) => (s.date < a.date ? s : a), dueSales[0])
      : null;
    return { total, count: dueSales.length, oldestName: oldest?.customerName || '' };
  }, [sales]);

  const dataFailed = Boolean(salesError || expensesError);

  const rows: Array<{
    id: string;
    icon: React.ReactNode;
    label: string;
    value: string;
    detail: string;
    target: string;
  }> = [
    {
      id: 'yesterday-profit',
      icon: <TrendingUp size={18} />,
      label: t.briefingYesterdayProfit,
      value: `৳${yesterday.netProfit.toLocaleString()}`,
      detail:
        lang === 'bn'
          ? `বিক্রি ৳${yesterday.salesTotal.toLocaleString()} · মোট লাভ ৳${yesterday.grossProfit.toLocaleString()} · খরচ ৳${yesterday.expenses.toLocaleString()} · ${yesterday.saleCount}টি বিক্রি`
          : `Sales ৳${yesterday.salesTotal.toLocaleString()} · gross ৳${yesterday.grossProfit.toLocaleString()} · expenses ৳${yesterday.expenses.toLocaleString()} · ${yesterday.saleCount} sales`,
      target: 'reports',
    },
    {
      id: 'order-today',
      icon: <ShoppingCart size={18} />,
      label: t.briefingOrderToday,
      value: `${orderQty.toLocaleString()}`,
      detail:
        orderItems > 0
          ? `${orderItems} ${lang === 'bn' ? 'টি পণ্য' : 'products'}`
          : lang === 'bn'
            ? 'পূর্বাভাস অনুযায়ী আজ অর্ডারের প্রয়োজন নেই'
            : 'No forecast need today',
      target: 'phase3',
    },
    {
      id: 'expiring-soon',
      icon: <AlertTriangle size={18} />,
      label: t.briefingExpiringSoon,
      value: `${expiryAlerts.length}`,
      detail:
        lang === 'bn'
          ? `${expiringCritical}টি জরুরি/মেয়াদোত্তীর্ণ`
          : `${expiringCritical} critical/expired`,
      target: 'phase3',
    },
    {
      id: 'dues-to-collect',
      icon: <Users size={18} />,
      label: t.briefingDuesToCollect,
      value: `৳${dues.total.toLocaleString()}`,
      detail:
        dues.count > 0
          ? `${dues.count} ${lang === 'bn' ? 'টি বিল' : 'bills'}${dues.oldestName ? ` · ${lang === 'bn' ? 'সবচেয়ে পুরনো' : 'oldest'}: ${dues.oldestName}` : ''}`
          : lang === 'bn'
            ? 'কোনো বাকি নেই'
            : 'No outstanding dues',
      target: 'dueList',
    },
    {
      id: 'low-stock',
      icon: <Package size={18} />,
      label: t.briefingLowStock,
      value: `${lowStock}`,
      detail: lang === 'bn' ? '১০টির কম স্টক' : 'Below 10 units in stock',
      target: 'inventory',
    },
  ];

  return (
    <section aria-label={t.briefingTitle} data-testid="morning-briefing" className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="p-2 bg-amber-100 text-amber-700 rounded-full">
          <Sunrise size={20} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-800">{t.briefingTitle}</h3>
          <p className="text-xs text-gray-500">{t.briefingSubtitle}</p>
        </div>
      </div>
      {dataFailed && (
        <p data-testid="briefing-data-unavailable" role="note" className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg text-sm">
          {t.briefingDataUnavailable}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
        {rows.map((row) => (
          <button
            key={row.id}
            data-testid={`briefing-${row.id}`}
            onClick={() => onNavigate(row.target)}
            className="text-left p-3 rounded-lg border border-gray-100 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-200 transition active:scale-[0.98]"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {row.icon}
              {row.label}
            </span>
            <span className="block text-xl font-bold text-gray-800 mt-1">{row.value}</span>
            <span className="block text-xs text-gray-500 mt-1">{row.detail}</span>
            <span className="block text-xs font-bold text-emerald-600 mt-2">
              {lang === 'bn' ? 'ট্যাপ করুন →' : 'Tap to act →'}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-3">{t.briefingNoDueDateNote}</p>
    </section>
  );
};

export default MorningBriefing;
