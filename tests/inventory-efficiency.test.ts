// Item 5 — inventory efficiency: unit tests for the pure helpers
// exported from components/Inventory.tsx. No rendering, no network;
// the component only wires these helpers to the UI.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOW_STOCK_THRESHOLD,
  normalizeInventoryQuery,
  inventorySearchHaystack,
  searchInventory,
  lowStockProducts,
  unionSelection,
  deselectVisibleSelection,
  hiddenSelectedCount,
  formatBulkMessage,
  remainingSelectionAfterBulk,
  formatStockDelta,
  invText,
} from '../components/Inventory';
import type { Product } from '../types';

const product = (over: Partial<Product> & { id: string }): Product => ({
  name: 'Rice',
  nameBn: 'চাল',
  price: 100,
  cost: 70,
  category: 'Grocery',
  stock: 20,
  unit: 'kg',
  ...over,
});

const catalog: Product[] = [
  product({ id: 'p1', name: 'Phase6 Fine Rice', nameBn: 'চাল', category: 'Grocery', stock: 40, barcode: '8901112223334' }),
  product({ id: 'p2', name: 'Phase6 Low Stock Tea', nameBn: 'চা', category: 'Grocery', stock: 3, barcode: '8909991112223' }),
  product({ id: 'p3', name: 'Lentil', nameBn: 'ডাল', category: 'Pulses', stock: 9 }),
  product({ id: 'p4', name: 'Sugar', nameBn: 'চিনি', category: 'Grocery', stock: 10 }),
];

test('item5 search: normalizes Bangla digits, case and whitespace', () => {
  assert.equal(normalizeInventoryQuery('  চাল  ১২৩ '), 'চাল 123');
  assert.equal(normalizeInventoryQuery('RICE'), 'rice');
  assert.equal(inventorySearchHaystack(catalog[0]), 'phase6 fine rice চাল grocery 8901112223334');
});

