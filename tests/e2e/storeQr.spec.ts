// Per-store Smart QR E2E (fallback store): owner Store QR screen,
// public storefront isolation (A's code shows only A's visible
// products), guest pickup order through the existing guest-order
// pipeline (server total, tableId null, KDS queue), unknown code
// not-found, and the offline panel on API failure (route abort stands
// in for a dead connection — the app shell is already loaded, so the
// fetch failure, not a browser navigation error, is what is proven).
import { test, expect } from '@playwright/test';
import { registerOwner, createProduct, expectOk } from './helpers';

test('store QR screen shows the owner store link, and the storefront orders a pickup', async ({ page, browser }) => {
  // Restaurant owner so the Kitchen nav (restaurant-only) exists for
  // the KDS assertion at the end; the storefront itself is
  // category-independent.
  const owner = await registerOwner(page, { storeCategory: 'restaurant' });
  const product = await createProduct(page, { price: 150, cost: 100, stock: 20, name: 'QR Pickles' });
  const hidden = await createProduct(page, {
    price: 999,
    cost: 10,
    stock: 5,
    isOnlineVisible: false,
    name: 'QR Hidden',
  });

  // A second store's product must never leak into the first storefront.
  const otherCtx = await browser.newContext();
  const otherPage = await otherCtx.newPage();
  await registerOwner(otherPage, { storeCategory: 'grocery' });
  const otherProduct = await createProduct(otherPage, { price: 200, cost: 10, stock: 5, name: 'QR Other Store' });
  await otherCtx.close();

  const qr = await expectOk(page.request, 'POST', '/api/store-qr', {});
  expect(qr.storeCode).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  const code = qr.storeCode as string;

  // Owner Store QR screen (Profile, owner only).
  await page.goto('/');
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('store-qr-screen')).toBeVisible();
  await expect(page.getByTestId('store-qr-url')).toContainText(`/s/${code}`);

  // Public storefront as a guest (fresh context, no session).
  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  await guestPage.goto(`/s/${code}`);
  await expect(guestPage.getByTestId('storefront-name')).toBeVisible();
  await expect(guestPage.getByTestId('storefront-name')).toContainText('E2E Store');
  await expect(guestPage.getByTestId(`storefront-add-${product.id}`)).toBeVisible();
  await expect(guestPage.getByTestId(`storefront-add-${hidden.id}`)).toHaveCount(0);
  await expect(guestPage.getByTestId(`storefront-add-${otherProduct.id}`)).toHaveCount(0);

  await guestPage.getByTestId(`storefront-add-${product.id}`).click();
  await guestPage.getByTestId('storefront-place-order').click();
  await expect(guestPage.getByTestId('storefront-order-confirmation')).toBeVisible();
  await expect(guestPage.getByTestId('storefront-order-confirmation')).toContainText('150');

  // The order reached the owner's guest-order queue as a pickup
  // order (no table), pending, with the server-computed total.
  const guestOrders = await expectOk(page.request, 'GET', '/api/restaurant/guest-orders');
  const order = guestOrders.find((o: any) => o.storeId === owner.userId && o.tableId === null);
  expect(order).toBeTruthy();
  expect(order.status).toBe('pending');
  expect(order.totalAmount).toBe(150);

  // And it shows in the KDS queue (labelled Pickup there).
  await page.goto('/');
  await page.getByTestId('nav-kitchen').click();
  await expect(page.getByTestId(`kds-order-${order.id}`)).toBeVisible();

  await guestCtx.close();
});

test('storefront unknown code shows not-found, never another store', async ({ browser }) => {
  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  await guestPage.goto('/s/0000000000000000');
  await expect(guestPage.getByTestId('storefront-not-found')).toBeVisible();
  await expect(guestPage.getByTestId('storefront-screen')).toHaveCount(0);
  await guestCtx.close();
});

test('storefront API failure shows the offline panel, never a wrong store', async ({ browser }) => {
  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  await guestPage.route('**/api/public/store/code/**', (route) => route.abort());
  await guestPage.goto('/s/1111111111111111');
  await expect(guestPage.getByTestId('storefront-offline')).toBeVisible();
  await expect(guestPage.getByTestId('storefront-not-found')).toHaveCount(0);
  await guestCtx.close();
});
