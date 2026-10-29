// ADDITIONAL SCOPE — voice-to-add inventory (new product only).
//
// WHY GUIDED STEPS, NOT ONE FREE-FORM UTTERANCE: the existing
// services/voice.ts listenOnce() returns a PARSED VoiceCommand
// (query + one quantity), not a raw transcript — so a single spoken
// sentence "rice price 120 stock 30" cannot be recovered faithfully
// from it (only the first number survives). The voice path therefore
// captures one field per listen: name as the parsed query, price and
// stock as the parsed quantity, category as the parsed query again.
// Each captured value is shown on screen and editable as text before
// the next step, so a misheard value is corrected, never saved blind.
//
// The TYPED path parses a whole command at once (parseVoiceAddCommand
// below, unit-testable) and lands on the same confirmation screen.
// Both paths share one hard rule: NOTHING is written until the user
// taps "Save product" on the confirmation screen, which shows exactly
// what will be saved (including defaults for fields not given).
// A rejected / unclear command never creates a product: it shows an
// error, keeps the draft unsaved, and offers re-speak / re-type.
// Voice never gates adding: the typed input and the manual form in
// Inventory stay fully usable with voice off or unsupported.
//
// Saves use the existing product-create API (StorageService.saveProduct
// -> POST /products); no new endpoint is needed. Money is sent as plain
// taka numbers exactly like the manual form; the server recalculates
// sale totals, and product price/cost are stored as given.
import React, { useState } from 'react';
import { Language, Product } from '../types';
import { TRANSLATIONS } from '../constants';
import { StorageService } from '../services/storage';
import { listenOnce, isSpeechRecognitionSupported } from '../services/voice';
import { normalizeDigits } from '../shared/phase3';
import { AdButton, AdCard, AdInput } from './ui';

export interface VoiceAddDraft {
  name: string;
  price: string;
  cost: string;
  stock: string;
  unit: string;
  category: string;
  barcode: string;
}

export const EMPTY_VOICE_ADD_DRAFT: VoiceAddDraft = {
  name: '',
  price: '',
  cost: '',
  stock: '',
  unit: 'pcs',
  category: 'General',
  barcode: '',
};

/**
 * Parse a whole typed (or typed-fallback) voice-add command into fields.
 * Bangla digits are normalized; labelled numbers win over bare numbers.
 *
 *   "add rice price 120 stock 30 category grocery"
 *   "চাল যোগ কর দাম ১২০ টাকা স্টক ৩০ ক্যাটাগরি মুদি"
 *   "নতুন পণ্য চিনি দাম ৮০ স্টক ১৫"
 *
 * Rules (documented so a wrong parse is visible, not silent):
 * - price: number after দাম/মূল্য/price; else the FIRST bare number.
 * - stock: number after স্টক/মজুদ/stock; else the SECOND bare number.
 * - category: words after ক্যাটাগরি/বিভাগ/category, up to the next marker.
 * - name: whatever remains after removing command words, markers, numbers
 *   and currency words. Empty name => unclear (caller must not save).
 * - cost is never guessed from speech: it defaults to 0 on confirmation
 *   and the user may edit it there. Guessing a cost would silently
 *   invent profit figures.
 */
