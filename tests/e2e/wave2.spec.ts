// Wave 2 — branch management in profile, settings screen, dashboard
// headline totals, and mic-denial guidance. Browser-level checks for
// the parts node unit tests cannot reach (localStorage-backed settings
// toggles, rendered panels). Run by the coordinator's Playwright gate.
import { test, expect } from '@playwright/test';
import { registerOwner, expectOk, uid } from './helpers';

test('wave2 settings: voice/sound toggles persist in localStorage', async ({ page }) => {
  await registerOwner(page);
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  // Defaults are on.
  await expect(page.getByTestId('settings-voice-toggle')).toBeChecked();
  await expect(page.getByTestId('settings-sound-toggle')).toBeChecked();
  await page.getByTestId('settings-voice-toggle').uncheck();
  await page.getByTestId('settings-sound-toggle').uncheck();
  expect(await page.evaluate(() => localStorage.getItem('amar-voice-confirm'))).toBe('false');
  expect(await page.evaluate(() => localStorage.getItem('amar-sound-confirm'))).toBe('false');
  // Theme + font-scale toggles persist and apply immediately.
  await page.getByTestId('settings-theme-dark').click();
  expect(await page.evaluate(() => localStorage.getItem('amar-theme'))).toBe('dark');
  await page.getByTestId('settings-font-large').click();
  expect(await page.evaluate(() => localStorage.getItem('amar-font-scale'))).toBe('large');
  await expect(page.getByTestId('settings-sync-status')).toBeVisible();
});

test('wave2 branches: add via profile, guarded delete refuses a stocked branch', async ({ page }) => {
  await registerOwner(page);
  const branch = await expectOk(page.request, 'POST', '/api/branches', {
    name: `Wave2 Branch ${uid('br').slice(-6)}`,
  });
  await expectOk(page.request, 'POST', '/api/products', {
    id: `prod-${uid('br')}`,
    name: 'Wave2 Branch Stock',
    nameBn: '',
    category: 'general',
    unit: 'pcs',
    price: 100,
    cost: 50,
    stock: 4,
    branchId: branch.id,
  });
  // Server-level guard: DELETE must be refused, naming the blocker.
  const refused = await page.request.delete(`/api/branches/${branch.id}`);
  expect(refused.status()).toBe(409);
  const body = await refused.json();
  expect(body.error).toBe('BRANCH_NOT_EMPTY');
  expect(body.message).toMatch(/product/);
  // The branch is still there, and the profile panel lists it.
  await page.goto('/');
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('branch-manager')).toBeVisible();
  await expect(page.getByTestId('branch-manager')).toContainText(branch.name);
  // An empty branch deletes cleanly.
  const empty = await expectOk(page.request, 'POST', '/api/branches', {
    name: `Wave2 Empty ${uid('br').slice(-6)}`,
  });
  const deleted = await page.request.delete(`/api/branches/${empty.id}`);
  expect(deleted.status()).toBe(200);
});

test('wave2 dashboard: headline total comes from the server totals endpoint', async ({ page }) => {
  await registerOwner(page);
  const totals = await expectOk(page.request, 'GET', '/api/dashboard/totals');
  expect(typeof totals.totalSales).toBe('number');
  expect(typeof totals.onlineCompletedTotalSales).toBe('number');
  expect(typeof totals.onlinePendingTotalSales).toBe('number');
  await page.goto('/');
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-headline-total')).toBeVisible();
  await expect(page.getByTestId('dashboard-headline-total')).toContainText(
    `৳${totals.totalSales.toLocaleString()}`,
  );
});

test('wave2 voice: typed fallback stays visible on both voice panels', async ({ page }) => {
  await registerOwner(page);
  await page.goto('/');
  await page.getByTestId('nav-pos').click();
  await expect(page.getByTestId('voice-text-input')).toBeVisible();
  await page.getByTestId('nav-inventory').click();
  await expect(page.getByTestId('voice-inventory-text-input')).toBeVisible();
});
