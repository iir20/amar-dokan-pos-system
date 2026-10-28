// (b) Staff permission denial — staff without manage_inventory cannot
// create products: the UI hides Inventory AND the server returns 403.
import { test, expect } from '@playwright/test';
import { registerOwner, expectOk, apiJson, uid } from './helpers';

test('staff without manage_inventory is denied product creation (UI + API)', async ({ page, browser }) => {
  const owner = await registerOwner(page);
  const staffUsername = uid('e2estaff');
  await expectOk(page.request, 'POST', '/api/staff', {
    name: 'E2E Staff',
    username: staffUsername,
    pin: '5678',
    permissions: ['process_sale'],
  });

  const staffCtx = await browser.newContext();
  const staffPage = await staffCtx.newPage();
  await expectOk(staffPage.request, 'POST', '/api/auth/login', { username: staffUsername, pin: '5678' });
  await staffPage.goto('/');
  // Owner nav has Inventory; staff without the permission must not see it.
  await expect(staffPage.getByTestId('nav-inventory')).toHaveCount(0);
  // And the server must refuse regardless of what the UI shows.
  const { status, json } = await apiJson(staffPage.request, 'POST', '/api/products', {
    id: `prod-${uid('x')}`,
    name: 'Forbidden Product',
    nameBn: 'Forbidden Product',
    category: 'general',
    unit: 'pcs',
    price: 10,
    cost: 5,
    stock: 1,
  });
  expect(status).toBe(403);
  expect(json.error).toBe('FORBIDDEN');
  await staffCtx.close();
  // Control: the owner CAN create a product (proves the denial is RBAC,
  // not a broken endpoint).
  await expectOk(page.request, 'POST', '/api/products', {
    id: `prod-${uid('ok')}`,
    name: 'Owner Product',
    nameBn: 'Owner Product',
    category: 'general',
    unit: 'pcs',
    price: 10,
    cost: 5,
    stock: 1,
  });
  expect(owner.username).toBeTruthy();
});
