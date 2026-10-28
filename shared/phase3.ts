// Phase 3 (Depth) — pure, server-independent business logic.
//
// Every function here is deterministic and unit-testable with no I/O, so
// the money/stock rules can be proven without a running server. The
// server layer (server/memStorage.ts) calls these helpers and owns
// persistence; the client never computes a final total from them — the
// server recalculates every sale (see createSale promo handling).
//
// Money convention (same as shared/finance.ts): taka amounts are numbers
// with at most two decimals; integer-paisa math uses Math.round(x * 100).

export interface SaleQtyPoint {
  date: string; // ISO date
  quantity: number;
}

export interface ForecastInput {
  productId: string;
  productName: string;
  currentStock: number;
  /** Sales quantities, newest or oldest first — only the window matters. */
  history: SaleQtyPoint[];
  windowDays: number;
  leadTimeDays: number;
}

export interface ForecastResult {
  productId: string;
  productName: string;
  windowDays: number;
  leadTimeDays: number;
  /** Total units sold inside the window. */
  windowQty: number;
  /** Average daily sales over the window (units/day, 4 dp). */
  avgDailySales: number;
  /** Units needed to cover the lead time: avgDailySales x leadTimeDays. */
  leadTimeDemand: number;
  currentStock: number;
  /** ceil(leadTimeDemand - currentStock), floored at 0. */
  suggestedQty: number;
  /** Human-readable rule — shown verbatim in the UI so nothing is hidden. */
  basis: string;
  rule: string;
}

export const FORECAST_RULE =
  'suggested = ceil(average daily sales over the last N days x lead-time days - current stock), minimum 0';

export function forecastDemand(input: ForecastInput): ForecastResult {
  const windowDays = Math.max(1, Math.floor(input.windowDays));
  const leadTimeDays = Math.max(0, Math.floor(input.leadTimeDays));
  const now = Date.now();
  const windowStart = now - windowDays * 24 * 60 * 60 * 1000;
  let windowQty = 0;
  for (const point of input.history) {
    const t = new Date(point.date).getTime();
    if (Number.isFinite(t) && t >= windowStart && t <= now && point.quantity > 0) {
      windowQty += point.quantity;
    }
  }
  const avgDailySales = Math.round((windowQty / windowDays) * 10000) / 10000;
  const leadTimeDemand = avgDailySales * leadTimeDays;
  const suggestedQty = Math.max(0, Math.ceil(leadTimeDemand - input.currentStock));
  return {
    productId: input.productId,
    productName: input.productName,
    windowDays,
    leadTimeDays,
    windowQty: Math.round(windowQty * 10000) / 10000,
    avgDailySales,
    leadTimeDemand: Math.round(leadTimeDemand * 10000) / 10000,
    currentStock: input.currentStock,
    suggestedQty,
    basis:
      `Last ${windowDays} days sold ${Math.round(windowQty * 100) / 100} units ` +
      `(avg ${avgDailySales}/day) x ${leadTimeDays} lead-time days = ${Math.round(leadTimeDemand * 100) / 100} units needed; ` +
      `current stock ${input.currentStock}; suggested ${suggestedQty}.`,
    rule: FORECAST_RULE,
  };
}

// ------------------------------------------------------------------
// Medicine expiry alerts
// ------------------------------------------------------------------

export type ExpirySeverity = 'expired' | 'critical' | 'warning' | 'watch';

export interface ExpiryAlert {
  productId: string;
  productName: string;
  expiryDate: string;
  daysLeft: number;
  severity: ExpirySeverity;
  badge: string;
}

export const EXPIRY_THRESHOLDS = [30, 14, 7] as const;

export function expirySeverity(daysLeft: number): ExpirySeverity | null {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 7) return 'critical';
  if (daysLeft <= 14) return 'warning';
  if (daysLeft <= 30) return 'watch';
  return null;
}

export function expiryAlerts(
  products: Array<{ id: string; name: string; expiryDate?: string | null }>,
  now = new Date(),
): ExpiryAlert[] {
  const out: ExpiryAlert[] = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const p of products) {
    if (!p.expiryDate) continue;
    const exp = new Date(p.expiryDate);
    if (Number.isNaN(exp.getTime())) continue;
    const expDay = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate()).getTime();
    const daysLeft = Math.round((expDay - today) / (24 * 60 * 60 * 1000));
    const severity = expirySeverity(daysLeft);
    if (!severity) continue;
    out.push({
      productId: p.id,
      productName: p.name,
      expiryDate: p.expiryDate,
      daysLeft,
      severity,
      badge:
        severity === 'expired'
          ? 'মেয়াদোত্তীর্ণ'
          : severity === 'critical'
            ? '৭ দিনের মধ্যে মেয়াদ শেষ'
            : severity === 'warning'
              ? '১৪ দিনের মধ্যে মেয়াদ শেষ'
              : '৩০ দিনের মধ্যে মেয়াদ শেষ',
    });
  }
  out.sort((a, b) => a.daysLeft - b.daysLeft);
  return out;
}

