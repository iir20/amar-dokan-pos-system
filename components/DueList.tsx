
import React, { useMemo, useState, useEffect } from 'react';
import { Sale, Language, User } from '../types';
import { TRANSLATIONS } from '../constants';
import { Eye, Phone, Lock, Crown, ChevronDown, ChevronUp, Users, FileText } from 'lucide-react';
import { useApiData } from '../hooks/useApiData';
import { StorageService } from '../services/storage';
import SubscriptionModal from './SubscriptionModal';

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

  // Group sales by customer name
  const groupedDues = useMemo(() => {
    const groups: Record<string, GroupedDue> = {};

    allSales
      .filter(sale => sale.dueAmount > 0)
      .forEach(sale => {
        const nameKey = sale.customerName?.trim() || 'Unknown Customer';
        
        if (!groups[nameKey]) {
          groups[nameKey] = {
            customerName: nameKey,
            customerPhone: sale.customerPhone || '',
            totalDue: 0,
            invoices: []
          };
        }

        groups[nameKey].invoices.push(sale);
        groups[nameKey].totalDue += sale.dueAmount;
        
        // If the group doesn't have a phone but this invoice does, update it
        if (!groups[nameKey].customerPhone && sale.customerPhone) {
            groups[nameKey].customerPhone = sale.customerPhone;
        }
      });

    // Sort groups by highest due amount first
    return Object.values(groups).sort((a, b) => b.totalDue - a.totalDue);
  }, [allSales]);

  const totalDueAmount = groupedDues.reduce((acc, g) => acc + g.totalDue, 0);

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
        </div>
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-xl font-bold border border-red-100 shadow-sm flex flex-col items-end">
           <span className="text-xs text-red-400 uppercase tracking-wider">{t.totalDue}</span>
           <span className="text-xl">৳{totalDueAmount.toLocaleString()}</span>
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
              groupedDues.map(group => {
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
                      </td>
                      <td className="p-4 text-gray-600">
                          {group.customerPhone ? (
                              <div className="flex items-center gap-2">
                                  <Phone size={14} className="text-gray-400" />
                                  {group.customerPhone}
                              </div>
                          ) : '-'}
                      </td>
                      <td className="p-4 text-center">
                          <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-bold">
                              {group.invoices.length}
                          </span>
                      </td>
                      <td className="p-4 text-right font-bold text-red-600 text-lg">
                          ৳{group.totalDue.toLocaleString()}
                      </td>
                    </tr>

                    {/* Child Rows (Individual Invoices) */}
                    {isExpanded && group.invoices.map((sale, idx) => (
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
                                                {sale.items.map(i => lang === 'bn' ? i.nameBn : i.name).join(', ')}
                                            </div>
                                            <div className="text-[10px] text-gray-400">ID: {sale.id.slice(-6)}</div>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <div className="text-xs text-gray-400 uppercase">Total</div>
                                            <div className="text-sm font-medium">৳{sale.totalAmount}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs text-gray-400 uppercase">Paid</div>
                                            <div className="text-sm font-medium text-emerald-600">৳{sale.paidAmount}</div>
                                        </div>
                                        <div className="text-right w-20">
                                            <div className="text-xs text-red-300 uppercase font-bold">Due</div>
                                            <div className="text-sm font-bold text-red-600">৳{sale.dueAmount}</div>
                                        </div>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onViewInvoice(sale); }}
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
