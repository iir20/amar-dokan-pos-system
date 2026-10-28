// Phase 6 unit tests. Pure helpers are tested directly; the API retry
// rule is tested against the REAL services/api.ts with only the fetch
// transport stubbed (a labelled test double for the network, never for
// production logic) — so the attempt bounds asserted here are the
// bounds the shipped client actually uses.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeBarcode,
  isValidBarcode,
  parseInventoryVoiceCommand,
  inventoryConfirmText,
  validateBulkRequest,
  applyStockDelta,
  apiRetryDelayMs,
  isRetryableStatus,
  isIdempotentMethod,
  API_MAX_ATTEMPTS,
} from '../shared/phase6';

test('phase6 barcode: trims, rejects blank/overlong/whitespace codes', () => {
  assert.equal(normalizeBarcode('  890123  '), '890123');
  assert.equal(isValidBarcode('8901234567890'), true);
  assert.equal(isValidBarcode(''), false);
  assert.equal(isValidBarcode('   '), false);
  assert.equal(isValidBarcode('890 123'), false);
  assert.equal(isValidBarcode('x'.repeat(129)), false);
});

test('phase6 inventory voice: Bangla search, add, stock with Bangla digits, barcode search', () => {
  const search = parseInventoryVoiceCommand('চাল খুঁজুন');
  assert.equal(search.kind, 'search');
  assert.equal(search.query, 'চাল');
  const add = parseInventoryVoiceCommand('add rice');
  assert.equal(add.kind, 'add');
  assert.equal(add.query, 'rice');
  const stock = parseInventoryVoiceCommand('চালের স্টক ২০ কর');
  assert.equal(stock.kind, 'stock');
  assert.equal(stock.query, 'চাল');
  assert.equal(stock.quantity, 20);
  const barcode = parseInventoryVoiceCommand('8901234567890');
  assert.equal(barcode.kind, 'search');
  assert.equal(barcode.query, '8901234567890');
  // A digit glued to a word is part of the name, never a quantity.
  const phase6 = parseInventoryVoiceCommand('search Phase6 Fine Rice');
  assert.equal(phase6.kind, 'search');
  assert.equal(phase6.query, 'Phase6 Fine Rice');
  const phase6Stock = parseInventoryVoiceCommand('stock Phase6 Voice Stock Item 42');
  assert.equal(phase6Stock.kind, 'stock');
  assert.equal(phase6Stock.query, 'Phase6 Voice Stock Item');
  assert.equal(phase6Stock.quantity, 42);
  assert.equal(parseInventoryVoiceCommand('').kind, 'unknown');
});

test('phase6 inventory voice: Bangla confirmations mention name and stock', () => {
  assert.match(inventoryConfirmText('stock', 'চাল', 20), /চাল/);
  assert.match(inventoryConfirmText('stock', 'চাল', 20), /২০|20/);
  assert.match(inventoryConfirmText('added', 'চাল'), /যোগ/);
});

test('phase6 bulk: validation rejects empty ids, negative-result deltas are a server-side skip, delete needs confirmation', () => {
  assert.equal(validateBulkRequest({ ids: [], action: 'delete', confirmed: true }), 'NO_PRODUCTS_SELECTED');
  assert.equal(validateBulkRequest({ ids: ['p1'], action: 'delete' }), 'DELETE_NOT_CONFIRMED');
  assert.equal(validateBulkRequest({ ids: ['p1'], action: 'delete', confirmed: true }), null);
  assert.equal(validateBulkRequest({ ids: ['p1'], action: 'set-price', price: -5 }), 'INVALID_PRICE');
  assert.equal(validateBulkRequest({ ids: ['p1'], action: 'adjust-stock', delta: 1.5 }), 'INVALID_DELTA');
  assert.equal(applyStockDelta(5, -6), null);
  assert.equal(applyStockDelta(5, -5), 0);
  assert.equal(applyStockDelta(5, 3), 8);
});

test('phase6 retry bounds: max 3 attempts, capped delays, only 429/5xx retryable, only GET/DELETE idempotent', () => {
  assert.equal(API_MAX_ATTEMPTS, 3);
  assert.deepEqual([apiRetryDelayMs(1), apiRetryDelayMs(2)], [150, 300]);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(500), false);
  assert.equal(isIdempotentMethod('GET'), true);
  assert.equal(isIdempotentMethod('DELETE'), true);
  assert.equal(isIdempotentMethod('POST'), false);
  assert.equal(isIdempotentMethod('PUT'), false);
});

// --- Real api.ts retry behaviour (fetch transport stubbed) ---

function fakeResponse(status: number, body: any) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

test('phase6 api retry: GET network failures retry boundedly then succeed', async () => {
  const { api } = await import('../services/api');
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    if (calls < 3) throw new Error('network down');
    return fakeResponse(200, { ok: true });
  };
  const body = await api.get('/products');
  assert.deepEqual(body, { ok: true });
  assert.equal(calls, 3);
});

test('phase6 api retry: GET that always fails stops after exactly 3 attempts', async () => {
  const { api } = await import('../services/api');
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    throw new Error('network down');
  };
  await assert.rejects(() => api.get('/products'));
  assert.equal(calls, 3);
});

test('phase6 api retry: POST is NEVER auto-retried (money-safe)', async () => {
  const { api } = await import('../services/api');
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    throw new Error('network down');
  };
  await assert.rejects(() => api.post('/sales', { id: 'sale-1' }));
  assert.equal(calls, 1);
});

// --- Real AmarSync outbox behaviour (browser storage + transport stubbed;
// the queue logic itself is the shipped services/amarSync.ts) ---
function installBrowserStubs() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  // Node 24 exposes navigator as a getter-only global; redefine it.
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  (globalThis as any).window = { addEventListener: () => {} };
  // amarSync registers a 20 s heartbeat with setInterval at import time;
  // stub it out BEFORE the first import so the test process can exit.
  (globalThis as any).setInterval = () => 0 as any;
}

test('phase6 sync: enqueueing the same sale twice queues it exactly once', async () => {
  installBrowserStubs();
  const { enqueueOfflineSale, getOutbox } = await import('../services/amarSync');
  const sale = { id: 'sale-dedupe-1', items: [], totalAmount: 100 };
  enqueueOfflineSale(sale);
  enqueueOfflineSale(sale);
  assert.equal(getOutbox().filter((i) => i.id === 'sale-dedupe-1').length, 1);
});

test('phase6 sync: a server SALE_ID_CONFLICT counts as synced, never failed, and is not re-queued', async () => {
  installBrowserStubs();
  const { enqueueOfflineSale, flushOutbox, getOutbox } = await import('../services/amarSync');
  (globalThis as any).fetch = async () =>
    fakeResponse(409, { error: 'SALE_ID_CONFLICT', message: 'Sale already recorded' });
  enqueueOfflineSale({ id: 'sale-conflict-1', items: [], totalAmount: 100 });
  const result = await flushOutbox();
  assert.equal(result.synced, 1);
  assert.equal(result.failed, 0);
  assert.equal(getOutbox().length, 0);
});

test('phase6 api retry: GET 503 retries, then succeeds', async () => {
  const { api } = await import('../services/api');
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    return calls === 1 ? fakeResponse(503, { error: 'UNAVAILABLE' }) : fakeResponse(200, { ok: true });
  };
  const body = await api.get('/products');
  assert.deepEqual(body, { ok: true });
  assert.equal(calls, 2);
});
