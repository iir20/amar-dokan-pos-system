import React, { useEffect, useMemo, useState } from 'react';
import { Sale, Language, User, Branch } from '../types';
import { StorageService } from '../services/storage';
import { isNativePlatform } from '../services/native';
import { ensurePermission, permissionRationale, permissionSettingsGuidance } from '../services/permissions';
import { printViaBluetooth, downloadEscPosText } from '../services/nativePrint';
import { buildEscPosReceiptText } from './Invoice';
import { recomputeReceiptTotals, formatTakaForLang, formatQtyWithUnit } from '../utils/currency';
import { Printer, Share2, Copy, X, AlertTriangle, Bluetooth, FileDown } from 'lucide-react';

// Wave 2 (second addition) — individual sale receipt view.
// Opened from sales history (DailyReport history tab) and from any
// other surface that hands it a Sale. A sale that exists in history
// ALWAYS opens here: the component renders purely from the Sale
// object it is given, so even a not-yet-synced offline sale (passed
// from the AmarSync outbox) shows its full receipt, flagged as pending
// sync, instead of hitting a dead end. Stored server totals are
// authoritative; the integer-paisa recomputation is a cross-check and
// any mismatch is shown as a banner, never silently overwritten.
//
// New UI strings live in this local dict (EN + BN) by design —
// types.ts / constants.ts are owned by the merge coordinator.

interface ReceiptViewProps {
  sale: Sale;
  lang: Language;
  onClose: () => void;
  /** True when this sale still sits in the offline outbox. */
  syncPending?: boolean;
}

type Dict = Record<string, { en: string; bn: string }>;
const RV: Dict = {
  receiptTitle: { en: 'Receipt', bn: 'রশিদ' },
  invoiceNo: { en: 'Invoice', bn: 'ইনভয়েস' },
  dateTime: { en: 'Date & time', bn: 'তারিখ ও সময়' },
  staff: { en: 'Served by', bn: 'পরিবেশনকারী' },
  branch: { en: 'Branch', bn: 'শাখা' },
  customer: { en: 'Customer', bn: 'ক্রেতা' },
  phone: { en: 'Phone', bn: 'ফোন' },
  item: { en: 'Item', bn: 'পণ্য' },
  qty: { en: 'Qty', bn: 'পরিমাণ' },
  unitPrice: { en: 'Unit price', bn: 'একক দাম' },
  amount: { en: 'Amount', bn: 'মোট' },
  subTotal: { en: 'Subtotal', bn: 'উপমোট' },
  discount: { en: 'Discount', bn: 'ছাড়' },
  vat: { en: 'VAT', bn: 'ভ্যাট' },
  total: { en: 'Total', bn: 'সর্বমোট' },
  paid: { en: 'Paid', bn: 'পরিশোধিত' },
  paymentMethod: { en: 'Payment method', bn: 'পেমেন্ট মাধ্যম' },
  cashReceived: { en: 'Cash received', bn: 'নগদ প্রাপ্তি' },
  change: { en: 'Change', bn: 'ফেরত' },
  due: { en: 'Due (baki)', bn: 'বাকি' },
  thankYou: { en: 'Thank you for shopping with us!', bn: 'কেনাকাটার জন্য ধন্যবাদ!' },
  print: { en: 'Print', bn: 'প্রিন্ট' },
  reprintEscPos: { en: 'Reprint (ESC/POS .txt)', bn: 'আবার প্রিন্ট (ESC/POS .txt)' },
  bluetoothPrint: { en: 'Bluetooth print', bn: 'ব্লুটুথ প্রিন্ট' },
  share: { en: 'Share', bn: 'শেয়ার' },
  copy: { en: 'Copy text', bn: 'টেক্সট কপি' },
  copied: { en: 'Copied to clipboard.', bn: 'ক্লিপবোর্ডে কপি হয়েছে।' },
  shareFailed: {
    en: 'Sharing is not available here — use Copy text instead.',
    bn: 'এখানে শেয়ার করা যাচ্ছে না — টেক্সট কপি ব্যবহার করুন।',
  },
  close: { en: 'Close', bn: 'বন্ধ করুন' },
  mismatchTitle: {
    en: 'Receipt check: stored totals differ from the item lines',
    bn: 'রশিদ যাচাই: সংরক্ষিত মোট আইটেমের হিসাবের সঙ্গে মিলছে না',
  },
  mismatchNote: {
    en: 'The stored totals below are shown as recorded. Ask the owner to check this sale before reprinting for a customer.',
    bn: 'নিচে সংরক্ষিত মোট দেখানো হয়েছে। ক্রেতাকে আবার দেওয়ার আগে দোকান মালিককে এই বিক্রিটি যাচাই করতে বলুন।',
  },
  syncPendingNote: {
    en: 'Not synced yet — this receipt is from the offline record on this device. It will appear in the server history once synced.',
    bn: 'এখনো সিঙ্ক হয়নি — এই রশিদ এই ডিভাইসের অফলাইন রেকর্ড থেকে। সিঙ্ক হলে সার্ভার হিস্ট্রিতে দেখা যাবে।',
  },
  methodCash: { en: 'Cash', bn: 'নগদ' },
  methodBkash: { en: 'bKash', bn: 'বিকাশ' },
  methodNagad: { en: 'Nagad', bn: 'নগদ' },
  methodCard: { en: 'Card', bn: 'কার্ড' },
  btFailed: {
    en: 'Bluetooth print failed — use the ESC/POS .txt download instead.',
    bn: 'ব্লুটুথ প্রিন্ট ব্যর্থ — ESC/POS .txt ডাউনলোড ব্যবহার করুন।',
  },
  btPrinted: { en: 'Printed via Bluetooth.', bn: 'ব্লুটুথে প্রিন্ট হয়েছে।' },
  btRetryNote: {
    en: 'Tap Bluetooth again to retry, or use the ESC/POS .txt download instead.',
    bn: 'আবার Bluetooth ট্যাপ করে চেষ্টা করুন, অথবা ESC/POS .txt ডাউনলোড ব্যবহার করুন।',
  },
};

