// Phase 4 — bKash/Nagad callback flow (flag-gated, signature-verified).
//
// STATUS, stated honestly:
// - This module implements the complete callback flow the Phase 1 spec
//   (docs/gateway-callback-spec.md) required: HMAC signature verification,
//   idempotent capture, refunds, and a gateway-vs-ledger reconciliation
//   report that LISTS mismatches and never drops them.
// - It is DISABLED unless AMAR_GATEWAY_CALLBACKS_ENABLED=true AND the
//   per-gateway callback secret is configured. Without credentials the
//   callback routes answer 503 GATEWAY_NOT_CONFIGURED and nothing is
//   captured. No real gateway credentials exist in this sandbox, so live
//   gateway verification stays UNVERIFIED (see docs/gateway-callback-spec.md
//   credentials checklist); the code path itself is proven by unit tests
//   against self-generated HMAC vectors with known keys, plus a live
//   HTTP proof with a dev-only test secret.
// - The old format-check-only endpoint POST /api/payments/verify-gateway
//   is deliberately NOT wired into capture: it never contacts a gateway
//   and its `verified` fields stay false. Settlement still records an
//   operator-supplied gatewayTrxId as opaque metadata only.
//
// MONEY RULES: amounts here are integer paisa (minor units: ৳1 = 100).
// The ledger's PaymentIntent amounts are in taka (major units); the
// reconciliation report converts minor -> major at exactly 2 decimals
// and reports any difference as a mismatch, never silently rounding it
// away.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type GatewayName = 'bkash' | 'nagad';
export type GatewayIntentStatus = 'pending' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';

export interface GatewayIntent {
  id: string;
  storeId: string;
  gateway: GatewayName;
  amountMinor: number;
  merchantRef: string;
  gatewayTrxId: string | null;
  status: GatewayIntentStatus;
  capturedAmountMinor: number;
  refundedAmountMinor: number;
  audit: Array<{ at: string; event: string; detail: Record<string, unknown> }>;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayRefund {
  id: string;
  intentId: string;
  refundRef: string;
  amountMinor: number;
  createdAt: string;
}

export class GatewayError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function gatewayCallbacksEnabled(): boolean {
  return process.env.AMAR_GATEWAY_CALLBACKS_ENABLED === 'true';
}

export function gatewaySecret(gateway: GatewayName): string | undefined {
  const value = gateway === 'bkash' ? process.env.AMAR_BKASH_CALLBACK_SECRET : process.env.AMAR_NAGAD_CALLBACK_SECRET;
  return value && value.length >= 16 ? value : undefined;
}

// --- Signature ---------------------------------------------------------
// Header: `x-gateway-signature: sha256=<hex hmac-sha256 of raw body>`.
// Compared with timingSafeEqual. Any missing/malformed input, or a
// missing secret, verifies as false — never as true.
export function verifyCallbackSignature(
  gateway: GatewayName,
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
): boolean {
  const secret = gatewaySecret(gateway);
  if (!secret || !signatureHeader) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(match[1].toLowerCase());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Test/dev helper: sign a body the same way a gateway would.
export function signCallbackBody(gateway: GatewayName, rawBody: Buffer | string): string {
  const secret = gatewaySecret(gateway);
  if (!secret) throw new GatewayError('GATEWAY_NOT_CONFIGURED', 'No callback secret configured for this gateway.', 503);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

// --- Durable intent store (same directory convention as durableStore) --
function dataDir(): string {
  return process.env.AMAR_DATA_DIR ? path.resolve(process.env.AMAR_DATA_DIR) : path.resolve(process.cwd(), 'data');
}

function storePath(): string {
  return path.join(dataDir(), 'gateway-intents.json');
}

interface GatewayStoreFile {
  intents: GatewayIntent[];
  refunds: GatewayRefund[];
}

function loadStore(): GatewayStoreFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as GatewayStoreFile;
    if (parsed && Array.isArray(parsed.intents) && Array.isArray(parsed.refunds)) return parsed;
  } catch {}
  return { intents: [], refunds: [] };
}

function saveStore(store: GatewayStoreFile): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${storePath()}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, storePath());
}

function audit(intent: GatewayIntent, event: string, detail: Record<string, unknown>): void {
  intent.audit.push({ at: new Date().toISOString(), event, detail });
  intent.updatedAt = new Date().toISOString();
}

export function listGatewayIntents(storeId: string): GatewayIntent[] {
  return loadStore().intents.filter((i) => i.storeId === storeId);
}

export function getGatewayIntent(storeId: string, id: string): GatewayIntent | null {
  return loadStore().intents.find((i) => i.storeId === storeId && i.id === id) || null;
}

