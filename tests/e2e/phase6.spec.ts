// Phase 6 — inventory efficiency, Bangla inventory voice, barcode +
// manual entry, owner-profile regression, GuestMenu toggle drive-by,
// and a dropped-connection retry through the real UI.
import { test, expect } from '@playwright/test';
import { registerOwner, createProduct, expectOk, uid } from './helpers';

async function createBarcodeProduct(page: any, barcode: string, stock = 12) {
  const id = `prod-${uid('bc')}`;
  const name = `Barcode Item ${id.slice(-6)}`;
  return expectOk(page.request, 'POST', '/api/products', {
    id,
    name,
    nameBn: name,
    category: 'general',
    unit: 'pcs',
    price: 120,
    cost: 80,
    stock,
    barcode,
    isOnlineVisible: true,
  });
}

test('phase6 barcode: server lookup finds by printed code, 404s unknown codes', async ({ page }) => {
  await registerOwner(page);
  const product = await createBarcodeProduct(page, '8901234567890');
  const found = await expectOk(page.request, 'GET', `/api/products/barcode/8901234567890`);
  expect(found.id).toBe(product.id);
  const miss = await page.request.fetch('/api/products/barcode/0000000000000');
  expect(miss.status()).toBe(404);
});

test('phase6 inventory: instant search, low-stock list, manual barcode entry, voice text fallback', async ({
  page,
}) => {
  await registerOwner(page);
  const low = await createProduct(page, { price: 50, cost: 30, stock: 3, name: 'Phase6 Low Stock Tea' });
  const ok = await createProduct(page, { price: 90, cost: 60, stock: 40, name: 'Phase6 Fine Rice' });
  const bc = await createBarcodeProduct(page, '8909991112223', 12);
  await page.goto('/');
  await page.getByTestId('nav-inventory').click();
  await expect(page.getByTestId('inventory-search')).toBeVisible();

  // Instant filtering as you type.
  await page.getByTestId('inventory-search').fill('Low Stock Tea');
  await expect(page.getByText('Phase6 Low Stock Tea', { exact: true })).toBeVisible();
  await expect(page.getByText('Phase6 Fine Rice', { exact: true })).toHaveCount(0);
  await page.getByTestId('inventory-search').fill('');
  await expect(page.getByText('Phase6 Fine Rice', { exact: true })).toBeVisible();

  // Low-stock badge + list.
  await expect(page.getByTestId('inventory-low-stock-list')).toContainText('Phase6 Low Stock Tea');
  await page.getByTestId('inventory-low-stock-toggle').click();
  await expect(page.getByText('Phase6 Fine Rice', { exact: true })).toHaveCount(0);
  await page.getByTestId('inventory-low-stock-toggle').click();

  // Manual barcode entry (typed code, same server lookup as a scan).
  await page.getByTestId('inventory-barcode-input').fill('8909991112223');
  await page.getByTestId('inventory-barcode-lookup').click();
  await expect(page.getByTestId('inventory-barcode-result')).toContainText(bc.name);
  await page.getByTestId('inventory-barcode-input').fill('0000000000000');
  await page.getByTestId('inventory-barcode-lookup').click();
  await expect(page.getByText(/No product found for barcode/)).toBeVisible();

  // Voice text fallback: typed command searches (voice never required).
  await page.getByTestId('voice-inventory-text-input').fill('search Phase6 Fine Rice');
  await page.getByTestId('voice-inventory-text-submit').click();
  await expect(page.getByTestId('inventory-search')).toHaveValue('Phase6 Fine Rice');
  await expect(page.getByText('Phase6 Low Stock Tea', { exact: true })).toHaveCount(0);
  expect(low.id).toBeTruthy();
  expect(ok.id).toBeTruthy();
});

test('phase6 inventory voice: typed stock command updates stock, bulk adjust + price + delete work', async ({
  page,
}) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 100, cost: 70, stock: 10, name: 'Phase6 Voice Stock Item' });
  const bulk = await createProduct(page, { price: 200, cost: 150, stock: 20, name: 'Phase6 Bulk Item' });
  await page.goto('/');
  await page.getByTestId('nav-inventory').click();
  await expect(page.getByTestId('inventory-search')).toBeVisible();
  await expect(page.getByText('Phase6 Voice Stock Item', { exact: true })).toBeVisible();

  // Voice stock command (typed fallback) sets stock to 42.
  await page.getByTestId('voice-inventory-text-input').fill('stock Phase6 Voice Stock Item 42');
  await page.getByTestId('voice-inventory-text-submit').click();
  await expect
    .poll(async () => {
      const products = await expectOk(page.request, 'GET', '/api/products');
      return products.find((p: any) => p.id === product.id)?.stock;
    })
    .toBe(42);

  // Bulk stock adjust (+5) on the bulk item only.
  await page.getByTestId(`inventory-select-${bulk.id}`).check();
  await page.getByTestId('inventory-bulk-delta').fill('5');
  await page.getByTestId('inventory-bulk-adjust').click();
  await expect(page.getByTestId('inventory-bulk-message')).toContainText('1টি আপডেট');
  await expect
    .poll(async () => {
      const products = await expectOk(page.request, 'GET', '/api/products');
      return products.find((p: any) => p.id === bulk.id)?.stock;
    })
    .toBe(25);

  // Bulk price set, then bulk delete with confirmation accepted.
  await page.getByTestId(`inventory-select-${bulk.id}`).check();
  await page.getByTestId('inventory-bulk-price').fill('250');
  await page.getByTestId('inventory-bulk-price-btn').click();
  await expect(page.getByTestId('inventory-bulk-message')).toContainText('1টি আপডেট');
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByTestId(`inventory-select-${bulk.id}`).check();
  await page.getByTestId('inventory-bulk-delete').click();
  await expect
    .poll(async () => {
      const products = await expectOk(page.request, 'GET', '/api/products');
      return products.some((p: any) => p.id === bulk.id);
    })
    .toBe(false);
});

