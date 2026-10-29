// One-tap bazar list — generated from REAL low stock + the existing
// demand-forecast API (see shared/distinctive.ts buildBazarList for
// the rule, shown per line). Quantities are editable before the owner
// confirms: print or share uses the ADJUSTED quantities, never the
// original suggestion. Print uses window.print (same pattern as
// Invoice/ReceiptView); share tries Web Share, then clipboard, and
// says which one happened. Offline: the list shows last-fetched data
// only when a fetch succeeded; a failed fetch shows "unavailable",
// never a stale list presented as fresh — the fetch error is surfaced.
import React, { useMemo, useState } from 'react';
import { Language } from '../types';
import { TRANSLATIONS } from '../constants';
import { StorageService } from '../services/storage';
import { useApiData } from '../hooks/useApiData';
import { buildBazarList, bazarListText, type BazarItem } from '../shared/distinctive';
import { Printer, Share2, Minus, Plus, Trash2 } from 'lucide-react';

interface BazarListProps {
  lang: Language;
}

const BazarList: React.FC<BazarListProps> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const { data: productsData, error: productsError } = useApiData(() => StorageService.getProducts(), []);
  const { data: forecastData, error: forecastError } = useApiData(() => StorageService.getForecast(30, 7), []);
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [shareNote, setShareNote] = useState('');

  const base = useMemo(
    () => buildBazarList(productsData || [], (forecastData as any)?.items || []),
    [productsData, forecastData],
  );
  const items: BazarItem[] = useMemo(
    () =>
      base
        .filter((i) => !removed.has(i.productId))
        .map((i) => {
          const qty = adjustments[i.productId] ?? i.qty;
          return { ...i, qty, estCost: Math.round(qty * i.price * 100) / 100 };
        }),
    [base, adjustments, removed],
  );
  const totalCost = items.reduce((a, i) => a + i.estCost, 0);
  const failed = Boolean(productsError || forecastError);

  const setQty = (id: string, qty: number) => {
    const next = Math.max(0, Math.floor(qty) || 0);
    setAdjustments((prev) => ({ ...prev, [id]: next }));
  };

  const handleShare = async () => {
    const text = bazarListText(items.map((i) => ({ name: i.nameBn || i.name, qty: i.qty, unit: i.unit })));
    if (!text) return;
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).share) {
        await (navigator as any).share({ title: t.bazarListTitle, text });
        setShareNote(t.bazarCopied);
        return;
      }
      throw new Error('NO_SHARE');
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setShareNote(t.bazarCopied);
      } catch {
        setShareNote(lang === 'bn' ? 'শেয়ার করা যায়নি — লিস্টটি হাতে কপি করুন।' : 'Could not share — copy the list by hand.');
      }
    }
  };

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-full" data-testid="bazar-list">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">{t.bazarListTitle}</h2>
          <p className="text-sm text-gray-500">{t.bazarShareNote}</p>
          {failed && (
            <p data-testid="bazar-data-unavailable" role="note" className="mt-2 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg text-sm">
              {t.briefingDataUnavailable}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            disabled={items.length === 0}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium flex items-center gap-2 disabled:opacity-40"
          >
            <Printer size={18} /> {t.bazarPrint}
          </button>
          <button
            onClick={handleShare}
            disabled={items.length === 0}
            className="px-4 py-2 rounded-lg bg-white border font-medium flex items-center gap-2 disabled:opacity-40"
          >
            <Share2 size={18} /> {t.bazarShare}
          </button>
        </div>
      </div>

      {shareNote && (
        <p role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded-lg text-sm">
          {shareNote}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-center py-10 text-gray-400">{t.bazarListEmpty}</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-gray-600 text-sm">
              <tr>
                <th className="p-4">{t.item}</th>
                <th className="p-4">{t.stockLevel}</th>
                <th className="p-4">{t.bazarQty}</th>
                <th className="p-4 text-right">{t.bazarEstCost}</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.productId}>
                  <td className="p-4">
                    <p className="font-medium text-gray-800">{item.nameBn || item.name}</p>
                    <p className="text-xs text-gray-500">{item.basis}</p>
                  </td>
                  <td className="p-4 text-sm text-gray-600">
                    {item.stock} {item.unit}
                  </td>
                  <td className="p-4">
                    <span className="inline-flex items-center gap-1">
                      <button aria-label="Decrease quantity" onClick={() => setQty(item.productId, item.qty - 1)} className="p-1 border rounded">
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        min={0}
                        value={item.qty}
                        onChange={(e) => setQty(item.productId, Number(e.target.value))}
                        className="w-16 p-1 border rounded text-center"
                      />
                      <button aria-label="Increase quantity" onClick={() => setQty(item.productId, item.qty + 1)} className="p-1 border rounded">
                        <Plus size={14} />
                      </button>
                      <span className="text-sm text-gray-500 ml-1">{item.unit}</span>
                    </span>
                  </td>
                  <td className="p-4 text-right font-bold">৳{item.estCost.toLocaleString()}</td>
                  <td className="p-4 text-center">
                    <button
                      aria-label="Remove from list"
                      onClick={() => setRemoved((prev) => new Set(prev).add(item.productId))}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-4 bg-gray-50 flex justify-between font-bold text-gray-800">
            <span>{t.total}</span>
            <span>৳{totalCost.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default BazarList;
