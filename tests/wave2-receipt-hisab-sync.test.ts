// Wave 2 (second addition) — receipt view, hisab, units, sync hardening.
//
// Pure helpers are tested directly; the hisab aggregation is the
// shipped server helper (computeHisab in server/storage.ts, imported
// with a throwaway AMAR_DATA_DIR like tests/dashboard-online-sales.test.ts
// so no real store data is touched); the AmarSync outbox is the
// shipped module run against stubbed localStorage/navigator/fetch.
// No fake production logic is used anywhere here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AMAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amar-wave2-test-'));

import {
  toBanglaDigits,
  formatTakaBn,
  normalizeUnit,
  unitLabel,
  formatQty,
  formatQtyWithUnit,
  applyStockDelta,
  recomputeReceiptTotals,
} from '../utils/currency.ts';

const { computeHisab } = await import('../server/storage.ts');

// --- Bangla numerals -------------------------------------------------

test('Bangla digits convert ASCII digits and leave separators alone', () => {
  assert.equal(toBanglaDigits(1250.5), '১২৫০.৫');
  assert.equal(toBanglaDigits('1,250.50'), '১,২৫০.৫০');
});

test('formatTakaBn renders a grouped taka amount in Bangla digits', () => {
  assert.equal(formatTakaBn(1250.5), '৳১,২৫০.৫০');
});

// --- Local units ------------------------------------------------------

test('unit spellings normalize to one canonical unit', () => {
  assert.equal(normalizeUnit('L'), 'litre');
  assert.equal(normalizeUnit('litre'), 'litre');
  assert.equal(normalizeUnit('লিটার'), 'litre');
  assert.equal(normalizeUnit('pcs'), 'piece');
  assert.equal(normalizeUnit('পিস'), 'piece');
  assert.equal(normalizeUnit('kg'), 'kg');
  assert.equal(normalizeUnit('packet'), 'packet');
  assert.equal(normalizeUnit('প্যাকেট'), 'packet');
  assert.equal(normalizeUnit('box'), 'other');
  assert.equal(unitLabel('box', 'en'), 'box');
  assert.equal(unitLabel('L', 'bn'), 'লিটার');
  assert.equal(unitLabel('pcs', 'bn'), 'পিস');
});

test('quantities print without float dust and with the Bangla label', () => {
  assert.equal(formatQty(2.5000000001), '2.5');
  assert.equal(formatQtyWithUnit(2.5, 'kg', 'en'), '2.5 kg');
  assert.equal(formatQtyWithUnit(2.5, 'kg', 'bn'), '২.৫ কেজি');
  assert.equal(formatQtyWithUnit(1, 'packet', 'bn'), '১ প্যাকেট');
});

test('fractional stock math keeps 6 decimals like the server', () => {
  assert.equal(applyStockDelta(10, -2.5), 7.5);
  assert.equal(applyStockDelta(5, -0.333333), 4.666667);
});

// --- Receipt recomputation (integer paisa) ----------------------------

const sale = {
  items: [
    { price: 80, quantity: 2.5 }, // 2.5 kg rice
    { price: 45, quantity: 2 }, // 2 packets
  ],
  subTotal: 290,
  discount: 10,
  vat: 0,
  totalAmount: 280,
  paidAmount: 300,
  cashReceived: 300,
  changeAmount: 20,
  dueAmount: 0,
};

test('receipt recomputation matches the sale exactly, including fractional kg', () => {
  const r = recomputeReceiptTotals(sale);
  assert.equal(r.subTotal, 290);
  assert.equal(r.totalAmount, 280);
  assert.equal(r.changeAmount, 20);
  assert.equal(r.dueAmount, 0);
  assert.deepEqual(r.mismatches, []);
});

test('receipt recomputation reports a stored total that disagrees with the lines', () => {
  const r = recomputeReceiptTotals({ ...sale, totalAmount: 281 });
  assert.equal(r.totalAmount, 280);
  assert.equal(r.mismatches.length, 1);
  assert.match(r.mismatches[0], /Total/);
});

