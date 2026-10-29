// Distinctive Features track (2026-10-29) unit tests. Pure logic only:
// yesterday summary, bazar list, credit score, voice-toggle rule and
// CODE_128 printability. The sticker SVG itself is proven scannable
// in tests/distinctive-barcode.test.ts (encode -> decode round-trip).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeYesterdaySummary,
  buildBazarList,
  bazarListText,
  computeCreditScore,
  voiceAnnouncementEnabled,
  isPrintableCode128,
} from '../shared/distinctive';

test('distinctive briefing: yesterday profit uses only yesterday sales and expenses', () => {
  const now = new Date(2026, 9, 29, 9, 0, 0); // 29 Oct 2026 local
  const sales = [
    { date: '2026-10-28T10:00:00', totalAmount: 1000, totalProfit: 300, dueAmount: 0 },
    { date: '2026-10-28T18:00:00', totalAmount: 500, totalProfit: 150, dueAmount: 200 },
    { date: '2026-10-29T09:00:00', totalAmount: 9999, totalProfit: 9999, dueAmount: 0 },
  ];
  const expenses = [
    { date: '2026-10-28T12:00:00', amount: 100 },
    { date: '2026-10-29T08:00:00', amount: 7777 },
  ];
  const y = computeYesterdaySummary(sales, expenses, now);
  assert.equal(y.dateKey, '2026-10-28');
  assert.equal(y.salesTotal, 1500);
  assert.equal(y.grossProfit, 450);
  assert.equal(y.expenses, 100);
  assert.equal(y.netProfit, 350);
  assert.equal(y.saleCount, 2);
});

test('distinctive bazar: forecast + low stock merged, deduplicated, basis shown', () => {
  const products = [
    { id: 'p1', name: 'Rice', nameBn: 'চাল', stock: 3, unit: 'kg', price: 70 },
    { id: 'p2', name: 'Oil', nameBn: 'তেল', stock: 50, unit: 'L', price: 180 },
    { id: 'p3', name: 'Salt', nameBn: 'লবণ', stock: 20, unit: 'kg', price: 40 },
  ];
  const forecast = [
    { productId: 'p1', suggestedQty: 12 },
    { productId: 'p2', suggestedQty: 5 },
    { productId: 'p3', suggestedQty: 0 },
  ];
  const list = buildBazarList(products, forecast);
  assert.equal(list.length, 2);
  const rice = list.find((i) => i.productId === 'p1')!;
  assert.equal(rice.qty, 12); // forecast wins over the top-up
  assert.equal(rice.reason, 'both');
  const oil = list.find((i) => i.productId === 'p2')!;
  assert.equal(oil.qty, 5);
  assert.equal(oil.reason, 'forecast');
  // Low stock with no forecast need tops up to the threshold.
  const lowOnly = buildBazarList(
    [{ id: 'p9', name: 'Sugar', stock: 4, unit: 'kg', price: 90 }],
    [],
  );
  assert.equal(lowOnly[0].qty, 6);
  assert.equal(lowOnly[0].reason, 'low-stock');
  assert.equal(lowOnly[0].estCost, 540);
  assert.match(bazarListText([{ name: 'চাল', qty: 12, unit: 'kg' }]), /চাল — 12 kg/);
});

test('distinctive credit score: transparent, paid ratio + ageing, no history is null', () => {
  assert.equal(computeCreditScore([]), null);
  const good = computeCreditScore([
    { totalAmount: 1000, paidAmount: 1000, dueAmount: 0, date: '2026-10-20T10:00:00' },
    { totalAmount: 500, paidAmount: 500, dueAmount: 0, date: '2026-10-25T10:00:00' },
  ])!;
  assert.equal(good.score, 100);
  assert.equal(good.band, 'good');
  assert.equal(good.basis.paidRatio, 1);
  assert.equal(good.basis.oldestDueDays, 0);
  const now = new Date('2026-10-29T09:00:00');
  const risky = computeCreditScore(
    [
      { totalAmount: 1000, paidAmount: 200, dueAmount: 800, date: '2026-08-01T10:00:00' },
      { totalAmount: 1000, paidAmount: 1000, dueAmount: 0, date: '2026-10-20T10:00:00' },
    ],
    now,
  )!;
  // paid 1200/2000 = 0.6 -> 36 pts; oldest due 88 days -> ~0.9 pts; total ~37.
  assert.equal(risky.basis.totalBills, 2);
  assert.equal(risky.basis.dueBills, 1);
  assert.equal(risky.basis.totalDue, 800);
  assert.equal(risky.basis.oldestDueDays, 88);
  assert.ok(risky.score < 50);
  assert.equal(risky.band, 'caution');
  assert.match(risky.formula, /60/);
});

test('distinctive voice toggle: unset means on, only explicit false turns it off', () => {
  assert.equal(voiceAnnouncementEnabled(null), true);
  assert.equal(voiceAnnouncementEnabled('true'), true);
  assert.equal(voiceAnnouncementEnabled('false'), false);
  assert.equal(voiceAnnouncementEnabled(''), false);
});

test('distinctive barcode printability: ASCII only, rejects blank/overlong/non-ASCII', () => {
  assert.equal(isPrintableCode128('8901234567890'), true);
  assert.equal(isPrintableCode128('AMAR-001'), true);
  assert.equal(isPrintableCode128(''), false);
  assert.equal(isPrintableCode128('চাল'), false);
  assert.equal(isPrintableCode128('x'.repeat(81)), false);
});