const METHOD_LABEL: Record<string, keyof typeof RV> = {
  cash: 'methodCash',
  bkash: 'methodBkash',
  nagad: 'methodNagad',
  card: 'methodCard',
};

const ReceiptView: React.FC<ReceiptViewProps> = ({ sale, lang, onClose, syncPending }) => {
  const t = (key: keyof typeof RV) => RV[key][lang];
  const [user, setUser] = useState<User | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    StorageService.getCurrentUser()
      .then(setUser)
      .catch(() => {});
    StorageService.getBranches()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  const storeName = user?.storeName || sale.storeName || 'AMAR DOKAN';
  const address = user?.address || '';
  const phone = user?.phone || '';
  const branchName = branches.find((b) => b.id === sale.branchId)?.name;

  // Integer-paisa cross-check of the stored sale. Stored values win.
  const recomputed = useMemo(() => recomputeReceiptTotals(sale), [sale]);
  const changeAmount = sale.changeAmount ?? Math.max(0, (sale.cashReceived ?? 0) - sale.totalAmount);
  const tk = (n: number) => formatTakaForLang(n, lang);
  const dateStr = new Date(sale.date).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const shareText = useMemo(() => {
    const lines: string[] = [storeName, `${t('invoiceNo')}: ${sale.id.slice(0, 8)}`, `${t('dateTime')}: ${dateStr}`];
    if (sale.customerName) lines.push(`${t('customer')}: ${sale.customerName}`);
    if (sale.servedBy) lines.push(`${t('staff')}: ${sale.servedBy}`);
    lines.push('---');
    for (const item of sale.items) {
      const name = lang === 'bn' ? item.nameBn || item.name : item.name;
      lines.push(
        `${name} — ${formatQtyWithUnit(item.quantity, item.unit, lang)} × ${tk(item.price)} = ${tk(item.price * item.quantity)}`,
      );
    }
    lines.push('---');
    lines.push(`${t('subTotal')}: ${tk(sale.subTotal ?? sale.totalAmount + sale.discount)}`);
    if (sale.discount > 0) lines.push(`${t('discount')}: -${tk(sale.discount)}`);
    if (sale.vat > 0) lines.push(`${t('vat')}: +${tk(sale.vat)}`);
    lines.push(`${t('total')}: ${tk(sale.totalAmount)}`);
    lines.push(`${t('paid')} (${t(METHOD_LABEL[sale.paymentMethod] ?? 'methodCash')}): ${tk(sale.paidAmount)}`);
    if (sale.cashReceived != null && sale.cashReceived > 0)
      lines.push(`${t('cashReceived')}: ${tk(sale.cashReceived)}`);
    if (changeAmount > 0) lines.push(`${t('change')}: ${tk(changeAmount)}`);
    if (sale.dueAmount > 0) lines.push(`${t('due')}: ${tk(sale.dueAmount)}`);
    lines.push(t('thankYou'));
    return lines.join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale, storeName, lang]);

  const handlePrint = () => window.print();

  const handleEscPos = () => {
    downloadEscPosText(
      buildEscPosReceiptText(sale, { storeName, address, phone }, '80mm'),
      `receipt_${sale.id.slice(0, 8)}_80mm.txt`,
    );
    setStatus(t('copied'));
  };

  const handleBluetooth = async () => {
    setStatus('');
    // Point-of-use Bluetooth permission first: a denial shows the
    // Settings path and keeps the ESC/POS download fallback.
    if (isNativePlatform()) {
      const perm = await ensurePermission('bluetooth');
      if (perm.outcome === 'denied-retryable') {
        setStatus(`${permissionRationale('bluetooth', lang)} — ${t('btRetryNote')}`);
        return;
      }
      if (perm.outcome === 'permanently-denied') {
        setStatus(permissionSettingsGuidance('bluetooth', lang) ?? t('btFailed'));
        return;
      }
    }
    try {
      const result = await printViaBluetooth(buildEscPosReceiptText(sale, { storeName, address, phone }, '80mm'));
      setStatus(result.deviceName ? `${t('btPrinted')} (${result.deviceName})` : t('btPrinted'));
    } catch {
      setStatus(t('btFailed'));
    }
  };

  const handleShare = async () => {
    const nav = navigator as Navigator & { share?: (data: { title: string; text: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: `${storeName} — ${t('receiptTitle')}`, text: shareText });
        return;
      } catch {
        // User cancelled or share unavailable: fall through to copy.
      }
    }
    await handleCopy();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setStatus(t('copied'));
    } catch {
      setStatus(t('shareFailed'));
    }
  };

  return (
    <div data-testid="receipt-view" className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[420px] h-[85vh] flex flex-col shadow-2xl rounded-lg overflow-hidden">
        <div className="bg-gray-100 p-3 border-b flex flex-wrap justify-between items-center gap-2 no-print">
          <h2 className="font-bold text-gray-800 text-sm">
            {lang === 'bn' ? 'রশিদ' : 'Receipt'} · {sale.id.slice(0, 8)}
          </h2>
          <div className="flex gap-1.5">
            <button
              data-testid="receipt-print"
              onClick={handlePrint}
              className="flex items-center gap-1 bg-emerald-600 text-white px-2.5 py-1.5 rounded-md hover:bg-emerald-700 text-xs font-semibold"
            >
              <Printer size={14} /> <span>{t('print')}</span>
            </button>
            <button
              data-testid="receipt-escpos"
              onClick={handleEscPos}
              title={t('reprintEscPos')}
              className="flex items-center gap-1 bg-slate-700 text-white px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-xs font-semibold"
            >
              <FileDown size={14} /> <span>ESC/POS</span>
            </button>
            {isNativePlatform() && (
              <button
                data-testid="receipt-bluetooth"
                onClick={handleBluetooth}
                title={t('bluetoothPrint')}
                className="flex items-center gap-1 bg-indigo-600 text-white px-2.5 py-1.5 rounded-md hover:bg-indigo-700 text-xs font-semibold"
              >
                <Bluetooth size={14} /> <span>{t('bluetoothPrint')}</span>
              </button>
            )}
            <button
              data-testid="receipt-share"
              onClick={handleShare}
              className="flex items-center gap-1 bg-blue-600 text-white px-2.5 py-1.5 rounded-md hover:bg-blue-700 text-xs font-semibold"
            >
              <Share2 size={14} /> <span>{t('share')}</span>
            </button>
            <button
              data-testid="receipt-copy"
              onClick={handleCopy}
              title={t('copy')}
              className="flex items-center gap-1 bg-gray-200 text-gray-700 px-2 py-1.5 rounded-md hover:bg-gray-300 text-xs font-semibold"
            >
              <Copy size={14} />
            </button>
            <button
              data-testid="receipt-close"
              onClick={onClose}
              aria-label={t('close')}
              className="text-gray-600 hover:text-red-500 font-medium text-sm px-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {status && (
          <div
            data-testid="receipt-status"
            role="status"
            className="no-print bg-blue-50 border-b border-blue-100 px-3 py-2 text-xs text-blue-900"
          >
            {status}
          </div>
        )}
        {syncPending && (
          <div
            data-testid="receipt-sync-pending"
            className="no-print bg-amber-50 border-b border-amber-100 px-3 py-2 text-xs text-amber-900"
          >
            {t('syncPendingNote')}
          </div>
        )}
        {recomputed.mismatches.length > 0 && (
          <div
            data-testid="receipt-mismatch"
            className="no-print bg-red-50 border-b border-red-100 px-3 py-2 text-xs text-red-900"
          >
            <div className="font-bold flex items-center gap-1">
              <AlertTriangle size={14} /> {t('mismatchTitle')}
            </div>
            <div className="mt-1">{t('mismatchNote')}</div>
            <ul className="mt-1 list-disc pl-4">
              {recomputed.mismatches.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <div id="receipt-printable-area" className="flex-1 overflow-y-auto p-4 md:p-6 bg-white text-sm">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold uppercase tracking-wide text-gray-800 break-words leading-tight">
              {storeName}
            </h1>
            {address && <p className="text-gray-500 text-xs mt-1">{address}</p>}
            {phone && <p className="text-gray-500 text-xs">Tel: {phone}</p>}
          </div>

          <div className="border-b-2 border-dashed border-gray-300 mb-4 pb-2 text-xs text-gray-500 space-y-1">
            <div className="flex justify-between">
              <span>
                {t('invoiceNo')}: {sale.id.slice(0, 8)}
              </span>
              <span>{dateStr}</span>
            </div>
            {sale.customerName && (
              <div>
                {t('customer')}: <span className="font-bold text-gray-700">{sale.customerName}</span>
              </div>
            )}
            {sale.customerPhone && (
              <div>
                {t('phone')}: {sale.customerPhone}
              </div>
            )}
            {sale.servedBy && (
              <div>
                {t('staff')}: <span className="font-medium text-gray-700">{sale.servedBy}</span>
              </div>
            )}
            {branchName && (
              <div>
                {t('branch')}: {branchName}
              </div>
            )}
          </div>

          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b text-gray-600">
                <th className="text-left py-1 font-medium">{t('item')}</th>
                <th className="text-center py-1 font-medium">{t('qty')}</th>
                <th className="text-right py-1 font-medium">{t('amount')}</th>
              </tr>
            </thead>
            <tbody className="text-gray-800">
              {sale.items.map((item, idx) => (
                <tr key={idx} className="border-b border-gray-100">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{lang === 'bn' ? item.nameBn || item.name : item.name}</div>
                    <div className="text-[10px] text-gray-500">
                      {t('unitPrice')}: {tk(item.price)}
                    </div>
                  </td>
                  <td className="text-center py-2 align-top text-xs">
                    {formatQtyWithUnit(item.quantity, item.unit, lang)}
                  </td>
                  <td className="text-right py-2 align-top">{tk(item.price * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t-2 border-dashed border-gray-300 pt-3 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{t('subTotal')}</span>
              <span>{tk(sale.subTotal ?? sale.totalAmount + sale.discount)}</span>
            </div>
            {sale.discount > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>{t('discount')}</span>
                <span>- {tk(sale.discount)}</span>
              </div>
            )}
            {sale.vat > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>{t('vat')}</span>
                <span>+ {tk(sale.vat)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-gray-900 border-t border-gray-100 pt-2">
              <span>{t('total')}</span>
              <span>{tk(sale.totalAmount)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600 pt-2">
              <span>
                {t('paid')} ({t(METHOD_LABEL[sale.paymentMethod] ?? 'methodCash')})
              </span>
              <span>{tk(sale.paidAmount)}</span>
            </div>
            {sale.cashReceived != null && sale.cashReceived > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>{t('cashReceived')}</span>
                <span>{tk(sale.cashReceived)}</span>
              </div>
            )}
            {changeAmount > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>{t('change')}</span>
                <span>{tk(changeAmount)}</span>
              </div>
            )}
            {sale.dueAmount > 0 && (
              <div className="flex justify-between text-sm text-red-600 font-bold">
                <span>{t('due')}</span>
                <span>{tk(sale.dueAmount)}</span>
              </div>
            )}
          </div>

          <div className="mt-8 text-center">
            <p className="font-medium text-gray-800">{t('thankYou')}</p>
            <p className="text-[10px] text-gray-400 mt-1">{sale.id}</p>
          </div>
        </div>

        <style>{`
          @media print {
            body * { visibility: hidden; }
            #receipt-printable-area, #receipt-printable-area * { visibility: visible; }
            #receipt-printable-area { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 10px; }
            .no-print { display: none; }
          }
        `}</style>
      </div>
    </div>
  );
};

export default ReceiptView;
export { RV as RECEIPT_VIEW_STRINGS };
