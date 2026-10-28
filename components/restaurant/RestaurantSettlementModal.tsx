import React, { useState } from 'react';
import { GuestOrder, RestaurantTable } from '../../types';
import { StorageService } from '../../services/storage';
import { formatTaka } from '../../utils/currency';
import { X, CheckCircle2, AlertTriangle, ShieldCheck, CreditCard, Banknote, Smartphone, Split, Printer } from 'lucide-react';

interface RestaurantSettlementModalProps {
  order: GuestOrder;
  table?: RestaurantTable;
  isOpen?: boolean;
  lang?: any;
  onClose: () => void;
  onSettled: () => void;
  onVoided?: () => void;
}

const RestaurantSettlementModal: React.FC<RestaurantSettlementModalProps> = ({
  order,
  table,
  isOpen = true,
  onClose,
  onSettled,
  onVoided,
}) => {
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bkash' | 'nagad' | 'card' | 'split'>('cash');
  const [discount, setDiscount] = useState<number>(0);
  const [vatRate, setVatRate] = useState<number>(5);
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [trxId, setTrxId] = useState<string>('');
  const [isVerifyingGateway, setIsVerifyingGateway] = useState<boolean>(false);
  const [gatewayVerified, setGatewayVerified] = useState<boolean>(false);
  const [gatewayMessage, setGatewayMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Void State
  const [isVoiding, setIsVoiding] = useState<boolean>(false);
  const [voidReason, setVoidReason] = useState<string>('');

  if (!isOpen) return null;

  const items = (order.items || []) as any[];
  const subTotal = order.totalAmount || items.reduce((acc, i) => acc + (i.price || 0) * (i.quantity || 1), 0);
  const discounted = Math.max(0, subTotal - (discount || 0));
  const vatAmount = Math.round(discounted * ((vatRate || 0) / 100));
  const totalAmount = discounted + vatAmount;

  const effectiveCashReceived = cashReceived || totalAmount;
  const changeAmount = paymentMethod === 'cash' ? Math.max(0, effectiveCashReceived - totalAmount) : 0;

  const handleVerifyGateway = async () => {
    if (!trxId.trim()) {
      setError('Please enter transaction ID');
      return;
    }
    setError('');
    setIsVerifyingGateway(true);
    try {
      const result = await StorageService.verifyGatewayPayment({
        gateway: paymentMethod,
        trxId: trxId.trim(),
        amount: totalAmount,
      });
      if (result.valid) {
        setGatewayVerified(true);
        setGatewayMessage(`Verified: ৳${result.amount} received via ${result.gateway.toUpperCase()}`);
      } else {
        setGatewayVerified(false);
        setError(result.message || 'Gateway verification failed');
      }
    } catch {
      setError('Could not verify with payment gateway');
    } finally {
      setIsVerifyingGateway(false);
    }
  };

  const handleSettle = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await StorageService.settleGuestOrder(order.id, {
        paymentMethod,
        paidAmount: totalAmount,
        cashReceived: paymentMethod === 'cash' ? effectiveCashReceived : undefined,
        discount,
        vatRate,
        gatewayTrxId: trxId ? trxId.trim() : undefined,
      });
      onSettled();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Settlement failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVoid = async () => {
    if (!voidReason.trim()) {
      setError('A reason is required to void this dining order.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      await StorageService.voidGuestOrder(order.id, voidReason.trim());
      onVoided?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to void order');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b bg-gradient-to-r from-emerald-50 to-white flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-md">
              AmarPay Settlement
            </span>
            <h2 className="text-base font-bold text-gray-900 mt-1">
              {table ? table.name : 'Table Order'} &bull; #{order.id.slice(-6)}
            </h2>
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
            <AlertTriangle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {!isVoiding ? (
            <>
              {/* Items Summary */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-2">
                  Order Items ({items.length})
                </span>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs text-gray-700">
                      <span>{item.quantity}x {item.nameBn || item.name}</span>
                      <span className="font-semibold text-gray-900">{formatTaka((item.price || 0) * (item.quantity || 1))}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Adjustments */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-gray-600 font-medium mb-1">Discount (৳)</label>
                  <input
                    type="number"
                    min="0"
                    max={subTotal}
                    value={discount}
                    onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 font-medium mb-1">VAT / Tax (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={vatRate}
                    onChange={(e) => setVatRate(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              {/* Bill Totals Summary */}
              <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-100 space-y-1 text-xs">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal:</span>
                  <span>{formatTaka(subTotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>Discount:</span>
                    <span>-{formatTaka(discount)}</span>
                  </div>
                )}
                {vatAmount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>VAT ({vatRate}%):</span>
                    <span>+{formatTaka(vatAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-gray-900 pt-1 border-t border-emerald-200">
                  <span>Total Payable:</span>
                  <span className="text-emerald-700">{formatTaka(totalAmount)}</span>
                </div>
              </div>

              {/* Payment Method Selector */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Payment Method
                </label>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => { setPaymentMethod('cash'); setGatewayVerified(false); }}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center gap-1 ${
                      paymentMethod === 'cash' ? 'border-emerald-600 bg-emerald-50 text-emerald-800 font-bold' : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    <Banknote size={18} />
                    <span className="text-[11px]">Cash</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('bkash')}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center gap-1 ${
                      paymentMethod === 'bkash' ? 'border-pink-600 bg-pink-50 text-pink-800 font-bold' : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    <Smartphone size={18} className="text-pink-600" />
                    <span className="text-[11px]">bKash</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('nagad')}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center gap-1 ${
                      paymentMethod === 'nagad' ? 'border-orange-600 bg-orange-50 text-orange-800 font-bold' : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    <Smartphone size={18} className="text-orange-600" />
                    <span className="text-[11px]">Nagad</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPaymentMethod('card'); setGatewayVerified(false); }}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center gap-1 ${
                      paymentMethod === 'card' ? 'border-blue-600 bg-blue-50 text-blue-800 font-bold' : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    <CreditCard size={18} className="text-blue-600" />
                    <span className="text-[11px]">Card</span>
                  </button>
                </div>
              </div>

              {/* Cash Change Calculation */}
              {paymentMethod === 'cash' && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-semibold text-gray-700">Cash Received (৳):</label>
                    <input
                      type="number"
                      min={totalAmount}
                      value={cashReceived || ''}
                      placeholder={totalAmount.toString()}
                      onChange={(e) => setCashReceived(Number(e.target.value))}
                      className="w-32 p-1.5 border rounded-lg text-right font-bold focus:ring-2 focus:ring-emerald-500 outline-none text-xs"
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs font-semibold pt-1 border-t border-slate-200">
                    <span className="text-gray-600">Change to Return:</span>
                    <span className="text-emerald-700 font-bold text-sm">{formatTaka(changeAmount)}</span>
                  </div>
                </div>
              )}

              {/* Digital Gateway Verification */}
              {(paymentMethod === 'bkash' || paymentMethod === 'nagad') && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <label className="block text-gray-700 font-semibold">
                    {paymentMethod.toUpperCase()} Transaction ID (TrxID)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. 9J8A7K3L"
                      value={trxId}
                      onChange={(e) => { setTrxId(e.target.value); setGatewayVerified(false); }}
                      className="flex-1 p-2 border rounded-lg font-mono uppercase focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                    <button
                      type="button"
                      disabled={isVerifyingGateway || !trxId.trim()}
                      onClick={handleVerifyGateway}
                      className="px-3 py-2 bg-slate-800 text-white font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50 transition"
                    >
                      {isVerifyingGateway ? 'Verifying...' : 'Verify'}
                    </button>
                  </div>
                  {gatewayVerified && (
                    <div className="text-emerald-700 font-medium flex items-center gap-1.5 text-[11px] bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                      <ShieldCheck size={14} />
                      <span>{gatewayMessage}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Void Order Form */
            <div className="space-y-3 py-2">
              <div className="p-3 bg-rose-50 text-rose-800 rounded-xl border border-rose-200 text-xs">
                <p className="font-bold flex items-center gap-1.5 mb-1">
                  <AlertTriangle size={15} />
                  Void Dining Order #{order.id.slice(-6)}
                </p>
                <p>Voiding will cancel this order and record an audit log with reason in the AmarPay ledger.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Select / Enter Void Reason</label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {['Customer Walkout', 'Order Cancelled', 'Accidental Duplicate', 'Food Issue'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setVoidReason(preset)}
                      className={`p-2 text-xs rounded-lg border text-left transition ${
                        voidReason === preset ? 'border-rose-600 bg-rose-50 text-rose-800 font-bold' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Or type custom void reason..."
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  className="w-full p-2.5 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t bg-slate-50 flex items-center justify-between gap-3">
          {!isVoiding ? (
            <>
              <button
                type="button"
                onClick={() => setIsVoiding(true)}
                className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-3 py-2 rounded-lg border border-rose-200 transition font-medium"
              >
                Void Order
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs text-gray-600 hover:bg-gray-200 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  data-testid="settle-confirm"
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSettle}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-5 py-2 rounded-xl font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-200 disabled:opacity-50"
                >
                  <CheckCircle2 size={15} />
                  <span>{isSubmitting ? 'Settling...' : `Settle ${formatTaka(totalAmount)}`}</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setIsVoiding(false)}
                className="px-3.5 py-2 text-xs text-gray-600 hover:bg-gray-200 rounded-lg transition"
              >
                Back to Settlement
              </button>
              <button
                type="button"
                disabled={isSubmitting || !voidReason.trim()}
                onClick={handleVoid}
                className="bg-rose-600 hover:bg-rose-700 text-white text-xs px-5 py-2 rounded-xl font-bold transition flex items-center gap-1.5 shadow-md shadow-rose-200 disabled:opacity-50"
              >
                <AlertTriangle size={15} />
                <span>{isSubmitting ? 'Voiding...' : 'Confirm Void'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RestaurantSettlementModal;
