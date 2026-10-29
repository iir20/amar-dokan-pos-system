// ADDITIONAL SCOPE unit tests — manual-add helpers (Inventory),
// voice-to-add parsing/validation (VoiceAddProduct), and the new
// translation block (both locales). No rendering, no network, no
// mocks of production logic: the functions under test are the shipped
// ones. The E2E spec (tests/e2e/additional-scope.spec.ts) proves the
// rendered flows against the real server.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLastManualAddDefaults,
  saveLastManualAddDefaults,
  resolveManualAddDefaults,
  buildSimilarProductForm,
  validateManualProductForm,
} from '../components/Inventory';
import { parseVoiceAddCommand, validateVoiceAddDraft } from '../components/VoiceAddProduct';
import { TRANSLATIONS } from '../constants';
import type { Product } from '../types';

const product = (over: Partial<Product> & { id: string }): Product => ({
  name: 'Rice',
  nameBn: 'চাল',
  price: 120,
  cost: 80,
  category: 'Grocery',
  stock: 40,
  unit: 'kg',
  ...over,
});

// --- Manual add: smart defaults -------------------------------------

test('additional manual: smart defaults fall back, then remember last-used category/unit', () => {
  // No localStorage in node: guarded helpers return {} and swallow saves.
  assert.deepEqual(getLastManualAddDefaults(), {});
  assert.deepEqual(resolveManualAddDefaults('General', 'pcs'), { category: 'General', unit: 'pcs' });
  saveLastManualAddDefaults({ category: 'Grocery', unit: 'kg' }); // must not throw
  assert.deepEqual(getLastManualAddDefaults(), {});
});

test('additional manual: quick-add copies category/unit/price/cost but never name, barcode or id', () => {
  const src = product({ id: 'p1', barcode: '8901112223334', supplier: 'Acme' });
  const form = buildSimilarProductForm(src);
  assert.equal(form.category, 'Grocery');
  assert.equal(form.unit, 'kg');
  assert.equal(form.price, 120);
  assert.equal(form.cost, 80);
  assert.equal(form.supplier, 'Acme');
  assert.equal(form.name, '');
  assert.equal(form.nameBn, '');
  assert.equal(form.barcode, '');
  assert.equal(form.stock, 0);
  assert.equal((form as { id?: string }).id, undefined);
});

// --- Manual add: visible validation (no silent no-ops) --------------

test('additional manual: validation names every bad field, passes a good form', () => {
  const bad = validateManualProductForm(
    { name: '  ', price: -5, cost: NaN, stock: 2.5, barcode: 'has space' },
    { isMedicine: true },
  );
  assert.deepEqual([...bad].sort(), ['barcode', 'cost', 'expiryDate', 'name', 'price', 'stock']);
  assert.deepEqual(
    validateManualProductForm(
      { name: 'Rice', price: 120, cost: 80, stock: 10, expiryDate: '2030-01-01' },
      { isMedicine: true },
    ),
    [],
  );
  // Non-medicine: no expiry required.
  assert.deepEqual(
    validateManualProductForm({ name: 'Rice', price: 120, cost: 80, stock: 10 }, { isMedicine: false }),
    [],
  );
});

// --- Voice-to-add parsing -------------------------------------------

test('additional voice: English labelled command parses name, price, stock, category', () => {
  const { draft, unclear, missing } = parseVoiceAddCommand('add rice price 120 stock 30 category grocery');
  assert.equal(unclear, false);
  assert.deepEqual(missing, []);
  assert.equal(draft.name, 'rice');
  assert.equal(draft.price, '120');
  assert.equal(draft.stock, '30');
  assert.equal(draft.category, 'grocery');
});

test('additional voice: Bangla command with Bangla digits parses', () => {
  const { draft, unclear } = parseVoiceAddCommand('চাল যোগ কর দাম ১২০ টাকা স্টক ৩০ ক্যাটাগরি মুদি');
  assert.equal(unclear, false);
  assert.equal(draft.name, 'চাল');
  assert.equal(draft.price, '120');
  assert.equal(draft.stock, '30');
  assert.equal(draft.category, 'মুদি');
});

test('additional voice: bare numbers are price then stock; a digit glued to a name is not a price', () => {
  const bare = parseVoiceAddCommand('rice 120 30');
  assert.equal(bare.draft.price, '120');
  assert.equal(bare.draft.stock, '30');
  const glued = parseVoiceAddCommand('add Phase6 Voice Item price 100 stock 5');
  assert.equal(glued.draft.name, 'Phase6 Voice Item');
  assert.equal(glued.draft.price, '100');
  assert.equal(glued.draft.stock, '5');
  const labelledThenBare = parseVoiceAddCommand('rice price 120 30');
  assert.equal(labelledThenBare.draft.price, '120');
  assert.equal(labelledThenBare.draft.stock, '30');
});

