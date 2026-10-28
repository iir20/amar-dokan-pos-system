// Phase 3 (Depth) unit tests — pure logic in shared/phase3.ts.
// Money/stock rules are proven here without a server; the E2E suite
// (tests/e2e/phase3.spec.ts) proves the same rules through the API.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forecastDemand,
  expiryAlerts,
  deadStock,
  validateCoupon,
  loyaltyEarned,
  loyaltyRedeemable,
  parseVoiceCommand,
  toBanglaDigits,
  formatBanglaTaka,
  speakItemText,
  speakTotalText,
  toCsv,
  vatReportRows,
  profitByCategoryRows,
  staffPerformanceRows,
  validateImport,
} from '../shared/phase3';

const nowIso = () => new Date().toISOString();

test('forecast: visible basis — avg daily x lead time, rounded up, minus stock', () => {
  const history = [];
  for (let i = 0; i < 10; i += 1) {
    history.push({ date: new Date(Date.now() - i * 86400000).toISOString(), quantity: 2 });
  }
  const f = forecastDemand({
    productId: 'p1',
    productName: 'Rice',
    currentStock: 5,
    history,
    windowDays: 10,
    leadTimeDays: 7,
  });
  assert.equal(f.windowQty, 20);
  assert.equal(f.avgDailySales, 2);
  assert.equal(f.leadTimeDemand, 14);
  assert.equal(f.suggestedQty, 9); // ceil(14 - 5)
  assert.match(f.basis, /Last 10 days/);
  assert.match(f.basis, /avg 2\/day/);
  assert.match(f.rule, /average daily sales/);
});

test('forecast: never suggests below zero when stock covers lead time', () => {
  const f = forecastDemand({
    productId: 'p1',
    productName: 'Rice',
    currentStock: 100,
    history: [{ date: nowIso(), quantity: 1 }],
    windowDays: 30,
    leadTimeDays: 7,
  });
  assert.equal(f.suggestedQty, 0);
});

test('forecast: sales outside the window do not count', () => {
  const f = forecastDemand({
    productId: 'p1',
    productName: 'Rice',
    currentStock: 0,
    history: [{ date: new Date(Date.now() - 40 * 86400000).toISOString(), quantity: 100 }],
    windowDays: 30,
    leadTimeDays: 7,
  });
  assert.equal(f.windowQty, 0);
  assert.equal(f.suggestedQty, 0);
});

test('expiry: 30/14/7 thresholds, severity by nearness, harmless with no dates', () => {
  const day = 86400000;
  const alerts = expiryAlerts([
    { id: 'a', name: 'A', expiryDate: new Date(Date.now() + 5 * day).toISOString().slice(0, 10) },
    { id: 'b', name: 'B', expiryDate: new Date(Date.now() + 12 * day).toISOString().slice(0, 10) },
    { id: 'c', name: 'C', expiryDate: new Date(Date.now() + 25 * day).toISOString().slice(0, 10) },
    { id: 'd', name: 'D', expiryDate: new Date(Date.now() + 90 * day).toISOString().slice(0, 10) },
    { id: 'e', name: 'E' },
    { id: 'f', name: 'F', expiryDate: new Date(Date.now() - 2 * day).toISOString().slice(0, 10) },
  ]);
  assert.deepEqual(
    alerts.map((a) => a.productId),
    ['f', 'a', 'b', 'c'],
  );
  assert.deepEqual(
    alerts.map((a) => a.severity),
    ['expired', 'critical', 'warning', 'watch'],
  );
  assert.equal(expiryAlerts([]).length, 0);
  assert.equal(expiryAlerts([{ id: 'x', name: 'X' }]).length, 0);
});

test('dead stock: no sale in window flagged, recent sale not flagged, zero stock ignored', () => {
  const items = deadStock(
    [
      { id: 'old', name: 'Old', stock: 10 },
      { id: 'new', name: 'New', stock: 10 },
      { id: 'never', name: 'Never', stock: 5 },
      { id: 'empty', name: 'Empty', stock: 0 },
    ],
    new Map([
      ['old', new Date(Date.now() - 120 * 86400000).toISOString()],
      ['new', new Date(Date.now() - 5 * 86400000).toISOString()],
    ]),
    90,
  );
  assert.deepEqual(items.map((i) => i.productId).sort(), ['never', 'old']);
  assert.match(items.find((i) => i.productId === 'old')!.suggestedAction, /ডিসকাউন্ট/);
});

