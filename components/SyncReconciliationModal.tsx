import React, { useState, useEffect } from 'react';
import { SyncItem } from '../types';
import { getOutbox, flushOutbox, clearSyncedOutbox, retryFailedOutbox, subscribeToSync } from '../services/amarSync';
import { formatTaka } from '../utils/currency';
import { Cloud, CloudOff, RefreshCw, CheckCircle2, AlertCircle, Trash2, X, Clock, ArrowRight } from 'lucide-react';

interface SyncReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaleSynced?: () => void;
}

const SyncReconciliationModal: React.FC<SyncReconciliationModalProps> = ({ isOpen, onClose, onSaleSynced }) => {
  const [items, setItems] = useState<SyncItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncFeedback, setSyncFeedback] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setItems(getOutbox());

    const unsubscribe = subscribeToSync((state) => {
      setItems(getOutbox());
      setIsOnline(state.isOnline);
      setIsSyncing(state.isSyncing);
    });

    return unsubscribe;
  }, [isOpen]);

  if (!isOpen) return null;

  const pendingItems = items.filter((i) => i.status === 'pending');
  const failedItems = items.filter((i) => i.status === 'failed');

  const handleManualSync = async () => {
    if (!navigator.onLine) {
      setSyncFeedback('Cannot sync: device is currently offline.');
      return;
    }
    setIsSyncing(true);
    setSyncFeedback('Syncing offline sales with server...');
    const result = await flushOutbox();
    setItems(getOutbox());
    setIsSyncing(false);
    setSyncFeedback(`Sync complete: ${result.synced} sales synced, ${result.failed} failed.`);
    if (onSaleSynced && result.synced > 0) {
      onSaleSynced();
    }
  };

  const handleClear = () => {
    clearSyncedOutbox();
    setItems(getOutbox());
  };

  // Phase 6 — failed records stay in the outbox and are retryable from
  // here (they used to be silently droppable via Clear Synced).
  const handleRetryFailed = async () => {
    retryFailedOutbox();
    setItems(getOutbox());
    await handleManualSync();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b flex items-center justify-between bg-gradient-to-r from-slate-50 to-emerald-50/50">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}
            >
              {isOnline ? <Cloud size={24} /> : <CloudOff size={24} />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                AmarSync Protocol
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}
                >
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </h2>
              <p className="text-xs text-gray-500">Offline-first outbox & reconciliation ledger</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Status Bar */}
        <div className="p-4 bg-slate-50 border-b flex items-center justify-between text-sm flex-wrap gap-2">
          <div className="flex items-center gap-4 text-xs font-medium">
            <span className="text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
              Pending: {pendingItems.length}
            </span>
            {failedItems.length > 0 && (
              <span className="text-rose-700 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200">
                Failed: {failedItems.length}
              </span>
            )}
            <span className="text-gray-500">Total Queued: {items.length}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="text-xs text-gray-600 hover:text-rose-600 px-3 py-1.5 rounded-lg border hover:bg-rose-50 transition flex items-center gap-1.5"
            >
              <Trash2 size={13} />
              Clear Synced
            </button>
            {failedItems.length > 0 && (
              <button
                data-testid="sync-retry-failed"
                onClick={() => void handleRetryFailed()}
                disabled={isSyncing || !isOnline}
                className="bg-amber-600 text-white text-xs px-3.5 py-1.5 rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50 transition"
              >
                Retry {failedItems.length} failed
              </button>
            )}
            <button
              onClick={handleManualSync}
              disabled={isSyncing || !isOnline}
              className="bg-emerald-600 text-white text-xs px-3.5 py-1.5 rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 transition flex items-center gap-1.5 shadow-sm"
            >
              <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        </div>

        {syncFeedback && (
          <div className="px-4 py-2 bg-emerald-50 text-emerald-800 text-xs border-b border-emerald-100 flex items-center gap-2">
            <CheckCircle2 size={14} className="shrink-0" />
            <span>{syncFeedback}</span>
          </div>
        )}

        {/* Content List */}
        <div className="p-4 overflow-y-auto flex-1 divide-y divide-gray-100">
          {items.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-2 opacity-80" />
              <p className="font-medium text-gray-700 text-sm">All sales are synced with server!</p>
              <p className="text-xs text-gray-400 mt-1">
                When internet disconnects, new sales queue here safely and sync automatically once reconnected.
              </p>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="py-3 flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 p-1.5 rounded-lg ${
                      item.status === 'synced'
                        ? 'bg-emerald-100 text-emerald-700'
                        : item.status === 'failed'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {item.status === 'synced' ? (
                      <CheckCircle2 size={16} />
                    ) : item.status === 'failed' ? (
                      <AlertCircle size={16} />
                    ) : (
                      <Clock size={16} />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-gray-900">Sale #{item.id.slice(-8)}</span>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          item.status === 'synced'
                            ? 'bg-emerald-100 text-emerald-700'
                            : item.status === 'failed'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.sale.items?.length || 0} items &bull; Method: {item.sale.paymentMethod || 'cash'} &bull;
                      Queued: {new Date(item.queuedAt).toLocaleTimeString()}
                    </p>
                    {item.error && <p className="text-[11px] text-rose-600 mt-0.5">{item.error}</p>}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-sm font-bold text-gray-900">{formatTaka(item.sale.totalAmount || 0)}</span>
                  <p className="text-[10px] text-gray-400">
                    {item.retryCount > 0 ? `Retries: ${item.retryCount}` : 'New'}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-slate-50 flex items-center justify-between text-xs text-gray-500">
          <span>AmarSync guarantees zero lost sales during network outages.</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SyncReconciliationModal;