test('receipt recomputation derives change from cash received when unstated', () => {
  const r = recomputeReceiptTotals({ ...sale, changeAmount: null });
  assert.equal(r.changeAmount, 20);
});

// --- Hisab (server helper) --------------------------------------------

const hisabSales = [
  { date: '2026-10-29T08:00:00.000Z', totalAmount: 500, paidAmount: 400, paymentMethod: 'cash', dueAmount: 100 },
  { date: '2026-10-29T13:00:00.000Z', totalAmount: 200, paidAmount: 200, paymentMethod: 'bkash', dueAmount: 0 },
  { date: '2026-10-28T08:00:00.000Z', totalAmount: 999, paidAmount: 999, paymentMethod: 'cash', dueAmount: 0 },
];
const hisabExpenses = [
  { date: '2026-10-29T09:00:00.000Z', amount: 150 },
  { date: '2026-10-28T09:00:00.000Z', amount: 777 },
];

test('hisab sums only the requested day, in integer paisa', () => {
  const h = computeHisab(hisabSales, hisabExpenses, '2026-10-29');
  assert.equal(h.salesCount, 2);
  assert.equal(h.salesTotal, 700);
  assert.equal(h.cashPaid, 400);
  assert.equal(h.digitalPaid, 200);
  assert.equal(h.duesCreated, 100);
  assert.equal(h.expensesTotal, 150);
  assert.equal(h.expensesCount, 1);
  assert.equal(h.cashInHand, 250); // 400 cash received - 150 expenses
  assert.equal(h.byMethod.cash, 400);
  assert.equal(h.byMethod.bkash, 200);
});

test('hisab dues outstanding covers all days but dues collected is honestly unavailable', () => {
  const h = computeHisab(hisabSales, hisabExpenses, '2026-10-29');
  assert.equal(h.duesOutstandingTotal, 100);
  assert.equal(h.duesCollected, null);
  assert.equal(h.duesCollectedAvailable, false);
});

test('hisab cash in hand goes negative rather than being floored to zero', () => {
  const h = computeHisab(
    [{ date: '2026-10-29T08:00:00.000Z', totalAmount: 100, paidAmount: 100, paymentMethod: 'cash', dueAmount: 0 }],
    [{ date: '2026-10-29T09:00:00.000Z', amount: 250 }],
    '2026-10-29',
  );
  assert.equal(h.cashInHand, -150);
});

// --- AmarSync outbox (shipped module, stubbed environment) -------------

// Stub browser globals BEFORE importing the shipped module.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => store.clear(),
};
const navStub: any = { onLine: false };
// Node 24 exposes navigator as a getter-only global; replace it via
// defineProperty instead of assignment.
Object.defineProperty(globalThis, 'navigator', { value: navStub, configurable: true });

type FetchStub = (url: string, init?: any) => Promise<any>;
const jsonResponse = (status: number, body: any) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  headers: { get: () => null },
});
let fetchImpl: FetchStub = async () => jsonResponse(200, {});
(globalThis as any).fetch = (url: string, init?: any) => fetchImpl(url, init);

const amarSync = await import('../services/amarSync.ts');

const outbox = () => amarSync.getOutbox();
const setOutbox = (items: any[]) => (globalThis as any).localStorage.setItem('amar_sync_outbox', JSON.stringify(items));
const offlineSale = (id: string) => ({
  id,
  date: '2026-10-29T08:00:00.000Z',
  items: [{ id: 'p1', name: 'Rice', price: 80, quantity: 2.5, unit: 'kg' }],
  subTotal: 200,
  discount: 0,
  vat: 0,
  totalAmount: 200,
  totalProfit: 0,
  paymentMethod: 'cash',
  paidAmount: 200,
  dueAmount: 0,
});

test('outbox enqueue dedupes by sale id — a retry never queues twice', () => {
  store.clear();
  navStub.onLine = false; // no immediate-flush timer while asserting
  amarSync.enqueueOfflineSale(offlineSale('sale-1'));
  amarSync.enqueueOfflineSale(offlineSale('sale-1'));
  assert.equal(outbox().length, 1);
  assert.equal(outbox()[0].status, 'pending');
});

