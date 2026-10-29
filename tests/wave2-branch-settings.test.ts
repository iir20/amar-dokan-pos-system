// Wave 2 tests — branch-delete safety (Item 2), translation promotion
// (Item 5), mic-denial guidance (Item 3 gap) and settings preferences
// (Item 4). Uses a throwaway AMAR_DATA_DIR, never a real store.
// Branch delete is exercised through MemStorage (the same code the
// PostgreSQL wrapper falls back to, and the same guard the PG path
// re-implements); the DELETE route itself is a thin pass-through to
// Storage.deleteBranch (see server/routes.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AMAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amar-wave2-test-'));

const { MemStorage } = await import('../server/memStorage.ts');
const { TRANSLATIONS } = await import('../constants.ts');
const { invText } = await import('../components/Inventory.tsx');
const { MIC_SETTINGS_GUIDANCE, micFailureGuidance, classifyMicError } = await import('../services/native.ts');

async function makeBranch(store: string, name: string) {
  return MemStorage.createBranch({ storeId: store, name });
}

async function makeProduct(store: string, id: string, branchId: string | null, stock: number) {
  const { product } = await MemStorage.upsertProduct(
    {
      id,
      name: `Wave2 ${id}`,
      nameBn: '',
      price: 100,
      cost: 50,
      category: 'Grocery',
      stock,
      unit: 'pcs',
      branchId,
    } as any,
    store,
  );
  return product;
}

test('wave2 branch delete: an empty branch deletes cleanly', async () => {
  const branch = await makeBranch('wave2-empty', 'Empty Branch');
  const result = await MemStorage.deleteBranch('wave2-empty', branch.id);
  assert.deepEqual(result, { deleted: true });
  const remaining = await MemStorage.getBranchesByStore('wave2-empty');
  assert.ok(!remaining.some((b) => b.id === branch.id), 'deleted branch must be gone');
});

test('wave2 branch delete: a branch holding stock is REFUSED and left intact', async () => {
  const branch = await makeBranch('wave2-stock', 'Stock Branch');
  await makeProduct('wave2-stock', 'wave2-stock-prod', branch.id, 5);
  await assert.rejects(
    () => MemStorage.deleteBranch('wave2-stock', branch.id),
    (err: any) => {
      assert.equal(err.code, 'BRANCH_NOT_EMPTY');
      assert.equal(err.status, 409);
      assert.match(err.message, /product\(s\)/);
      assert.match(err.message, /stock/);
      return true;
    },
  );
  const remaining = await MemStorage.getBranchesByStore('wave2-stock');
  assert.ok(remaining.some((b) => b.id === branch.id), 'refused delete must leave the branch intact');
});

test('wave2 branch delete: a branch with sales and unpaid dues is REFUSED naming both', async () => {
  const branch = await makeBranch('wave2-sales', 'Sales Branch');
  // The sold product lives in another branch (branchId null = main
  // store), so only the SALE + DUE block this delete, not stock.
  const product = await makeProduct('wave2-sales', 'wave2-sale-prod', null, 10);
  const sale = await MemStorage.createSale({
    sale: {
      id: 'wave2-sale-1',
      items: [{ id: product.id, quantity: 1 }],
      paymentMethod: 'cash',
      paidAmount: 40,
      branchId: branch.id,
    },
    storeId: 'wave2-sales',
    vatRate: 0,
  });
  assert.ok(sale.dueAmount > 0, `expected a due on a part-paid sale, got due=${sale.dueAmount}`);
  await assert.rejects(
    () => MemStorage.deleteBranch('wave2-sales', branch.id),
    (err: any) => {
      assert.equal(err.code, 'BRANCH_NOT_EMPTY');
      assert.equal(err.status, 409);
      assert.match(err.message, /sale\(s\)/);
      assert.match(err.message, /due/);
      return true;
    },
  );
  const remaining = await MemStorage.getBranchesByStore('wave2-sales');
  assert.ok(remaining.some((b) => b.id === branch.id), 'refused delete must leave the branch intact');
});