export function parseVoiceAddCommand(raw: string): {
  draft: VoiceAddDraft;
  unclear: boolean;
  missing: Array<'name' | 'price' | 'stock' | 'category'>;
} {
  const norm = normalizeDigits((raw || '').trim());
  if (!norm) {
    return { draft: { ...EMPTY_VOICE_ADD_DRAFT }, unclear: true, missing: ['name', 'price', 'stock', 'category'] };
  }
  let text = norm;
  // Category is captured BEFORE numbers are stripped, so a category
  // word is never eaten as part of the name.
  let category = '';
  const catMatch = text.match(/(?:ক্যাটাগরি|বিভাগ|category)\s*:?\s*([^,]+)/i);
  if (catMatch) {
    category = catMatch[1]
      .replace(/(?:দাম|মূল্য|price|স্টক|মজুদ|stock|যোগ কর|যোগ|add|বারকোড|barcode).*$/i, '')
      .replace(/\s+\d+.*$/, '')
      .trim();
    text = text.replace(catMatch[0], ' ');
  }
  const priceMatch = text.match(/(?:দাম|মূল্য|price)\s*:?\s*(\d+(?:\.\d+)?)/i);
  const price = priceMatch ? priceMatch[1] : '';
  if (priceMatch) text = text.replace(priceMatch[0], ' ');
  const stockMatch = text.match(/(?:স্টক|মজুদ|stock)\s*:?\s*(\d+(?:\.\d+)?)/i);
  const stock = stockMatch ? stockMatch[1] : '';
  if (stockMatch) text = text.replace(stockMatch[0], ' ');
  // Bare numbers left: STANDALONE tokens only — a digit glued to a
  // word ("Phase6") is part of the name and must never become a price.
  const bare = text
    .split(/\s+/)
    .filter((token) => /^\d+(?:\.\d+)?$/.test(token));
  let finalPrice = price;
  let finalStock = stock;
  let bareIndex = 0;
  if (!finalPrice && bare[bareIndex]) {
    finalPrice = bare[bareIndex];
    bareIndex += 1;
  }
  if (!finalStock && bare[bareIndex]) finalStock = bare[bareIndex];
  text = text.replace(/(^|\s)\d+(?:\.\d+)?(?=\s|$)/g, ' ');
  // Name = remaining words, with command/filler words removed as
  // STANDALONE tokens only (one leading command phrase, one trailing
  // verb). A product actually named "... Stock Item" keeps its word:
  // the labelled "stock 5" segment was already removed above, and a
  // global strip would have eaten the name's own word.
  const name = text
    .replace(/^(নতুন পণ্য|new product|যোগ কর|add)\s+/i, '')
    .replace(/\s+(যোগ কর|দাও|করো|কর)$/i, '')
    .split(/\s+/)
    // Exact-token command/filler words only: "যোগ" as its own token is
    // a command word, while "যোগাযোগ" or "দামি" (different tokens)
    // survive untouched.
    .filter(
      (token) =>
        ![
          'টা', 'টি', 'পিস', 'pcs', 'piece', 'pieces', 'টাকা', 'taka', '৳',
          'যোগ', 'কর', 'দাও', 'করো', 'add',
          'দাম', 'মূল্য', 'price', 'স্টক', 'মজুদ', 'stock', 'ক্যাটাগরি', 'বিভাগ', 'category',
        ].includes(token),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const draft: VoiceAddDraft = {
    ...EMPTY_VOICE_ADD_DRAFT,
    name,
    price: finalPrice,
    stock: finalStock ? String(Math.floor(Number(finalStock))) : '',
    category: category || 'General',
  };
  const missing: Array<'name' | 'price' | 'stock' | 'category'> = [];
  if (!name) missing.push('name');
  if (!finalPrice) missing.push('price');
  if (!finalStock) missing.push('stock');
  if (!category) missing.push('category');
  // Unclear = no usable name at all. A missing price/stock/category is
  // NOT unclear: confirmation shows it as "not given" and the user
  // fills it in before any save. Saving with an empty name, however,
  // would create a nameless product — that is always rejected.
  return { draft, unclear: !name, missing };
}

/** Field-level validation of a confirmation draft. Empty = saveable. */
export function validateVoiceAddDraft(draft: VoiceAddDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('name');
  if (draft.price.trim() === '' || !Number.isFinite(Number(draft.price)) || Number(draft.price) < 0) errors.push('price');
  if (draft.cost.trim() !== '' && (!Number.isFinite(Number(draft.cost)) || Number(draft.cost) < 0)) errors.push('cost');
  if (draft.stock.trim() === '' || !Number.isInteger(Number(draft.stock)) || Number(draft.stock) < 0) errors.push('stock');
  if (draft.barcode && (draft.barcode.length > 128 || /\s/.test(draft.barcode))) errors.push('barcode');
  return errors;
}

type Step = 'name' | 'price' | 'stock' | 'category' | 'confirm';

const STEP_ORDER: Step[] = ['name', 'price', 'stock', 'category', 'confirm'];

interface Props {
  lang: Language;
  onSaved?: (product: Product) => void;
}

const VoiceAddProduct: React.FC<Props> = ({ lang, onSaved }) => {
  const t = TRANSLATIONS[lang];
  const [step, setStep] = useState<Step>('name');
  const [draft, setDraft] = useState<VoiceAddDraft>({ ...EMPTY_VOICE_ADD_DRAFT });
  const [typedCommand, setTypedCommand] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const recognitionSupported = isSpeechRecognitionSupported();

  const setField = (field: keyof VoiceAddDraft, value: string) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const stepValue = (s: Step): string =>
    s === 'name' ? draft.name : s === 'price' ? draft.price : s === 'stock' ? draft.stock : draft.category;

  const advance = () => {
    const idx = STEP_ORDER.indexOf(step);
    setError('');
    setStep(STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)]);
  };

  const canAdvanceFromStep = (): boolean => {
    if (step === 'name') return draft.name.trim().length > 0;
    if (step === 'price') return draft.price.trim() !== '' && Number.isFinite(Number(draft.price)) && Number(draft.price) >= 0;
    if (step === 'stock') return draft.stock.trim() !== '' && Number.isInteger(Number(draft.stock)) && Number(draft.stock) >= 0;
    return true; // category: 'General' default is always valid; user may edit it
  };

  /** One guided listen for the current step. Returns nothing on failure. */
  const handleListen = async () => {
    setListening(true);
    setError('');
    try {
      const cmd = await listenOnce(lang);
      if (step === 'name' || step === 'category') {
        const value = (cmd.query || '').trim();
        if (!value) {
          setError(t.voiceAddUnclear);
          return;
        }
        setField(step, value);
      } else {
        // Price / stock arrive as the parsed quantity of the utterance
        // (e.g. spoken "৫০" -> quantity 50). A quantity of 0 with no
        // query is treated as unclear, never as a free product.
        if (!Number.isFinite(cmd.quantity) || cmd.quantity < 0 || (cmd.quantity === 0 && !cmd.query)) {
          setError(t.voiceAddUnclear);
          return;
        }
        if (step === 'price') setField('price', String(cmd.quantity));
        else setField('stock', String(Math.floor(cmd.quantity)));
      }
    } catch {
      // Every mic failure lands on the typed fallback, never a dead end.
      setError(t.voiceAddMicFallback);
    } finally {
      setListening(false);
    }
  };

  /** Typed whole-command path: same parser, same confirmation screen. */
  const handleTypedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { draft: parsed, unclear } = parseVoiceAddCommand(typedCommand);
    if (unclear) {
      setError(t.voiceAddUnclear);
      return;
    }
    setDraft({ ...parsed, cost: '', unit: 'pcs' });
    setTypedCommand('');
    setError('');
    setStep('confirm');
  };

  const handleSave = async () => {
    const errors = validateVoiceAddDraft(draft);
    if (errors.length > 0) {
      setSaveError(t.voiceAddConfirmHint);
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const product: Product = {
        id: crypto.randomUUID(),
        name: draft.name.trim(),
        nameBn: draft.name.trim(),
        category: draft.category.trim() || 'General',
        price: Number(draft.price),
        cost: draft.cost.trim() === '' ? 0 : Number(draft.cost),
        stock: Number(draft.stock),
        unit: draft.unit.trim() || 'pcs',
        barcode: draft.barcode.trim() || undefined,
      };
      const savedProduct = await StorageService.saveProduct(product);
      setSaved(true);
      onSaved?.(savedProduct || product);
    } catch (err: any) {
      setSaveError(err?.body?.message || err?.message || 'Could not save this product. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft({ ...EMPTY_VOICE_ADD_DRAFT });
    setStep('name');
    setError('');
    setSaveError('');
    setSaved(false);
  };

  const stepLabel =
    step === 'name'
      ? t.voiceAddStepName
      : step === 'price'
        ? t.voiceAddStepPrice
        : step === 'stock'
          ? t.voiceAddStepStock
          : step === 'category'
            ? t.voiceAddStepCategory
            : t.voiceAddConfirmTitle;

  if (saved) {
    return (
      <AdCard testid="voice-add-product">
        <p role="status" data-testid="voice-add-saved" className="text-sm font-bold text-emerald-700">
          {t.voiceAddSaved} {draft.name} — ৳{draft.price} · {draft.stock} {draft.unit}
        </p>
        <p className="text-sm text-gray-600 mt-1">Check it in the inventory list below.</p>
        <div className="mt-3">
          <AdButton testid="voice-add-another" variant="ghost" onClick={reset}>
            {t.voiceAddAddAnother}
          </AdButton>
        </div>
      </AdCard>
    );
  }

  return (
    <AdCard testid="voice-add-product">
      <p className="text-sm font-bold text-gray-800">{t.voiceAddTitle}</p>
      <p className="text-xs text-gray-600 mt-1">{t.voiceAddHint}</p>

      {step !== 'confirm' ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm font-bold text-gray-800">{stepLabel}</p>
          <div className="flex flex-wrap gap-2">
            <AdButton
              testid="voice-add-listen"
              variant="ghost"
              disabled={!recognitionSupported || listening}
              onClick={() => void handleListen()}
            >
              {listening ? t.voiceAddListening : t.voiceAddSpeak}
            </AdButton>
            {!recognitionSupported && <p className="text-xs text-gray-600">{t.voiceAddMicFallback}</p>}
          </div>
          {/* Text correction for the current step — always visible, so a
              misheard value is fixed by typing, never by re-speaking. */}
          <div>
            <AdInput
              testid="voice-add-step-input"
              value={stepValue(step)}
              onChange={(v) => setField(step, v)}
              ariaLabel={stepLabel}
              placeholder={stepLabel}
            />
          </div>
          {error && (
            <p role="alert" data-testid="voice-add-error" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            {STEP_ORDER.indexOf(step) > 0 && (
              <AdButton
                testid="voice-add-back"
                variant="ghost"
                onClick={() => setStep(STEP_ORDER[STEP_ORDER.indexOf(step) - 1])}
              >
                {t.voiceAddBack}
              </AdButton>
            )}
            <AdButton
              testid="voice-add-next"
              disabled={!canAdvanceFromStep()}
              onClick={() => {
                if (!canAdvanceFromStep()) {
                  setError(t.voiceAddUnclear);
                  return;
                }
                advance();
              }}
            >
              {step === 'category' ? t.voiceAddToConfirmation : t.voiceAddNext}
            </AdButton>
          </div>
          <p className="text-[11px] text-gray-500">
            Captured so far: {draft.name || '—'} · ৳{draft.price || '—'} · {draft.stock || '—'} · {draft.category}
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3" data-testid="voice-add-confirmation">
          <p className="text-sm font-bold text-gray-800">{t.voiceAddConfirmTitle}</p>
          <p className="text-xs text-gray-600">{t.voiceAddConfirmHint}</p>
          <dl className="text-sm space-y-1 bg-white border rounded-lg p-3">
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{t.voiceAddFieldName}</dt>
              <dd data-testid="voice-add-confirm-name" className="font-bold">{draft.name || t.voiceAddMissing}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{t.voiceAddFieldPrice}</dt>
              <dd data-testid="voice-add-confirm-price" className="font-bold">৳{draft.price || t.voiceAddMissing}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{t.voiceAddFieldCost}</dt>
              <dd data-testid="voice-add-confirm-cost" className="font-bold">৳{draft.cost.trim() === '' ? '0' : draft.cost}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{t.voiceAddFieldStock}</dt>
              <dd data-testid="voice-add-confirm-stock" className="font-bold">{draft.stock || t.voiceAddMissing} {draft.unit}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{t.voiceAddFieldCategory}</dt>
              <dd data-testid="voice-add-confirm-category" className="font-bold">{draft.category}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">{t.voiceAddFieldBarcode}</dt>
              <dd data-testid="voice-add-confirm-barcode" className="font-bold">{draft.barcode || '—'}</dd>
            </div>
          </dl>
          {/* Confirmation fields are editable: the summary above and
              these inputs are the same draft, so what you see is
              exactly what Save will write. */}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold text-gray-600">
              {t.voiceAddFieldName}
              <input
                data-testid="voice-add-confirm-input-name"
                value={draft.name}
                onChange={(e) => setField('name', e.target.value)}
                className="mt-1 w-full border rounded px-2 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-bold text-gray-600">
              {t.voiceAddFieldPrice}
              <input
                data-testid="voice-add-confirm-input-price"
                type="number"
                min="0"
                value={draft.price}
                onChange={(e) => setField('price', e.target.value)}
                className="mt-1 w-full border rounded px-2 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-bold text-gray-600">
              {t.voiceAddFieldCost}
              <input
                data-testid="voice-add-confirm-input-cost"
                type="number"
                min="0"
                value={draft.cost}
                onChange={(e) => setField('cost', e.target.value)}
                className="mt-1 w-full border rounded px-2 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-bold text-gray-600">
              {t.voiceAddFieldStock}
              <input
                data-testid="voice-add-confirm-input-stock"
                type="number"
                min="0"
                step="1"
                value={draft.stock}
                onChange={(e) => setField('stock', e.target.value)}
                className="mt-1 w-full border rounded px-2 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-bold text-gray-600">
              {t.voiceAddFieldUnit}
              <input
                data-testid="voice-add-confirm-input-unit"
                value={draft.unit}
                onChange={(e) => setField('unit', e.target.value)}
                className="mt-1 w-full border rounded px-2 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-bold text-gray-600">
              {t.voiceAddFieldCategory}
              <input
                data-testid="voice-add-confirm-input-category"
                value={draft.category}
                onChange={(e) => setField('category', e.target.value)}
                className="mt-1 w-full border rounded px-2 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-bold text-gray-600 col-span-2">
              {t.voiceAddFieldBarcode}
              <input
                data-testid="voice-add-confirm-input-barcode"
                value={draft.barcode}
                onChange={(e) => setField('barcode', e.target.value)}
                className="mt-1 w-full border rounded px-2 py-2 text-sm font-normal"
              />
            </label>
          </div>
          {validateVoiceAddDraft(draft).length > 0 && (
            <p role="alert" data-testid="voice-add-confirm-errors" className="text-sm text-red-700">
              {t.voiceAddMissing} — {validateVoiceAddDraft(draft).join(', ')}
            </p>
          )}
          {saveError && (
            <p role="alert" className="text-sm text-red-700">
              {saveError}
            </p>
          )}
          <div className="flex gap-2">
            <AdButton testid="voice-add-cancel" variant="ghost" onClick={reset}>
              {t.voiceAddCancel}
            </AdButton>
            <AdButton
              testid="voice-add-save"
              disabled={saving || validateVoiceAddDraft(draft).length > 0}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving…' : t.voiceAddSave}
            </AdButton>
          </div>
          <p className="text-[11px] text-gray-500">
            Discard throws this draft away — no product is created.
          </p>
        </div>
      )}

      {/* Typed whole-command fallback — always visible, same confirmation. */}
      <form className="mt-4 flex gap-2 border-t pt-3" onSubmit={handleTypedSubmit}>
        <input
          data-testid="voice-add-text-input"
          value={typedCommand}
          onChange={(e) => setTypedCommand(e.target.value)}
          placeholder={t.voiceAddTypedPlaceholder}
          className="flex-1 border rounded px-2 py-2 text-sm bg-white"
        />
        <button
          data-testid="voice-add-text-submit"
          type="submit"
          className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-bold"
        >
          {t.voiceAddTypedSubmit}
        </button>
      </form>
      {step !== 'confirm' && error && (
        <p role="alert" className="text-xs text-red-700 mt-2">
          {error}
        </p>
      )}
    </AdCard>
  );
};

export default VoiceAddProduct;
