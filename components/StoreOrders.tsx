
import React, { useEffect, useState } from 'react';
import { Language, OnlineOrder, DeliveryStatus } from '../types';
import { useApiData } from '../hooks/useApiData';
import { StorageService } from '../services/storage';
import { Package, MapPin, Phone, Clock, CheckCircle2, Truck, XCircle, ChevronRight } from 'lucide-react';

interface StoreOrdersProps {
  lang: Language;
}

const STATUS_FLOW: DeliveryStatus[] = ['placed', 'confirmed', 'out_for_delivery', 'delivered'];

const STATUS_META: Record<DeliveryStatus, { label: string; color: string; icon: any }> = {
  placed: { label: 'Placed', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: Clock },
  confirmed: { label: 'Confirmed', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: CheckCircle2 },
  out_for_delivery: { label: 'Out for Delivery', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: Truck },
  delivered: { label: 'Delivered', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-700 border-red-200', icon: XCircle },
};

const StoreOrders: React.FC<StoreOrdersProps> = ({ lang }) => {
  const { data: ordersData, loading, error, refetch } = useApiData(() => StorageService.getStoreOnlineOrders(), []);
  useEffect(() => {
    const poll = setInterval(() => { void refetch(); }, 5_000);
    return () => clearInterval(poll);
  }, [refetch]);
  const orders = (ordersData || []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const visibleOrders = filter === 'active'
    ? orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled')
    : orders;

  const advanceStatus = async (order: OnlineOrder) => {
    const currentIdx = STATUS_FLOW.indexOf(order.status as DeliveryStatus);
    const next = STATUS_FLOW[currentIdx + 1];
    if (!next) return;
    setUpdatingId(order.id);
    try {
      await StorageService.updateOnlineOrderStatus(order.id, next);
      refetch();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not update this order.');
    } finally {
      setUpdatingId(null);
    }
  };

  const cancelOrder = async (order: OnlineOrder) => {
    if (!window.confirm('Cancel this order?')) return;
    setUpdatingId(order.id);
    try {
      await StorageService.updateOnlineOrderStatus(order.id, 'cancelled');
      refetch();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not cancel this order.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="p-4 md:p-6 h-full overflow-y-auto bg-slate-50">
      {loading && !ordersData && <p role="status" className="mb-3 text-sm text-gray-600">Loading marketplace orders…</p>}
      {error && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>Order updates could not be refreshed. Existing orders remain visible.</span>
          <button onClick={() => refetch()} className="font-semibold underline">Retry</button>
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Package className="text-emerald-600" /> Online Orders
          </h2>
          <p className="text-sm text-gray-500 mt-1">Delivery orders placed by customers via the marketplace</p>
        </div>
        <div className="flex gap-2 bg-white p-1 rounded-lg border border-gray-200">
          <button
            onClick={() => setFilter('active')}
            className={`px-4 py-1.5 rounded-md text-sm font-bold transition ${filter === 'active' ? 'bg-emerald-600 text-white' : 'text-gray-500'}`}
          >
            Active
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-1.5 rounded-md text-sm font-bold transition ${filter === 'all' ? 'bg-emerald-600 text-white' : 'text-gray-500'}`}
          >
            All
          </button>
        </div>
      </div>

      {visibleOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-400">
          <Package size={40} className="mx-auto mb-3 opacity-30" />
          <p>No {filter === 'active' ? 'active' : ''} online orders yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visibleOrders.map(order => {
            const meta = STATUS_META[order.status as DeliveryStatus] || STATUS_META.placed;
            const StatusIcon = meta.icon;
            const nextIdx = STATUS_FLOW.indexOf(order.status as DeliveryStatus) + 1;
            const nextLabel = STATUS_FLOW[nextIdx] ? STATUS_META[STATUS_FLOW[nextIdx]].label : null;
            const isFinal = order.status === 'delivered' || order.status === 'cancelled';

            return (
              <div key={order.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 border-b bg-gray-50/50 flex justify-between items-start">
                  <div>
                    <span className="text-xs font-mono text-gray-400">#{order.id.slice(-6)}</span>
                    <div className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleString()}</div>
                  </div>
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase border ${meta.color}`}>
                    <StatusIcon size={13} /> {meta.label}
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-gray-700 font-bold">
                    {order.customerName}
                    <span className="flex items-center gap-1 text-gray-400 font-normal text-xs">
                      <Phone size={12} /> {order.customerPhone}
                    </span>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-gray-500">
                    <MapPin size={14} className="mt-0.5 shrink-0" />
                    <span>{order.deliveryAddress}</span>
                  </div>

                  <ul className="space-y-1 pt-2 border-t border-dashed">
                    {order.items.map((item, i) => (
                      <li key={i} className="flex justify-between text-sm">
                        <span className="text-gray-700"><span className="font-bold">{item.quantity}x</span> {lang === 'bn' ? item.nameBn : item.name}</span>
                        <span className="text-gray-500">৳{item.price * item.quantity}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex justify-between items-center pt-2 border-t text-sm">
                    <span className="text-gray-500">Delivery Fee</span>
                    <span className="font-medium">৳{order.deliveryFee}</span>
                  </div>
                  <div className="flex justify-between items-center font-bold text-gray-800">
                    <span>Total</span>
                    <span>৳{order.totalAmount}</span>
                  </div>

                  {!isFinal && (
                    <div className="flex gap-2 pt-2">
                      {nextLabel && (
                        <button
                          onClick={() => advanceStatus(order)}
                          disabled={updatingId === order.id}
                          className="flex-1 bg-emerald-600 text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-1 hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Mark {nextLabel} <ChevronRight size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => cancelOrder(order)}
                        disabled={updatingId === order.id}
                        className="px-4 py-2.5 rounded-lg font-bold text-sm text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StoreOrders;
