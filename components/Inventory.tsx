import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { Product, Language, User, StoreCategory } from '../types';
import { TRANSLATIONS, LIMITS, STORE_THEMES } from '../constants';
import { StorageService } from '../services/storage';
import {
  Plus,
  Edit2,
  Trash2,
  X,
  Save,
  Crown,
  ScanBarcode,
  Image as ImageIcon,
  Zap,
  Shirt,
  Pill,
  Utensils,
  TrendingUp,
  AlertCircle,
  Search,
} from 'lucide-react';
import { useApiData } from '../hooks/useApiData';
import SubscriptionModal from './SubscriptionModal';
// Phase 6 — inventory efficiency on the Phase 5 design system, Bangla
// inventory voice, and camera/manual barcode entry.
import { AdCard, AdButton, AdInput } from './ui';
import VoiceInventory from './VoiceInventory';
import VoiceAddProduct from './VoiceAddProduct';
import BarcodeScanner from './BarcodeScanner';
import { InventoryLog } from '../types';

// ------------------------------------------------------------------
// Item 5 — inventory efficiency (Phase 6 follow-up). Pure helpers are
// exported so unit tests can cover them without rendering; the
// component below only wires them to the UI. No behaviour below
// removes an existing path: search, barcode lookup, manual entry,
// voice fallback, bulk adjust/price/delete and movement history all
// keep their existing entry points and testids.
//
// NOTE ON TRANSLATIONS: the Item 5 strings were promoted (Wave 2) into
// the shared TRANSLATIONS in constants.ts (`inv*` keys) + the Translation
// type in types.ts; the component reads t.inv* directly.
// ------------------------------------------------------------------

/** Stock below this is "low" — the threshold the Phase 6 UI already used. */
export const LOW_STOCK_THRESHOLD = 10;

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Lowercase, trim, collapse whitespace, Bangla digits -> Latin digits,
 *  so "চাল", "CHAL" and a Bangla-digit barcode all match stored data. */