// ------------------------------------------------------------------
// Dead stock
// ------------------------------------------------------------------

export interface DeadStockItem {
  productId: string;
  productName: string;
  stock: number;
  lastSaleAt: string | null;
  daysSinceSale: number | null;
  suggestedAction: string;
}

export function deadStock(
  products: Array<{ id: string; name: string; stock: number }>,
  lastSaleByProduct: Map<string, string> | Record<string, string>,
  windowDays = 90,
  now = new Date(),
): DeadStockItem[] {
  const out: DeadStockItem[] = [];
  const getLast = (id: string): string | null => {
    if (lastSaleByProduct instanceof Map) return lastSaleByProduct.get(id) ?? null;
    return lastSaleByProduct[id] ?? null;
  };
  for (const p of products) {
    if (!(p.stock > 0)) continue;
    const last = getLast(p.id);
    const daysSinceSale = last ? Math.floor((now.getTime() - new Date(last).getTime()) / (24 * 60 * 60 * 1000)) : null;
    // Never sold at all counts as dead once it has sat in stock; a product
    // sold within the window is alive.
    if (daysSinceSale !== null && daysSinceSale < windowDays) continue;
    out.push({
      productId: p.id,
      productName: p.name,
      stock: p.stock,
      lastSaleAt: last,
      daysSinceSale,
      suggestedAction:
        last === null
          ? `কোনো বিক্রি হয়নি — ক্লিয়ারেন্স ছাড় দিয়ে বিক্রি করুন বা সরিয়ে ফেলুন`
          : `${windowDays} দিনে কোনো বিক্রি নেই — ডিসকাউন্ট/ক্লিয়ারেন্স দিন`,
    });
  }
  return out;
}

// ------------------------------------------------------------------
// Coupons (validated server-side; the client-supplied discount is never
// trusted — see memStorage.createSale, which re-runs this check).
// ------------------------------------------------------------------

export interface Coupon {
  id: string;
  storeId: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number; // percent (0-100) or fixed taka
  minPurchase: number;
  maxUses: number; // 0 = unlimited
  usedCount: number;
  expiresAt: string | null;
  active: boolean;
}

export type CouponCheck =
  { valid: true; discount: number; reason: string } | { valid: false; discount: 0; reason: string };

export function validateCoupon(coupon: Coupon | null | undefined, subTotal: number, now = new Date()): CouponCheck {
  if (!coupon) return { valid: false, discount: 0, reason: 'COUPON_NOT_FOUND' };
  if (!coupon.active) return { valid: false, discount: 0, reason: 'COUPON_INACTIVE' };
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now.getTime()) {
    return { valid: false, discount: 0, reason: 'COUPON_EXPIRED' };
  }
  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, discount: 0, reason: 'COUPON_LIMIT_REACHED' };
  }
  if (subTotal < coupon.minPurchase) {
    return { valid: false, discount: 0, reason: 'COUPON_MIN_PURCHASE' };
  }
  let discount: number;
  if (coupon.type === 'percent') {
    if (coupon.value < 0 || coupon.value > 100) {
      return { valid: false, discount: 0, reason: 'COUPON_INVALID_VALUE' };
    }
    discount = Math.round(((subTotal * coupon.value) / 100) * 100) / 100;
  } else {
    if (coupon.value < 0) return { valid: false, discount: 0, reason: 'COUPON_INVALID_VALUE' };
    discount = Math.min(coupon.value, subTotal);
  }
  return { valid: true, discount, reason: 'OK' };
}

// ------------------------------------------------------------------
// Loyalty points: 1 point per full ৳100 of the final bill; 1 point = ৳1
// when redeemed. Redemption can never exceed the customer's balance or
// the bill remaining after other discounts.
// ------------------------------------------------------------------

export const LOYALTY_TAKA_PER_POINT = 100;
export const LOYALTY_POINT_VALUE_TAKA = 1;

export function loyaltyEarned(totalAmount: number): number {
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) return 0;
  return Math.floor(totalAmount / LOYALTY_TAKA_PER_POINT);
}

