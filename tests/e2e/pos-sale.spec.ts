// (a) Owner sale with cash change — UI checkout, server-recalculated totals.
import { test, expect } from '@playwright/test';
import { registerOwner, createProduct, getSales, getProducts } from './helpers';

test('owner sale with cash change: UI checkout, server totals, stock deduct', async ({ page }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 380, cost: 340, stock: 50 });

  await page.goto('/');
  // POS is the default view for an owner.
  await page.getByTestId(`pos-product-${product.id}`).click();
  await expect(page.getByTestId('pos-change')).toContainText('৳0.00');
  await page.getByTestId('pos-paid-amount').fill('400');
  await expect(page.getByTestId('pos-change')).toContainText('৳20.00');
  await page.getByTestId('pos-checkout').click();
  // Phase 5 two-tap checkout: tap 1 opens the receipt preview sheet,
  // tap 2 confirms. Assertions below are unchanged (invoice + server math).
  await expect(page.getByTestId('receipt-preview')).toBeVisible();
  await expect(page.getByTestId('checkout-sheet-total')).toContainText('৩৮০');
  await page.getByTestId('pos-confirm-checkout').click();

  // Invoice modal shows the server-saved sale with the change.
  await expect(page.getByTestId('invoice')).toBeVisible();
  await expect(page.getByTestId('invoice')).toContainText('৳২০.০০');

  // Server side: totals recalculated by the server, stock deducted once.
  const sales = await getSales(page);
  const sale = sales.find((s: any) => s.items?.some((i: any) => i.id === product.id));
  expect(sale).toBeTruthy();
  expect(sale.totalAmount).toBe(380);
  expect(sale.cashReceived).toBe(400);
  expect(sale.changeAmount).toBe(20);
  expect(sale.totalProfit).toBe(40);
  const products = await getProducts(page);
  expect(products.find((p: any) => p.id === product.id).stock).toBe(49);
});
