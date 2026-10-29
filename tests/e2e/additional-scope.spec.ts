// ADDITIONAL SCOPE — full daily-flow E2E, run while ONLINE only.
// (The coordinator runs this; this worker does NOT run the full
// Playwright suite, per the task's process rule.)
//
// Flow, in shopkeeper order: open shop (register + land on POS) ->
// add a product manually -> add a product by voice (typed-fallback
// path, because a headless browser has no microphone; the typed text
// goes through the same parser and the same confirmation screen as
// speech) -> sell one product in full -> sell one on dues (customer
// name required, partial payment) -> dashboard headline total equals
// the two server-recalculated sale totals, including the delivered-
// online total rule (no online orders here, so the delivered-online
// part is ৳0 and the headline is exactly the POS total).
// A second spec proves the safety rules: an unclear voice command and
// a discarded confirmation never create a product, and a manual form
// error is shown inline instead of silently doing nothing.
import { test, expect } from '@playwright/test';
import { registerOwner, getProducts, getSales, uid } from './helpers';

async function openManualAddForm(page: any) {
  await page.getByTestId('nav-inventory').click();
  await expect(page.getByTestId('inventory-search')).toBeVisible();
  await page.getByRole('button', { name: 'পণ্য যোগ', exact: true }).first().click();
  await expect(page.getByTestId('inventory-form-name')).toBeVisible();
}

test('additional daily flow online: manual add + voice add + sell + dues + dashboard total', async ({ page }) => {
  await registerOwner(page);
  await page.goto('/');
  // Open shop: the owner lands on POS by default.
  await page.getByTestId('nav-pos').click();

  // 1. Manual add (fully usable without voice or camera).
  const manualName = `Daily Manual ${uid('m').slice(-6)}`;
  await openManualAddForm(page);
  await page.getByTestId('inventory-form-name').fill(manualName);
  await page.getByTestId('inventory-form-stock').fill('50');
  await page.getByTestId('inventory-form-unit').fill('pcs');
  await page.getByTestId('inventory-form-category').fill('grocery');
  await page.getByTestId('inventory-form-cost').fill('60');
  await page.getByTestId('inventory-form-price').fill('100');
  await page.getByTestId('inventory-form-save').click();
  await expect(page.getByText(manualName, { exact: true })).toBeVisible();

  // Smart-defaults check: the next form starts with the last category/unit.
  await page.getByRole('button', { name: 'পণ্য যোগ', exact: true }).first().click();
  await expect(page.getByTestId('inventory-form-category')).toHaveValue('grocery');
  await expect(page.getByTestId('inventory-form-unit')).toHaveValue('pcs');
  await page.getByTestId('inventory-form-cancel').click();

  // 2. Voice add via the typed fallback (no mic in headless browsers):
  // typed command -> confirmation screen -> explicit Save.
  const voiceName = `Daily Voice ${uid('v').slice(-6)}`;
  await page.getByTestId('inventory-voice-add-open').click();
  await page.getByTestId('voice-add-text-input').fill(`add ${voiceName} price 90 stock 25 category grocery`);
  await page.getByTestId('voice-add-text-submit').click();
  await expect(page.getByTestId('voice-add-confirmation')).toBeVisible();
  await expect(page.getByTestId('voice-add-confirm-name')).toContainText(voiceName);
  await expect(page.getByTestId('voice-add-confirm-price')).toContainText('90');
  await expect(page.getByTestId('voice-add-confirm-stock')).toContainText('25');
  // Nothing is saved before the confirmation Save: the API list must
  // not contain the voice product yet.
  let products = await getProducts(page);
  expect(products.some((p: any) => p.name === voiceName)).toBe(false);
  await page.getByTestId('voice-add-save').click();
  await expect(page.getByTestId('voice-add-saved')).toBeVisible();
  await expect(page.getByText(voiceName, { exact: true })).toBeVisible();

  // 3. Sell the manual product in full: 1 x 100, paid 100.
  products = await getProducts(page);
  const manual = products.find((p: any) => p.name === manualName);
  expect(manual).toBeTruthy();
  await page.getByTestId('nav-pos').click();
  await page.getByTestId(`pos-product-${manual.id}`).click();
  await page.getByTestId('pos-paid-amount').fill('100');
  await page.getByTestId('pos-checkout').click();
  await expect(page.getByTestId('receipt-preview')).toBeVisible();
  await page.getByTestId('pos-confirm-checkout').click();
  await expect(page.getByTestId('invoice')).toBeVisible();
  await page.getByRole('button', { name: 'বন্ধ করুন' }).click();

  // 4. Record dues: same product, paid 40 of 100, customer name given.
  await page.getByTestId(`pos-product-${manual.id}`).click();
  await page.getByPlaceholder('ক্রেতার নাম').fill('Due Customer');
  await page.getByTestId('pos-paid-amount').fill('40');
  await page.getByTestId('pos-checkout').click();
  await expect(page.getByTestId('receipt-preview')).toBeVisible();
  await page.getByTestId('pos-confirm-checkout').click();
  await expect(page.getByTestId('invoice')).toBeVisible();
  // Close the dues-sale invoice before navigating: the modal overlay
  // otherwise covers the nav and the dashboard click can never land.
  await page.getByTestId('invoice-close').click();

  // Server side: two sales, totals recalculated by the server.
  const sales = await getSales(page);
  const full = sales.find((s: any) => s.dueAmount === 0 && s.totalAmount === 100);
  const due = sales.find((s: any) => s.dueAmount === 60 && s.totalAmount === 100);
  expect(full).toBeTruthy();
  expect(due).toBeTruthy();
  expect(due.customerName).toBe('Due Customer');

  // 5. Dashboard: headline = POS total (100 + 100), delivered online ৳0.
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-headline-total')).toContainText('৳200');
  const totals = await page.request.fetch('/api/dashboard/totals').then((r: any) => r.json());
  expect(totals.totalSales).toBe(200);
  expect(totals.onlineCompletedTotalSales).toBe(0);

  // 6. About is reachable from the main menu and shows the tour.
  await page.getByTestId('nav-about').click();
  await expect(page.getByTestId('about-screen')).toBeVisible();
  await expect(page.getByTestId('about-screen')).toContainText('POS');
  await expect(page.getByTestId('about-screen')).toContainText('ইনভেন্টরি');
  await expect(page.getByTestId('about-screen')).toContainText('ড্যাশবোর্ড');
});

