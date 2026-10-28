// (f) Subscription request -> admin approval -> premium plan.
// The admin is the prepared E2E admin (tests/e2e/prepare-admin.mjs);
// without it this test skips and names the missing step instead of
// inventing an admin.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { registerOwner, expectOk } from './helpers';

function readAdmin() {
  try {
    return JSON.parse(fs.readFileSync('/tmp/amar-e2e-admin.json', 'utf8'));
  } catch {
    return null;
  }
}

test('subscription request approved by admin upgrades owner to premium', async ({ page, browser }) => {
  const admin = readAdmin();
  test.skip(!admin, 'No prepared E2E admin: run `npm run test:e2e` (which runs prepare-admin.mjs) instead of bare `playwright test`.');

  const owner = await registerOwner(page);
  const request = await expectOk(page.request, 'POST', '/api/subscription-requests', {
    package: 'monthly',
    amount: 499,
    paymentNumber: '01700000000',
    trxId: 'E2ETRX001',
    status: 'pending',
    username: owner.username,
    storeName: `E2E Store ${owner.username}`,
    storeCategory: 'grocery',
  });
  expect(request.status).toBe('pending');
  // Owner is pending approval while the request is open.
  let me = await expectOk(page.request, 'GET', '/api/auth/me');
  expect(me.user.subscriptionStatus).toBe('pending_approval');

  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await expectOk(adminPage.request, 'POST', '/api/auth/login', { username: admin.username, pin: admin.pin });
  await adminPage.goto('/');
  // Admin lands on the Admin Panel (platform-admin session).
  await expect(adminPage.getByTestId('admin-tab-status')).toBeVisible();
  const approval = await expectOk(adminPage.request, 'POST', `/api/admin/subscription-requests/${request.id}/approve`);
  expect(approval.success).toBe(true);
  await adminCtx.close();

  me = await expectOk(page.request, 'GET', '/api/auth/me');
  expect(me.user.plan).toBe('premium');
  expect(me.user.subscriptionStatus).toBe('active');
});
