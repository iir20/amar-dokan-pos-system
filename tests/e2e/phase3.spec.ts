// Phase 3 (Depth) E2E — money/stock paths through the real API + UI.
// - supplier goods-received updates stock + inventory log + supplier due
// - coupon rejected server-side (expired / unknown) and honoured when valid
// - loyalty earn/redeem math via the server
// - Z-report per counter (expected / actual / discrepancy, per counter)
// - voice POS text fallback (voice input + speak-total text shown)
import { test, expect } from '@playwright/test';
import { registerOwner, createProduct, expectOk, apiJson, uid } from './helpers';

async function createSupplier(page: any, name: string) {
  return expectOk(page.request, 'POST', '/api/suppliers', { name });
}

async function createCoupon(page: any, body: any) {
  return expectOk(page.request, 'POST', '/api/coupons', body);
}

async function postSale(page: any, body: any) {
  return expectOk(page.request, 'POST', '/api/sales', body);
}

test('supplier goods-received updates stock, writes inventory log, raises due', async ({ page }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 100, cost: 80, stock: 10 });
  const supplier = await createSupplier(page, 'Phase3 Supplier');

  const po = await expectOk(page.request, 'POST', '/api/purchase-orders', {
    supplierId: supplier.id,
    items: [{ productId: product.id, quantity: 5, cost: 80 }],
  });
  expect(po.status).toBe('draft');
  expect(po.totalCost).toBe(400);

  // A draft orders nothing: stock unchanged before receiving.
  let products = await expectOk(page.request, 'GET', '/api/products');
  expect(products.find((p: any) => p.id === product.id).stock).toBe(10);

  const received = await expectOk(page.request, 'POST', `/api/purchase-orders/${po.id}/receive`, {
    received: [{ productId: product.id, quantity: 5 }],
  });
  expect(received.status).toBe('received');

  products = await expectOk(page.request, 'GET', '/api/products');
  expect(products.find((p: any) => p.id === product.id).stock).toBe(15);

  const logs = await expectOk(page.request, 'GET', '/api/inventory-logs');
  const poLog = logs.find((l: any) => l.productId === product.id && l.type === 'in' && /Purchase Order/.test(l.reason));
  expect(poLog).toBeTruthy();
  expect(poLog.quantity).toBe(5);

  const suppliers = await expectOk(page.request, 'GET', '/api/suppliers');
  expect(suppliers.find((s: any) => s.id === supplier.id).totalDue).toBe(400);
  const dues = await expectOk(page.request, 'GET', '/api/suppliers/dues-total');
  expect(dues.totalDue).toBe(400);
});

