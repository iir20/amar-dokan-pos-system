
import React from 'react';
import { GuestOrder, RestaurantTable, Language } from '../../types';

import { ChefHat, CheckCircle2, UtensilsCrossed, Clock, ArrowLeft, Plus } from 'lucide-react';
import { TRANSLATIONS } from '../../constants';

interface Props {
  orders: GuestOrder[];
  table?: RestaurantTable;
  lang: Language;
  onOrderMore: () => void;
}

const GuestOrderTracking: React.FC<Props> = ({ orders, table, lang, onOrderMore }) => {
  const getStatusInfo = (status: string) => {
      switch(status) {
          case 'pending': return { text: 'Sent', icon: Clock, color: 'text-yellow-600 bg-yellow-100', msg: 'Waiting for confirm' };
          case 'accepted': return { text: 'Accepted', icon: CheckCircle2, color: 'text-blue-600 bg-blue-100', msg: 'Order received' };
          case 'preparing': return { text: 'Cooking', icon: ChefHat, color: 'text-orange-600 bg-orange-100', msg: 'Chef is working' };
          case 'ready': return { text: 'Ready', icon: UtensilsCrossed, color: 'text-green-600 bg-green-100', msg: 'Coming to table' };
          default: return { text: status, icon: Clock, color: 'text-gray-600 bg-gray-100', msg: '' };
      }
  };

  return (
    <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col font-sans">
        {/* Header */}
        <div className="bg-white p-4 shadow-sm border-b flex items-center justify-between">
             <button onClick={onOrderMore} className="flex items-center gap-1 text-gray-600 font-medium">
                 <ArrowLeft size={18} /> Menu
             </button>
             <h1 className="font-bold text-gray-800">Order Status</h1>
             <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
             <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 text-center mb-6">
                 <p className="text-gray-500 text-sm mb-1">Table</p>
                 <h2 className="text-2xl font-bold text-gray-800">{table?.name || 'Unknown'}</h2>
             </div>

             {orders.length === 0 ? (
                 <div className="text-center text-gray-400 py-10">
                     <p>No active orders.</p>
                     <button onClick={onOrderMore} className="mt-4 text-orange-600 font-bold">Go to Menu</button>
                 </div>
             ) : (
                 orders.map((order, idx) => {
                     const info = getStatusInfo(order.status);
                     const StatusIcon = info.icon;
                     return (
                         <div key={order.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                             <div className="p-4 border-b bg-gray-50/50 flex justify-between items-center">
                                 <div>
                                     <span className="text-xs font-mono text-gray-400">Order #{order.id.slice(-4)}</span>
                                     <div className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                 </div>
                                 <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase ${info.color}`}>
                                     <StatusIcon size={14} />
                                     {info.text}
                                 </div>
                             </div>
                             <div className="p-4">
                                 <ul className="space-y-2 mb-3">
                                     {order.items.map((item, i) => (
                                         <li key={i} className="flex justify-between text-sm">
                                             <span className="text-gray-700"><span className="font-bold">{item.quantity}x</span> {lang === 'bn' ? item.nameBn : item.name}</span>
                                             <span className="text-gray-500">৳{item.price * item.quantity}</span>
                                         </li>
                                     ))}
                                 </ul>
                                 <div className="flex justify-between items-center pt-3 border-t border-dashed">
                                     <span className="text-sm font-bold text-gray-500">Total</span>
                                     <span className="text-lg font-bold text-gray-800">৳{order.totalAmount}</span>
                                 </div>
                             </div>
                             {/* Progress Bar for Visual Feedback */}
                             <div className="h-1 w-full bg-gray-100">
                                 <div 
                                    className={`h-full transition-all duration-1000 ${order.status === 'ready' ? 'bg-green-500' : 'bg-orange-500'}`} 
                                    style={{ width: order.status === 'pending' ? '25%' : order.status === 'accepted' ? '50%' : order.status === 'preparing' ? '75%' : '100%' }} 
                                 />
                             </div>
                         </div>
                     );
                 })
             )}
        </div>

        <div className="p-4 bg-white border-t">
            <button 
                onClick={onOrderMore}
                className="w-full bg-orange-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-orange-200 flex items-center justify-center gap-2 text-lg active:scale-95 transition"
            >
                <Plus size={20} /> Order More Items
            </button>
        </div>
    </div>
  );
};

export default GuestOrderTracking;
