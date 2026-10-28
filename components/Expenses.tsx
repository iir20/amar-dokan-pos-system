import React, { useState } from 'react';
import { Expense, Language } from '../types';
import { TRANSLATIONS } from '../constants';
import { StorageService } from '../services/storage';
import { Plus, Trash2 } from 'lucide-react';
import { useApiData } from '../hooks/useApiData';

interface ExpensesProps {
  lang: Language;
  canManage?: boolean;
}

const Expenses: React.FC<ExpensesProps> = ({ lang, canManage = true }) => {
  const t = TRANSLATIONS[lang];
  const { data: expensesData, refetch: refetchExpenses } = useApiData(() => StorageService.getExpenses(), []);
  const expenses = expensesData || [];
  const [formData, setFormData] = useState({ description: '', amount: '', category: 'General' });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.description || !formData.amount) return;

    const newExpense: Expense = {
      id: Date.now().toString(),
      description: formData.description,
      amount: parseFloat(formData.amount),
      category: formData.category,
      date: new Date().toISOString()
    };

    await StorageService.addExpense(newExpense);
    setFormData({ description: '', amount: '', category: 'General' });
    refetchExpenses();
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t.confirmDelete)) {
      await StorageService.deleteExpense(id);
      refetchExpenses();
    }
  };

  const totalExpenses = expenses.reduce((acc, curr) => acc + curr.amount, 0);

  return (
    <div className="p-6 h-full flex flex-col gap-6">
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Add Expense Form */}
          {canManage && <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
              <h3 className="font-bold text-lg mb-4 text-gray-800">{t.addExpense}</h3>
              <form onSubmit={handleAdd} className="space-y-4">
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t.description}</label>
                      <input 
                        type="text" required
                        className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                        value={formData.description}
                        onChange={e => setFormData({...formData, description: e.target.value})}
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t.amount}</label>
                      <input 
                        type="number" required min="0"
                        className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                        value={formData.amount}
                        onChange={e => setFormData({...formData, amount: e.target.value})}
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                      <select 
                        className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                        value={formData.category}
                        onChange={e => setFormData({...formData, category: e.target.value})}
                      >
                          <option value="General">General</option>
                          <option value="Rent">Rent</option>
                          <option value="Utilities">Utilities</option>
                          <option value="Salary">Salary</option>
                          <option value="Other">Other</option>
                      </select>
                  </div>
                  <button type="submit" className="w-full bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 font-medium flex items-center justify-center gap-2">
                      <Plus size={18} /> {t.save}
                  </button>
              </form>
          </div>}

          {/* List */}
          <div className="md:col-span-2 flex flex-col h-full overflow-hidden">
             <div className="flex justify-between items-center mb-4">
                 <h2 className="text-xl font-bold text-gray-800">{t.expenses}</h2>
                 <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg font-bold border border-red-100">
                     {t.total}: ৳{totalExpenses.toLocaleString()}
                 </div>
             </div>
             
             <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 overflow-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 text-gray-600 font-medium text-sm sticky top-0 z-10">
                        <tr>
                            <th className="p-4">{t.date}</th>
                            <th className="p-4">{t.description}</th>
                            <th className="p-4">Category</th>
                            <th className="p-4 text-right">{t.amount}</th>
                            <th className="p-4 text-center">{t.actions}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {expenses.length === 0 ? (
                            <tr><td colSpan={5} className="p-8 text-center text-gray-400">No expenses recorded.</td></tr>
                        ) : (
                            expenses.slice().reverse().map(exp => (
                                <tr key={exp.id} className="hover:bg-gray-50">
                                    <td className="p-4 text-sm text-gray-600">{new Date(exp.date).toLocaleDateString()}</td>
                                    <td className="p-4 font-medium text-gray-800">{exp.description}</td>
                                    <td className="p-4 text-sm text-gray-500">
                                        <span className="bg-gray-100 px-2 py-1 rounded text-xs">{exp.category}</span>
                                    </td>
                                    <td className="p-4 text-right font-bold text-gray-800">৳{exp.amount}</td>
                                    <td className="p-4 text-center">
                                        {canManage && (
                                        <button onClick={() => handleDelete(exp.id)} className="text-gray-400 hover:text-red-500">
                                            <Trash2 size={16} />
                                        </button>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
             </div>
          </div>
       </div>
    </div>
  );
};

export default Expenses;