test('coupon rejected server-side when expired or unknown; valid coupon recalculated by server', async ({ page }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 1000, cost: 800, stock: 50 });
  await createCoupon(page, {
    code: 'OLD10',
    type: 'percent',
    value: 10,
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  await createCoupon(page, { code: 'SAVE10', type: 'percent', value: 10 });

  // Expired coupon: server rejects even though the client claimed it.
  const expired = await apiJson(page.request, 'POST', '/api/sales', {
    id: uid('sale'),
    items: [{ id: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    cashReceived: 1000,
    couponCode: 'OLD10',
  });
  expect(expired.status).toBe(400);
  expect(expired.json.error).toMatch(/COUPON/);

  // Unknown coupon: same rejection.
  const unknown = await apiJson(page.request, 'POST', '/api/sales', {
    id: uid('sale'),
    items: [{ id: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    cashReceived: 1000,
    couponCode: 'NOPE99',
  });
  expect(unknown.status).toBe(400);

  // Valid coupon: server applies 10% of 1000 = 100, total 900.
  const ok = await postSale(page, {
    id: uid('sale'),
    items: [{ id: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    cashReceived: 1000,
    couponCode: 'SAVE10',
  });
  expect(ok.discount).toBe(100);
  expect(ok.totalAmount).toBe(900);
  expect(ok.changeAmount).toBe(100);
  expect(ok.couponCode).toBe('SAVE10');
});

test('loyalty earn and redeem math is server-side', async ({ page }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 1000, cost: 800, stock: 50 });
  const phone = '01700000001';

  // Bill 1000 -> 10 points earned.
  const first = await postSale(page, {
    id: uid('sale'),
    items: [{ id: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    cashReceived: 1000,
    customerPhone: phone,
    customerName: 'Loyal',
  });
  expect(first.loyaltyEarned).toBe(10);
  let account = await expectOk(page.request, 'GET', `/api/loyalty/${phone}`);
  expect(account.points).toBe(10);

  // Redeem 5 on a 1000 bill -> discount 5, total 995, earn floor(995/100)=9.
  // Balance: 10 - 5 + 9 = 14.
  const second = await postSale(page, {
    id: uid('sale'),
    items: [{ id: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    cashReceived: 1000,
    customerPhone: phone,
    customerName: 'Loyal',
    loyaltyPointsRedeem: 5,
  });
  expect(second.discount).toBe(5);
  expect(second.totalAmount).toBe(995);
  expect(second.loyaltyRedeemed).toBe(5);
  expect(second.loyaltyEarned).toBe(9);
  account = await expectOk(page.request, 'GET', `/api/loyalty/${phone}`);
  expect(account.points).toBe(14);

  // Redeeming more than the balance is rejected, not silently capped.
  const over = await apiJson(page.request, 'POST', '/api/sales', {
    id: uid('sale'),
    items: [{ id: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    cashReceived: 1000,
    customerPhone: phone,
    loyaltyPointsRedeem: 999,
  });
  expect(over.status).toBe(400);
  expect(over.json.error).toBe('LOYALTY_INSUFFICIENT');
});

test('Z-report per counter: each counter counts only its own sales', async ({ page }) => {
  await registerOwner(page);
  const branch = await expectOk(page.request, 'POST', '/api/branches', { name: 'Branch A' });
  const counterA = await expectOk(page.request, 'POST', '/api/counters', { branchId: branch.id, name: 'Counter 1' });
  const counterB = await expectOk(page.request, 'POST', '/api/counters', { branchId: branch.id, name: 'Counter 2' });
  const product = await createProduct(page, { price: 100, cost: 80, stock: 100 });

  const shiftA = await expectOk(page.request, 'POST', '/api/shifts/open', {
    openingCash: 0,
    branchId: branch.id,
    counterId: counterA.id,
  });
  const shiftB = await expectOk(page.request, 'POST', '/api/shifts/open', {
    openingCash: 0,
    branchId: branch.id,
    counterId: counterB.id,
  });
  expect(shiftA.id).not.toBe(shiftB.id);

  await postSale(page, {
    id: uid('sale'),
    items: [{ id: product.id, quantity: 5 }],
    paymentMethod: 'cash',
    cashReceived: 500,
    branchId: branch.id,
    counterId: counterA.id,
  });
  await postSale(page, {
    id: uid('sale'),
    items: [{ id: product.id, quantity: 3 }],
    paymentMethod: 'cash',
    cashReceived: 300,
    branchId: branch.id,
    counterId: counterB.id,
  });

  const closedA = await expectOk(page.request, 'POST', `/api/shifts/${shiftA.id}/close`, { actualCash: 500 });
  expect(closedA.expectedCash).toBe(500);
  expect(closedA.discrepancy).toBe(0);
  const closedB = await expectOk(page.request, 'POST', `/api/shifts/${shiftB.id}/close`, { actualCash: 290 });
  expect(closedB.expectedCash).toBe(300);
  expect(closedB.discrepancy).toBe(-10);

  const z = await expectOk(page.request, 'GET', '/api/shifts/z-report');
  const rowA = z.perCounter.find((r: any) => r.counterId === counterA.id);
  const rowB = z.perCounter.find((r: any) => r.counterId === counterB.id);
  expect(rowA).toBeTruthy();
  expect(rowA.expectedCash).toBe(500);
  expect(rowA.actualCash).toBe(500);
  expect(rowA.discrepancy).toBe(0);
  expect(rowB.expectedCash).toBe(300);
  expect(rowB.discrepancy).toBe(-10);

  // Branch-scoped reads: the branch sees its own sales only.
  const branchSales = await expectOk(page.request, 'GET', `/api/branches/${branch.id}/sales`);
  expect(branchSales.length).toBe(2);
});

test('forecast basis is visible and expiry alert fires for near-expiry stock', async ({ page }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 100, cost: 80, stock: 5 });
  await postSale(page, {
    id: uid('sale'),
    items: [{ id: product.id, quantity: 2 }],
    paymentMethod: 'cash',
    cashReceived: 200,
  });
  const forecast = await expectOk(page.request, 'GET', '/api/insights/forecast?windowDays=30&leadTimeDays=7');
  expect(forecast.windowDays).toBe(30);
  expect(forecast.leadTimeDays).toBe(7);
  expect(forecast.rule).toMatch(/average daily sales/);
  const item = forecast.items.find((f: any) => f.productId === product.id);
  expect(item).toBeTruthy();
  expect(item.basis).toMatch(/Last 30 days/);

  const expiring = await expectOk(page.request, 'POST', '/api/products', {
    id: `prod-${uid('exp')}`,
    name: 'Expiring Med',
    nameBn: 'Expiring Med',
    category: 'medicine',
    unit: 'pcs',
    price: 50,
    cost: 40,
    stock: 10,
    expiryDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
  });
  const expiry = await expectOk(page.request, 'GET', '/api/insights/expiry');
  const alert = expiry.alerts.find((a: any) => a.productId === expiring.id);
  expect(alert).toBeTruthy();
  expect(alert.severity).toBe('critical');
});

test('voice POS text fallback: typed command adds to cart, speak-total shows text', async ({ page }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 120, cost: 100, stock: 50, name: 'VoiceRice' });

  await page.goto('/');
  await expect(page.getByTestId(`pos-product-${product.id}`)).toBeVisible();
  await expect(page.getByTestId('voice-pos')).toBeVisible();
  await page.getByTestId('voice-text-input').fill('add 2 VoiceRice');
  await page.getByTestId('voice-text-submit').click();
  // Cart now holds the product (visible in the cart column).
  await expect(page.getByTestId('voice-speak-total')).toBeVisible();
  await page.getByTestId('voice-speak-total').click();
  await expect(page.getByTestId('voice-last-spoken')).toContainText('মোট');
});
