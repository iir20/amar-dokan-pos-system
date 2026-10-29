import React, { useMemo, useState, useEffect } from 'react';
import { Sale, Language, User } from '../types';
import { TRANSLATIONS } from '../constants';
import { Eye, Phone, Lock, Crown, ChevronDown, ChevronUp, Users, FileText } from 'lucide-react';
import { useApiData } from '../hooks/useApiData';
import { StorageService } from '../services/storage';
import { getOutbox } from '../services/amarSync';
import { formatTakaBn } from '../utils/currency';
import { computeCreditScore } from '../shared/distinctive';
import SubscriptionModal from './SubscriptionModal';

// Wave 2 (second addition) — due follow-up surfacing. New strings in
// this local dict (EN + BN); types.ts / constants.ts are owned by the
// merge coordinator. NOTE: one-tap collection RECORDING is deliberately
// NOT in this file: no server endpoint can settle a due (no PUT /sales,
// no /dues/collect), and routes.ts ownership here is hisab-only — so a
// Collect button would either lie or corrupt sales totals. Follow-up
// (who owes, since when, call link, receipt per invoice) ships fully;
// recording is listed as not-built in the worker report with the exact
// endpoint spec the merge needs.
const DUE2: Record<string, { en: string; bn: string }> = {
  oldestDue: { en: 'Oldest due', bn: 'সবচেয়ে পুরনো বাকি' },
  daysAgo: { en: 'days outstanding', bn: 'দিন ধরে বাকি' },
  call: { en: 'Call', bn: 'কল করুন' },
  pendingSyncNote: {
    en: 'sales still waiting to sync — dues from them will appear here once synced.',
    bn: 'টি বিক্রি এখনো সিঙ্ক হয়নি — সিঙ্ক হলে সেগুলোর বাকি এখানে দেখা যাবে।',
  },
  followUpHint: {
    en: 'Oldest first: collect the longest-outstanding baki first.',
    bn: 'সবচেয়ে পুরনো বাকি আগে আদায় করুন।',
  },
};

interface DueListProps {
  sales: Sale[];
  lang: Language;
  onViewInvoice: (sale: Sale) => void;
}

interface GroupedDue {
  customerName: string;
  customerPhone: string;
  totalDue: number;
  invoices: Sale[];
  oldestDate: string;
}

