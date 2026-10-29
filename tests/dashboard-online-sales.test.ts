// ITEM 1 regression tests — dashboard totals must include completed
// (delivered) online/marketplace orders.
//
// BEFORE the fix, the dashboard's overall sell total summed only the
// `sales` table (in-store POS sales): components/Dashboard.tsx summed
// GET /api/sales into `stats.totalSales` and kept marketplace orders in
// a separate online-only block, and no server endpoint aggregated the
// two record sets. These tests pin the fixed server-side aggregation
// (`computeDashboardTotals` in server/storage.ts, served by
// GET /api/dashboard/totals): delivered online orders count, pending
// and cancelled ones do not, and an order is never counted twice.
//
// The aggregation helper is pure; it is imported from server/storage.ts
// with a throwaway AMAR_DATA_DIR (same pattern as tests/phase4.test.ts)
// so no real store data or database is touched. No fake production
// logic is used here — the helper under test is the shipped code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AMAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amar-dashboard-test-'));

const { computeDashboardTotals, Storage } = await import('../server/storage.ts');

test('dashboard totals: a delivered online order appears in the overall sell total', () => {
  const totals = computeDashboardTotals(
    [{ id: 'sale-1', totalAmount: 200, dueAmount: 0 }],
    [{ id: 'order-1', totalAmount: 450, status: 'delivered' }],
  );
  assert.equal(totals.posTotalSales, 200);
  assert.equal(totals.onlineCompletedTotalSales, 450);
  assert.equal(totals.totalSales, 650);
  assert.equal(totals.posCount, 1);
  assert.equal(totals.onlineCompletedCount, 1);
  assert.equal(totals.totalCount, 2);
  assert.equal(totals.onlinePendingTotalSales, 0);
  assert.equal(totals.duplicateOnlineIdsSkipped, 0);
});

test('dashboard totals: placed/confirmed/out-for-delivery orders are pending, never in the total', () => {
  const totals = computeDashboardTotals(
    [{ id: 'sale-1', totalAmount: 200, dueAmount: 0 }],
    [
      { id: 'order-placed', totalAmount: 100, status: 'placed' },
      { id: 'order-confirmed', totalAmount: 150, status: 'confirmed' },
      { id: 'order-shipping', totalAmount: 250, status: 'out_for_delivery' },
    ],
  );
  // The headline total is still POS-only until an order is delivered.
  assert.equal(totals.totalSales, 200);
  assert.equal(totals.onlineCompletedTotalSales, 0);
  assert.equal(totals.onlineCompletedCount, 0);
  // ...but the pending value is visible separately, not silently dropped.
  assert.equal(totals.onlinePendingTotalSales, 500);
  assert.equal(totals.onlinePendingCount, 3);
  assert.equal(totals.totalCount, 1);
});

test('dashboard totals: cancelled online orders never count', () => {
  const totals = computeDashboardTotals(
    [{ id: 'sale-1', totalAmount: 200, dueAmount: 0 }],
    [
      { id: 'order-cancelled', totalAmount: 999, status: 'cancelled' },
      { id: 'order-delivered', totalAmount: 450, status: 'delivered' },
    ],
  );
  assert.equal(totals.totalSales, 650);
  assert.equal(totals.onlineCancelledCount, 1);
  assert.equal(totals.onlinePendingTotalSales, 0);
});

test('dashboard totals: an order also present in the sales list counts exactly once', () => {
  const totals = computeDashboardTotals(
    [{ id: 'shared-id', totalAmount: 300, dueAmount: 0 }],
    [{ id: 'shared-id', totalAmount: 300, status: 'delivered' }],
  );
  assert.equal(totals.totalSales, 300);
  assert.equal(totals.onlineCompletedCount, 0);
  assert.equal(totals.duplicateOnlineIdsSkipped, 1);
  assert.equal(totals.totalCount, 1);
});

test('dashboard totals: integer-paisa math, no float drift (100.10 + 50.20 = 150.30)', () => {
  const totals = computeDashboardTotals(
    [{ id: 'sale-1', totalAmount: 100.1, dueAmount: 0 }],
    [{ id: 'order-1', totalAmount: 50.2, status: 'delivered' }],
  );
  assert.equal(totals.totalSales, 150.3);
  assert.equal(totals.posTotalSales, 100.1);
  assert.equal(totals.onlineCompletedTotalSales, 50.2);
});

test('dashboard totals: POS due passes through; a delivered COD order adds no due', () => {
  const totals = computeDashboardTotals(
    [{ id: 'sale-1', totalAmount: 500, dueAmount: 120 }],
    [{ id: 'order-1', totalAmount: 450, status: 'delivered' }],
  );
  assert.equal(totals.totalSales, 950);
  assert.equal(totals.totalDue, 120);
});

test('dashboard totals: empty store is all zeros via the storage aggregation path', async () => {
  const totals = await Storage.getDashboardTotals('store-that-does-not-exist');
  assert.equal(totals.totalSales, 0);
  assert.equal(totals.posTotalSales, 0);
  assert.equal(totals.onlineCompletedTotalSales, 0);
  assert.equal(totals.totalCount, 0);
  assert.equal(totals.onlinePendingCount, 0);
  assert.equal(totals.onlineCancelledCount, 0);
});