test('item5 search: one box covers name, Bangla name, category and barcode', () => {
  assert.deepEqual(searchInventory(catalog, 'Fine Rice').map((p) => p.id), ['p1']);
  assert.deepEqual(searchInventory(catalog, 'ডাল').map((p) => p.id), ['p3']);
  // Substring semantics are kept: 'চা' matches both 'চা' and 'চাল'.
  assert.deepEqual(searchInventory(catalog, 'চা').map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(searchInventory(catalog, 'pulses').map((p) => p.id), ['p3']);
  assert.deepEqual(searchInventory(catalog, '8909991112223').map((p) => p.id), ['p2']);
  // Partial token still matches, as before.
  assert.deepEqual(searchInventory(catalog, 'ric').map((p) => p.id), ['p1']);
  // Empty query returns everything (a copy, not the same array).
  const all = searchInventory(catalog, '   ');
  assert.deepEqual(all.map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
  assert.notEqual(all, catalog);
});

test('item5 search: token-AND matches tokens in any order or field', () => {
  // Old whole-string includes() failed on reversed word order.
  assert.deepEqual(searchInventory(catalog, 'rice grocery').map((p) => p.id), ['p1']);
  assert.deepEqual(searchInventory(catalog, 'grocery rice').map((p) => p.id), ['p1']);
  // Every token must match somewhere; "rice pulses" matches nothing.
  assert.deepEqual(searchInventory(catalog, 'rice pulses'), []);
});

test('item5 search: an exact barcode ranks its product first', () => {
  const withPrefix = [
    ...catalog,
    product({ id: 'p5', name: 'Other Code Item', category: 'Grocery', stock: 5, barcode: '89099911122230' }),
  ];
  // Substring search finds both codes; the exact one must come first.
  const hits = searchInventory(withPrefix, '8909991112223');
  assert.equal(hits[0].id, 'p2');
  assert.ok(hits.some((p) => p.id === 'p5'));
});

test('item5 low stock: threshold 10, boundary stock 10 is not low', () => {
  assert.equal(LOW_STOCK_THRESHOLD, 10);
  assert.deepEqual(lowStockProducts(catalog).map((p) => p.id), ['p2', 'p3']);
  assert.deepEqual(lowStockProducts(catalog, 5).map((p) => p.id), ['p2']);
});

test('item5 selection: select-all unions, deselect-shown preserves hidden, hidden count', () => {
  const selected = new Set(['p9']);
  // Old behaviour replaced the set; the union keeps the hidden p9.
  assert.deepEqual([...unionSelection(selected, ['p1', 'p2'])].sort(), ['p1', 'p2', 'p9']);
  assert.deepEqual([...deselectVisibleSelection(new Set(['p1', 'p9']), ['p1'])], ['p9']);
  assert.equal(hiddenSelectedCount(new Set(['p1', 'p9']), ['p1', 'p2']), 1);
  assert.equal(hiddenSelectedCount(new Set(['p1']), ['p1', 'p2']), 0);
});

test('item5 bulk message: keeps "N updated" wording and names every skipped item', () => {
  const message = formatBulkMessage(
    {
      updated: 1,
      deleted: 0,
      skipped: [
        { id: 'p3', reason: 'INSUFFICIENT_STOCK' },
        { id: 'gone', reason: 'PRODUCT_NOT_FOUND' },
      ],
    },
    catalog,
    'en',
  );
  assert.match(message, /1 updated, 0 deleted/);
  assert.match(message, /Lentil — would go below zero/);
  assert.match(message, /gone — not found/);
  const bn = formatBulkMessage(
    { updated: 2, deleted: 1, skipped: [{ id: 'p2', reason: 'DELETE_FAILED' }] },
    catalog,
    'bn',
  );
  assert.match(bn, /চা/);
  assert.match(bn, /মোছা যায়নি/);
  assert.match(bn, /বাদ পড়েছে/);
  assert.equal(formatBulkMessage({ updated: 3, deleted: 0, skipped: [] }, catalog, 'en'), 'Done: 3 updated, 0 deleted.');
});

test('item5 bulk selection: adjust/price keep it, delete drops only deleted ids', () => {
  const selected = new Set(['a', 'b', 'c']);
  assert.deepEqual([...remainingSelectionAfterBulk(selected, ['a', 'b'], 'adjust-stock', [])].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...remainingSelectionAfterBulk(selected, ['a', 'b'], 'set-price', [])].sort(), ['a', 'b', 'c']);
  // 'b' was skipped (not deleted) so it stays selected for a retry.
  assert.deepEqual(
    [...remainingSelectionAfterBulk(selected, ['a', 'b'], 'delete', [{ id: 'b' }])].sort(),
    ['b', 'c'],
  );
});

test('item5 labels: signed delta preview and every new string has Bangla', () => {
  assert.equal(formatStockDelta(5), '+5');
  assert.equal(formatStockDelta(-3), '-3');
  assert.equal(formatStockDelta(0), '0');
  const keys = [
    'searchPlaceholder', 'clearSearch', 'itemsShown', 'lowInView', 'lowStockToggle', 'showAll',
    'lowStockTitle', 'selectAllShown', 'deselectShown', 'clearSelection', 'bulkSelected',
    'selectedHidden', 'adjustStock', 'adjustStockPreview', 'setPrice', 'setPricePreview',
    'deleteSelected', 'deleteSelectedPreview', 'bulkNeedSelection', 'bulkDeltaInvalid',
    'bulkPriceInvalid', 'bulkDeleteConfirm', 'bulkFailed', 'stockMinus', 'stockPlus',
    'saveAddAnother', 'addFromBarcode', 'noMatch', 'noLowInSearch', 'noLowStock', 'noProducts',
  ] as const;
  for (const key of keys) {
    const en = invText('en', key, { n: 3, delta: '+5', price: 250 });
    const bn = invText('bn', key, { n: 3, delta: '+5', price: 250 });
    assert.ok(en.length > 0, `${key} en`);
    assert.ok(bn.length > 0, `${key} bn`);
    assert.ok(!en.includes('{') && !bn.includes('{'), `${key} placeholders replaced`);
    assert.notEqual(en, bn, `${key} must actually be translated, not copied`);
  }
});
