// Phase 5 — two-tap checkout, step 1: receipt preview.
// Shows EXACTLY what will print (same fields as Invoice: items, subtotal,
// discount, VAT, total, paid, change/due) and only then, on tap 2, the
// sale is completed. Money is never decided here: the preview shows the
// client-side estimate and the server recalculates the final bill, exactly
// as before — this sheet adds a preview, it does not change sale math.
import React from 'react';
import { CartItem, Language } from '../types';
import { buildReceiptPreviewLines } from '../shared/phase5';
import { toBanglaDigits } from '../shared/phase3';
import { AdButton } from './ui';

interface Props {
  lang: Language;
  items: CartItem[];
  subTotal: number;
  discount: number;
  vat: number;
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  dueAmount: number;
  paymentMethod: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const CheckoutSheet: React.FC<Props> = (props) => {
  const { lang } = props;
  const lines = buildReceiptPreviewLines({
    items: props.items.map((i) => ({
      name: lang === 'bn' ? i.nameBn : i.name,
      quantity: i.quantity,
      unit: i.unit,
      price: i.price,
    })),
    subTotal: props.subTotal,
    discount: props.discount,
    vat: props.vat,
    totalAmount: props.totalAmount,
    paidAmount: props.paidAmount,
    changeAmount: props.changeAmount,
    dueAmount: props.dueAmount,
    paymentMethod: props.paymentMethod,
  });
  const bigTotal =
    lang === 'bn' ? `৳${toBanglaDigits(props.totalAmount.toFixed(2))}` : `৳${props.totalAmount.toFixed(2)}`;

  return (
    <div
      data-testid="checkout-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'bn' ? 'রশিদ প্রিভিউ' : 'Receipt preview'}
      className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4"
    >
      <div className="ad-card w-full max-w-[420px] max-h-[85vh] overflow-y-auto !p-0">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-bold text-lg text-gray-800">
            {lang === 'bn' ? 'রশিদ প্রিভিউ — প্রিন্টের আগে যাচাই করুন' : 'Receipt preview — check before printing'}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {lang === 'bn'
              ? 'নিচে ঠিক যা প্রিন্ট হবে তাই দেখানো হচ্ছে। কনফার্ম করলেই বিক্রি সম্পন্ন হবে।'
              : 'This is exactly what will print. Confirm to complete the sale.'}
          </p>
        </div>
        <div data-testid="receipt-preview" className="p-4 font-mono text-sm text-gray-800 whitespace-pre-wrap">
          {lines.join('\n')}
        </div>
        <div className="p-4 border-t border-gray-200 space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-bold text-gray-800">{lang === 'bn' ? 'সর্বমোট' : 'Total'}</span>
            <span data-testid="checkout-sheet-total" className="text-3xl font-bold text-emerald-600">
              {bigTotal}
            </span>
          </div>
          <div className="flex gap-2">
            <AdButton
              variant="ghost"
              onClick={props.onCancel}
              className="flex-1"
              ariaLabel={lang === 'bn' ? 'ফিরে যান' : 'Go back and edit'}
            >
              {lang === 'bn' ? 'ফিরে যান' : 'Back'}
            </AdButton>
            <AdButton
              testid="pos-confirm-checkout"
              onClick={props.onConfirm}
              disabled={props.isSubmitting}
              className="flex-1"
              ariaLabel={lang === 'bn' ? 'বিক্রি কনফার্ম করুন' : 'Confirm sale'}
            >
              {props.isSubmitting
                ? lang === 'bn'
                  ? 'প্রসেস হচ্ছে…'
                  : 'Processing…'
                : lang === 'bn'
                  ? 'কনফার্ম করুন'
                  : 'Confirm sale'}
            </AdButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutSheet;
