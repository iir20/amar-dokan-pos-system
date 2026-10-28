import React, { useState, useEffect } from 'react';
import { Sale, Language, User } from '../types';
import { TRANSLATIONS, APP_LOGO } from '../constants';
import { Printer, Download, Loader2 } from 'lucide-react';
import { StorageService } from '../services/storage';
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
    StorageService.getGlobalConfig().then(cfg => {
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
        useCORS: true
      });
      
      const imgData = canvas.toDataURL('image/png');
      
      const pdfWidth = 80;
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [pdfWidth, pdfHeight]
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

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[380px] h-[85vh] flex flex-col shadow-2xl rounded-lg overflow-hidden">
        
        {/* Actions Header */}
        <div className="bg-gray-100 p-4 border-b flex justify-between items-center no-print">
          <button onClick={onClose} className="text-gray-600 hover:text-red-500 font-medium">
            {t.close}
          </button>
          <div className="flex gap-2">
            <button 
                onClick={handleDownload} 
                disabled={isDownloading}
                className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 transition disabled:opacity-50"
            >
                {isDownloading ? <Loader2 size={18} className="animate-spin"/> : <Download size={18} />}
                <span className="hidden sm:inline">{t.download}</span>
            </button>
            <button 
                onClick={handlePrint} 
                className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-md hover:bg-emerald-700 transition"
            >
                <Printer size={18} />
                <span className="hidden sm:inline">{t.print}</span>
            </button>
          </div>
        </div>

        {/* Printable Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-white print:p-0 print:overflow-visible" id="printable-area">
          <div className="text-center mb-6">
            <img src={displayLogo} alt="Logo" className="w-12 h-12 mx-auto mb-2 opacity-80 grayscale object-contain" />
            <h1 className="text-2xl font-bold uppercase tracking-wide text-gray-800 break-words leading-tight">{storeName}</h1>
            <p className="text-gray-500 text-xs mt-1">{address}</p>
            {phone && <p className="text-gray-500 text-xs">Tel: {phone}</p>}
          </div>

          <div className="border-b-2 border-dashed border-gray-300 mb-4 pb-2 text-xs text-gray-500">
             <div className="flex justify-between mb-1">
                <span>Inv: {sale.id.slice(0, 8)}</span>
                <span>{new Date(sale.date).toLocaleDateString()} {new Date(sale.date).toLocaleTimeString()}</span>
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
               <span>{t.paidAmount} ({sale.paymentMethod || 'cash'})</span>
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