export function loyaltyRedeemable(
  requestedPoints: number,
  balancePoints: number,
  remainingBill: number,
): { points: number; discount: number; reason: string } {
  const requested = Math.max(0, Math.floor(requestedPoints || 0));
  const byBalance = Math.min(requested, Math.max(0, Math.floor(balancePoints || 0)));
  const maxByBill = Math.floor(Math.max(0, remainingBill) / LOYALTY_POINT_VALUE_TAKA);
  const points = Math.min(byBalance, maxByBill);
  return {
    points,
    discount: points * LOYALTY_POINT_VALUE_TAKA,
    reason: points < requested ? 'CAPPED_BY_BALANCE_OR_BILL' : 'OK',
  };
}

// ------------------------------------------------------------------
// Voice POS — testable text logic only. The browser wrappers live in
// services/voice.ts; they call these functions and always fall back to
// visible text + tappable controls when speech is unavailable.
// ------------------------------------------------------------------

const BN_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

export function normalizeDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => BN_DIGITS[d] ?? d);
}

const BN_DIGIT_CHARS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBanglaDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => BN_DIGIT_CHARS[Number(d)]);
}

export function formatBanglaTaka(amount: number): string {
  return `${toBanglaDigits(amount.toFixed(2))} টাকা`;
}

export function speakItemText(name: string, price: number): string {
  return `${name}, দাম ${formatBanglaTaka(price)}`;
}

export function speakTotalText(total: number, change: number): string {
  const base = `মোট ${formatBanglaTaka(total)}`;
  if (change > 0) return `${base}, ফেরত ${formatBanglaTaka(change)}`;
  return base;
}

export interface VoiceCommand {
  kind: 'add' | 'total' | 'checkout' | 'clear' | 'unknown';
  quantity: number;
  /** Remaining words after stripping the command + quantity. */
  query: string;
}

/** Parse "২ টা চাল যোগ কর", "add 2 rice", "মোট কত", "চেকআউট করো". */
export function parseVoiceCommand(raw: string): VoiceCommand {
  const text = normalizeDigits((raw || '').trim().toLowerCase());
  if (!text) return { kind: 'unknown', quantity: 1, query: '' };
  if (/মোট কত|total|কত টাকা/.test(text)) return { kind: 'total', quantity: 1, query: '' };
  if (/চেকআউট|checkout|বিল কর|payment/.test(text)) return { kind: 'checkout', quantity: 1, query: '' };
  if (/মুছে|clear|খালি কর|বাতিল/.test(text)) return { kind: 'clear', quantity: 1, query: '' };
  const qtyMatch = text.match(/(\d+(?:\.\d+)?)/);
  const quantity = qtyMatch ? Math.max(0.1, parseFloat(qtyMatch[1])) : 1;
  const query = text
    .replace(/(\d+(?:\.\d+)?)/, ' ')
    .replace(/টা|টি|পিস|pcs|piece|pieces|add|যোগ কর|যোগ|দাও|নাও|কর/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(add|যোগ)/.test(text) || qtyMatch || query) {
    return { kind: 'add', quantity, query };
  }
  return { kind: 'unknown', quantity: 1, query: text };
}

// ------------------------------------------------------------------
// Accountant exports — CSV builders (Excel opens CSV; the endpoint
// labels the format honestly as CSV, never as a native .xlsx file).
// ------------------------------------------------------------------

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((row) => row.map(esc).join(',')).join('\n') + '\n';
}

export interface SaleLike {
  date: string;
  items: Array<{ category?: string; price: number; cost: number; quantity: number }>;
  subTotal: number;
  discount: number;
  vat: number;
  totalAmount: number;
  totalProfit: number;
  paymentMethod: string;
  servedBy?: string | null;
}

export function vatReportRows(sales: SaleLike[]): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [['Date', 'Sub Total', 'Discount', 'VAT', 'Total']];
  for (const s of sales) {
    rows.push([new Date(s.date).toISOString().slice(0, 10), s.subTotal, s.discount, s.vat, s.totalAmount]);
  }
  const totals = sales.reduce(
    (a, s) => [a[0] + s.subTotal, a[1] + s.discount, a[2] + s.vat, a[3] + s.totalAmount],
    [0, 0, 0, 0],
  );
  rows.push(['TOTAL', ...totals.map((v) => Math.round(v * 100) / 100)]);
  return rows;
}