test('phase6 inventory: per-product movement history shows the stock adjustment', async ({ page }) => {
  await registerOwner(page);
  const product = await createProduct(page, { price: 80, cost: 50, stock: 10, name: 'Phase6 History Item' });
  // A stock change via the normal product save logs an adjustment.
  await expectOk(page.request, 'POST', '/api/products', { ...product, stock: 15 });
  await page.goto('/');
  await page.getByTestId('nav-inventory').click();
  await page.getByTestId(`inventory-history-${product.id}`).click();
  await expect(page.getByTestId('inventory-history-panel')).toBeVisible();
  await expect(page.getByTestId('inventory-history-panel')).toContainText('adjustment');
});

test('phase6 profile: zila/upozila/thana/phone/address/store/plan all display (regression)', async ({ page }) => {
  const owner = await registerOwner(page);
  await expectOk(page.request, 'PUT', '/api/profile', {
    address: 'Phase6 Road 1',
    phone: '01700000000',
    zila: 'Dhaka',
    upozila: 'Savar',
    thana: 'Savar Thana',
  });
  await page.goto('/');
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile-summary')).toBeVisible();
  await expect(page.getByTestId('profile-summary-store')).toContainText(`E2E Store ${owner.username}`);
  await expect(page.getByTestId('profile-summary-username')).toContainText(owner.username);
  await expect(page.getByTestId('profile-summary-plan')).toContainText('free');
  await expect(page.getByTestId('profile-summary-address')).toContainText('Phase6 Road 1');
  await expect(page.getByTestId('profile-summary-phone')).toContainText('01700000000');
  await expect(page.getByTestId('profile-summary-zila')).toContainText('Dhaka');
  await expect(page.getByTestId('profile-summary-upozila')).toContainText('Savar');
  await expect(page.getByTestId('profile-summary-thana')).toContainText('Savar Thana');
  // The edit form is prefilled with the same values (editable, not just shown).
  await expect(page.getByTestId('profile-zila-input')).toHaveValue('Dhaka');
  await expect(page.getByTestId('profile-upozila-input')).toHaveValue('Savar');
  await expect(page.getByTestId('profile-thana-input')).toHaveValue('Savar Thana');
});

test('phase6 manual no-barcode: a product without a barcode stays reachable by name search', async ({ page }) => {
  await registerOwner(page);
  await createProduct(page, { price: 60, cost: 40, stock: 8, name: 'Phase6 No Barcode Lentil' });
  await page.goto('/');
  await page.getByTestId('nav-inventory').click();
  await page.getByTestId('inventory-search').fill('No Barcode Lentil');
  await expect(page.getByText('Phase6 No Barcode Lentil', { exact: true })).toBeVisible();
});

test('phase6 guest menu: language toggle flips the guest menu language', async ({ page, browser }) => {
  const owner = await registerOwner(page, { storeCategory: 'restaurant' });
  const product = await createProduct(page, { price: 150, cost: 100, stock: 20 });
  const table = await expectOk(page.request, 'POST', '/api/restaurant/tables', { name: 'Phase6 Table' });
  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  await guestPage.goto(`/?tableId=${table.id}&storeId=${owner.userId}`);
  await expect(guestPage.getByTestId('guest-lang-toggle')).toBeVisible();
  const before = await guestPage.getByTestId('guest-lang-toggle').innerText();
  await guestPage.getByTestId('guest-lang-toggle').click();
  const after = await guestPage.getByTestId('guest-lang-toggle').innerText();
  expect(after).not.toBe(before);
  expect(product.id).toBeTruthy();
  await guestCtx.close();
});

test('phase6 online reliability: a dropped first inventory request retries and still loads', async ({ page }) => {
  await registerOwner(page);
  await createProduct(page, { price: 70, cost: 45, stock: 9, name: 'Phase6 Retry Item' });
  await page.goto('/');
  // POS loads first (proves the session and catalog work before the drop).
  await expect(page.getByText('Phase6 Retry Item', { exact: true }).first()).toBeVisible();
  let calls = 0;
  await page.route('**/api/products', async (route) => {
    calls++;
    if (calls === 1) {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.getByTestId('nav-inventory').click();
  // The inventory fetch is aborted (dropped connection); the bounded GET
  // retry in services/api.ts must recover and render the product row.
  await expect(page.locator('table').getByText('Phase6 Retry Item', { exact: true })).toBeVisible({ timeout: 15000 });
  expect(calls).toBeGreaterThanOrEqual(2);
  await page.unroute('**/api/products');
});
