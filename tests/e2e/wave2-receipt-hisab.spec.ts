// Wave 2 (second addition) — individual sale receipt view, daily
// hisab closing summary, and offline-sale receipt with exactly-once
// sync. Run by the coordinator's full gate (npm run test:e2e); this
// file is new coverage, not a replacement for offline-sync.spec.ts.
import { test, expect } from '@playwright/test';
import { registerOwner, createProduct, getSales, getProducts, expectOk } from './helpers';

async function checkoutCashSale(page: any, productId: string, paid: string) {
  await page.goto('/');
  await page.getByTestId(`pos-product-${productId}`).click();
  await page.getByTestId('pos-paid-amount').fill(paid);
  await page.getByTestId('pos-checkout').click();
  await expect(page.getByTestId('receipt-preview')).toBeVisible();
  await page.getByTestId('pos-confirm-checkout').click();
  await expect(page.getByTestId('invoice')).toBeVisible();
  // Close the checkout invoice so the reports view can be opened.
  await page.getByTestId('invoice-close').click();
}

test('sale from history opens a receipt matching the sale exactly', async ({ page }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 380, cost: 340, stock: 50 });
  await checkoutCashSale(page, product.id, '400');

  const sales = await getSales(page);
  const sale = sales.find((s: any) => s.items?.some((i: any) => i.id === product.id));
  expect(sale).toBeTruthy();
  expect(sale.totalAmount).toBe(380);
  expect(sale.changeAmount).toBe(20);

  await page.getByTestId('nav-reports').click();
  await page.getByTestId('reports-tab-history').click();
  await page.getByTestId(`history-sale-${sale.id}`).click();

  const receipt = page.getByTestId('receipt-view');
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText(product.name);
  await expect(receipt).toContainText('৳৩৮০.০০');
  await expect(receipt).toContainText('৳২০.০০');
  await expect(receipt).toContainText('Owner');
  // No mismatch banner: the receipt matches the sale exactly.
  await expect(page.getByTestId('receipt-mismatch')).toHaveCount(0);
  // Reprint + share actions exist on the history receipt.
  await expect(page.getByTestId('receipt-escpos')).toBeVisible();
  await expect(page.getByTestId('receipt-share')).toBeVisible();
  await expect(page.getByTestId('receipt-print')).toBeVisible();
});

test('hisab endpoint matches the day sales, expenses and cash in hand', async ({ page }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 380, cost: 340, stock: 50 });
  await checkoutCashSale(page, product.id, '400');
  await expectOk(page.request, 'POST', '/api/expenses', {
    description: 'Wave2 hisab expense',
    amount: 50,
    category: 'transport',
  });

  const sales = await getSales(page);
  const sale = sales.find((s: any) => s.items?.some((i: any) => i.id === product.id));
  const day = String(sale.date).slice(0, 10);
  const hisab = await expectOk(page.request, 'GET', `/api/hisab?date=${day}`);
  expect(hisab.salesCount).toBe(1);
  expect(hisab.salesTotal).toBe(380);
  // cashPaid is kept cash (paidAmount), not tendered cash: the ৳400
  // tendered for a ৳380 bill leaves ৳380 in hand after ৳20 change, so
  // cash in hand is 380 − 50 expenses = 330.
  expect(hisab.cashPaid).toBe(380);
  expect(hisab.expensesTotal).toBe(50);
  expect(hisab.cashInHand).toBe(330);
  // Dues collected is honestly unavailable until /dues/collect lands.
  expect(hisab.duesCollected).toBe(null);
  expect(hisab.duesCollectedAvailable).toBe(false);

  const bad = await page.request.fetch(`/api/hisab?date=not-a-date`);
  expect(bad.status()).toBe(400);
});

test('offline sale shows its receipt before sync and syncs exactly once', async ({ page, context }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 100, cost: 60, stock: 20 });

  await page.goto('/');
  await page.getByTestId(`pos-product-${product.id}`).click();
  await page.getByTestId('pos-paid-amount').fill('100');

  await context.setOffline(true);
  await page.getByTestId('pos-checkout').click();
  await expect(page.getByTestId('receipt-preview')).toBeVisible();
  await page.getByTestId('pos-confirm-checkout').click();
  // The checkout invoice opens for offline sales too; close it so the
  // reports view underneath is clickable.
  await expect(page.getByTestId('invoice')).toBeVisible();
  await page.getByTestId('invoice-close').click();
  await expect(page.getByTestId('sync-indicator')).toContainText('1 Unsynced');

  const outboxRaw = await page.evaluate(() => localStorage.getItem('amar_sync_outbox') || '[]');
  const pending = JSON.parse(outboxRaw).filter((i: any) => i.status === 'pending');
  expect(pending).toHaveLength(1);
  const offlineSaleId = pending[0].id;

  // History while still offline: the sale opens its receipt, flagged
  // as sync-pending — no dead end before the server has the sale.
  await page.getByTestId('nav-reports').click();
  await page.getByTestId('reports-tab-history').click();
  await expect(page.getByTestId(`history-sale-${offlineSaleId}`)).toContainText('সিঙ্ক বাকি');
  await page.getByTestId(`history-sale-${offlineSaleId}`).click();
  await expect(page.getByTestId('receipt-view')).toBeVisible();
  await expect(page.getByTestId('receipt-sync-pending')).toBeVisible();
  await expect(page.getByTestId('receipt-view')).toContainText('৳১০০.০০');
  await page.getByTestId('receipt-close').click();

  await context.setOffline(false);
  await expect(page.getByTestId('sync-indicator')).toContainText('Synced', { timeout: 30000 });

  await expect.poll(async () => {
    const sales = await getSales(page);
    return sales.filter((s: any) => s.id === offlineSaleId).length;
  }).toBe(1);
  await page.waitForTimeout(3000);
  const salesAfter = await getSales(page);
  expect(salesAfter.filter((s: any) => s.id === offlineSaleId)).toHaveLength(1);
  const products = await getProducts(page);
  expect(products.find((p: any) => p.id === product.id).stock).toBe(19);
});