export function profitByCategoryRows(sales: SaleLike[]): Array<Array<string | number>> {
  const byCat = new Map<string, { revenue: number; cost: number; profit: number; qty: number }>();
  for (const s of sales) {
    for (const item of s.items) {
      const cat = item.category || 'general';
      const cur = byCat.get(cat) || { revenue: 0, cost: 0, profit: 0, qty: 0 };
      cur.revenue += item.price * item.quantity;
      cur.cost += item.cost * item.quantity;
      cur.profit += (item.price - item.cost) * item.quantity;
      cur.qty += item.quantity;
      byCat.set(cat, cur);
    }
  }
  const rows: Array<Array<string | number>> = [['Category', 'Revenue', 'Cost', 'Profit', 'Qty']];
  for (const [cat, v] of [...byCat.entries()].sort((a, b) => b[1].profit - a[1].profit)) {
    rows.push([
      cat,
      Math.round(v.revenue * 100) / 100,
      Math.round(v.cost * 100) / 100,
      Math.round(v.profit * 100) / 100,
      Math.round(v.qty * 100) / 100,
    ]);
  }
  return rows;
}

export function staffPerformanceRows(sales: SaleLike[]): Array<Array<string | number>> {
  const byStaff = new Map<string, { sales: number; revenue: number; profit: number }>();
  for (const s of sales) {
    const name = s.servedBy || 'Owner';
    const cur = byStaff.get(name) || { sales: 0, revenue: 0, profit: 0 };
    cur.sales += 1;
    cur.revenue += s.totalAmount;
    cur.profit += s.totalProfit;
    byStaff.set(name, cur);
  }
  const rows: Array<Array<string | number>> = [['Staff', 'Bills', 'Revenue', 'Profit']];
  for (const [name, v] of [...byStaff.entries()].sort((a, b) => b[1].revenue - a[1].revenue)) {
    rows.push([name, v.sales, Math.round(v.revenue * 100) / 100, Math.round(v.profit * 100) / 100]);
  }
  return rows;
}

// ------------------------------------------------------------------
// Full data import validation — money records (sales, expenses) are
// NEVER imported: they are counted as skipped so an import can never
// silently overwrite a bill or an expense. Only reference data
// (products, suppliers, coupons, branches, counters) may be created, and
// only when the id does not already exist.
// ------------------------------------------------------------------

export interface ImportPayload {
  products?: Array<{ id?: string; [k: string]: unknown }>;
  suppliers?: Array<{ id?: string; [k: string]: unknown }>;
  coupons?: Array<{ id?: string; [k: string]: unknown }>;
  branches?: Array<{ id?: string; [k: string]: unknown }>;
  counters?: Array<{ id?: string; [k: string]: unknown }>;
  sales?: unknown[];
  expenses?: unknown[];
  [k: string]: unknown;
}

export interface ImportValidation {
  counts: Record<string, number>;
  skips: Array<{ section: string; id: string | null; reason: string }>;
  errors: string[];
  /** Ids that are safe to create (new reference-data ids only). */
  creatable: Record<string, string[]>;
}

export function validateImport(payload: ImportPayload, existingIds: Record<string, Set<string>>): ImportValidation {
  const counts: Record<string, number> = {};
  const skips: ImportValidation['skips'] = [];
  const errors: string[] = [];
  const creatable: Record<string, string[]> = {};
  const refSections = ['products', 'suppliers', 'coupons', 'branches', 'counters'] as const;
  for (const section of refSections) {
    const list = payload[section];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`${section} must be an array`);
      continue;
    }
    counts[section] = list.length;
    creatable[section] = [];
    for (const entry of list) {
      const id = typeof entry?.id === 'string' && entry.id ? entry.id : null;
      if (!id) {
        skips.push({ section, id: null, reason: 'MISSING_ID' });
        continue;
      }
      if (existingIds[section]?.has(id)) {
        skips.push({ section, id, reason: 'ALREADY_EXISTS_NOT_OVERWRITTEN' });
        continue;
      }
      creatable[section].push(id);
    }
  }
  // Money sections: counted, never imported.
  for (const section of ['sales', 'expenses'] as const) {
    const list = payload[section];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`${section} must be an array`);
      continue;
    }
    counts[section] = list.length;
    for (const entry of list as Array<{ id?: unknown }>) {
      skips.push({
        section,
        id: typeof entry?.id === 'string' ? entry.id : null,
        reason: 'MONEY_RECORD_NEVER_IMPORTED',
      });
    }
  }
  for (const key of Object.keys(payload)) {
    if (![...refSections, 'sales', 'expenses'].includes(key)) {
      errors.push(`Unknown section: ${key}`);
    }
  }
  return { counts, skips, errors, creatable };
}