test('wave2 branch delete: unknown branch is 404, and deleting the default promotes the next branch', async () => {
  await assert.rejects(
    () => MemStorage.deleteBranch('wave2-default', 'no-such-branch'),
    (err: any) => err.code === 'BRANCH_NOT_FOUND' && err.status === 404,
  );
  const first = await makeBranch('wave2-default', 'Default A');
  const second = await makeBranch('wave2-default', 'Default B');
  const all = await MemStorage.getBranchesByStore('wave2-default');
  const defaults = all.filter((b) => b.isDefault);
  assert.equal(defaults.length, 1, 'exactly one default branch at a time');
  await MemStorage.deleteBranch('wave2-default', defaults[0].id);
  const after = await MemStorage.getBranchesByStore('wave2-default');
  const survivors = after.filter((b) => b.id === first.id || b.id === second.id);
  assert.equal(survivors.filter((b) => b.isDefault).length, 1, 'a surviving branch must be promoted to default');
});

test('wave2 translations: all 31 inventory keys live in shared TRANSLATIONS and invText delegates to them', () => {
  const keys = [
    'searchPlaceholder', 'clearSearch', 'itemsShown', 'lowInView', 'lowStockToggle', 'showAll',
    'lowStockTitle', 'selectAllShown', 'deselectShown', 'clearSelection', 'bulkSelected',
    'selectedHidden', 'adjustStock', 'adjustStockPreview', 'setPrice', 'setPricePreview',
    'deleteSelected', 'deleteSelectedPreview', 'bulkNeedSelection', 'bulkDeltaInvalid',
    'bulkPriceInvalid', 'bulkDeleteConfirm', 'bulkFailed', 'stockMinus', 'stockPlus',
    'saveAddAnother', 'addFromBarcode', 'noMatch', 'noLowInSearch', 'noLowStock', 'noProducts',
  ] as const;
  for (const key of keys) {
    const shared = `inv${key[0].toUpperCase()}${key.slice(1)}` as keyof typeof TRANSLATIONS.en;
    const en = (TRANSLATIONS.en as any)[shared];
    const bn = (TRANSLATIONS.bn as any)[shared];
    assert.ok(typeof en === 'string' && en.length > 0, `${shared} en`);
    assert.ok(typeof bn === 'string' && bn.length > 0, `${shared} bn`);
    assert.notEqual(en, bn, `${shared} must actually be translated`);
    assert.equal(invText('en', key, { n: 3, delta: '+5', price: 250 }), en.replace('{n}', '3').replace('{delta}', '+5').replace('{price}', '250'));
  }
});

test('wave2 mic guidance: a denial maps to PERMISSION_DENIED and the guidance embeds the exact Settings path', () => {
  assert.equal(classifyMicError(new Error('PERMISSION_DENIED')), 'PERMISSION_DENIED');
  assert.equal(classifyMicError(new Error('permission denied by user')), 'PERMISSION_DENIED');
  const guidance = micFailureGuidance('PERMISSION_DENIED');
  assert.ok(guidance.includes(MIC_SETTINGS_GUIDANCE), 'guidance must contain the exact MIC_SETTINGS_GUIDANCE string');
  assert.match(MIC_SETTINGS_GUIDANCE, /Settings → Apps → Amar Dokan POS → Permissions → Microphone/);
});

// NOTE: the voice/sound toggle persistence helpers live in
// components/Settings.tsx, but importing that module in node pulls in
// services/amarSync, which starts a 20-second heartbeat setInterval at
// import time whenever `window` exists — that interval keeps the node
// test process alive forever. So the toggles are NOT unit-tested here;
// they are covered by the browser-level spec tests/e2e/wave2.spec.ts,
// where localStorage persistence is asserted through the real UI
// (the coordinator runs the Playwright suite at merge).