test('additional safety: unclear voice command and discarded draft never create a product; manual barcode error is visible', async ({
  page,
}) => {
  await registerOwner(page);
  await page.goto('/');
  await page.getByTestId('nav-inventory').click();
  await expect(page.getByTestId('inventory-search')).toBeVisible();
  const before = await getProducts(page);

  // Unclear voice command: no confirmation, no product.
  await page.getByTestId('inventory-voice-add-open').click();
  await page.getByTestId('voice-add-text-input').fill('যোগ কর');
  await page.getByTestId('voice-add-text-submit').click();
  await expect(page.getByTestId('voice-add-error')).toBeVisible();
  await expect(page.getByTestId('voice-add-confirmation')).toHaveCount(0);

  // Valid command, then Discard: confirmation shown, nothing saved.
  const discardedName = `Discarded ${uid('d').slice(-6)}`;
  await page.getByTestId('voice-add-text-input').fill(`add ${discardedName} price 50 stock 10 category grocery`);
  await page.getByTestId('voice-add-text-submit').click();
  await expect(page.getByTestId('voice-add-confirmation')).toBeVisible();
  await page.getByTestId('voice-add-cancel').click();
  let products = await getProducts(page);
  expect(products.some((p: any) => p.name === discardedName)).toBe(false);

  // Manual form: a barcode with a space fails with a visible inline
  // error and creates nothing (no silent no-op).
  await openManualAddForm(page);
  await page.getByTestId('inventory-form-name').fill(`Bad Barcode ${uid('b').slice(-6)}`);
  await page.getByTestId('inventory-form-stock').fill('5');
  await page.getByTestId('inventory-form-cost').fill('10');
  await page.getByTestId('inventory-form-price').fill('20');
  await page.getByTestId('inventory-form-barcode').fill('has space');
  await page.getByTestId('inventory-form-save').click();
  await expect(page.getByTestId('inventory-form-error-barcode')).toBeVisible();
  products = await getProducts(page);
  expect(products.length).toBe(before.length);
});
