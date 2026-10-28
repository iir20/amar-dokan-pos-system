// (c) Marketplace order lifecycle: server prices, stock deduct on order,
// status advance, stock restock on cancel.
import { test, expect } from '@playwright/test';
import { registerOwner, createProduct, expectOk, getProducts, newIdempotencyKey, uid } from './helpers';

test('marketplace order: deduct on order, advance, restock on cancel', async ({ page, browser }) => {
  const owner = await registerOwner(page);
  const product = await createProduct(page, { price: 200, cost: 150, stock: 10 });

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
  // Server prices: 2 x 200 = 400 subtotal, + 50 delivery (subtotal <= 500).
  expect(order.totalAmount).toBe(450);
  expect(order.items[0].price).toBe(200);

  // Stock deducted transactionally at order time.
  let products = await getProducts(page);
  expect(products.find((p: any) => p.id === product.id).stock).toBe(8);

  // Store advances the order, then cancels: cancellation restocks.
  await expectOk(page.request, 'PUT', `/api/orders/${orderId}/status`, { status: 'confirmed' });
  let mine = await expectOk(custPage.request, 'GET', '/api/marketplace/orders/mine');
  expect(mine.find((o: any) => o.id === orderId).status).toBe('confirmed');
  await expectOk(page.request, 'PUT', `/api/orders/${orderId}/status`, { status: 'cancelled' });
  mine = await expectOk(custPage.request, 'GET', '/api/marketplace/orders/mine');
  expect(mine.find((o: any) => o.id === orderId).status).toBe('cancelled');
  products = await getProducts(page);
  expect(products.find((p: any) => p.id === product.id).stock).toBe(10);

  // Idempotency: replaying the same order key returns the original order,
  // it does not create a second order or deduct stock again.
  const replay = await expectOk(custPage.request, 'POST', '/api/marketplace/orders', {
    idempotencyKey: orderId,
    storeId: owner.userId,
    items: [{ id: product.id, quantity: 2 }],
    deliveryAddress: 'E2E Street 1, Dhaka',
    paymentMethod: 'cod',
  });
  expect(replay.id).toBe(orderId);
  products = await getProducts(page);
  expect(products.find((p: any) => p.id === product.id).stock).toBe(10);
  await custCtx.close();
  expect(uid('done')).toBeTruthy();
});
