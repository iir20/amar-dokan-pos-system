// (b) ITEM 1 — dashboard totals must include delivered online orders.
//
// Regression for the live bug where online/marketplace sales never
// reached the dashboard's overall sell total: the old dashboard summed
// only GET /api/sales (POS sales) and showed online orders in a separate
// block. GET /api/dashboard/totals is the fixed server-side aggregation
// (server/storage.ts `computeDashboardTotals`, served from
// server/routes.ts): POS sale + delivered online order, counted once.
// API-only spec (no UI testids): register owner, POS sale, marketplace
// order, advance it to delivered, then assert the totals at each stage.
import { test, expect } from '@playwright/test';
import { registerOwner, createProduct, expectOk, newIdempotencyKey, uid } from './helpers';

test('dashboard totals: delivered online order joins the overall sell total, placed order does not', async ({
  page,
  browser,
}) => {
  const owner = await registerOwner(page);
  const product = await createProduct(page, { price: 200, cost: 150, stock: 50 });

  // 1. One in-store POS sale: 1 x 200 = 200.
  const sale = await expectOk(page.request, 'POST', '/api/sales', {
    id: uid('sale'),
    items: [{ id: product.id, quantity: 1 }],
    paymentMethod: 'cash',
    cashReceived: 200,
  });
  expect(sale.totalAmount).toBe(200);

  // Dashboard totals are POS-only before any online order exists.
  let totals = await expectOk(page.request, 'GET', '/api/dashboard/totals');
  expect(totals.posTotalSales).toBe(200);
  expect(totals.onlineCompletedTotalSales).toBe(0);
  expect(totals.totalSales).toBe(200);
  expect(totals.totalCount).toBe(1);

  // 2. Marketplace order: 2 x 200 = 400 subtotal, + 50 delivery (<= 500) = 450.
  const custCtx = await browser.newContext();
  const custPage = await custCtx.newPage();
  const phone = `017${Math.floor(10000000 + Math.random() * 89999999)}`;
  await expectOk(custPage.request, 'POST', '/api/customer/register', {
    name: 'E2E Customer',
    phone,
    pin: '1111',
  });
  const orderId = newIdempotencyKey();
  const order = await expectOk(custPage.request, 'POST', '/api/marketplace/orders', {
    idempotencyKey: orderId,
    storeId: owner.userId,
    items: [{ id: product.id, quantity: 2 }],
    deliveryAddress: 'E2E Street 1, Dhaka',
    paymentMethod: 'cod',
  });
  expect(order.status).toBe('placed');
  expect(order.totalAmount).toBe(450);

  // Placed (not completed) orders must NOT inflate the headline total.
  totals = await expectOk(page.request, 'GET', '/api/dashboard/totals');
  expect(totals.totalSales).toBe(200);
  expect(totals.onlinePendingTotalSales).toBe(450);
  expect(totals.onlinePendingCount).toBe(1);

  // 3. Store advances the order to delivered.
  for (const status of ['confirmed', 'out_for_delivery', 'delivered']) {
    const updated = await expectOk(page.request, 'PUT', `/api/orders/${orderId}/status`, { status });
    expect(updated.status).toBe(status);
  }

  // Delivered order now counts — exactly once.
  totals = await expectOk(page.request, 'GET', '/api/dashboard/totals');
  expect(totals.posTotalSales).toBe(200);
  expect(totals.onlineCompletedTotalSales).toBe(450);
  expect(totals.totalSales).toBe(650);
  expect(totals.onlineCompletedCount).toBe(1);
  expect(totals.totalCount).toBe(2);
  expect(totals.onlinePendingTotalSales).toBe(0);

  // The online order never created a POS sales row, so nothing can double-count.
  const sales = await expectOk(page.request, 'GET', '/api/sales');
  expect(sales.length).toBe(1);
  expect(sales[0].id).toBe(sale.id);

  await custCtx.close();
  expect(uid('done')).toBeTruthy();
});