export function createGatewayIntent(
  storeId: string,
  gateway: GatewayName,
  amountMinor: number,
  merchantRef: string,
): GatewayIntent {
  if (gateway !== 'bkash' && gateway !== 'nagad') {
    throw new GatewayError('INVALID_GATEWAY', 'Gateway must be bkash or nagad.');
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new GatewayError('INVALID_AMOUNT', 'Amount must be a positive integer number of paisa.');
  }
  if (typeof merchantRef !== 'string' || !merchantRef.trim() || merchantRef.length > 128) {
    throw new GatewayError('INVALID_MERCHANT_REF', 'A merchant reference is required.');
  }
  const store = loadStore();
  const existing = store.intents.find((i) => i.merchantRef === merchantRef.trim());
  if (existing) {
    if (existing.storeId === storeId && existing.gateway === gateway && existing.amountMinor === amountMinor) {
      return existing; // idempotent re-creation of the same intent
    }
    throw new GatewayError('MERCHANT_REF_TAKEN', 'This merchant reference is already used by a different intent.', 409);
  }
  const now = new Date().toISOString();
  const intent: GatewayIntent = {
    id: crypto.randomUUID(),
    storeId,
    gateway,
    amountMinor,
    merchantRef: merchantRef.trim(),
    gatewayTrxId: null,
    status: 'pending',
    capturedAmountMinor: 0,
    refundedAmountMinor: 0,
    audit: [{ at: now, event: 'intent_created', detail: { gateway, amountMinor } }],
    createdAt: now,
    updatedAt: now,
  };
  store.intents.push(intent);
  saveStore(store);
  return intent;
}

export type CallbackOutcome =
  | 'captured'
  | 'already_captured'
  | 'failed'
  | 'amount_mismatch'
  | 'gateway_trx_mismatch'
  | 'unknown_reference'
  | 'invalid_status';

export interface CallbackPayload {
  merchantRef: string;
  gatewayTrxId: string;
  amountMinor: number;
  status: string;
}

// Applies one gateway callback. Idempotent by construction: a repeated
// callback for the same transaction returns the already-recorded outcome
// and never double-captures; a conflicting callback never overwrites a
// captured intent. Mismatches are recorded in the audit trail and
// returned as outcomes — never dropped.
export function applyGatewayCallback(
  gateway: GatewayName,
  payload: CallbackPayload,
): { intent: GatewayIntent | null; outcome: CallbackOutcome } {
  const store = loadStore();
  const intent = store.intents.find((i) => i.gateway === gateway && i.merchantRef === payload.merchantRef) || null;
  if (!intent) return { intent: null, outcome: 'unknown_reference' };
  if (typeof payload.gatewayTrxId !== 'string' || !payload.gatewayTrxId.trim()) {
    return { intent, outcome: 'invalid_status' };
  }
  if (!Number.isSafeInteger(payload.amountMinor) || payload.amountMinor < 0) {
    return { intent, outcome: 'invalid_status' };
  }
  const trxId = payload.gatewayTrxId.trim();
  if (intent.status === 'captured' || intent.status === 'partially_refunded' || intent.status === 'refunded') {
    if (intent.gatewayTrxId !== trxId) {
      audit(intent, 'callback_conflict', { gatewayTrxId: trxId, reason: 'different transaction id than captured' });
      saveStore(store);
      return { intent, outcome: 'gateway_trx_mismatch' };
    }
    audit(intent, 'callback_replay', { gatewayTrxId: trxId, status: payload.status });
    saveStore(store);
    return { intent, outcome: 'already_captured' };
  }
  if (payload.status === 'completed' || payload.status === 'success') {
    if (payload.amountMinor !== intent.amountMinor) {
      audit(intent, 'callback_amount_mismatch', {
        gatewayTrxId: trxId,
        expectedMinor: intent.amountMinor,
        receivedMinor: payload.amountMinor,
      });
      saveStore(store);
      return { intent, outcome: 'amount_mismatch' };
    }
    intent.status = 'captured';
    intent.gatewayTrxId = trxId;
    intent.capturedAmountMinor = intent.amountMinor;
    audit(intent, 'captured', { gatewayTrxId: trxId, amountMinor: payload.amountMinor });
    saveStore(store);
    return { intent, outcome: 'captured' };
  }
  if (payload.status === 'failed' || payload.status === 'cancelled') {
    intent.status = 'failed';
    intent.gatewayTrxId = trxId;
    audit(intent, 'callback_failed', { gatewayTrxId: trxId });
    saveStore(store);
    return { intent, outcome: 'failed' };
  }
  return { intent, outcome: 'invalid_status' };
}

