// (d) Guest QR order -> KDS -> settlement -> receipt (sale record).
// The guest uses the public QR link (no session); the owner drives the
// kitchen display and settles the bill in cash.
import { test, expect } from '@playwright/test';
import { registerOwner, createProduct, expectOk } from './helpers';

test('guest QR order flows through KDS to settlement and a sale receipt', async ({ page, browser }) => {
  const owner = await registerOwner(page, { storeCategory: 'restaurant' });
  const product = await createProduct(page, { price: 150, cost: 100, stock: 20 });
  const table = await expectOk(page.request, 'POST', '/api/restaurant/tables', { name: 'E2E Table 1' });

  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  await guestPage.goto(`/?tableId=${table.id}&storeId=${owner.userId}`);
  await guestPage.getByTestId(`guest-add-${product.id}`).click();
  // ADD opens the cart bottom-sheet itself (GuestMenu addToCart), so the
  // Place Order button is already reachable — no separate cart click.
  await guestPage.getByTestId('guest-place-order').click();
  // The order must reach the owner's kitchen queue (asserted via API, then
  // driven through the KDS UI below — the guest view itself is incidental).
  const guestOrders = await expectOk(page.request, 'GET', '/api/restaurant/guest-orders');
  const order = guestOrders.find((o: any) => o.tableId === table.id);
  expect(order).toBeTruthy();
  expect(order.status).toBe('pending');

  // Owner kitchen display: accept -> cook -> ready, then settle in cash.
  await page.goto('/');
  await page.getByTestId('nav-kitchen').click();
  const card = page.getByTestId(`kds-order-${order.id}`);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Accept' }).click();
  await card.getByRole('button', { name: /Start Cooking/ }).click();
  await card.getByRole('button', { name: /Mark Ready/ }).click();
  await page.getByTestId(`kds-settle-${order.id}`).click();
  await page.getByTestId('settle-confirm').click();

  // Settlement closes the order as served and creates the sale receipt.
  await expect.poll(async () => {
    const orders = await expectOk(page.request, 'GET', '/api/restaurant/guest-orders');
    return orders.find((o: any) => o.id === order.id)?.status;
  }).toBe('served');
  const sales = await expectOk(page.request, 'GET', '/api/sales');
  const receipt = sales.find((s: any) => s.id === `sale-${order.id.slice(-8)}`);
  expect(receipt).toBeTruthy();
  // Settlement math: order subtotal 150 + the modal's default 5% VAT
  // (round(150 * 0.05) = 8) = 158. The VAT default lives in
  // RestaurantSettlementModal (vatRate initial state 5).
  expect(receipt.subTotal).toBe(150);
  expect(receipt.vat).toBe(8);
  expect(receipt.totalAmount).toBe(158);
  await guestCtx.close();
});
