import React, { useState, useEffect } from 'react';
import { Shift } from '../types';
import { StorageService } from '../services/storage';
import { formatTaka } from '../utils/currency';
import { X, CheckCircle2, AlertCircle, Clock, Banknote, FileText, ArrowRight, Printer } from 'lucide-react';

interface ShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShiftUpdated?: () => void;
}

const ShiftModal: React.FC<ShiftModalProps> = ({ isOpen, onClose, onShiftUpdated }) => {
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingCash, setOpeningCash] = useState<number>(500);
  // Phase 3 — per-counter shifts: a shift belongs to one counter, and its
  // Z-report counts only that counter's sales.
  const [branches, setBranches] = useState<any[]>([]);
  const [counters, setCounters] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [counterId, setCounterId] = useState('');
  const [actualCash, setActualCash] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const [closedZReport, setClosedZReport] = useState<Shift | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    loadShift();
    StorageService.getBranches()
      .then(setBranches)
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!branchId) {
      setCounters([]);
      setCounterId('');
      return;
    }
    StorageService.getCounters(branchId)
      .then(setCounters)
      .catch(() => {});
  }, [branchId]);

  const loadShift = async () => {
    setLoading(true);
    setError('');
    try {
      const shift = await StorageService.getCurrentShift();
      setCurrentShift(shift);
      if (shift) {
        setActualCash(shift.expectedCash || 0);
      }
    } catch {
      setError('Could not load current shift');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleOpenShift = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const shift = await StorageService.openShift({
        openingCash,
        notes: notes.trim() || undefined,
        branchId: branchId || undefined,
        counterId: counterId || undefined,
      });
      setCurrentShift(shift);
      setActualCash(shift.expectedCash || shift.openingCash);
      if (onShiftUpdated) onShiftUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to open shift');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseShift = async () => {
    if (!currentShift) return;
    setError('');
    setIsSubmitting(true);
    try {
      const closed = await StorageService.closeShift(currentShift.id, {
        actualCash,
        notes: notes.trim() || undefined,
      });
      setCurrentShift(null);
      setClosedZReport(closed);
      if (onShiftUpdated) onShiftUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to close shift');
    } finally {
      setIsSubmitting(false);
    }
  };

  const expectedCash = currentShift
    ? currentShift.openingCash + currentShift.totalCashSales - currentShift.totalExpenses
    : 0;
  const discrepancy = actualCash - expectedCash;

  const printZReport = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b bg-gradient-to-r from-emerald-50 to-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
              <Banknote size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Cashier Shift &amp; Z-Report</h2>
              <p className="text-xs text-gray-500">Cash drawer balance &amp; end-of-shift reconciliation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 bg-rose-50 text-rose-700 text-xs border-b border-rose-100 flex items-center gap-1.5">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {closedZReport ? (
            /* Z-Report View */
            <div className="space-y-4 text-xs">
              <div className="text-center p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                  Shift Closed &bull; Z-Report Generated
                </span>
                <h3 className="text-sm font-bold text-gray-900 mt-2">End-of-Shift Cash Settlement</h3>
                <p className="text-[11px] text-gray-500">Cashier: {closedZReport.cashierName}</p>
                <p className="text-[11px] text-gray-400">
                  {new Date(closedZReport.openedAt).toLocaleTimeString()} -{' '}
                  {new Date(closedZReport.closedAt || '').toLocaleTimeString()}
                </p>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                <div className="flex justify-between text-gray-600">
                  <span>Opening Cash Float:</span>
                  <span className="font-semibold text-gray-900">{formatTaka(closedZReport.openingCash)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Total Cash Sales:</span>
                  <span className="font-semibold text-emerald-700">+{formatTaka(closedZReport.totalCashSales)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Total Digital Sales:</span>
                  <span className="font-semibold text-blue-700">{formatTaka(closedZReport.totalDigitalSales)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Expenses Paid Out:</span>
                  <span className="font-semibold text-rose-600">-{formatTaka(closedZReport.totalExpenses)}</span>
                </div>
                <div className="flex justify-between text-gray-800 font-bold pt-2 border-t border-slate-200 text-sm">
                  <span>Expected Drawer Cash:</span>
                  <span>{formatTaka(closedZReport.expectedCash)}</span>
                </div>
                <div className="flex justify-between text-gray-800 font-bold">
                  <span>Actual Counted Cash:</span>
                  <span>{formatTaka(closedZReport.actualCash || 0)}</span>
                </div>
                <div className="flex justify-between font-bold pt-1 border-t border-slate-200">
                  <span>Cash Discrepancy:</span>
                  <span
                    className={
                      closedZReport.discrepancy === 0
                        ? 'text-emerald-600'
                        : closedZReport.discrepancy < 0
                          ? 'text-rose-600'
                          : 'text-amber-600'
                    }
                  >
                    {closedZReport.discrepancy === 0 ? 'Exact Match (৳0)' : formatTaka(closedZReport.discrepancy)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={printZReport}
                className="w-full bg-slate-800 hover:bg-slate-900 text-white py-2.5 rounded-xl font-bold transition flex items-center justify-center gap-2"
              >
                <Printer size={15} />
                <span>Print Z-Report Slip</span>
              </button>
            </div>
          ) : !currentShift ? (
            /* Open Shift Form */
            <div className="space-y-4 text-xs">
              <div className="p-4 bg-emerald-50/70 rounded-xl border border-emerald-100 text-emerald-900">
                <p className="font-bold text-sm mb-1">Start New Cashier Shift</p>
                <p className="text-gray-600">
                  Record your starting cash in drawer (drawer float) to keep track of daily cash sales, change given,
                  and cash discrepancies.
                </p>
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">Opening Cash in Drawer (৳)</label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full p-3 border rounded-xl font-bold text-base text-gray-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="e.g. 500"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Branch / Counter (optional — per-counter Z-report)
                </label>
                <div className="flex gap-2">
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="flex-1 p-2.5 border rounded-xl outline-none"
                  >
                    <option value="">Main store</option>
                    {branches.map((b: any) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={counterId}
                    onChange={(e) => setCounterId(e.target.value)}
                    className="flex-1 p-2.5 border rounded-xl outline-none"
                    disabled={!branchId}
                  >
                    <option value="">No counter</option>
                    {counters.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">Shift Notes (Optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Morning counter shift"
                  className="w-full p-2.5 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleOpenShift}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                <span>{isSubmitting ? 'Starting Shift...' : 'Open Shift &amp; Start Selling'}</span>
              </button>
            </div>
          ) : (
            /* Active Shift Summary & Close */
            <div className="space-y-4 text-xs">
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">
                    Active Shift in Progress
                  </span>
                  <span className="font-bold text-gray-900 text-sm">{currentShift.cashierName}</span>
                </div>
                <span className="text-[11px] text-gray-500 flex items-center gap-1">
                  <Clock size={12} />
                  Opened: {new Date(currentShift.openedAt).toLocaleTimeString()}
                </span>
              </div>

              {/* Current Breakdown */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                <div className="flex justify-between text-gray-600">
                  <span>Opening Float:</span>
                  <span className="font-semibold text-gray-900">{formatTaka(currentShift.openingCash)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Cash Sales Recorded:</span>
                  <span className="font-semibold text-emerald-700">+{formatTaka(currentShift.totalCashSales)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Digital Sales (bKash/Nagad/Card):</span>
                  <span className="font-semibold text-blue-700">{formatTaka(currentShift.totalDigitalSales)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Expenses Paid:</span>
                  <span className="font-semibold text-rose-600">-{formatTaka(currentShift.totalExpenses)}</span>
                </div>
                <div className="flex justify-between text-gray-900 font-bold text-sm pt-2 border-t border-slate-200">
                  <span>Expected Drawer Cash:</span>
                  <span className="text-emerald-700">{formatTaka(expectedCash)}</span>
                </div>
              </div>

              {/* Close Shift Form */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <span className="text-xs font-bold text-gray-800 uppercase tracking-wider block">
                  End of Shift Reconciliation
                </span>
                <div>
                  <label className="block text-gray-700 font-semibold mb-1">Actual Counted Cash in Drawer (৳)</label>
                  <input
                    type="number"
                    min="0"
                    value={actualCash}
                    onChange={(e) => setActualCash(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full p-2.5 border rounded-xl font-bold text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>

                <div className="flex justify-between items-center text-xs font-bold p-2.5 rounded-lg bg-white border">
                  <span className="text-gray-700">Discrepancy:</span>
                  <span
                    className={
                      discrepancy === 0 ? 'text-emerald-600' : discrepancy < 0 ? 'text-rose-600' : 'text-amber-600'
                    }
                  >
                    {discrepancy === 0
                      ? 'Exact Match (৳0)'
                      : discrepancy < 0
                        ? `Short by ${formatTaka(Math.abs(discrepancy))}`
                        : `Over by ${formatTaka(discrepancy)}`}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleCloseShift}
                className="w-full bg-slate-900 hover:bg-black text-white py-3 rounded-xl font-bold transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <FileText size={16} />
                <span>{isSubmitting ? 'Closing...' : 'Close Shift &amp; Generate Z-Report'}</span>
              </button>
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-slate-50 flex items-center justify-end text-xs">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShiftModal;
