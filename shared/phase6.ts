// Phase 6 — pure, server-independent helpers for inventory efficiency,
// Bangla inventory voice, barcode handling, bulk actions and bounded
// online retries. Every function here is deterministic and unit-tested
// in tests/phase6.test.ts with no I/O; the server layer owns persistence
// and re-validates everything (never trust a client-computed value).

import { normalizeDigits, toBanglaDigits } from './phase3';

// ------------------------------------------------------------------
// Barcodes
// ------------------------------------------------------------------

/** Trim whitespace; barcodes are compared exactly (case-sensitive, as
 *  printed on the label). Returns '' for a blank input. */
export function normalizeBarcode(raw: string | null | undefined): string {
  return (raw || '').trim();
}

/** A barcode is usable when it is 1–128 printable characters. */
export function isValidBarcode(raw: string | null | undefined): boolean {
  const code = normalizeBarcode(raw);
  return code.length >= 1 && code.length <= 128 && !/[\s]/.test(code);
}

// ------------------------------------------------------------------
// Inventory voice commands (Bangla + English, same pattern as the
// Phase 3 POS parser in shared/phase3.ts).
//
//   "চাল খুঁজুন" / "search rice"            -> search
//   "চাল যোগ কর" / "add rice"               -> add (opens the form)
//   "চালের স্টক ২০ কর" / "set stock rice 20" -> stock
//   "বারকোড 8901234567890 খুঁজুন"           -> search by barcode
// ------------------------------------------------------------------

export type InventoryVoiceCommand =
  | { kind: 'search'; query: string; quantity: number }
  | { kind: 'add'; query: string; quantity: number }
  | { kind: 'stock'; query: string; quantity: number }
  | { kind: 'unknown'; query: string; quantity: number };

export function parseInventoryVoiceCommand(raw: string): InventoryVoiceCommand {
  // Matching is case-insensitive, but the returned query keeps the
  // speaker's original casing so the search box shows "Phase6 Fine
  // Rice", not "phase6 fine rice".
  const rawNorm = normalizeDigits((raw || '').trim());
  const text = rawNorm.toLowerCase();
  if (!text) return { kind: 'unknown', query: '', quantity: 1 };
  // Quantity is a STANDALONE number token only ("স্টক ২০", "stock 42",
  // "2 টা চাল"). A digit glued to a word ("Phase6") is part of the
  // product name and must never be stripped — the old first-digit
  // match turned "Phase6 Fine Rice" into "Phase Fine Rice" and broke
  // both search and stock matching for such names.
  const tokens = rawNorm.split(/\s+/);
  const qtyIndex = tokens.findIndex((t) => /^\d+(?:\.\d+)?$/.test(t));
  const qtyMatch = qtyIndex >= 0 ? tokens[qtyIndex] : null;
  const quantity = qtyMatch ? Math.max(0, parseFloat(qtyMatch)) : 1;
  // Words left after removing the quantity token. Command keywords are
  // removed ONE occurrence only (String.replace without /g/): a product
  // actually named "… Stock Item" must survive "stock … Stock Item 42"
  // — the old global strip deleted the name's own word and the product
  // could never match. Standalone filler tokens (টা/টি/pcs) are dropped.
  const withoutDigits = (qtyIndex >= 0 ? tokens.filter((_, i) => i !== qtyIndex) : tokens).join(' ').trim();
  const dropTokens = (s: string) =>
    s
      .split(' ')
      .filter((t) => !['টা', 'টি', 'পিস', 'pcs', 'piece', 'pieces'].includes(t))
      .join(' ')
      .trim()
      // Bangla possessive suffix: "চালের" -> "চাল" (the product name).
      .replace(/ের$/, '');
  // A bare barcode (digits only, no product words) is a barcode search.
  if (qtyMatch && !withoutDigits) return { kind: 'search', query: qtyMatch, quantity: 1 };
  if (/খুঁজুন|খুঁজো|search|find/.test(text) || /বারকোড|barcode/.test(text)) {
    const query = dropTokens(withoutDigits.replace(/খুঁজুন|খুঁজো|search|find|বারকোড|barcode/i, ''));
    return { kind: 'search', query, quantity: 1 };
  }
  // Stock is checked before add: "চালের স্টক ২০ কর" must be a stock
  // update, not an add, even when a voice round-trip appends "যোগ কর".
  if (/স্টক|মজুদ|stock/.test(text)) {
    const query = dropTokens(withoutDigits.replace(/স্টক|মজুদ|stock/i, '').replace(/\s+(কর|করো|দাও)$/, ''));
    return { kind: 'stock', query, quantity };
  }
  if (/যোগ কর|যোগ|add/.test(text)) {
    const query = dropTokens(withoutDigits.replace(/যোগ কর|যোগ|add/i, ''));
    return { kind: 'add', query, quantity: 1 };
  }
  const query = dropTokens(withoutDigits);
  if (query) return { kind: 'search', query, quantity: 1 };
  return { kind: 'unknown', query: text, quantity: 1 };
}

