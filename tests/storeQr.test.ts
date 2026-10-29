// Per-store Smart QR tests: URL parsing, public-view stripping, and
// the store boundary both ways (A's code → only A, B's code → only
// B, unknown code → nothing). Uses a throwaway AMAR_DATA_DIR and the
// fallback store (MemStorage) — the same contract the PostgreSQL
// wrapper re-implements; the PG path itself is an owner-checklist
// item until the PG E2E suite runs against it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AMAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amar-storeqr-test-'));

const { parseStoreQrUrl, extractStoreCodeFromPath, buildStoreQrUrl, isValidStoreCode, generateStoreCode } =
  await import('../services/storeQr.ts');
const { publicStoreView, publicProductList } = await import('../server/publicView.ts');
const { MemStorage } = await import('../server/memStorage.ts');
const { Storage } = await import('../server/storage.ts');

const CODE_A = 'a1b2c3d4e5f60718';

test('storeQr parse: a /s/<code> URL (any origin) resolves to its code', () => {
  assert.equal(parseStoreQrUrl(`https://shop.example/s/${CODE_A}`), CODE_A);
  assert.equal(parseStoreQrUrl(`http://127.0.0.1:3201/s/${CODE_A}`), CODE_A);
  assert.equal(parseStoreQrUrl(`/s/${CODE_A}`), CODE_A);
  assert.equal(parseStoreQrUrl(`/s/${CODE_A}/`), CODE_A);
});

test('storeQr parse: anything that is not a store QR URL is null, never a guessed store', () => {
  assert.equal(parseStoreQrUrl(''), null);
  assert.equal(parseStoreQrUrl('not a url'), null);
  assert.equal(parseStoreQrUrl(CODE_A), null); // bare code, no /s/ path
  assert.equal(parseStoreQrUrl(`https://shop.example/?tableId=abc&storeId=xyz`), null); // table QR
  assert.equal(parseStoreQrUrl(`https://shop.example/s/${CODE_A}?x=1`), CODE_A); // query params ignored, path code rules
  assert.equal(parseStoreQrUrl(`https://shop.example/s/${CODE_A}/extra`), null); // extra segment
  assert.equal(parseStoreQrUrl(`https://shop.example/s/short`), null); // too short
  assert.equal(parseStoreQrUrl(`https://shop.example/stores/${CODE_A}`), null); // wrong path
  assert.equal(parseStoreQrUrl(null), null);
  assert.equal(extractStoreCodeFromPath('/s/'), null);
});

test('storeQr helpers: code format, URL building, generated codes are random and unique', () => {
  assert.equal(isValidStoreCode(CODE_A), true);
  assert.equal(isValidStoreCode('abc'), false);
  assert.equal(isValidStoreCode('a b c d e f g h'), false);
  assert.equal(buildStoreQrUrl('https://shop.example/', CODE_A), `https://shop.example/s/${CODE_A}`);
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const code = generateStoreCode();
    assert.equal(isValidStoreCode(code), true);
    assert.ok(!seen.has(code), 'generated codes must not repeat');
    seen.add(code);
  }
});

test('storeQr public view: the storefront exposes only public fields', () => {
  const view = publicStoreView({
    id: 'owner-1',
    storeCode: CODE_A,
    storeName: 'Shop A',
    storeCategory: 'grocery',
    username: 'shopa',
    pin: 'hashed-pin',
    plan: 'premium',
    subscriptionStatus: 'active',
    failedLoginAttempts: 0,
    isLocked: false,
    address: 'Main Road',
    phone: '01700000000',
    zila: 'Dhaka',
    upozila: null,
    thana: null,
    profilePicture: null,
  });
  assert.equal(view.storeName, 'Shop A');
  assert.equal(view.storeCode, CODE_A);
  assert.equal(view.address, 'Main Road');
  assert.ok(!('id' in view), 'internal owner id must not leak');
  assert.ok(!('username' in view), 'username must not leak');
  assert.ok(!('pin' in view), 'pin must not leak');
  assert.ok(!('plan' in view), 'plan must not leak');
  assert.ok(!('failedLoginAttempts' in view), 'security fields must not leak');
  const products = publicProductList([{ id: 'p1', name: 'Rice', price: 100, cost: 80, storeId: 'owner-1' }]);
  assert.equal((products[0] as any).price, 100);
  assert.ok(!('cost' in (products[0] as any)), 'cost must be stripped from public products');
});

