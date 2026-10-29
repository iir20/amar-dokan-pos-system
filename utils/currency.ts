
/**
 * Utility for safe financial calculations.
 * JavaScript numbers are floating point and prone to precision errors (0.1 + 0.2 !== 0.3).
 * We solve this by converting everything to integers (paisa/cents) for calculation, 
 * and converting back to float only for display.
 */

// Convert 10.50 -> 1050
export const toCents = (amount: number): number => {
  return Math.round(amount * 100);
};

// Convert 1050 -> 10.50
export const fromCents = (cents: number): number => {
  return cents / 100;
};

// Safe Addition
export const addMoney = (a: number, b: number): number => {
  return fromCents(toCents(a) + toCents(b));
};

// Safe Subtraction
export const subMoney = (a: number, b: number): number => {
  return fromCents(toCents(a) - toCents(b));
};

// Safe Multiplication (Price * Qty)
export const mulMoney = (amount: number, multiplier: number): number => {
  return fromCents(Math.round(toCents(amount) * multiplier));
};

// Safe Division
export const divMoney = (amount: number, divisor: number): number => {
  if (divisor === 0) return 0;
  return fromCents(Math.round(toCents(amount) / divisor));
};

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-BD', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

export const formatTaka = (amount: number): string => {
  return `৳${formatCurrency(amount)}`;
};

// ------------------------------------------------------------------
// Wave 2 (second addition): Bangla numerals, local units, and
// integer-paisa receipt re-computation. All money math here stays in
// integer paisa; floats are only a display form at the boundary.
// ------------------------------------------------------------------

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/** Convert ASCII digits in a string/number to Bangla digits. Signs,
 *  decimal points and grouping commas pass through unchanged. */
export const toBanglaDigits = (input: string | number): string => {
  return String(input).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
};

/** ৳ amount with Bangla digits, e.g. 1250.5 -> "৳১,২৫০.৫০". */
export const formatTakaBn = (amount: number): string => {
  return `৳${toBanglaDigits(formatCurrency(amount))}`;
};

/** Bangla digits when lang is 'bn', plain format otherwise. Used on
 *  screen/PDF receipts only — never in ESC/POS text, where most
 *  thermal printers have no Bangla glyphs and would print garbage. */
export const formatTakaForLang = (amount: number, lang: 'en' | 'bn'): string => {
  return lang === 'bn' ? formatTakaBn(amount) : formatTaka(amount);
};

// --- Local units (kg, litre, piece, packet, ...) -------------------
// Canonical unit keys. normalizeUnit maps the spellings the shop
// actually uses ('L', 'pcs', 'pc', 'পিস', ...) to one key so stock
// math and receipt display never treat the same unit as two units.
export type LocalUnit = 'kg' | 'gram' | 'litre' | 'ml' | 'piece' | 'packet' | 'dozen' | 'other';

const UNIT_ALIASES: Record<string, LocalUnit> = {
  kg: 'kg',
  কেজি: 'kg',
  g: 'gram',
  gram: 'gram',
  grams: 'gram',
  গ্রাম: 'gram',
  l: 'litre',
  litre: 'litre',
  liter: 'litre',
  litres: 'litre',
  liters: 'litre',
  লিটার: 'litre',
  ml: 'ml',
  মিলি: 'ml',
  pcs: 'piece',
  pc: 'piece',
  piece: 'piece',
  pieces: 'piece',
  পিস: 'piece',
  টি: 'piece',
  packet: 'packet',
  packets: 'packet',
  প্যাকেট: 'packet',
  dozen: 'dozen',
  ডজন: 'dozen',
};

export const UNIT_LABELS: Record<LocalUnit, { en: string; bn: string }> = {
  kg: { en: 'kg', bn: 'কেজি' },
  gram: { en: 'g', bn: 'গ্রাম' },
  litre: { en: 'litre', bn: 'লিটার' },
  ml: { en: 'ml', bn: 'মিলি' },
  piece: { en: 'pcs', bn: 'পিস' },
  packet: { en: 'packet', bn: 'প্যাকেট' },
  dozen: { en: 'dozen', bn: 'ডজন' },
  other: { en: '', bn: '' },
};

export const normalizeUnit = (unit?: string | null): LocalUnit => {
  if (!unit) return 'other';
  const key = unit.trim().toLowerCase();
  return UNIT_ALIASES[key] ?? 'other';
};

/** Raw unit string for an unrecognised unit, so nothing is silently
 *  renamed: 'box' stays 'box' instead of becoming ''. */