const DueList: React.FC<DueListProps> = ({ lang, onViewInvoice }) => {
  const t = TRANSLATIONS[lang];
  const [user, setUser] = useState<User | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    StorageService.getCurrentUser().then(setUser);
  }, [showUpsell]);

  // Realtime Sales Fetch
  const { data: allSalesData } = useApiData(() => StorageService.getSales(), []);
  const allSales = allSalesData || [];
  // Phase 3 — supplier dues shown where dues are shown (beside customer dues).
  const { data: supplierDuesData } = useApiData(
    () => StorageService.getSupplierDuesTotal().catch(() => ({ totalDue: 0 })),
    [],
  );
  const supplierDuesTotal = supplierDuesData?.totalDue || 0;

  // Group sales by customer name
  const groupedDues = useMemo(() => {
    const groups: Record<string, GroupedDue> = {};

    allSales
      .filter((sale) => sale.dueAmount > 0)
      .forEach((sale) => {
        const nameKey = sale.customerName?.trim() || 'Unknown Customer';

        if (!groups[nameKey]) {
          groups[nameKey] = {
            customerName: nameKey,
            customerPhone: sale.customerPhone || '',
            totalDue: 0,
            invoices: [],
            oldestDate: sale.date,
          };
        }

        groups[nameKey].invoices.push(sale);
        groups[nameKey].totalDue += sale.dueAmount;
        if (sale.date && sale.date < groups[nameKey].oldestDate) {
          groups[nameKey].oldestDate = sale.date;
        }

        // If the group doesn't have a phone but this invoice does, update it
        if (!groups[nameKey].customerPhone && sale.customerPhone) {
          groups[nameKey].customerPhone = sale.customerPhone;
        }
      });

    // Sort groups by highest due amount first
    return Object.values(groups).sort((a, b) => b.totalDue - a.totalDue);
  }, [allSales]);

  const totalDueAmount = groupedDues.reduce((acc, g) => acc + g.totalDue, 0);
  // Bangla digits for Bangla UI; English display kept byte-identical
  // to before (৳ + toLocaleString) so existing screens/tests don't move.
  const m = (n: number) => (lang === 'bn' ? formatTakaBn(n) : `৳${n.toLocaleString()}`);
  const d2 = (key: keyof typeof DUE2) => DUE2[key][lang];
  const pendingOutboxCount = getOutbox().filter((i) => i.status !== 'synced').length;
  const daysOutstanding = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 86400000) : 0;
  };

  const toggleGroup = (customerName: string) => {
    const newSet = new Set(expandedGroups);
    if (newSet.has(customerName)) {
      newSet.delete(customerName);
    } else {
      newSet.add(customerName);
    }
    setExpandedGroups(newSet);
  };

  // Premium Gate Check
  if (user?.plan === 'free') {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center text-center">
        {showUpsell && (
          <SubscriptionModal
            lang={lang}
            onClose={() => setShowUpsell(false)}
            onSuccess={() => StorageService.getCurrentUser().then(setUser)}
          />
        )}

        <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md border border-gray-100">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock size={32} />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">{t.premiumFeature}</h2>
          <p className="text-gray-500 mb-6">
            {lang === 'bn'
              ? 'বাকি খাতা বা Due List পরিচালনা করতে প্রিমিয়াম সাবস্ক্রিপশন প্রয়োজন।'
              : 'Manage your Due List and track customer debts efficiently with a Premium subscription.'}
          </p>
          <button
            onClick={() => setShowUpsell(true)}
            className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition flex items-center justify-center gap-2"
          >
            <Crown size={20} className="text-yellow-300" />
            {t.upgradeToPremium}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 h-full flex flex-col bg-slate-50">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Users className="text-emerald-600" />
            {t.dueList}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{groupedDues.length} customers with outstanding payments</p>
          <p className="text-xs text-gray-400 mt-1">{d2('followUpHint')}</p>
          {pendingOutboxCount > 0 && (
            <p data-testid="due-pending-sync-note" className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-2 w-fit">
              {pendingOutboxCount} {d2('pendingSyncNote')}
            </p>
          )}
        </div>
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-xl font-bold border border-red-100 shadow-sm flex flex-col items-end">
          <span className="text-xs text-red-400 uppercase tracking-wider">{t.totalDue}</span>
          <span className="text-xl">{m(totalDueAmount)}</span>
        </div>
        <div className="bg-amber-50 text-amber-800 px-4 py-2 rounded-xl font-bold border border-amber-100 shadow-sm flex flex-col items-end">
          <span className="text-xs text-amber-500 uppercase tracking-wider">{t.supplierDues}</span>
          <span className="text-xl">{m(supplierDuesTotal)}</span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 overflow-auto">
        <table className="w-full text-left border-collapse min-w-[700px] md:min-w-0">
          <thead className="bg-gray-50 text-gray-600 font-medium text-sm sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="p-4 w-10"></th>
              <th className="p-4">{t.customerName}</th>
              <th className="p-4">{t.customerPhone}</th>
              <th className="p-4 text-center">Invoices</th>
              <th className="p-4 text-right">{t.totalDue}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groupedDues.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-10 text-center text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <FileText size={32} className="opacity-20" />
                    <p>{t.noDueFound}</p>
                  </div>
                </td>
              </tr>
            ) : (
              groupedDues.map((group) => {
                const isExpanded = expandedGroups.has(group.customerName);
                return (
                  <React.Fragment key={group.customerName}>
                    {/* Parent Group Row */}
                    <tr
                      onClick={() => toggleGroup(group.customerName)}
                      className={`cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50' : 'hover:bg-gray-50'}`}
                    >
                      <td className="p-4 text-gray-400">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </td>
                      <td className="p-4 font-bold text-gray-800">
                        {group.customerName}
                        <div className="text-[11px] font-medium text-amber-700 mt-0.5">
                          {d2('oldestDue')}: {new Date(group.oldestDate).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB')}
                          {' · '}
                          {daysOutstanding(group.oldestDate)} {d2('daysAgo')}
                        </div>
                        {/* DISTINCTIVE FEATURES (2026-10-29) — credit-score
                            display only. Scored over ALL of this customer's
                            sales (not just the due bills in this group),
                            with its full basis shown — never a black box.
                            Limitation: records carry no due date, so
                            ageing stands in for lateness (see the note). */}
                        {(() => {
                          const score = computeCreditScore(
                            allSales.filter(
                              (s) => (s.customerName?.trim() || 'Unknown Customer') === group.customerName,
                            ),
                          );
                          if (!score) {
                            return (
                              <div data-testid="credit-score" className="text-[11px] font-medium text-gray-400 mt-0.5">
                                {t.creditScoreLabel}: {t.creditScoreNoHistory}
                              </div>
                            );
                          }
                          const bandLabel =
                            score.band === 'good'
                              ? t.creditScoreGood
                              : score.band === 'fair'
                                ? t.creditScoreFair
                                : t.creditScoreCaution;
                          const bandColor =
                            score.band === 'good'
                              ? 'text-emerald-700'
                              : score.band === 'fair'
                                ? 'text-amber-700'
                                : 'text-red-700';
                          return (
                            <div data-testid="credit-score" className="text-[11px] font-medium text-gray-600 mt-0.5">
                              <span className={bandColor}>
                                {t.creditScoreLabel}: {score.score} ({bandLabel})
                              </span>
                              {' — '}
                              {lang === 'bn'
                                ? `${score.basis.totalBills}টি বিল · পরিশোধ ${Math.round(score.basis.paidRatio * 100)}% · বাকি ৳${score.basis.totalDue.toLocaleString()} · সবচেয়ে পুরনো বাকি ${score.basis.oldestDueDays} দিন`
                                : `${score.basis.totalBills} bills · paid ${Math.round(score.basis.paidRatio * 100)}% · due ৳${score.basis.totalDue.toLocaleString()} · oldest due ${score.basis.oldestDueDays}d`}
                              <span className="block text-gray-400">{t.creditScoreAgeingNote}</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="p-4 text-gray-600">
                        {group.customerPhone ? (
                          <a href={`tel:${group.customerPhone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 hover:text-emerald-600">
                            <Phone size={14} className="text-gray-400" />
                            {group.customerPhone}
                            <span className="text-xs font-bold text-emerald-600 underline">{d2('call')}</span>
                          </a>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-bold">
                          {group.invoices.length}
                        </span>
                      </td>
                      <td className="p-4 text-right font-bold text-red-600 text-lg">
                        {m(group.totalDue)}
                      </td>
                    </tr>

                    {/* Child Rows (Individual Invoices) */}
                    {isExpanded &&
                      group.invoices.map((sale, idx) => (
                        <tr key={sale.id} className="bg-white hover:bg-slate-50 border-l-4 border-l-emerald-500">
                          <td className="p-0"></td>
                          <td colSpan={4} className="p-0">
                            <div className="flex items-center justify-between p-3 pl-4 border-t border-dashed border-gray-200">
                              <div className="flex items-center gap-4">
                                <div className="text-gray-500 text-xs w-24">
                                  {new Date(sale.date).toLocaleDateString()}
                                  <div className="text-[10px]">{new Date(sale.date).toLocaleTimeString()}</div>
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm text-gray-700 max-w-md truncate">
                                    {sale.items.map((i) => (lang === 'bn' ? i.nameBn : i.name)).join(', ')}
                                  </div>
                                  <div className="text-[10px] text-gray-400">ID: {sale.id.slice(-6)}</div>
                                </div>
                              </div>

                              <div className="flex items-center gap-6">
                                <div className="text-right">
                                  <div className="text-xs text-gray-400 uppercase">Total</div>
                                  <div className="text-sm font-medium">{m(sale.totalAmount)}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs text-gray-400 uppercase">Paid</div>
                                  <div className="text-sm font-medium text-emerald-600">{m(sale.paidAmount)}</div>
                                </div>
                                <div className="text-right w-20">
                                  <div className="text-xs text-red-300 uppercase font-bold">Due</div>
                                  <div className="text-sm font-bold text-red-600">{m(sale.dueAmount)}</div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onViewInvoice(sale);
                                  }}
                                  className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition"
                                  title="View Invoice"
                                >
                                  <Eye size={18} />
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DueList;