async function makeStore(storeName: string) {
  return MemStorage.createUser({
    storeName,
    storeCategory: 'grocery',
    username: `qr-${storeName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pin: 'x',
  } as any);
}

async function makeProduct(storeId: string, id: string, price: number, visible = true) {
  const { product } = await MemStorage.upsertProduct(
    {
      id,
      name: `QR ${id}`,
      nameBn: '',
      price,
      cost: Math.round(price / 2),
      category: 'general',
      stock: 50,
      unit: 'pcs',
      isOnlineVisible: visible,
    } as any,
    storeId,
  );
  return product;
}

test('storeQr boundary: A code returns only A, B code returns only B, unknown returns nothing', async () => {
  const storeA = await makeStore('StoreA');
  const storeB = await makeStore('StoreB');
  assert.ok(storeA.storeCode, 'store A must have a code');
  assert.ok(storeB.storeCode, 'store B must have a code');
  assert.notEqual(storeA.storeCode, storeB.storeCode, 'codes must differ per store');
  assert.equal(isValidStoreCode(storeA.storeCode), true);

  await makeProduct(storeA.id, 'qr-a-visible', 150, true);
  await makeProduct(storeA.id, 'qr-a-hidden', 999, false);
  await makeProduct(storeB.id, 'qr-b-visible', 200, true);

  // Exact code lookup, both ways.
  const resolvedA = await MemStorage.getUserByStoreCode(storeA.storeCode!);
  const resolvedB = await MemStorage.getUserByStoreCode(storeB.storeCode!);
  assert.equal(resolvedA?.id, storeA.id);
  assert.equal(resolvedB?.id, storeB.id);
  assert.equal(await MemStorage.getUserByStoreCode('0000000000000000'), null);
  assert.equal(await MemStorage.getUserByStoreCode(storeA.storeCode!.toUpperCase()), null, 'lookup is case-sensitive');

  // Composed storefront: only the resolved store's visible products.
  const frontA = await Storage.getPublicStorefront(storeA.storeCode!);
  const frontB = await Storage.getPublicStorefront(storeB.storeCode!);
  assert.equal(frontA?.store.storeName, 'StoreA');
  assert.deepEqual(
    frontA?.products.map((p: any) => p.id),
    ['qr-a-visible'],
    'A storefront must hide B products and A hidden products',
  );
  assert.deepEqual(
    frontB?.products.map((p: any) => p.id),
    ['qr-b-visible'],
  );
  assert.equal(await Storage.getPublicStorefront('0000000000000000'), null);
  assert.ok(!('cost' in (frontA?.products[0] as any)), 'storefront products must not carry cost');
});

test('storeQr ensure: an existing code is kept, never regenerated', async () => {
  const store = await makeStore('StoreKeep');
  const again = await MemStorage.ensureStoreCode(store.id);
  assert.equal(again.storeCode, store.storeCode);
});

test('storeQr pickup order: server totals, cross-store and hidden items rejected, idempotency held', async () => {
  const storeA = await makeStore('StorePickA');
  const storeB = await makeStore('StorePickB');
  await makeProduct(storeA.id, 'qr-pick-a', 150, true);
  await makeProduct(storeA.id, 'qr-pick-a-hidden', 999, false);
  await makeProduct(storeB.id, 'qr-pick-b', 200, true);

  const key = '11111111-2222-4333-8444-555555555555';
  const order = await MemStorage.createPickupGuestOrder({
    idempotencyKey: key,
    storeId: storeA.id,
    items: [{ id: 'qr-pick-a', quantity: 2 }],
  });
  assert.equal(order.storeId, storeA.id);
  assert.equal(order.tableId, null, 'pickup orders carry no table');
  assert.equal(order.status, 'pending');
  assert.equal(order.totalAmount, 300, 'total is recomputed server-side from product price, never client-supplied');

  // Replaying the same key with the same items returns the same order, not a duplicate.
  const replay = await MemStorage.createPickupGuestOrder({
    idempotencyKey: key,
    storeId: storeA.id,
    items: [{ id: 'qr-pick-a', quantity: 2 }],
  });
  assert.equal(replay.id, order.id);

  // Same key, different items is a conflict.
  await assert.rejects(
    () =>
      MemStorage.createPickupGuestOrder({
        idempotencyKey: key,
        storeId: storeA.id,
        items: [{ id: 'qr-pick-a', quantity: 3 }],
      }),
    (err: any) => err.code === 'IDEMPOTENCY_KEY_REUSED',
  );

  // Another store's item through A's order is rejected.
  await assert.rejects(
    () =>
      MemStorage.createPickupGuestOrder({
        idempotencyKey: '22222222-3333-4444-8555-666666666666',
        storeId: storeA.id,
        items: [{ id: 'qr-pick-b', quantity: 1 }],
      }),
    (err: any) => err.code === 'MENU_ITEM_UNAVAILABLE',
  );

  // A hidden item is rejected.
  await assert.rejects(
    () =>
      MemStorage.createPickupGuestOrder({
        idempotencyKey: '33333333-4444-4555-8666-777777777777',
        storeId: storeA.id,
        items: [{ id: 'qr-pick-a-hidden', quantity: 1 }],
      }),
    (err: any) => err.code === 'MENU_ITEM_UNAVAILABLE',
  );

  // A pickup order settles through the same pipeline with a Pickup label.
  const settled = await MemStorage.settleGuestOrder({
    orderId: order.id,
    storeId: storeA.id,
    paymentMethod: 'cash',
  });
  assert.equal(settled.order.status, 'served');
  assert.equal(settled.sale.customerName, 'Pickup Guest');
});