export const unitLabel = (unit: string | undefined, lang: 'en' | 'bn'): string => {
  const canonical = normalizeUnit(unit);
  if (canonical === 'other') return (unit || '').trim();
  return UNIT_LABELS[canonical][lang];
};

/** Quantity without float dust: 2.5000000001 kg prints as 2.5 kg.
 *  Server stock math keeps 6 decimals (see server/storage.ts); display
 *  trims to 3, which covers every shop unit (kg to the gram). */
export const formatQty = (quantity: number): string => {
  if (!Number.isFinite(quantity)) return '0';
  const trimmed = Number(quantity.toFixed(3));
  return String(trimmed);
};

/** "2.5 kg" / "২.৫ কেজি" — Bangla digits + Bangla label when bn. */
export const formatQtyWithUnit = (quantity: number, unit: string | undefined, lang: 'en' | 'bn'): string => {
  const qty = lang === 'bn' ? toBanglaDigits(formatQty(quantity)) : formatQty(quantity);
  const label = unitLabel(unit, lang);
  return label ? `${qty} ${label}` : qty;
};

/** Stock delta in the server's own convention: 6-decimal rounding, so
 *  10 kg - 2.5 kg = 7.5 kg exactly and repeated fractional deductions
 *  never accumulate binary-float dust. Mirrors server/storage.ts. */
export const applyStockDelta = (stock: number, delta: number): number => {
  return Number((stock + delta).toFixed(6));
};

// --- Receipt re-computation (integer paisa) ------------------------
// Recomputes a stored sale's totals from its own item lines, in
// integer paisa, using the same per-line rounding as shared/finance.ts
// (round half-up per line). The stored server totals stay
// authoritative; a mismatch is reported, never silently overwritten.

export interface ReceiptItemInput {
  price: number;
  quantity: number;
}

export interface ReceiptSaleInput {
  items: ReceiptItemInput[];
  subTotal?: number;
  discount: number;
  vat: number;
  totalAmount: number;
  paidAmount: number;
  cashReceived?: number | null;
  changeAmount?: number | null;
  dueAmount: number;
}

export interface RecomputedReceipt {
  subTotal: number;
  discount: number;
  vat: number;
  totalAmount: number;
  paidAmount: number;
  cashReceived: number;
  changeAmount: number;
  dueAmount: number;
  /** Human-readable mismatches vs the stored sale, in paisa-exact
   *  terms. Empty means the receipt matches the sale exactly. */
  mismatches: string[];
}

export const recomputeReceiptTotals = (sale: ReceiptSaleInput): RecomputedReceipt => {
  let subTotalMinor = 0;
  for (const item of sale.items) {
    // priceMinor (paisa) x quantity, rounded half-up per line.
    subTotalMinor += Math.round(toCents(item.price) * item.quantity);
  }
  const discountMinor = toCents(sale.discount);
  const vatMinor = toCents(sale.vat);
  const totalMinor = subTotalMinor - discountMinor + vatMinor;
  const paidMinor = toCents(sale.paidAmount);
  const cashMinor = sale.cashReceived != null ? toCents(sale.cashReceived) : 0;
  const changeMinor =
    sale.changeAmount != null ? toCents(sale.changeAmount) : Math.max(0, cashMinor - totalMinor);
  const dueMinor = Math.max(0, totalMinor - paidMinor);

  const recomputed: RecomputedReceipt = {
    subTotal: fromCents(subTotalMinor),
    discount: fromCents(discountMinor),
    vat: fromCents(vatMinor),
    totalAmount: fromCents(totalMinor),
    paidAmount: fromCents(paidMinor),
    cashReceived: fromCents(cashMinor),
    changeAmount: fromCents(changeMinor),
    dueAmount: fromCents(dueMinor),
    mismatches: [],
  };

  const check = (field: keyof RecomputedReceipt, stored: number | undefined | null, label: string) => {
    if (stored == null) return;
    if (toCents(stored) !== toCents(recomputed[field] as number)) {
      recomputed.mismatches.push(
        `${label}: stored ৳${Number(stored).toFixed(2)} but items recompute to ৳${(recomputed[field] as number).toFixed(2)}`,
      );
    }
  };
  // subTotal is optional on old records; only check it when present.
  check('subTotal', sale.subTotal, 'Subtotal');
  check('totalAmount', sale.totalAmount, 'Total');
  check('paidAmount', sale.paidAmount, 'Paid');
  check('dueAmount', sale.dueAmount, 'Due');
  if (sale.changeAmount != null) check('changeAmount', sale.changeAmount, 'Change');
  return recomputed;
};
