// Distinctive Features track (2026-10-29) — pure, deterministic logic
// for the morning briefing, bazar list, customer credit score and the
// voice-announcement toggle. No I/O, no invented data: every input is a
// real record passed in by the caller, and every output names its basis.
// Offline safety: these functions only transform data already fetched;
// when a source is missing the caller shows "unavailable", never a
// made-up number, and nothing here queues or synthesises a sale/stock
// change, so reconnect can never duplicate anything.

export interface BriefingSaleLike {
  date: string;
  totalAmount: number;
  totalProfit: number;
  dueAmount?: number;
  customerName?: string;
}

export interface BriefingExpenseLike {
  date: string;
  amount: number;
}

/** Local calendar key (YYYY-MM-DD) — avoids UTC-day drift for +06. */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface YesterdaySummary {
  dateKey: string;
  salesTotal: number;
  grossProfit: number;
  expenses: number;
  /** Gross profit minus THAT day's expenses only (labelled as such). */
  netProfit: number;
  saleCount: number;
}

/** Yesterday's real totals, from real sales + expenses of that day. */
export function computeYesterdaySummary(
  sales: BriefingSaleLike[],
  expenses: BriefingExpenseLike[],
  now = new Date(),
): YesterdaySummary {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const key = localDayKey(yesterday);
  const daySales = sales.filter((s) => localDayKey(new Date(s.date)) === key);
  const dayExpenses = expenses.filter((e) => localDayKey(new Date(e.date)) === key);
  const salesTotal = daySales.reduce((a, s) => a + (s.totalAmount || 0), 0);
  const grossProfit = daySales.reduce((a, s) => a + (s.totalProfit || 0), 0);
  const exp = dayExpenses.reduce((a, e) => a + (e.amount || 0), 0);
  return {
    dateKey: key,
    salesTotal: Math.round(salesTotal * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    expenses: Math.round(exp * 100) / 100,
    netProfit: Math.round((grossProfit - exp) * 100) / 100,
    saleCount: daySales.length,
  };
}

// ------------------------------------------------------------------
// Bazar list: low stock + demand forecast, deduplicated by product.
// ------------------------------------------------------------------

export interface BazarSourceProduct {
  id: string;
  name: string;
  nameBn?: string;
  stock: number;
  unit?: string;
  price: number;
}

export interface BazarSourceForecast {
  productId: string;
  suggestedQty: number;
}

/** Low-stock threshold, same as the dashboard's (< 10 units). */
export const LOW_STOCK_THRESHOLD = 10;

export interface BazarItem {
  productId: string;
  name: string;
  nameBn: string;
  unit: string;
  stock: number;
  /** Suggested buy quantity the owner may adjust before confirming. */
  qty: number;
  price: number;
  estCost: number;
  reason: 'forecast' | 'low-stock' | 'both';
  /** Plain-language basis, shown in the UI so nothing is hidden. */
  basis: string;
}

export function buildBazarList(
  products: BazarSourceProduct[],
  forecast: BazarSourceForecast[],
): BazarItem[] {
  const forecastById = new Map<string, number>();
  for (const f of forecast) {
    if ((f.suggestedQty || 0) > 0) forecastById.set(f.productId, f.suggestedQty);
  }
  const items: BazarItem[] = [];
  for (const p of products) {
    const suggested = forecastById.get(p.id) || 0;
    const isLow = p.stock < LOW_STOCK_THRESHOLD;
    if (suggested <= 0 && !isLow) continue;
    // Forecast quantity wins; a low-stock item with no forecast need
    // is topped up to the threshold — the rule is shown in `basis`.
    const topUp = Math.max(0, LOW_STOCK_THRESHOLD - p.stock);
    const qty = suggested > 0 ? suggested : topUp;
    const reason: BazarItem['reason'] =
      suggested > 0 && isLow ? 'both' : suggested > 0 ? 'forecast' : 'low-stock';
    items.push({
      productId: p.id,
      name: p.name,
      nameBn: p.nameBn || '',
      unit: p.unit || 'pcs',
      stock: p.stock,
      qty,
      price: p.price,
      estCost: Math.round(qty * p.price * 100) / 100,
      reason,
      basis:
        reason === 'both'
          ? `Forecast suggests ${suggested}; stock ${p.stock} is below ${LOW_STOCK_THRESHOLD}.`
          : reason === 'forecast'
            ? `Forecast suggests ${suggested} for the lead time.`
            : `Stock ${p.stock} is below ${LOW_STOCK_THRESHOLD}; top up to ${LOW_STOCK_THRESHOLD}.`,
    });
  }
  // Biggest need first so the owner sees the urgent lines at the top.
  items.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  return items;
}

export function bazarListText(items: Array<{ name: string; qty: number; unit: string }>): string {
  if (items.length === 0) return '';
  const lines = items.map((i) => `• ${i.name} — ${i.qty} ${i.unit}`);
  return `Bazar list\n${lines.join('\n')}`;
}

// ------------------------------------------------------------------
// Customer credit score — transparent, from sales records only.
// ------------------------------------------------------------------

export interface CreditScoreBasis {
  totalBills: number;
  paidBills: number;
  dueBills: number;
  totalBilled: number;
  totalPaid: number;
  totalDue: number;
  /** Paid / billed, 0..1. */
  paidRatio: number;
  /** Days since the oldest still-outstanding bill (0 when none due). */
  oldestDueDays: number;
}

export interface CreditScore {
  score: number;
  band: 'good' | 'fair' | 'caution';
  basis: CreditScoreBasis;
  /** The exact formula, shown next to the score — never a black box. */
  formula: string;
}

export const CREDIT_SCORE_FORMULA =
  'Score = 60 × (paid ÷ billed) + 40 × ageing factor; ageing factor is 1 with no outstanding due, otherwise max(0, 1 − oldest due days ÷ 90).';

/**
 * Score from repayment history only. LIMITATION, stated in the UI:
 * sales records carry no due-date or repayment timestamp, so "late"
 * cannot be observed directly — ageing (days since the oldest unpaid
 * bill) is the transparent proxy, and it is labelled as such. A
 * customer with no billed sales gets null (no score), never 0.
 */
export function computeCreditScore(
  sales: Array<{ totalAmount: number; paidAmount: number; dueAmount?: number; date: string }>,
  now = new Date(),
): CreditScore | null {
  if (sales.length === 0) return null;
  const totalBilled = sales.reduce((a, s) => a + (s.totalAmount || 0), 0);
  if (totalBilled <= 0) return null;
  const totalPaid = sales.reduce((a, s) => a + (s.paidAmount || 0), 0);
  const totalDue = sales.reduce((a, s) => a + (s.dueAmount || 0), 0);
  const dueSales = sales.filter((s) => (s.dueAmount || 0) > 0);
  const oldestDueDays =
    dueSales.length === 0
      ? 0
      : Math.max(
          0,
          Math.floor(
            (now.getTime() - Math.min(...dueSales.map((s) => new Date(s.date).getTime()))) /
              86400000,
          ),
        );
  const paidRatio = Math.min(1, Math.max(0, totalPaid / totalBilled));
  const ageingFactor = totalDue <= 0 ? 1 : Math.max(0, 1 - oldestDueDays / 90);
  const score = Math.round(60 * paidRatio + 40 * ageingFactor);
  return {
    score,
    band: score >= 80 ? 'good' : score >= 50 ? 'fair' : 'caution',
    basis: {
      totalBills: sales.length,
      paidBills: sales.length - dueSales.length,
      dueBills: dueSales.length,
      totalBilled: Math.round(totalBilled * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalDue: Math.round(totalDue * 100) / 100,
      paidRatio: Math.round(paidRatio * 10000) / 10000,
      oldestDueDays,
    },
    formula: CREDIT_SCORE_FORMULA,
  };
}

// ------------------------------------------------------------------
// Voice-announcement toggle (amar-voice-confirm, default on).
// The pure rule lives here so it is unit-testable; services/voice.ts
// reads the stored value and applies this rule before speaking.
// ------------------------------------------------------------------

export const VOICE_CONFIRM_KEY = 'amar-voice-confirm';

/** Stored value -> announcements on? null (never set) means on. */
export function voiceAnnouncementEnabled(stored: string | null): boolean {
  return stored === null || stored === 'true';
}

// ------------------------------------------------------------------
// CODE_128 printability (the sticker encoder lives in
// utils/barcodeSticker.ts; this predicate keeps the rule testable
// without pulling the ZXing bundle into pure-logic tests).
// ------------------------------------------------------------------

export function isPrintableCode128(code: string): boolean {
  if (!code || code.length > 80) return false;
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}