test('coupon: percent and fixed math, expired/over-limit/min-purchase rejected', () => {
  const base = {
    id: 'c1',
    storeId: 's',
    code: 'SAVE10',
    type: 'percent' as const,
    value: 10,
    minPurchase: 0,
    maxUses: 0,
    usedCount: 0,
    expiresAt: null,
    active: true,
  };
  assert.deepEqual(validateCoupon(base, 1000), { valid: true, discount: 100, reason: 'OK' });
  assert.deepEqual(validateCoupon({ ...base, type: 'fixed', value: 5000 }, 1000), {
    valid: true,
    discount: 1000,
    reason: 'OK',
  });
  assert.equal(validateCoupon({ ...base, active: false }, 1000).valid, false);
  assert.equal(
    validateCoupon({ ...base, expiresAt: new Date(Date.now() - 1000).toISOString() }, 1000).reason,
    'COUPON_EXPIRED',
  );
  assert.equal(validateCoupon({ ...base, maxUses: 2, usedCount: 2 }, 1000).reason, 'COUPON_LIMIT_REACHED');
  assert.equal(validateCoupon({ ...base, minPurchase: 2000 }, 1000).reason, 'COUPON_MIN_PURCHASE');
  assert.equal(validateCoupon(null, 1000).reason, 'COUPON_NOT_FOUND');
  assert.equal(validateCoupon({ ...base, type: 'percent', value: 150 }, 1000).valid, false);
});

test('loyalty: 1 point per full 100 taka; redemption capped by balance and bill', () => {
  assert.equal(loyaltyEarned(999), 9);
  assert.equal(loyaltyEarned(100), 1);
  assert.equal(loyaltyEarned(0), 0);
  assert.deepEqual(loyaltyRedeemable(50, 30, 1000), { points: 30, discount: 30, reason: 'CAPPED_BY_BALANCE_OR_BILL' });
  assert.deepEqual(loyaltyRedeemable(50, 100, 20), { points: 20, discount: 20, reason: 'CAPPED_BY_BALANCE_OR_BILL' });
  assert.deepEqual(loyaltyRedeemable(10, 100, 1000), { points: 10, discount: 10, reason: 'OK' });
});

test('voice: Bangla/English command parsing, Bangla digits, speak texts', () => {
  assert.equal(toBanglaDigits(123), '১২৩');
  assert.equal(formatBanglaTaka(380), '৩৮০.০০ টাকা');
  assert.equal(speakItemText('চাল', 380), 'চাল, দাম ৩৮০.০০ টাকা');
  assert.equal(speakTotalText(380, 20), 'মোট ৩৮০.০০ টাকা, ফেরত ২০.০০ টাকা');
  const add = parseVoiceCommand('২ টা চাল যোগ কর');
  assert.equal(add.kind, 'add');
  assert.equal(add.quantity, 2);
  assert.match(add.query, /চাল/);
  assert.equal(parseVoiceCommand('add 3 rice').quantity, 3);
  assert.equal(parseVoiceCommand('মোট কত').kind, 'total');
  assert.equal(parseVoiceCommand('চেকআউট করো').kind, 'checkout');
  assert.equal(parseVoiceCommand('').kind, 'unknown');
});

test('exports: VAT totals, profit by category, staff performance, CSV escaping', () => {
  const sales = [
    {
      date: nowIso(),
      items: [{ category: 'grocery', price: 100, cost: 80, quantity: 2 }],
      subTotal: 200,
      discount: 0,
      vat: 10,
      totalAmount: 210,
      totalProfit: 40,
      paymentMethod: 'cash',
      servedBy: 'Owner',
    },
    {
      date: nowIso(),
      items: [{ category: 'medicine', price: 50, cost: 30, quantity: 1 }],
      subTotal: 50,
      discount: 5,
      vat: 0,
      totalAmount: 45,
      totalProfit: 20,
      paymentMethod: 'bkash',
      servedBy: 'Staff A',
    },
  ];
  const vat = vatReportRows(sales);
  assert.deepEqual(vat[vat.length - 1], ['TOTAL', 250, 5, 10, 255]);
  const profit = profitByCategoryRows(sales);
  assert.equal(profit[1][0], 'grocery');
  assert.equal(profit[1][3], 40);
  const staff = staffPerformanceRows(sales);
  assert.equal(staff.find((r) => r[0] === 'Staff A')![1], 1);
  assert.equal(toCsv([['a"b', 'x,y', 5]]), '"a""b","x,y",5\n');
});

test('import validation: never overwrites money records, skips existing ids', () => {
  const v = validateImport(
    {
      products: [{ id: 'p-new' }, { id: 'p-old' }, {}],
      suppliers: [{ id: 's-new' }],
      sales: [{ id: 'sale-1' }],
      expenses: [{ id: 'exp-1' }],
      mystery: [],
    } as any,
    {
      products: new Set(['p-old']),
      suppliers: new Set(),
      coupons: new Set(),
      branches: new Set(),
      counters: new Set(),
    },
  );
  assert.deepEqual(v.creatable.products, ['p-new']);
  assert.equal(v.counts.sales, 1);
  assert.ok(v.skips.some((s) => s.section === 'sales' && s.reason === 'MONEY_RECORD_NEVER_IMPORTED'));
  assert.ok(v.skips.some((s) => s.section === 'expenses' && s.reason === 'MONEY_RECORD_NEVER_IMPORTED'));
  assert.ok(v.skips.some((s) => s.section === 'products' && s.reason === 'ALREADY_EXISTS_NOT_OVERWRITTEN'));
  assert.ok(v.skips.some((s) => s.section === 'products' && s.reason === 'MISSING_ID'));
  assert.ok(v.errors.some((e) => e.includes('mystery')));
});
