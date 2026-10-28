import React, { useState, useEffect } from 'react';
import { Sale, Language, User } from '../types';
import { TRANSLATIONS, APP_LOGO } from '../constants';
import { Printer, Download, Loader2 } from 'lucide-react';
import { StorageService } from '../services/storage';
// Phase 2 — Bluetooth thermal printing (native app only) + .txt fallback.
import { isNativePlatform } from '../services/native';
import { printViaBluetooth, downloadEscPosText } from '../services/nativePrint';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface InvoiceProps {
  sale: Sale;
  lang: Language;
  onClose: () => void;
}

const Invoice: React.FC<InvoiceProps> = ({ sale, lang, onClose }) => {
  const t = TRANSLATIONS[lang];
  const [user, setUser] = useState<User | null>(null);
  const [displayLogo, setDisplayLogo] = useState(APP_LOGO);

  useEffect(() => {
    StorageService.getGlobalConfig().then((cfg) => {
      if (cfg?.logo) setDisplayLogo(cfg.logo);
    });
  }, []);

  useEffect(() => {
    const fetchUser = async () => {
      const u = await StorageService.getCurrentUser();
      setUser(u);
    };
    fetchUser();
  }, []);

  const storeName = user?.storeName || 'AMAR DOKAN';
  const address = user?.address || 'Dhaka, Bangladesh';
  const phone = user?.phone || '';
  const [isDownloading, setIsDownloading] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    const element = document.getElementById('printable-area');
    if (!element) {
      setIsDownloading(false);
      return;
    }

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
      });

      const imgData = canvas.toDataURL('image/png');

      const pdfWidth = 80;
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [pdfWidth, pdfHeight],
      });

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Receipt_${sale.id}.pdf`);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download receipt');
    } finally {
      setIsDownloading(false);
    }
  };

  const changeAmount = sale.changeAmount ?? Math.max(0, sale.paidAmount - sale.totalAmount);

  const [format, setFormat] = useState<'80mm' | '58mm'>('80mm');

  const generateEscPosText = () => {
    const width = format === '58mm' ? 32 : 42;
    const divider = '-'.repeat(width);

    const pad = (str: string, len: number, align: 'left' | 'right' | 'center' = 'left') => {
      const s = (str || '').slice(0, len);
      if (align === 'center') {
        const left = Math.floor((len - s.length) / 2);
        return ' '.repeat(Math.max(0, left)) + s + ' '.repeat(Math.max(0, len - s.length - left));
      }
      if (align === 'right') {
        return ' '.repeat(Math.max(0, len - s.length)) + s;
      }
      return s + ' '.repeat(Math.max(0, len - s.length));
    };

    const row = (left: string, right: string) => {
      const rightLen = right.length;
      const leftLen = width - rightLen - 1;
      return pad(left, leftLen) + ' ' + right;
    };

    const lines: string[] = [];
    lines.push(pad(storeName, width, 'center'));
    if (address) lines.push(pad(address, width, 'center'));
    if (phone) lines.push(pad(`Tel: ${phone}`, width, 'center'));
    lines.push(divider);
    lines.push(row(`Inv: ${sale.id.slice(0, 8)}`, new Date(sale.date).toLocaleDateString()));
    if (sale.customerName) lines.push(row('Customer:', sale.customerName));
    if (sale.customerPhone) lines.push(row('Phone:', sale.customerPhone));
    lines.push(divider);

    // Items header
    if (format === '58mm') {
      lines.push(row('Item', 'Qty x Price'));
    } else {
      lines.push(pad('Item', 20) + pad('Qty', 6, 'center') + pad('Price', 8, 'right') + pad('Total', 8, 'right'));
    }
    lines.push(divider);

    for (const item of sale.items) {
      const name = item.name;
      const total = (item.price * item.quantity).toFixed(2);
      if (format === '58mm') {
        lines.push(name.slice(0, width));
        lines.push(row(`  ${item.quantity} ${item.unit || 'pcs'} @${item.price}`, `৳${total}`));
      } else {
        lines.push(
          pad(name, 20) +
            pad(`${item.quantity}`, 6, 'center') +
            pad(`${item.price.toFixed(2)}`, 8, 'right') +
            pad(`৳${total}`, 8, 'right'),
        );
      }
    }

    lines.push(divider);
    lines.push(row('Subtotal:', `৳${(sale.subTotal || sale.totalAmount).toFixed(2)}`));
    if (sale.discount > 0) lines.push(row('Discount:', `-৳${sale.discount.toFixed(2)}`));
    if (sale.vat > 0) lines.push(row('VAT:', `+৳${sale.vat.toFixed(2)}`));
    lines.push(divider);
    lines.push(row('TOTAL:', `৳${sale.totalAmount.toFixed(2)}`));
    lines.push(row(`Paid (${sale.paymentMethod}):`, `৳${sale.paidAmount.toFixed(2)}`));
    if (sale.cashReceived != null && sale.cashReceived > 0) {
      lines.push(row('Cash Received:', `৳${sale.cashReceived.toFixed(2)}`));
    }
    if (sale.dueAmount > 0) {
      lines.push(row('Due (Rest):', `৳${sale.dueAmount.toFixed(2)}`));
    }
    if (changeAmount > 0) {
      lines.push(row('Change:', `৳${changeAmount.toFixed(2)}`));
    }
    lines.push(divider);
    lines.push(pad('Thank you for shopping with us!', width, 'center'));
    lines.push(pad(sale.id, width, 'center'));
    lines.push('\n\n\x1D\x56\x00'); // ESC/POS paper cut command

    return lines.join('\n');
  };

  // The .txt download fallback is unchanged from before Phase 2 — it must
  // keep working on the web, where no Bluetooth printer path exists.
  const handleDownloadEscPos = () => {
    downloadEscPosText(generateEscPosText(), `escpos_${sale.id.slice(0, 8)}_${format}.txt`);
  };

  const [btStatus, setBtStatus] = useState('');
  const handleBluetoothPrint = async () => {
    setBtStatus('Connecting to printer…');
    try {
      const result = await printViaBluetooth(generateEscPosText());
      setBtStatus(result.deviceName ? `Printed via Bluetooth (${result.deviceName})` : 'Printed via Bluetooth');
    } catch (e: any) {
      // Never pretend success: show the failure and point at the fallback.
      setBtStatus(`Bluetooth print failed: ${e?.message || 'unknown error'} — use the ESC/POS .txt download instead.`);
    }
  };

  return (
    <div data-testid="invoice" className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        className={`bg-white w-full ${format === '58mm' ? 'max-w-[320px]' : 'max-w-[400px]'} h-[85vh] flex flex-col shadow-2xl rounded-lg overflow-hidden transition-all`}
      >
        {/* Actions Header */}
        <div className="bg-gray-100 p-3 border-b flex flex-wrap justify-between items-center gap-2 no-print">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-gray-600 hover:text-red-500 font-medium text-sm">
              {t.close}
            </button>
            <div className="inline-flex rounded-md shadow-xs bg-gray-200 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setFormat('80mm')}
                className={`px-2 py-1 rounded font-semibold transition ${format === '80mm' ? 'bg-white text-emerald-700 shadow-xs' : 'text-gray-600'}`}
              >
                80mm
              </button>
              <button
                type="button"
                onClick={() => setFormat('58mm')}
                className={`px-2 py-1 rounded font-semibold transition ${format === '58mm' ? 'bg-white text-emerald-700 shadow-xs' : 'text-gray-600'}`}
              >
                58mm
              </button>
            </div>
          </div>
          <div className="flex gap-1.5">
            {isNativePlatform() && (
              <button
                data-testid="invoice-bluetooth-print"
                onClick={handleBluetoothPrint}
                title="Print this receipt on a Bluetooth thermal printer (Android app only)"
                className="flex items-center gap-1 bg-indigo-600 text-white px-2 py-1.5 rounded-md hover:bg-indigo-700 transition text-xs font-semibold"
              >
                <span>Bluetooth Print</span>
              </button>
            )}
            <button
              data-testid="invoice-escpos-download"
              onClick={handleDownloadEscPos}
              title="Download ESC/POS raw text receipt for thermal receipt printers"
              className="flex items-center gap-1 bg-slate-700 text-white px-2 py-1.5 rounded-md hover:bg-slate-800 transition text-xs font-semibold"
            >
              <span>ESC/POS</span>
            </button>
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex items-center gap-1.5 bg-blue-600 text-white px-2.5 py-1.5 rounded-md hover:bg-blue-700 transition disabled:opacity-50 text-xs font-semibold"
            >
              {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span className="hidden sm:inline">PDF</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 bg-emerald-600 text-white px-2.5 py-1.5 rounded-md hover:bg-emerald-700 transition text-xs font-semibold"
            >
              <Printer size={14} />
              <span className="hidden sm:inline">{t.print}</span>
            </button>
          </div>
        </div>

        {btStatus && (
          <div
            data-testid="invoice-bluetooth-status"
            role="status"
            className="no-print bg-indigo-50 border-b border-indigo-100 px-3 py-2 text-xs text-indigo-900"
          >
            {btStatus}
          </div>
        )}

        {/* Phase 5 — receipt preview label: this modal IS the preview
            shown before any print action (Print / Bluetooth / PDF). */}
        <div
          data-testid="invoice-preview-note"
          className="no-print bg-emerald-50 border-b border-emerald-100 px-3 py-2 text-xs text-emerald-900"
        >
          {lang === 'bn'
            ? 'রশিদ প্রিভিউ — এটাই প্রিন্ট হবে। যাচাই করে প্রিন্ট করুন।'
            : 'Receipt preview — this is exactly what will print. Check, then print.'}
        </div>

        {/* Printable Area */}
        <div
          className={`flex-1 overflow-y-auto p-4 md:p-6 bg-white print:p-0 print:overflow-visible ${format === '58mm' ? 'text-xs' : 'text-sm'}`}
          id="printable-area"
        >
          <div className="text-center mb-6">
            <img src={displayLogo} alt="Logo" className="w-12 h-12 mx-auto mb-2 opacity-80 grayscale object-contain" />
            <h1 className="text-2xl font-bold uppercase tracking-wide text-gray-800 break-words leading-tight">
              {storeName}
            </h1>
            <p className="text-gray-500 text-xs mt-1">{address}</p>
            {phone && <p className="text-gray-500 text-xs">Tel: {phone}</p>}
          </div>

          <div className="border-b-2 border-dashed border-gray-300 mb-4 pb-2 text-xs text-gray-500">
            <div className="flex justify-between mb-1">
              <span>Inv: {sale.id.slice(0, 8)}</span>
              <span>
                {new Date(sale.date).toLocaleDateString()} {new Date(sale.date).toLocaleTimeString()}
              </span>
            </div>
            {(sale.customerName || sale.customerPhone) && (
              <div className="mt-2 pt-2 border-t border-dashed border-gray-200">
                {sale.customerName && <div className="font-bold text-gray-700">{sale.customerName}</div>}
                {sale.customerPhone && <div>{sale.customerPhone}</div>}
              </div>
            )}
          </div>

          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b text-gray-600">
                <th className="text-left py-1 font-medium">{t.item}</th>
                <th className="text-center py-1 font-medium">{t.qty}</th>
                <th className="text-right py-1 font-medium">{t.price}</th>
              </tr>
            </thead>
            <tbody className="text-gray-800">
              {sale.items.map((item, idx) => (
                <tr key={idx} className="border-b border-gray-100">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{lang === 'bn' ? item.nameBn : item.name}</div>
                    {/* Dynamic Variant Details */}
                    <div className="text-[10px] text-gray-500 flex flex-wrap gap-1">
                      {item.size && <span>Size: {item.size}</span>}
                      {item.color && <span>/ {item.color}</span>}
                      {item.warranty && <span>/ War: {item.warranty}</span>}
                      {item.serialNumber && <span>/ SN: {item.serialNumber}</span>}
                    </div>
                  </td>
                  <td className="text-center py-2 align-top text-xs">
                    {item.quantity} {item.unit || 'pcs'}
                  </td>
                  <td className="text-right py-2 align-top">৳{(item.price * item.quantity).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t-2 border-dashed border-gray-300 pt-3 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{t.subTotal}</span>
              <span>৳{sale.subTotal?.toFixed(2) || (sale.totalAmount + sale.discount).toFixed(2)}</span>
            </div>

            {sale.discount > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>{t.discount}</span>
                <span>- ৳{sale.discount.toFixed(2)}</span>
              </div>
            )}

            {sale.vat > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>{t.vat}</span>
                <span>+ ৳{sale.vat.toFixed(2)}</span>
              </div>
            )}

            <div className="flex justify-between text-lg font-bold text-gray-900 border-t border-gray-100 pt-2">
              <span>{t.total}</span>
              <span>৳{sale.totalAmount.toFixed(2)}</span>
            </div>

            <div className="flex justify-between text-sm text-gray-600 pt-2">
              <span>
                {t.paidAmount} ({sale.paymentMethod || 'cash'})
              </span>
              <span>৳{sale.paidAmount.toFixed(2)}</span>
            </div>

            {sale.cashReceived != null && sale.cashReceived > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>Cash received</span>
                <span>৳{sale.cashReceived.toFixed(2)}</span>
              </div>
            )}

            {sale.dueAmount > 0 && (
              <div className="flex justify-between text-sm text-red-600 font-bold">
                <span>{t.dueAmount} (REST)</span>
                <span>৳{sale.dueAmount.toFixed(2)}</span>
              </div>
            )}

            {changeAmount > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>{t.changeAmount}</span>
                <span>৳{changeAmount.toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className="mt-8 text-center">
            <p className="font-medium text-gray-800">{t.thankYou}</p>
            <p className="text-[10px] text-gray-400 mt-1">{sale.id}</p>
          </div>
        </div>

        <style>{`
          @media print {
            body * {
              visibility: hidden;
            }
            #printable-area, #printable-area * {
              visibility: visible;
            }
            #printable-area {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
              margin: 0;
              padding: 10px;
            }
            .no-print {
              display: none;
            }
          }
        `}</style>
      </div>
    </div>
  );
};

export default Invoice;