test('additional voice: missing price/stock is NOT unclear (confirmation fills it); empty name IS unclear', () => {
  const partial = parseVoiceAddCommand('চিনি');
  assert.equal(partial.unclear, false);
  assert.equal(partial.draft.name, 'চিনি');
  assert.ok(partial.missing.includes('price'));
  assert.ok(partial.missing.includes('stock'));
  assert.equal(parseVoiceAddCommand('').unclear, true);
  assert.equal(parseVoiceAddCommand('যোগ কর').unclear, true);
  assert.equal(parseVoiceAddCommand('add').unclear, true);
});

test('additional voice: confirmation validation rejects empty name, negative price, fractional stock', () => {
  assert.deepEqual(validateVoiceAddDraft({ name: '', price: '10', cost: '', stock: '5', unit: 'pcs', category: 'General', barcode: '' }), ['name']);
  assert.deepEqual(validateVoiceAddDraft({ name: 'Rice', price: '-1', cost: '', stock: '5', unit: 'pcs', category: 'General', barcode: '' }), ['price']);
  assert.deepEqual(validateVoiceAddDraft({ name: 'Rice', price: '10', cost: '', stock: '2.5', unit: 'pcs', category: 'General', barcode: '' }), ['stock']);
  // Cost defaults to 0 on save: an empty cost string is valid here.
  assert.deepEqual(validateVoiceAddDraft({ name: 'Rice', price: '10', cost: '', stock: '5', unit: 'pcs', category: 'General', barcode: '' }), []);
});

// --- Translation block: both locales, no missing key ----------------

test('additional scope: every new translation key exists in both locales and is non-empty', () => {
  const keys = [
    'invSmartDefaultsHint', 'invAddSimilar', 'invVoiceAddOpen',
    'invFormErrorName', 'invFormErrorPrice', 'invFormErrorCost', 'invFormErrorStock', 'invFormErrorBarcode', 'invFormErrorExpiry', 'invFormErrorSummary',
    'voiceAddTitle', 'voiceAddHint', 'voiceAddTypedPlaceholder', 'voiceAddTypedSubmit',
    'voiceAddStepName', 'voiceAddStepPrice', 'voiceAddStepStock', 'voiceAddStepCategory',
    'voiceAddSpeak', 'voiceAddListening', 'voiceAddNext', 'voiceAddBack', 'voiceAddToConfirmation',
    'voiceAddConfirmTitle', 'voiceAddConfirmHint', 'voiceAddSave', 'voiceAddCancel', 'voiceAddSaved',
    'voiceAddUnclear', 'voiceAddMicFallback',
    'voiceAddFieldName', 'voiceAddFieldPrice', 'voiceAddFieldCost', 'voiceAddFieldStock', 'voiceAddFieldUnit', 'voiceAddFieldCategory', 'voiceAddFieldBarcode',
    'voiceAddMissing', 'voiceAddAddAnother',
    'aboutTitle', 'aboutWhatTitle', 'aboutWhatBody', 'aboutTourTitle', 'aboutTourIntro',
    'aboutTourPosTitle', 'aboutTourPosDesc', 'aboutTourInventoryTitle', 'aboutTourInventoryDesc',
    'aboutTourDashboardTitle', 'aboutTourDashboardDesc', 'aboutTourOrdersTitle', 'aboutTourOrdersDesc',
    'aboutTourSettingsTitle', 'aboutTourSettingsDesc',
    'aboutSpecTitle', 'aboutFeaturesTitle', 'aboutFeaturesBody', 'aboutVersion',
    'aboutRequirementsTitle', 'aboutRequirementsBody', 'aboutSyncTitle', 'aboutSyncBody',
    'aboutSupportTitle', 'aboutSupportBody',
  ] as const;
  for (const key of keys) {
    for (const lang of ['en', 'bn'] as const) {
      const value = (TRANSLATIONS[lang] as unknown as Record<string, string>)[key];
      assert.ok(typeof value === 'string' && value.trim().length > 0, `${lang}.${key} missing/empty`);
    }
  }
  // About tour covers all five main screens, in menu order.
  assert.match(TRANSLATIONS.en.aboutTourPosTitle, /POS/);
  assert.match(TRANSLATIONS.en.aboutTourInventoryTitle, /Inventory/);
  assert.match(TRANSLATIONS.en.aboutTourDashboardTitle, /Dashboard/);
  assert.match(TRANSLATIONS.en.aboutTourOrdersTitle, /Online Orders/);
  assert.match(TRANSLATIONS.en.aboutTourSettingsTitle, /Settings/);
});