export function normalizeInventoryQuery(value: string | null | undefined): string {
  return (value || '')
    .split('')
    .map((ch) => {
      const idx = BANGLA_DIGITS.indexOf(ch);
      return idx >= 0 ? String(idx) : ch;
    })
    .join('')
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** One precomputed haystack per product: the list is indexed once per
 *  products change (useMemo in the component) instead of lowercasing
 *  four fields per product on every keystroke. */
export function inventorySearchHaystack(product: Product): string {
  return normalizeInventoryQuery(
    [product.name, product.nameBn, product.category, product.barcode].filter(Boolean).join(' '),
  );
}

/**
 * Instant search over name, Bengali name, category and barcode in one
 * box. Token-AND: every whitespace-separated token must appear
 * somewhere in the haystack, so "rice grocery" and "grocery rice" both
 * match (the old whole-string includes() failed on reversed order).
 * A query that exactly equals a barcode ranks that product first, so a
 * full scanned/typed code surfaces its product even when the code is a
 * prefix of another product's code. Single-token behaviour is
 * unchanged (one token + includes == the old any-field includes).
 */
export function searchInventory(products: Product[], query: string): Product[] {
  const q = normalizeInventoryQuery(query);
  if (!q) return [...products];
  const tokens = q.split(' ');
  const matches = products.filter((p) => {
    const haystack = inventorySearchHaystack(p);
    return tokens.every((token) => haystack.includes(token));
  });
  const exact = matches.filter((p) => normalizeInventoryQuery(p.barcode) === q);
  if (exact.length === 0) return matches;
  const exactIds = new Set(exact.map((p) => p.id));
  return [...exact, ...matches.filter((p) => !exactIds.has(p.id))];
}

export function lowStockProducts(products: Product[], threshold: number = LOW_STOCK_THRESHOLD): Product[] {
  return products.filter((p) => p.stock < threshold);
}

/** "Select all shown" must UNION with the existing selection, never
 *  replace it — the old replace silently dropped products selected
 *  before a search/filter change. */
export function unionSelection(existing: ReadonlySet<string>, visibleIds: string[]): Set<string> {
  const next = new Set(existing);
  visibleIds.forEach((id) => next.add(id));
  return next;
}

/** Deselect only the shown rows; hidden selections survive. */
export function deselectVisibleSelection(existing: ReadonlySet<string>, visibleIds: string[]): Set<string> {
  const next = new Set(existing);
  visibleIds.forEach((id) => next.delete(id));
  return next;
}

/** How many selected products are hidden by the current search/filter,
 *  so the bulk panel can say so instead of silently acting on them. */
export function hiddenSelectedCount(selected: ReadonlySet<string>, visibleIds: string[]): number {
  const visible = new Set(visibleIds);
  let count = 0;
  selected.forEach((id) => {
    if (!visible.has(id)) count++;
  });
  return count;
}

export interface BulkActionResult {
  updated: number;
  deleted: number;
  skipped: Array<{ id: string; reason: string }>;
}

const BULK_SKIP_REASONS: Record<string, { en: string; bn: string }> = {
  PRODUCT_NOT_FOUND: { en: 'not found', bn: 'পাওয়া যায়নি' },
  INSUFFICIENT_STOCK: { en: 'would go below zero', bn: 'স্টক শূন্যের নিচে যেত' },
  DELETE_FAILED: { en: 'delete failed', bn: 'মোছা যায়নি' },
};

/**
 * Bulk result message with PER-ITEM skip reporting (name + reason),
 * not just a count of reasons. The English prefix keeps the exact
 * "N updated, N deleted" wording the Phase 6 E2E asserts on.
 */
export function formatBulkMessage(result: BulkActionResult, products: Product[], lang: Language): string {
  const names = new Map(products.map((p) => [p.id, lang === 'bn' ? p.nameBn || p.name : p.name] as const));
  const base =
    lang === 'bn'
      ? `সম্পন্ন: ${result.updated}টি আপডেট, ${result.deleted}টি মোছা হয়েছে`
      : `Done: ${result.updated} updated, ${result.deleted} deleted`;
  if (result.skipped.length === 0) return lang === 'bn' ? `${base}।` : `${base}.`;
  const skips = result.skipped
    .map((s) => {
      const reason = BULK_SKIP_REASONS[s.reason]?.[lang] ?? s.reason;
      return `${names.get(s.id) || s.id} — ${reason}`;
    })
    .join('; ');
  return lang === 'bn' ? `${base}; বাদ পড়েছে: ${skips}।` : `${base}, skipped: ${skips}.`;
}

/**
 * Selection after a bulk action: adjust/price keep the selection (so a
 * second bulk action needs no re-selecting); delete drops only the
 * ids that were actually deleted, keeping skipped ids selected for a
 * retry. Previously every bulk action cleared the whole selection.
 */
export function remainingSelectionAfterBulk(
  selected: ReadonlySet<string>,
  requestedIds: string[],
  action: 'adjust-stock' | 'set-price' | 'delete',
  skipped: Array<{ id: string }>,
): Set<string> {
  if (action !== 'delete') return new Set(selected);
  const skippedIds = new Set(skipped.map((s) => s.id));
  const next = new Set(selected);
  requestedIds.forEach((id) => {
    if (!skippedIds.has(id)) next.delete(id);
  });
  return next;
}

/** Signed delta for preview labels: 5 -> "+5", -3 -> "-3". */
export function formatStockDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

// ------------------------------------------------------------------
// ADDITIONAL SCOPE — manual-add efficiency. Pure helpers, unit-tested
// in tests/additional-scope.test.ts. The manual form stays fully usable
// without voice or camera: these helpers only prefill, never gate.
// ------------------------------------------------------------------

export const MANUAL_ADD_DEFAULTS_KEY = 'amar-last-product-defaults';

export interface ManualAddDefaults {
  category?: string;
  unit?: string;
}

function manualAddStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Last-used category/unit, or {} when nothing was saved yet. Never throws. */
export function getLastManualAddDefaults(): ManualAddDefaults {
  try {
    const raw = manualAddStorage()?.getItem(MANUAL_ADD_DEFAULTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ManualAddDefaults;
    return {
      category: typeof parsed.category === 'string' && parsed.category.trim() ? parsed.category : undefined,
      unit: typeof parsed.unit === 'string' && parsed.unit.trim() ? parsed.unit : undefined,
    };
  } catch {
    return {};
  }
}

export function saveLastManualAddDefaults(defaults: ManualAddDefaults): void {
  try {
    manualAddStorage()?.setItem(MANUAL_ADD_DEFAULTS_KEY, JSON.stringify(defaults));
  } catch {
    // Defaults are a convenience only; a storage failure must never
    // block saving the product itself.
  }
}

/**
 * New-product form defaults: last-used category/unit win over the
 * store fallback. Price/cost are NEVER carried over — carrying a price
 * could silently save the wrong price on the next product.
 */
export function resolveManualAddDefaults(
  fallbackCategory: string,
  fallbackUnit: string,
): { category: string; unit: string } {
  const last = getLastManualAddDefaults();
  return { category: last.category || fallbackCategory, unit: last.unit || fallbackUnit };
}

/**
 * Quick-add ("Add similar") form: copies category, unit, price, cost
 * and supplier from an existing product, but clears name, Bangla name,
 * barcode and stock and drops the id — so the copy can never overwrite
 * the original or inherit its barcode. The shopkeeper only types a new
 * name (and stock) before saving.
 */
export function buildSimilarProductForm(product: Product): Partial<Product> {
  return {
    name: '',
    nameBn: '',
    category: product.category,
    price: product.price,
    cost: product.cost,
    stock: 0,
    unit: product.unit,
    barcode: '',
    supplier: product.supplier,
    image: '',
  };
}

export type ManualFormErrorField = 'name' | 'price' | 'cost' | 'stock' | 'barcode' | 'expiryDate';

/**
 * Field-level manual-form validation. Returns one error code per bad
 * field (empty = saveable). The component renders each code as a
 * visible inline message — a failed save is never a silent no-op.
 * Stock must be a whole number; price/cost finite and >= 0.
 */
export function validateManualProductForm(
  formData: Partial<Product>,
  opts: { isMedicine: boolean },
): ManualFormErrorField[] {
  const errors: ManualFormErrorField[] = [];
  if (!formData.name?.trim()) errors.push('name');
  if (!Number.isFinite(Number(formData.price)) || Number(formData.price) < 0) errors.push('price');
  if (!Number.isFinite(Number(formData.cost)) || Number(formData.cost) < 0) errors.push('cost');
  const stock = Number(formData.stock);
  if (!Number.isInteger(stock) || stock < 0) errors.push('stock');
  if (formData.barcode && (formData.barcode.length > 128 || /\s/.test(formData.barcode))) errors.push('barcode');
  if (opts.isMedicine && !formData.expiryDate) errors.push('expiryDate');
  return errors;
}

export const MANUAL_FORM_ERROR_MESSAGE_KEY: Record<ManualFormErrorField, string> = {
  name: 'invFormErrorName',
  price: 'invFormErrorPrice',
  cost: 'invFormErrorCost',
  stock: 'invFormErrorStock',
  barcode: 'invFormErrorBarcode',
  expiryDate: 'invFormErrorExpiry',
};

// Every inventory UI string below lives in TRANSLATIONS (both locales).
// {n}, {delta} and {price} are replaced at the call site.
/** Inventory strings now live in the shared TRANSLATIONS (constants.ts,
 * `inv*` keys) — the local INV_TEXT dict was promoted (Wave 2, Item 5).
 * invText() is kept as a thin compatibility wrapper over TRANSLATIONS so
 * the existing inventory-efficiency tests keep passing unchanged; the
 * component itself now reads t.inv* directly. */
export function invText(
  lang: Language,
  key:
    | 'searchPlaceholder'
    | 'clearSearch'
    | 'itemsShown'
    | 'lowInView'
    | 'lowStockToggle'
    | 'showAll'
    | 'lowStockTitle'
    | 'selectAllShown'
    | 'deselectShown'
    | 'clearSelection'
    | 'bulkSelected'
    | 'selectedHidden'
    | 'adjustStock'
    | 'adjustStockPreview'
    | 'setPrice'
    | 'setPricePreview'
    | 'deleteSelected'
    | 'deleteSelectedPreview'
    | 'bulkNeedSelection'
    | 'bulkDeltaInvalid'
    | 'bulkPriceInvalid'
    | 'bulkDeleteConfirm'
    | 'bulkFailed'
    | 'stockMinus'
    | 'stockPlus'
    | 'saveAddAnother'
    | 'addFromBarcode'
    | 'noMatch'
    | 'noLowInSearch'
    | 'noLowStock'
    | 'noProducts',
  replacements?: Record<string, string | number>,
): string {
  const sharedKey = `inv${key[0].toUpperCase()}${key.slice(1)}`;
  const dict = TRANSLATIONS[lang] as unknown as Record<string, string>;
  const fallback = TRANSLATIONS.en as unknown as Record<string, string>;
  let text: string = dict[sharedKey] ?? fallback[sharedKey] ?? '';
  if (replacements) {
    for (const [name, value] of Object.entries(replacements)) {
      text = text.replace(`{${name}}`, String(value));
    }
  }
  return text;
}

interface InventoryProps {
  lang: Language;
}

const Inventory: React.FC<InventoryProps> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const {
    data: productsData,
    loading,
    error,
    refetch: refetchProducts,
  } = useApiData(() => StorageService.getProducts(), []);
  const products = productsData || [];
  const [user, setUser] = useState<User | null>(null);
  const [query, setQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showUpsell, setShowUpsell] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({});
  // Additional scope — visible field errors (never a silent no-op) and
  // the voice-to-add panel toggle. Manual add stays independent of both.
  const [formErrors, setFormErrors] = useState<ManualFormErrorField[]>([]);
  const [showVoiceAdd, setShowVoiceAdd] = useState(false);
  // Phase 6 state
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDelta, setBulkDelta] = useState('');
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeResult, setBarcodeResult] = useState<Product | null>(null);
  const [barcodeError, setBarcodeError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [historyProductId, setHistoryProductId] = useState<string | null>(null);
  const [historyLogs, setHistoryLogs] = useState<InventoryLog[]>([]);
  const [historyError, setHistoryError] = useState('');
  // Item 5 — guards one in-flight quick stock tap per product so a
  // double-tap on a phone cannot apply the same +/- twice.
  const [quickAdjustingId, setQuickAdjustingId] = useState<string | null>(null);

  // Real-time Profit Calculation for the Form
  const [calculatedMargin, setCalculatedMargin] = useState<{ profit: number; percent: number } | null>(null);

  useEffect(() => {
    StorageService.getCurrentUser().then(setUser);
  }, [showUpsell]);

  // Update margin whenever price or cost changes
  useEffect(() => {
    const price = Number(formData.price) || 0;
    const cost = Number(formData.cost) || 0;
    if (price > 0) {
      const profit = price - cost;
      const percent = (profit / price) * 100;
      setCalculatedMargin({ profit, percent });
    } else {
      setCalculatedMargin(null);
    }
  }, [formData.price, formData.cost]);

  // Determine current Store Theme
  const currentCategory: StoreCategory = user?.storeCategory || 'grocery';
  const theme = STORE_THEMES[currentCategory] || STORE_THEMES['grocery'];
  const ThemeIcon = theme.icon;
  // Item 5 (a) — the search box stays instant (raw `query` drives the
  // input) while the filtered list follows a deferred query, so typing
  // never waits on filtering/rendering a large list. The haystack is
  // indexed once per products change, not per keystroke.
  const deferredQuery = useDeferredValue(query);
  const filteredProducts = useMemo(() => searchInventory(products, deferredQuery), [products, deferredQuery]);
  // Item 5 (b) — low-stock counts are computed on the FILTERED list, so
  // the toggle badge, the summary line and the low-stock chips always
  // agree with what the search actually shows (previously the badge
  // showed the unfiltered total while a search was active).
  const filteredLowStock = useMemo(() => lowStockProducts(filteredProducts), [filteredProducts]);
  const visibleProducts = showLowOnly ? filteredLowStock : filteredProducts;
  const allVisibleSelected = visibleProducts.length > 0 && visibleProducts.every((p) => selectedIds.has(p.id));
  const hiddenSelection = hiddenSelectedCount(
    selectedIds,
    visibleProducts.map((p) => p.id),
  );
  // Item 5 (c) — live bulk preview: the action buttons themselves state
  // the exact effect (delta/price + item count) before the tap, so the
  // single-tap execution the Phase 6 E2E relies on needs no extra
  // confirmation step, yet nothing executes blind.
  const bulkDeltaNumber = bulkDelta.trim() === '' ? NaN : Number(bulkDelta);
  const bulkDeltaValid = Number.isInteger(bulkDeltaNumber) && bulkDeltaNumber !== 0;
  const bulkPriceNumber = bulkPrice.trim() === '' ? NaN : Number(bulkPrice);
  const bulkPriceValid = Number.isFinite(bulkPriceNumber) && bulkPriceNumber >= 0;

  // Phase 6 — barcode lookup (server-side route; typed entry and camera
  // scan both land here, so both paths behave identically).
  const handleBarcodeLookup = async (code: string) => {
    const trimmed = code.trim();
    setBarcodeError('');
    setBarcodeResult(null);
    if (!trimmed) {
      setBarcodeError('Enter a barcode first.');
      return;
    }
    try {
      const found = await StorageService.getProductByBarcode(trimmed);
      setBarcodeResult(found);
      setQuery(found.name);
    } catch {
      setBarcodeError(`No product found for barcode “${trimmed}”. Check the printed code or add it as a new product.`);
    }
  };

  const loadHistory = async (productId: string) => {
    setHistoryProductId(productId);
    setHistoryError('');
    try {
      const logs = await StorageService.getInventoryLogs();
      setHistoryLogs(logs.filter((l) => l.productId === productId));
    } catch {
      setHistoryError('Could not load movement history. Try again.');
      setHistoryLogs([]);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulk = async (action: 'adjust-stock' | 'set-price' | 'delete') => {
    setBulkMessage('');
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setBulkMessage(t.invBulkNeedSelection);
      return;
    }
    // Item 5 (c) — client-side guards so a blank delta no longer
    // silently "adjusts by 0" and a blank price is never sent.
    if (action === 'adjust-stock' && !bulkDeltaValid) {
      setBulkMessage(t.invBulkDeltaInvalid);
      return;
    }
    if (action === 'set-price' && !bulkPriceValid) {
      setBulkMessage(t.invBulkPriceInvalid);
      return;
    }
    if (action === 'delete' && !window.confirm(t.invBulkDeleteConfirm.replace('{n}', String(ids.length)))) return;
    // Capture names BEFORE refetch: skip reporting needs the names of
    // products that may be gone from the list afterwards.
    const productsBefore = [...products];
    try {
      const result = await StorageService.bulkProducts({
        ids,
        action,
        delta: action === 'adjust-stock' ? bulkDeltaNumber : undefined,
        price: action === 'set-price' ? bulkPriceNumber : undefined,
        confirmed: action === 'delete' ? true : undefined,
      });
      setBulkMessage(formatBulkMessage(result, productsBefore, lang));
      // Item 5 (c) — selection survives the action: adjust/price keep
      // it for a follow-up action; delete drops only what was deleted.
      setSelectedIds(remainingSelectionAfterBulk(selectedIds, ids, action, result.skipped));
      await refetchProducts();
    } catch (error: any) {
      setBulkMessage(error?.body?.message || error?.message || t.invBulkFailed);
    }
  };

  // Item 5 (d) — one-tap stock +/- on the row itself. Before: Edit tap
  // -> scroll to the stock field -> type -> Save tap (4 interactions).
  // Now: 1 tap per unit, guarded against double-taps while in flight.
  const handleQuickAdjust = async (product: Product, delta: number) => {
    if (quickAdjustingId !== null) return;
    const next = product.stock + delta;
    if (next < 0) return;
    setQuickAdjustingId(product.id);
    setSaveError('');
    try {
      await StorageService.saveProduct({ ...product, stock: next });
      await refetchProducts();
    } catch (error: any) {
      setSaveError(error?.body?.message || error?.message || 'Could not update stock.');
    } finally {
      setQuickAdjustingId(null);
    }
  };

  // Phase 6 — inventory voice callbacks (mutations stay in Inventory;
  // the voice panel only parses and dispatches).
  const handleVoiceSetStock = async (product: Product, stock: number) => {
    await StorageService.saveProduct({ ...product, stock });
    await refetchProducts();
  };

  // Additional scope — open the form for a new product. `overrides`
  // are applied in the SAME setFormData call as the defaults, so a
  // barcode passed from the barcode panel cannot be lost to React
  // batching (the old two-call pattern relied on queue order).
  const handleOpenModal = (product?: Product, overrides?: Partial<Product>) => {
    setSaveError('');
    setFormErrors([]);
    if (!product) {
      if (user?.plan === 'free' && products.length >= LIMITS.FREE_PRODUCT_LIMIT) {
        setShowUpsell(true);
        return;
      }
    }

    if (product) {
      setEditingProduct(product);
      setFormData({ ...product });
    } else {
      // Smart defaults: last-used category/unit, else store fallback.
      const defaults = resolveManualAddDefaults('General', currentCategory === 'medicine' ? 'strip' : 'pcs');
      setEditingProduct(null);
      setFormData({
        name: '',
        nameBn: '',
        category: defaults.category,
        price: 0,
        cost: 0,
        stock: 0,
        unit: defaults.unit,
        image: '',
        ...overrides,
      });
    }
    setIsModalOpen(true);
  };

  // Additional scope — quick-add for repeat items: one tap on a row
  // opens a NEW product form prefilled from that row (category, unit,
  // price, cost, supplier). Name/barcode/stock are blank, so the copy
  // can never silently overwrite the original.
  const handleOpenSimilar = (product: Product) => {
    if (user?.plan === 'free' && products.length >= LIMITS.FREE_PRODUCT_LIMIT) {
      setShowUpsell(true);
      return;
    }
    setSaveError('');
    setFormErrors([]);
    setEditingProduct(null);
    setFormData(buildSimilarProductForm(product));
    setIsModalOpen(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) {
        alert('Image size must be less than 1MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, image: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t.confirmDelete)) {
      try {
        await StorageService.deleteProduct(id);
        await refetchProducts();
      } catch (error: any) {
        alert(error?.body?.message || error?.message || 'Could not delete this product.');
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveForm('close');
  };

  // Item 5 (d) — 'another' keeps the modal open on a blank form after a
  // successful create, so adding N products costs N+1 taps (Add, then
  // Save & add another … , Save) instead of 2N (Add + Save each time).
  // Validation, alerts and the free-limit upsell path are identical.
  const saveForm = async (mode: 'close' | 'another') => {
    if (isSaving) return;
    setSaveError('');
    setFormErrors([]);

    // Additional scope — field-level validation FIRST, rendered inline
    // under each bad field plus a summary, so a failed save is never a
    // silent no-op. The medicine expiry rule is now a visible field
    // error instead of an alert-only block. Clothing size/color and
    // cost>price remain explicit confirms (user decision, not silence).
    const fieldErrors = validateManualProductForm(formData, { isMedicine: currentCategory === 'medicine' });
    if (fieldErrors.length > 0) {
      setFormErrors(fieldErrors);
      setSaveError(t.invFormErrorSummary);
      return;
    }

    if (currentCategory === 'clothing') {
      if (!formData.size && !formData.color) {
        if (!window.confirm("⚠️ Fashion System Alert:\nYou haven't specified Size or Color. Are you sure?")) return;
      }
    }

    if (Number(formData.cost) > Number(formData.price)) {
      if (
        !window.confirm('⚠️ Profit Alert:\nBuying Price is higher than Selling Price. You will make a LOSS. Continue?')
      )
        return;
    }
    // -------------------------------------------

    const productToSave: any = {
      id: editingProduct ? editingProduct.id : crypto.randomUUID(),
      // Validation above already returned unless name is non-blank.
      name: (formData.name || '').trim(),
      nameBn: formData.nameBn || formData.name || '',
      category: formData.category || 'General',
      price: Number(formData.price) || 0,
      cost: Number(formData.cost) || 0,
      stock: Number(formData.stock) || 0,
      unit: formData.unit || 'pcs',
      image: formData.image,
      barcode: formData.barcode,
      supplier: formData.supplier,
    };

    // Store specific fields injection
    if (currentCategory === 'medicine') {
      productToSave.expiryDate = formData.expiryDate;
      productToSave.batchNumber = formData.batchNumber;
      productToSave.genericName = formData.genericName;
    }
    if (currentCategory === 'clothing') {
      productToSave.color = formData.color;
      productToSave.size = formData.size;
      productToSave.style = formData.style;
      productToSave.brand = formData.brand;
    }
    if (currentCategory === 'electronics') {
      productToSave.warranty = formData.warranty;
      productToSave.serialNumber = formData.serialNumber;
      productToSave.brand = formData.brand;
    }
    if (currentCategory === 'restaurant') {
      productToSave.dietaryType = formData.dietaryType;
      productToSave.preparationTime = formData.preparationTime;
    }
    if (currentCategory === 'grocery') {
      productToSave.expiryDate = formData.expiryDate;
    }

    setIsSaving(true);
    try {
      await StorageService.saveProduct(productToSave as Product);
      // Additional scope — remember last-used category/unit for the
      // next manual add (price/cost are deliberately not remembered).
      if (!editingProduct) saveLastManualAddDefaults({ category: productToSave.category, unit: productToSave.unit });
      if (mode === 'another' && !editingProduct) {
        setEditingProduct(null);
        setFormErrors([]);
        setFormData({
          name: '',
          nameBn: '',
          // 'Save & add another' keeps the just-saved category/unit
          // (previously it reset to General/pcs, costing two retypes).
          category: productToSave.category,
          price: 0,
          cost: 0,
          stock: 0,
          unit: productToSave.unit,
          image: '',
        });
      } else {
        setIsModalOpen(false);
      }
      await refetchProducts();
    } catch (error: any) {
      if (error.message === 'FREE_LIMIT_REACHED') {
        setIsModalOpen(false);
        setShowUpsell(true);
      } else {
        setSaveError(error?.body?.message || error?.message || 'Could not save this product. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const isExpired = (dateString?: string) => {
    if (!dateString) return false;
    return new Date(dateString) < new Date();
  };

  // Additional scope — visible text for each field error code.
  const formErrorText: Record<ManualFormErrorField, string> = {
    name: t.invFormErrorName,
    price: t.invFormErrorPrice,
    cost: t.invFormErrorCost,
    stock: t.invFormErrorStock,
    barcode: t.invFormErrorBarcode,
    expiryDate: t.invFormErrorExpiry,
  };
  const fieldError = (field: ManualFormErrorField) =>
    formErrors.includes(field) ? (
      <p data-testid={`inventory-form-error-${field}`} role="alert" className="text-xs text-red-700 mt-1">
        {formErrorText[field]}
      </p>
    ) : null;
  const clearFieldError = (field: ManualFormErrorField) => setFormErrors((prev) => prev.filter((f) => f !== field));

  // Helper styles based on theme color
  const getThemeColorClass = (type: 'text' | 'bg' | 'border' | 'button') => {
    const c = theme.color;
    if (type === 'text') return `text-${c}-600`;
    if (type === 'bg') return `bg-${c}-50`;
    if (type === 'border') return `border-${c}-200`;
    if (type === 'button') return `bg-${c}-600 hover:bg-${c}-700 text-white`;
    return '';
  };

  return (
    // Phase 6: pb-24 bottom padding — without it the last table row's
    // action buttons sit partially below the fold with no scroll room
    // left (the scroll container is already at max scroll), so they can
    // never be fully reached by mouse or by automation.
    <div className="p-4 md:p-6 pb-24 h-full flex flex-col">
      {showUpsell && (
        <SubscriptionModal
          lang={lang}
          onClose={() => setShowUpsell(false)}
          onSuccess={() => StorageService.getCurrentUser().then(setUser)}
        />
      )}

      {/* Header with Dynamic Theme */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">{t.inventory}</h2>
          <div
            className={`mt-1 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase ${getThemeColorClass('bg')} ${getThemeColorClass('text')} border ${getThemeColorClass('border')}`}
          >
            <ThemeIcon size={14} />
            {theme.label} System
          </div>

          {user?.plan === 'free' && (
            <div className="text-xs text-gray-500 mt-2 flex items-center gap-2">
              <span className="font-medium">
                Limit: {products.length}/{LIMITS.FREE_PRODUCT_LIMIT}
              </span>
              <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${products.length >= LIMITS.FREE_PRODUCT_LIMIT ? 'bg-red-500' : 'bg-gray-500'}`}
                  style={{ width: `${(products.length / LIMITS.FREE_PRODUCT_LIMIT) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
        <button
          onClick={() => handleOpenModal()}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition font-medium shadow-sm ${
            user?.plan === 'free' && products.length >= LIMITS.FREE_PRODUCT_LIMIT
              ? 'bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-200'
              : getThemeColorClass('button')
          }`}
        >
          {user?.plan === 'free' && products.length >= LIMITS.FREE_PRODUCT_LIMIT ? (
            <>
              <Crown size={18} /> {t.upgradeToPremium}
            </>
          ) : (
            <>
              <Plus size={18} /> {t.addProduct}
            </>
          )}
        </button>
      </div>

      <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <label className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            data-testid="inventory-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.invSearchPlaceholder}
            aria-label="Search inventory"
            className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {query && (
            <button
              type="button"
              data-testid="inventory-search-clear"
              aria-label={t.invClearSearch}
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-lg leading-none"
            >
              ×
            </button>
          )}
        </label>
        <div className="text-sm text-gray-600 whitespace-nowrap">
          {t.invItemsShown.replace('{n}', String(visibleProducts.length))} ·{' '}
          {t.invLowInView.replace('{n}', String(filteredLowStock.length))}
        </div>
        <button
          data-testid="inventory-low-stock-toggle"
          onClick={() => setShowLowOnly((v) => !v)}
          aria-pressed={showLowOnly}
          className={`px-3 py-2 rounded-lg text-sm font-bold border ${showLowOnly ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-200'}`}
        >
          {showLowOnly ? t.invShowAll : t.invLowStockToggle.replace('{n}', String(filteredLowStock.length))}
        </button>
      </div>

      {/* Phase 6 — barcode (camera scan + manual entry) + voice, on the
          Phase 5 design system. Neither path gates the other. */}
      <AdCard testid="inventory-barcode-panel" className="mb-4">
        <p className="text-sm font-bold text-gray-800 mb-2">Barcode — scan or type the printed code</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <AdInput
              testid="inventory-barcode-input"
              value={barcodeInput}
              onChange={setBarcodeInput}
              placeholder="Type barcode, e.g. 8901234567890"
              ariaLabel="Barcode"
              inputMode="numeric"
            />
          </div>
          <AdButton testid="inventory-barcode-lookup" onClick={() => void handleBarcodeLookup(barcodeInput)}>
            Look up
          </AdButton>
          <AdButton testid="inventory-barcode-scan" variant="ghost" onClick={() => setScanning((v) => !v)}>
            {scanning ? 'Hide camera' : '📷 Scan with camera'}
          </AdButton>
        </div>
        {barcodeError && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-red-700">
              {barcodeError}
            </p>
          </div>
        )}
        {/* Additional scope — barcode prefill no longer waits for a
            failed lookup: any typed/scanned code with no matching
            product offers one tap into the form with the code filled
            in (same testid as before, same single setFormData call). */}
        {barcodeInput.trim() && !barcodeResult && (
          <div className="mt-2">
            <AdButton
              variant="ghost"
              testid="inventory-barcode-add-new"
              onClick={() => handleOpenModal(undefined, { barcode: barcodeInput.trim() })}
            >
              {t.invAddFromBarcode}
            </AdButton>
          </div>
        )}
        {barcodeResult && (
          <div data-testid="inventory-barcode-result" className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span>
              Found: <strong>{barcodeResult.name}</strong> — ৳{barcodeResult.price} · {barcodeResult.stock}{' '}
              {barcodeResult.unit}
            </span>
            <AdButton variant="ghost" testid="inventory-barcode-edit" onClick={() => handleOpenModal(barcodeResult)}>
              Edit product
            </AdButton>
            <AdButton
              variant="ghost"
              testid="inventory-barcode-add-stock"
              onClick={async () => {
                await StorageService.saveProduct({ ...barcodeResult, stock: barcodeResult.stock + 1 });
                setBarcodeResult({ ...barcodeResult, stock: barcodeResult.stock + 1 });
                await refetchProducts();
              }}
            >
              +1 stock
            </AdButton>
          </div>
        )}
        {scanning && (
          <div className="mt-2">
            <BarcodeScanner
              onDetected={(code) => {
                setBarcodeInput(code);
                setScanning(false);
                void handleBarcodeLookup(code);
              }}
              onClose={() => setScanning(false)}
            />
          </div>
        )}
        <p className="text-[11px] text-gray-500 mt-2">
          No barcode? Use the search box above or “Add Product” — every product stays reachable without a barcode.
        </p>
      </AdCard>

      <div className="mb-4">
        <VoiceInventory
          lang={lang}
          products={products}
          onSearch={setQuery}
          onRequestAdd={(name) => {
            handleOpenModal();
            if (name) setFormData((prev) => ({ ...prev, name }));
          }}
          onSetStock={handleVoiceSetStock}
        />
      </div>

      {/* Additional scope — voice-to-add entry point. The panel saves
          through the same product-create API and refetches this list;
          manual add above and below stays fully usable without it. */}
      <div className="mb-4">
        <AdButton testid="inventory-voice-add-open" variant="ghost" onClick={() => setShowVoiceAdd((v) => !v)}>
          {t.invVoiceAddOpen}
        </AdButton>
        {showVoiceAdd && (
          <div className="mt-2">
            <VoiceAddProduct lang={lang} onSaved={() => void refetchProducts()} />
          </div>
        )}
      </div>

      {/* Phase 6 — low-stock list (visible badges, one tap to the product).
          Item 5 (b): chips follow the active search (filteredLowStock),
          so the count and the chips always match the list on screen,
          and the panel hides in low-stock-only view, where the table
          already IS that list. Chip taps use the displayed (Bn/En) name. */}
      {filteredLowStock.length > 0 && !showLowOnly && (
        <AdCard testid="inventory-low-stock-list" className="mb-4">
          <p className="text-sm font-bold text-red-700 mb-2">
            {t.invLowStockTitle.replace('{n}', String(filteredLowStock.length))}
          </p>
          <div className="flex flex-wrap gap-2">
            {filteredLowStock.map((p) => (
              <button
                key={p.id}
                data-testid={`inventory-low-stock-${p.id}`}
                onClick={() => setQuery(lang === 'bn' ? p.nameBn || p.name : p.name)}
                className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700"
              >
                {lang === 'bn' ? p.nameBn || p.name : p.name} · {p.stock} {p.unit}
              </button>
            ))}
          </div>
        </AdCard>
      )}

      {/* Phase 6 — bulk actions (safe set: stock adjust, price set, delete
          with confirmation; per-product skips are reported, never hidden). */}
      <AdCard testid="inventory-bulk-panel" className="mb-4">
        <p className="text-sm font-bold text-gray-800 mb-2">
          {t.invBulkSelected.replace('{n}', String(selectedIds.size))}
        </p>
        {hiddenSelection > 0 && (
          <p className="text-xs text-amber-700 mb-2">{t.invSelectedHidden.replace('{n}', String(hiddenSelection))}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-28">
            <AdInput
              testid="inventory-bulk-delta"
              value={bulkDelta}
              onChange={setBulkDelta}
              placeholder="± stock"
              ariaLabel="Bulk stock delta"
              type="number"
            />
          </div>
          <AdButton testid="inventory-bulk-adjust" variant="ghost" onClick={() => void handleBulk('adjust-stock')}>
            {selectedIds.size > 0 && bulkDeltaValid
              ? t.invAdjustStockPreview
                  .replace('{delta}', formatStockDelta(bulkDeltaNumber))
                  .replace('{n}', String(selectedIds.size))
              : t.invAdjustStock}
          </AdButton>
          <div className="w-28">
            <AdInput
              testid="inventory-bulk-price"
              value={bulkPrice}
              onChange={setBulkPrice}
              placeholder="New price"
              ariaLabel="Bulk new price"
              type="number"
            />
          </div>
          <AdButton testid="inventory-bulk-price-btn" variant="ghost" onClick={() => void handleBulk('set-price')}>
            {selectedIds.size > 0 && bulkPriceValid
              ? t.invSetPricePreview
                  .replace('{price}', String(bulkPriceNumber))
                  .replace('{n}', String(selectedIds.size))
              : t.invSetPrice}
          </AdButton>
          <AdButton testid="inventory-bulk-delete" variant="danger" onClick={() => void handleBulk('delete')}>
            {selectedIds.size > 0
              ? t.invDeleteSelectedPreview.replace('{n}', String(selectedIds.size))
              : t.invDeleteSelected}
          </AdButton>
          <button
            data-testid="inventory-select-all"
            onClick={() =>
              setSelectedIds(
                unionSelection(
                  selectedIds,
                  visibleProducts.map((p) => p.id),
                ),
              )
            }
            className="text-sm font-bold text-emerald-700 underline"
          >
            {t.invSelectAllShown}
          </button>
          <button
            data-testid="inventory-deselect-shown"
            onClick={() =>
              setSelectedIds(
                deselectVisibleSelection(
                  selectedIds,
                  visibleProducts.map((p) => p.id),
                ),
              )
            }
            className="text-sm font-bold text-gray-600 underline"
          >
            {t.invDeselectShown}
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-sm font-bold text-gray-600 underline">
            {t.invClearSelection}
          </button>
        </div>
        {bulkMessage && (
          <p data-testid="inventory-bulk-message" role="status" className="text-sm text-gray-800 mt-2">
            {bulkMessage}
          </p>
        )}
      </AdCard>
      {loading && (
        <p role="status" className="mb-3 text-sm text-gray-500">
          Loading inventory…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <span>Could not refresh inventory. Your last loaded list is kept on screen.</span>
          <button onClick={() => refetchProducts()} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}
      {saveError && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {saveError}
        </p>
      )}

      {/* Phase 6: pb-24 INSIDE the scroll container — without it the last
          row's action buttons stop exactly at the viewport's bottom edge
          (center on the edge, so no click can land on them). */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 overflow-auto pb-24">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead className="bg-gray-50 text-gray-600 font-medium text-sm sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="p-4">
                <input
                  type="checkbox"
                  data-testid="inventory-select-all-visible"
                  checked={allVisibleSelected}
                  onChange={() =>
                    setSelectedIds(
                      allVisibleSelected
                        ? deselectVisibleSelection(
                            selectedIds,
                            visibleProducts.map((p) => p.id),
                          )
                        : unionSelection(
                            selectedIds,
                            visibleProducts.map((p) => p.id),
                          ),
                    )
                  }
                  aria-label={t.invSelectAllShown}
                />
              </th>
              <th className="p-4">{t.item}</th>

              {/* ISOLATED COLUMNS */}
              {currentCategory === 'medicine' && <th className="p-4">{t.genericName}</th>}
              {currentCategory === 'medicine' && <th className="p-4">{t.expiryDate}</th>}

              {currentCategory === 'clothing' && (
                <th className="p-4">
                  {t.size} / {t.color}
                </th>
              )}
              {currentCategory === 'clothing' && <th className="p-4">{t.brand}</th>}

              {currentCategory === 'electronics' && <th className="p-4">{t.serialNumber}</th>}
              {currentCategory === 'electronics' && <th className="p-4">{t.warranty}</th>}

              {currentCategory === 'restaurant' && <th className="p-4">{t.dietaryType}</th>}
              {currentCategory === 'restaurant' && <th className="p-4">{t.prepTime}</th>}

              <th className="p-4 text-right">{t.cost}</th>
              <th className="p-4 text-right">{t.price}</th>
              <th className="p-4 text-center">{t.stockLevel}</th>
              <th className="p-4 text-center">{t.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleProducts.length === 0 && !loading && (
              <tr>
                <td colSpan={11} className="p-10 text-center text-gray-500">
                  {!query && !showLowOnly
                    ? t.invNoProducts
                    : showLowOnly
                      ? query
                        ? t.invNoLowInSearch
                        : t.invNoLowStock
                      : t.invNoMatch}
                </td>
              </tr>
            )}
            {visibleProducts.map((p) => (
              <tr key={p.id} className={`hover:bg-gray-50 transition-colors`}>
                <td className="p-4">
                  <input
                    type="checkbox"
                    data-testid={`inventory-select-${p.id}`}
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    aria-label={`Select ${p.name}`}
                  />
                </td>
                <td className="p-4 font-medium text-gray-800">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center overflow-hidden hidden sm:block border border-gray-200 shrink-0">
                      {p.image ? (
                        <img src={p.image} className="w-full h-full object-cover" />
                      ) : (
                        <ThemeIcon size={20} className="text-gray-400" />
                      )}
                    </div>
                    <div>
                      <div>{lang === 'bn' ? p.nameBn : p.name}</div>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>{p.category}</span>
                        {p.barcode && (
                          <span className="bg-gray-100 px-1 rounded flex items-center gap-0.5">
                            <ScanBarcode size={10} />
                            {p.barcode}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>

                {/* MEDICINE COLUMNS */}
                {currentCategory === 'medicine' && (
                  <>
                    <td className="p-4 text-sm text-gray-600 font-mono">{p.genericName || '-'}</td>
                    <td className="p-4 text-sm">
                      {p.expiryDate ? (
                        <span className={isExpired(p.expiryDate) ? 'text-red-600 font-bold' : 'text-gray-600'}>
                          {new Date(p.expiryDate).toLocaleDateString()}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </>
                )}

                {/* CLOTHING COLUMNS */}
                {currentCategory === 'clothing' && (
                  <>
                    <td className="p-4 text-sm text-gray-600">
                      {p.size && <span className="bg-gray-100 px-1.5 rounded font-bold mr-1">{p.size}</span>}
                      {p.color}
                    </td>
                    <td className="p-4 text-sm text-gray-600">{p.brand}</td>
                  </>
                )}

                {/* ELECTRONICS COLUMNS */}
                {currentCategory === 'electronics' && (
                  <>
                    <td className="p-4 text-sm font-mono text-gray-600">{p.serialNumber || '-'}</td>
                    <td className="p-4 text-sm text-gray-600">{p.warranty}</td>
                  </>
                )}

                {/* RESTAURANT COLUMNS */}
                {currentCategory === 'restaurant' && (
                  <>
                    <td className="p-4 text-sm">
                      {p.dietaryType && (
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-bold ${p.dietaryType === 'veg' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                        >
                          {p.dietaryType.toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-sm text-gray-600">
                      {p.preparationTime ? `${p.preparationTime} min` : '-'}
                    </td>
                  </>
                )}

                <td className="p-4 text-right text-gray-500 text-sm">৳{p.cost}</td>
                <td className="p-4 text-right font-medium text-gray-900">৳{p.price}</td>
                <td className="p-4 text-center">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-bold ${p.stock < 10 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}
                  >
                    {p.stock} {p.unit}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      data-testid={`inventory-stock-minus-${p.id}`}
                      disabled={p.stock <= 0 || quickAdjustingId === p.id}
                      onClick={() => void handleQuickAdjust(p, -1)}
                      className="px-1.5 py-0.5 text-base font-bold text-gray-700 hover:bg-gray-100 rounded disabled:opacity-40"
                      aria-label={`${t.invStockMinus} ${p.name}`}
                    >
                      −
                    </button>
                    <button
                      data-testid={`inventory-stock-plus-${p.id}`}
                      disabled={quickAdjustingId === p.id}
                      onClick={() => void handleQuickAdjust(p, 1)}
                      className="px-1.5 py-0.5 text-base font-bold text-gray-700 hover:bg-gray-100 rounded disabled:opacity-40"
                      aria-label={`${t.invStockPlus} ${p.name}`}
                    >
                      +
                    </button>
                    <button
                      onClick={() => handleOpenModal(p)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                      aria-label={`Edit ${p.name}`}
                    >
                      <Edit2 size={16} />
                    </button>
                    {/* Additional scope — quick-add for repeat items. */}
                    <button
                      data-testid={`inventory-add-similar-${p.id}`}
                      onClick={() => handleOpenSimilar(p)}
                      className="p-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded"
                      aria-label={`${t.invAddSimilar} ${p.name}`}
                      title={t.invAddSimilar}
                    >
                      + {t.invAddSimilar}
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      aria-label={`Delete ${p.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                    <button
                      data-testid={`inventory-history-${p.id}`}
                      onClick={() => void loadHistory(p.id)}
                      className="p-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded"
                    >
                      History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phase 6 — per-product stock movement history from /inventory-logs. */}
      {historyProductId && (
        <AdCard testid="inventory-history-panel" className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-gray-800">
              Stock movement — {products.find((p) => p.id === historyProductId)?.name || historyProductId}
            </p>
            <button onClick={() => setHistoryProductId(null)} className="text-sm font-bold text-gray-600 underline">
              Close
            </button>
          </div>
          {historyError && (
            <p role="alert" className="text-sm text-red-700 mt-2">
              {historyError}
            </p>
          )}
          {historyLogs.length === 0 && !historyError ? (
            <p className="text-sm text-gray-500 mt-2">No movements recorded for this product yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {historyLogs.map((log) => (
                <li
                  key={log.id}
                  data-testid={`inventory-history-row-${log.id}`}
                  className="flex flex-wrap gap-2 text-gray-700"
                >
                  <span className="font-bold">{log.type}</span>
                  <span>
                    {log.quantity} · {log.reason}
                  </span>
                  <span className="text-gray-400">{new Date(log.date).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </AdCard>
      )}

      {/* Dynamic Modal based on Category */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                {editingProduct ? <Edit2 size={18} /> : <Plus size={18} />}
                {editingProduct ? t.actions : t.addProduct}
              </h3>
              <button onClick={() => setIsModalOpen(false)}>
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-6">
              {/* --- Basic Info Section --- */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider border-b pb-1">
                  Basic Information
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                    <input
                      type="text"
                      required
                      autoFocus
                      data-testid="inventory-form-name"
                      className="input-field"
                      value={formData.name || ''}
                      onChange={(e) => {
                        clearFieldError('name');
                        setFormData({ ...formData, name: e.target.value });
                      }}
                    />
                    {fieldError('name')}
                  </div>
                  {!editingProduct && (
                    <p className="col-span-2 text-[11px] text-gray-500 -mt-2">{t.invSmartDefaultsHint}</p>
                  )}
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bangla Name</label>
                    <input
                      type="text"
                      className="input-field"
                      value={formData.nameBn || ''}
                      onChange={(e) => setFormData({ ...formData, nameBn: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stock Quantity</label>
                    <input
                      type="number"
                      required
                      data-testid="inventory-form-stock"
                      className="input-field"
                      value={formData.stock || ''}
                      onChange={(e) => {
                        clearFieldError('stock');
                        setFormData({ ...formData, stock: Number(e.target.value) });
                      }}
                    />
                    {fieldError('stock')}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                    <input
                      type="text"
                      data-testid="inventory-form-unit"
                      className="input-field"
                      value={formData.unit || ''}
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                      placeholder="pcs, kg, box"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <input
                      type="text"
                      data-testid="inventory-form-category"
                      className="input-field"
                      value={formData.category || ''}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Barcode (Optional)</label>
                    <div className="relative">
                      <ScanBarcode size={16} className="absolute top-3 left-3 text-gray-400" />
                      <input
                        type="text"
                        data-testid="inventory-form-barcode"
                        className="input-field pl-9"
                        value={formData.barcode || ''}
                        onChange={(e) => {
                          clearFieldError('barcode');
                          setFormData({ ...formData, barcode: e.target.value });
                        }}
                      />
                    </div>
                    {fieldError('barcode')}
                  </div>
                </div>
              </div>

              {/* --- Pricing & Profit Section (Enhanced) --- */}
              <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                <h4 className="text-sm font-bold text-emerald-800 uppercase tracking-wider border-b border-emerald-200 pb-1 mb-3 flex items-center gap-2">
                  <TrendingUp size={16} /> Pricing & Profit
                </h4>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Buying Price (Cost)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-gray-400 font-bold">৳</span>
                      <input
                        type="number"
                        required
                        min="0"
                        data-testid="inventory-form-cost"
                        className="input-field pl-7 bg-white border-gray-300 focus:border-emerald-500 focus:ring-emerald-500"
                        value={formData.cost || ''}
                        onChange={(e) => {
                          clearFieldError('cost');
                          setFormData({ ...formData, cost: Number(e.target.value) });
                        }}
                        placeholder="0.00"
                      />
                    </div>
                    {fieldError('cost')}
                    <p className="text-[10px] text-gray-500 mt-1">Cost to purchase/produce</p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-emerald-700 mb-1">Selling Price</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-emerald-600 font-bold">৳</span>
                      <input
                        type="number"
                        required
                        min="0"
                        data-testid="inventory-form-price"
                        className="input-field pl-7 font-bold text-emerald-900 bg-white border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500"
                        value={formData.price || ''}
                        onChange={(e) => {
                          clearFieldError('price');
                          setFormData({ ...formData, price: Number(e.target.value) });
                        }}
                        placeholder="0.00"
                      />
                    </div>
                    {fieldError('price')}
                  </div>
                </div>

                {/* Margin Indicator */}
                {calculatedMargin && (
                  <div
                    className={`mt-3 flex items-center justify-between p-2 rounded-lg ${calculatedMargin.profit > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}
                  >
                    <div className="text-xs font-bold uppercase">Estimated Profit:</div>
                    <div className="text-sm font-bold flex items-center gap-2">
                      <span>৳{calculatedMargin.profit.toFixed(2)}</span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full ${calculatedMargin.profit > 0 ? 'bg-white/50' : 'bg-red-200'}`}
                      >
                        {calculatedMargin.percent.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* --- STORE SPECIFIC FIELDS (ISOLATED) --- */}

              {currentCategory === 'medicine' && (
                <div className="bg-cyan-50 p-4 rounded-lg border border-cyan-100">
                  <h4 className="text-sm font-bold text-cyan-700 mb-3 flex items-center gap-1">
                    <Pill size={14} /> Medicine Details
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-600 mb-1">Generic Name</label>
                      <input
                        type="text"
                        className="input-field"
                        value={formData.genericName || ''}
                        onChange={(e) => setFormData({ ...formData, genericName: e.target.value })}
                        placeholder="e.g. Paracetamol"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Batch No</label>
                      <input
                        type="text"
                        className="input-field"
                        value={formData.batchNumber || ''}
                        onChange={(e) => setFormData({ ...formData, batchNumber: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-red-600 mb-1 flex items-center gap-1">
                        Expiry Date <AlertCircle size={10} />
                      </label>
                      <input
                        type="date"
                        className="input-field border-red-200 focus:border-red-500"
                        value={formData.expiryDate || ''}
                        onChange={(e) => {
                          clearFieldError('expiryDate');
                          setFormData({ ...formData, expiryDate: e.target.value });
                        }}
                      />
                      {fieldError('expiryDate')}
                    </div>
                  </div>
                </div>
              )}

              {currentCategory === 'clothing' && (
                <div className="bg-violet-50 p-4 rounded-lg border border-violet-100">
                  <h4 className="text-sm font-bold text-violet-700 mb-3 flex items-center gap-1">
                    <Shirt size={14} /> Apparel Details
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Brand</label>
                      <input
                        type="text"
                        className="input-field"
                        value={formData.brand || ''}
                        onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-violet-700 mb-1">Size</label>
                      <input
                        type="text"
                        className="input-field border-violet-200"
                        value={formData.size || ''}
                        onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                        placeholder="S, M, L, XL"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-violet-700 mb-1">Color</label>
                      <input
                        type="text"
                        className="input-field border-violet-200"
                        value={formData.color || ''}
                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Style Code</label>
                      <input
                        type="text"
                        className="input-field"
                        value={formData.style || ''}
                        onChange={(e) => setFormData({ ...formData, style: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {currentCategory === 'electronics' && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                  <h4 className="text-sm font-bold text-blue-700 mb-3 flex items-center gap-1">
                    <Zap size={14} /> Device Details
                  </h4>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-blue-700 mb-1">Serial / IMEI Number</label>
                      <input
                        type="text"
                        className="input-field font-mono border-blue-200"
                        value={formData.serialNumber || ''}
                        onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Warranty Period</label>
                      <input
                        type="text"
                        className="input-field"
                        value={formData.warranty || ''}
                        onChange={(e) => setFormData({ ...formData, warranty: e.target.value })}
                        placeholder="e.g. 1 Year Official"
                      />
                    </div>
                  </div>
                </div>
              )}

              {currentCategory === 'restaurant' && (
                <div className="bg-orange-50 p-4 rounded-lg border border-orange-100">
                  <h4 className="text-sm font-bold text-orange-700 mb-3 flex items-center gap-1">
                    <Utensils size={14} /> Menu Details
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Dietary Type</label>
                      <select
                        className="input-field bg-white"
                        value={formData.dietaryType || ''}
                        onChange={(e) => setFormData({ ...formData, dietaryType: e.target.value as any })}
                      >
                        <option value="">None</option>
                        <option value="veg">Vegetarian</option>
                        <option value="non-veg">Non-Veg</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Prep Time (min)</label>
                      <input
                        type="number"
                        className="input-field"
                        value={formData.preparationTime || ''}
                        onChange={(e) => setFormData({ ...formData, preparationTime: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {saveError && (
                <p role="alert" className="text-sm text-red-700">
                  {saveError}
                </p>
              )}
              <div className="pt-2 space-y-2 border-t">
                <div className="flex gap-3">
                  <button
                    type="button"
                    data-testid="inventory-form-cancel"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    data-testid="inventory-form-save"
                    disabled={isSaving}
                    className={`flex-1 py-2.5 text-white rounded-lg flex justify-center items-center gap-2 font-bold shadow-md disabled:opacity-60 ${getThemeColorClass('button')}`}
                  >
                    <Save size={18} /> {isSaving ? 'Saving…' : t.save}
                  </button>
                </div>
                {!editingProduct && (
                  <button
                    type="button"
                    data-testid="inventory-save-add-another"
                    disabled={isSaving}
                    onClick={() => void saveForm('another')}
                    className="w-full py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium disabled:opacity-60"
                  >
                    {t.invSaveAddAnother}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
          .input-field {
              width: 100%;
              padding: 0.6rem;
              border: 1px solid #e2e8f0;
              border-radius: 0.5rem;
              outline: none;
              font-size: 0.95rem;
              transition: all 0.2s;
          }
          .input-field:focus {
              border-color: #cbd5e1;
              box-shadow: 0 0 0 3px rgba(226, 232, 240, 0.4);
          }
      `}</style>
    </div>
  );
};

export default Inventory;
