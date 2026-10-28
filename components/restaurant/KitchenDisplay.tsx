
import React, { useEffect, useState } from 'react';
import { useApiData } from '../../hooks/useApiData';
import { Language, GuestOrder, OrderStatus } from '../../types';
import { TRANSLATIONS } from '../../constants';
import { Clock, CheckCircle2, ChefHat, Bell, Utensils, XCircle, CreditCard } from 'lucide-react';
import { StorageService } from '../../services/storage';
import RestaurantSettlementModal from './RestaurantSettlementModal';

interface KitchenDisplayProps {
  lang: Language;
}

const KitchenDisplay: React.FC<KitchenDisplayProps> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const [settlingOrder, setSettlingOrder] = useState<GuestOrder | null>(null);
  // Filter out served/cancelled orders to keep display clean
  const { data: ordersData, loading, error, refetch: refetchOrders } = useApiData(() => StorageService.getGuestOrders(), []);
  useEffect(() => {
      const poll = setInterval(() => { void refetchOrders(); }, 5_000);
      return () => clearInterval(poll);
  }, [refetchOrders]);
  const orders = (ordersData || [])
      .filter(o => o.status !== 'served' && o.status !== 'cancelled')
      .reverse();

  const { data: tablesData } = useApiData(() => StorageService.getTables(), []);
  const tables = tablesData || [];

  const getTableName = (id: string) => tables.find(t => t.id === id)?.name || 'Unknown Table';

  const updateStatus = async (orderId: string, status: OrderStatus) => {
      try {
          await StorageService.updateGuestOrderStatus(orderId, status);
          refetchOrders();
      } catch (error) {
          window.alert(error instanceof Error ? error.message : 'Could not update this order.');
      }
  };

  const getTimeElapsed = (iso: string) => {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
  };

  return (
    <div className="p-4 md:p-6 h-full overflow-y-auto bg-slate-100">
      {loading && !ordersData && <p role="status" className="mb-3 text-sm text-gray-600">Connecting to the restaurant server…</p>}
      {error && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>Kitchen updates could not be refreshed. Existing orders remain visible.</span>
          <button onClick={() => refetchOrders()} className="font-semibold underline">Retry</button>
        </div>
      )}
      <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <ChefHat className="text-orange-500" />
              Kitchen Display System
          </h2>
          <div className="bg-white px-4 py-2 rounded-full shadow-sm text-sm font-bold text-gray-600 border">
              Active Orders: {orders.length}
          </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {orders.length === 0 && (
              <div className="col-span-full h-64 flex flex-col items-center justify-center text-gray-400">
                  <Utensils size={48} className="mb-4 opacity-20" />
                  <p>No active orders. Kitchen is quiet.</p>
              </div>
          )}

          {orders.map(order => (
              <div key={order.id} data-testid={`kds-order-${order.id}`} className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden flex flex-col ${
                  order.status === 'pending' ? 'border-yellow-400 animate-pulse-slow' : 'border-transparent'
              }`}>
                  {/* Header */}
                  <div className={`p-3 flex justify-between items-center text-white ${
                      order.status === 'pending' ? 'bg-yellow-500' :
                      order.status === 'accepted' ? 'bg-blue-500' :
                      order.status === 'preparing' ? 'bg-orange-500' :
                      'bg-green-500'
                  }`}>
                      <div>
                          <h3 className="font-bold text-lg">{getTableName(order.tableId)}</h3>
                          <p className="text-xs opacity-90">#{order.id.slice(-4)}</p>
                      </div>
                      <div className="text-right">
                          <div className="flex items-center gap-1 text-xs font-bold bg-black/20 px-2 py-1 rounded">
                              <Clock size={12} /> {getTimeElapsed(order.createdAt)}
                          </div>
                          <p className="text-[10px] mt-1 uppercase font-bold tracking-wider">{order.status}</p>
                      </div>
                  </div>

                  {/* Body */}
                  <div className="p-4 flex-1">
                      <ul className="space-y-3">
                          {order.items.map((item, idx) => (
                              <li key={idx} className="flex justify-between items-start text-sm border-b border-dashed pb-2 last:border-0">
                                  <div className="flex gap-2">
                                      <span className="font-bold bg-gray-100 w-6 h-6 flex items-center justify-center rounded text-gray-800">
                                          {item.quantity}
                                      </span>
                                      <div>
                                          <span className="text-gray-800 font-medium">{lang === 'bn' ? item.nameBn : item.name}</span>
                                          {item.note && (
                                              <p className="text-xs text-red-500 italic mt-0.5">Note: {item.note}</p>
                                          )}
                                      </div>
                                  </div>
                              </li>
                          ))}
                      </ul>
                      {order.note && (
                          <div className="mt-3 bg-red-50 p-2 rounded text-xs text-red-700 font-medium border border-red-100">
                              Order Note: {order.note}
                          </div>
                      )}
                      <div className="mt-3 flex justify-between border-t pt-2 text-sm">
                          <span className="text-gray-500">Order total</span>
                          <span className="font-bold text-gray-800">৳{order.totalAmount.toFixed(2)}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">
                          Serving updates fulfillment only; record payment separately at checkout.
                      </p>
                  </div>

                  {/* Actions */}
                  <div className="p-3 bg-gray-50 border-t flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        {order.status === 'pending' && (
                            <>
                                <button onClick={() => updateStatus(order.id, 'cancelled')} className="col-span-1 py-2 bg-red-100 text-red-700 rounded-lg text-xs font-bold hover:bg-red-200">Reject</button>
                                <button onClick={() => updateStatus(order.id, 'accepted')} className="col-span-1 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700">Accept</button>
                            </>
                        )}
                        {order.status === 'accepted' && (
                            <button onClick={() => updateStatus(order.id, 'preparing')} className="col-span-2 py-2 bg-orange-500 text-white rounded-lg text-sm font-bold hover:bg-orange-600">Start Cooking 👨‍🍳</button>
                        )}
                        {order.status === 'preparing' && (
                            <button onClick={() => updateStatus(order.id, 'ready')} className="col-span-2 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600">Mark Ready ✅</button>
                        )}
                        {order.status === 'ready' && (
                            <button onClick={() => updateStatus(order.id, 'served')} className="col-span-2 py-2 bg-gray-800 text-white rounded-lg text-sm font-bold hover:bg-gray-900">Mark Served 🍽️</button>
                        )}
                      </div>

                      {/* AmarPay Dining Bill Settlement Button */}
                      <button
                        data-testid={`kds-settle-${order.id}`}
                        onClick={() => setSettlingOrder(order)}
                        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition"
                      >
                        <CreditCard size={14} /> Settle Bill / AmarPay
                      </button>
                  </div>
              </div>
          ))}
      </div>

      {settlingOrder && (
        <RestaurantSettlementModal
          lang={lang}
          order={settlingOrder}
          onClose={() => setSettlingOrder(null)}
          onSettled={() => {
            setSettlingOrder(null);
            refetchOrders();
          }}
        />
      )}
    </div>
  );
};

export default KitchenDisplay;
