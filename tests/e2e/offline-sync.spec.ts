// (e) Offline sale -> reconnect -> sync with zero duplicate deductions.
// The sale is created offline (browser offline), queued in the AmarSync
// outbox, then flushed exactly once on reconnect: one server sale with
// the offline id, and stock deducted exactly once.
import { test, expect } from '@playwright/test';
import { registerOwner, createProduct, getSales, getProducts } from './helpers';

test('offline sale syncs exactly once on reconnect', async ({ page, context }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 100, cost: 60, stock: 20 });

  await page.goto('/');
  await page.getByTestId(`pos-product-${product.id}`).click();
  await page.getByTestId('pos-paid-amount').fill('100');

  await context.setOffline(true);
  await page.getByTestId('pos-checkout').click();
  // Phase 5 two-tap checkout: preview sheet first, then confirm queues offline.
  await expect(page.getByTestId('receipt-preview')).toBeVisible();
  await page.getByTestId('pos-confirm-checkout').click();
  // Offline notice + sync pill show the queued sale.
  await expect(page.getByTestId('sync-indicator')).toContainText('1 Unsynced');
  const outboxRaw = await page.evaluate(() => localStorage.getItem('amar_sync_outbox') || '[]');
  const outbox = JSON.parse(outboxRaw);
  const pending = outbox.filter((i: any) => i.status === 'pending');
  expect(pending).toHaveLength(1);
  const offlineSaleId = pending[0].id;

  await context.setOffline(false);
  // The online event flushes immediately; the pill must settle to Synced.
  await expect(page.getByTestId('sync-indicator')).toContainText('Synced', { timeout: 30000 });

  // Exactly one server sale with the offline id, stock deducted once.
  await expect.poll(async () => {
    const sales = await getSales(page);
    return sales.filter((s: any) => s.id === offlineSaleId).length;
  }).toBe(1);
  const sales = await getSales(page);
  const sale = sales.find((s: any) => s.id === offlineSaleId);
  expect(sale.totalAmount).toBe(100);
  const products = await getProducts(page);
  expect(products.find((p: any) => p.id === product.id).stock).toBe(19);
  // Settle: a second flush must not create a duplicate (outbox is empty).
  await page.waitForTimeout(3000);
  const salesAfter = await getSales(page);
  expect(salesAfter.filter((s: any) => s.id === offlineSaleId)).toHaveLength(1);
});