export function createGatewayRefund(
  storeId: string,
  intentId: string,
  refundRef: string,
  amountMinor: number,
): { intent: GatewayIntent; refund: GatewayRefund } {
  if (typeof refundRef !== 'string' || !refundRef.trim() || refundRef.length > 128) {
    throw new GatewayError('INVALID_REFUND_REF', 'A refund reference is required.');
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new GatewayError('INVALID_AMOUNT', 'Refund amount must be a positive integer number of paisa.');
  }
  const store = loadStore();
  const existingRefund = store.refunds.find((r) => r.refundRef === refundRef.trim());
  if (existingRefund) {
    const intent = store.intents.find((i) => i.id === existingRefund.intentId) || null;
    if (!intent || intent.storeId !== storeId) {
      throw new GatewayError('REFUND_NOT_FOUND', 'Refund reference already used by a different store.', 409);
    }
    return { intent, refund: existingRefund }; // idempotent replay
  }
  const intent = store.intents.find((i) => i.id === intentId && i.storeId === storeId) || null;
  if (!intent) throw new GatewayError('INTENT_NOT_FOUND', 'Gateway intent not found in this store.', 404);
  if (intent.status !== 'captured' && intent.status !== 'partially_refunded') {
    throw new GatewayError('REFUND_NOT_CAPTURED', 'Only a captured payment can be refunded.', 409);
  }
  const remaining = intent.capturedAmountMinor - intent.refundedAmountMinor;
  if (amountMinor > remaining) {
    throw new GatewayError('REFUND_EXCEEDS_CAPTURED', 'Refund exceeds the unrefunded captured amount.', 409);
  }
  const refund: GatewayRefund = {
    id: crypto.randomUUID(),
    intentId: intent.id,
    refundRef: refundRef.trim(),
    amountMinor,
    createdAt: new Date().toISOString(),
  };
  store.refunds.push(refund);
  intent.refundedAmountMinor += amountMinor;
  intent.status = intent.refundedAmountMinor >= intent.capturedAmountMinor ? 'refunded' : 'partially_refunded';
  audit(intent, 'refunded', { refundRef: refund.refundRef, amountMinor });
  saveStore(store);
  return { intent, refund };
}

// --- Reconciliation ------------------------------------------------------
// Compares captured gateway intents against ledger PaymentIntents
// (matched on gatewayTrxId). Every discrepancy is returned as a
// mismatch entry; nothing is dropped or auto-corrected.
export interface LedgerEntry {
  id: string;
  gatewayTrxId: string | null;
  paidAmount: number; // taka (major units)
  status: string;
}

export interface ReconciliationMismatch {
  type: 'captured_without_ledger' | 'ledger_without_gateway_intent' | 'amount_mismatch';
  intentId: string | null;
  ledgerId: string | null;
  gatewayTrxId: string | null;
  gatewayAmountMinor: number | null;
  ledgerAmountMajor: number | null;
  detail: string;
}

export function reconcileGatewayVsLedger(
  storeId: string,
  ledger: LedgerEntry[],
): { checkedAt: string; intentsChecked: number; ledgerChecked: number; mismatches: ReconciliationMismatch[] } {
  const intents = listGatewayIntents(storeId).filter(
    (i) => i.status === 'captured' || i.status === 'partially_refunded' || i.status === 'refunded',
  );
  const mismatches: ReconciliationMismatch[] = [];
  const ledgerByTrx = new Map<string, LedgerEntry>();
  for (const entry of ledger) {
    if (entry.gatewayTrxId) ledgerByTrx.set(entry.gatewayTrxId, entry);
  }
  const matchedLedgerIds = new Set<string>();
  for (const intent of intents) {
    if (!intent.gatewayTrxId) {
      mismatches.push({
        type: 'captured_without_ledger',
        intentId: intent.id,
        ledgerId: null,
        gatewayTrxId: null,
        gatewayAmountMinor: intent.amountMinor,
        ledgerAmountMajor: null,
        detail: 'Captured intent has no gateway transaction id, so no ledger entry can match it.',
      });
      continue;
    }
    const entry = ledgerByTrx.get(intent.gatewayTrxId);
    if (!entry) {
      mismatches.push({
        type: 'captured_without_ledger',
        intentId: intent.id,
        ledgerId: null,
        gatewayTrxId: intent.gatewayTrxId,
        gatewayAmountMinor: intent.amountMinor,
        ledgerAmountMajor: null,
        detail: 'Gateway says captured but no ledger PaymentIntent carries this transaction id.',
      });
      continue;
    }
    matchedLedgerIds.add(entry.id);
    const ledgerMinor = Math.round(entry.paidAmount * 100);
    if (ledgerMinor !== intent.amountMinor) {
      mismatches.push({
        type: 'amount_mismatch',
        intentId: intent.id,
        ledgerId: entry.id,
        gatewayTrxId: intent.gatewayTrxId,
        gatewayAmountMinor: intent.amountMinor,
        ledgerAmountMajor: entry.paidAmount,
        detail: `Gateway amount ${intent.amountMinor} paisa != ledger paid amount ${entry.paidAmount} taka.`,
      });
    }
  }
  for (const entry of ledger) {
    if (entry.status !== 'captured') continue;
    if (!entry.gatewayTrxId) continue;
    if (matchedLedgerIds.has(entry.id)) continue;
    mismatches.push({
      type: 'ledger_without_gateway_intent',
      intentId: null,
      ledgerId: entry.id,
      gatewayTrxId: entry.gatewayTrxId,
      gatewayAmountMinor: null,
      ledgerAmountMajor: entry.paidAmount,
      detail: 'Ledger shows a captured payment with a gateway transaction id that matches no gateway intent.',
    });
  }
  return {
    checkedAt: new Date().toISOString(),
    intentsChecked: intents.length,
    ledgerChecked: ledger.length,
    mismatches,
  };
}