test('retryFailedOutbox resets the retry budget, not just the status', () => {
  setOutbox([
    {
      id: 'sale-9',
      sale: offlineSale('sale-9'),
      queuedAt: new Date().toISOString(),
      status: 'failed',
      retryCount: 5,
      error: 'boom',
    },
  ]);
  amarSync.retryFailedOutbox();
  assert.equal(outbox()[0].status, 'pending');
  assert.equal(outbox()[0].retryCount, 0);
  assert.equal(outbox()[0].error, undefined);
});

test('retryOutboxItem retries one record and reports an unknown id', () => {
  setOutbox([
    {
      id: 'sale-9',
      sale: offlineSale('sale-9'),
      queuedAt: new Date().toISOString(),
      status: 'failed',
      retryCount: 5,
      error: 'boom',
    },
  ]);
  assert.equal(amarSync.retryOutboxItem('sale-9'), true);
  assert.equal(outbox()[0].status, 'pending');
  assert.equal(amarSync.retryOutboxItem('no-such-sale'), false);
});

test('getSyncSummary never hides queued records', () => {
  setOutbox([
    { id: 'a', sale: offlineSale('a'), queuedAt: '2026-10-29T07:00:00.000Z', status: 'pending', retryCount: 0 },
    {
      id: 'b',
      sale: offlineSale('b'),
      queuedAt: '2026-10-29T08:00:00.000Z',
      status: 'failed',
      retryCount: 5,
      error: 'down',
    },
  ]);
  const s = amarSync.getSyncSummary();
  assert.equal(s.pendingCount, 1);
  assert.equal(s.failedCount, 1);
  assert.equal(s.totalQueued, 2);
  assert.equal(s.oldestQueuedAt, '2026-10-29T07:00:00.000Z');
  assert.equal(s.lastError, 'down');
});

test('flush while offline syncs nothing and drops nothing', async () => {
  setOutbox([
    { id: 'sale-1', sale: offlineSale('sale-1'), queuedAt: new Date().toISOString(), status: 'pending', retryCount: 0 },
  ]);
  navStub.onLine = false;
  const r = await amarSync.flushOutbox();
  assert.deepEqual(r, { synced: 0, failed: 0 });
  assert.equal(outbox().length, 1);
});

test('flush syncs exactly once and empties the outbox', async () => {
  setOutbox([
    { id: 'sale-1', sale: offlineSale('sale-1'), queuedAt: new Date().toISOString(), status: 'pending', retryCount: 0 },
  ]);
  navStub.onLine = true;
  fetchImpl = async () => jsonResponse(200, { id: 'sale-1' });
  const r = await amarSync.flushOutbox();
  assert.deepEqual(r, { synced: 1, failed: 0 });
  assert.equal(outbox().length, 0);
});

test('flush counts a SALE_ID_CONFLICT as synced only, never also failed', async () => {
  setOutbox([
    { id: 'sale-1', sale: offlineSale('sale-1'), queuedAt: new Date().toISOString(), status: 'pending', retryCount: 0 },
  ]);
  navStub.onLine = true;
  fetchImpl = async () => jsonResponse(409, { error: 'SALE_ID_CONFLICT' });
  const r = await amarSync.flushOutbox();
  assert.deepEqual(r, { synced: 1, failed: 0 });
  assert.equal(outbox().length, 0);
});

test('flush keeps a genuinely failed sale queued with its error visible', async () => {
  setOutbox([
    { id: 'sale-1', sale: offlineSale('sale-1'), queuedAt: new Date().toISOString(), status: 'pending', retryCount: 0 },
  ]);
  navStub.onLine = true;
  fetchImpl = async () => {
    throw new Error('fetch failed');
  };
  const r = await amarSync.flushOutbox();
  assert.deepEqual(r, { synced: 0, failed: 1 });
  assert.equal(outbox().length, 1);
  assert.equal(outbox()[0].status, 'pending');
  assert.match(outbox()[0].error || '', /fetch failed|Could not reach|Backend unreachable/);
});