/** Bangla confirmation spoken (and shown) after an inventory action. */
export function inventoryConfirmText(action: 'added' | 'stock' | 'found', name: string, stock?: number): string {
  if (action === 'added') return `${name} যোগ করা হয়েছে।`;
  if (action === 'stock') return `${name}-এর স্টক এখন ${toBanglaDigits(stock ?? 0)}টি।`;
  return `${name} পাওয়া গেছে।`;
}

// ------------------------------------------------------------------
// Bulk inventory actions (validated on BOTH client and server).
// ------------------------------------------------------------------

export type BulkAction = 'adjust-stock' | 'set-price' | 'delete';

export interface BulkRequest {
  ids: string[];
  action: BulkAction;
  /** adjust-stock only: signed delta, must keep every stock >= 0. */
  delta?: number;
  /** set-price only: new selling price, >= 0. */
  price?: number;
  /** delete only: the client must already have shown a confirmation. */
  confirmed?: boolean;
}

export function validateBulkRequest(req: BulkRequest): string | null {
  if (!Array.isArray(req.ids) || req.ids.length === 0) return 'NO_PRODUCTS_SELECTED';
  if (req.ids.length > 500) return 'TOO_MANY_PRODUCTS';
  if (req.ids.some((id) => typeof id !== 'string' || !id.trim())) return 'INVALID_PRODUCT_ID';
  if (req.action === 'adjust-stock') {
    if (typeof req.delta !== 'number' || !Number.isFinite(req.delta) || !Number.isInteger(req.delta)) {
      return 'INVALID_DELTA';
    }
  } else if (req.action === 'set-price') {
    if (typeof req.price !== 'number' || !Number.isFinite(req.price) || req.price < 0) return 'INVALID_PRICE';
  } else if (req.action === 'delete') {
    if (req.confirmed !== true) return 'DELETE_NOT_CONFIRMED';
  } else {
    return 'INVALID_ACTION';
  }
  return null;
}

/** Pure stock math for a bulk adjust: returns null when it would go negative. */
export function applyStockDelta(current: number, delta: number): number | null {
  const next = current + delta;
  return next < 0 ? null : next;
}

// ------------------------------------------------------------------
// Bounded online retry (services/api.ts). Delays are capped and the
// attempt count is bounded — retries NEVER loop forever. Only
// idempotent requests (GET / DELETE) are retried automatically; POST /
// PUT failures surface immediately with a retry path in the UI, because
// re-sending a sale or expense could duplicate money.
// ------------------------------------------------------------------

export const API_MAX_ATTEMPTS = 3;

export function apiRetryDelayMs(attempt: number): number {
  // attempt 1 (first retry) -> 150 ms, then 300 ms. Deterministic so
  // tests can assert the bound; no jitter is needed at this scale.
  return [0, 150, 300][attempt] ?? 300;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function isIdempotentMethod(method: string): boolean {
  return method === 'GET' || method === 'DELETE' || method === 'HEAD';
}
