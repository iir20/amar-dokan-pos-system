// Native Android permission system (services/permissions.ts) —
// sandbox-side coverage only. No device, no system prompt, and no
// plugin call exists in this environment, so what IS proven here is
// the pure state machine, the fallback mapping, the EN+BN strings,
// and the web-context passthrough (the exact behaviours that must
// hold before any on-device check). Real-device grant / deny /
// permanently-denied round-trips are an explicit owner checklist in
// docs/android-permissions.md and are NEVER claimed as passed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PERMISSION_PROMPTS,
  ensurePermission,
  fallbackFor,
  getPermissionAttempts,
  openAppSettings,
  permissionRationale,
  permissionSettingsGuidance,
  resetPermissionAttempts,
  resolvePermissionOutcome,
  shouldPrompt,
  type PermissionKind,
} from '../services/permissions';
import { TRANSLATIONS } from '../constants';

const KINDS: PermissionKind[] = ['camera', 'microphone', 'bluetooth', 'photos'];
const BENGALI = /[\u0980-\u09FF]/;

test('two-prompt cap is 2: a third prompt is never allowed', () => {
  assert.equal(MAX_PERMISSION_PROMPTS, 2);
  assert.equal(shouldPrompt('prompt', 0), true);
  assert.equal(shouldPrompt('prompt-with-rationale', 1), true);
  assert.equal(shouldPrompt('prompt', 2), false);
  assert.equal(shouldPrompt('prompt-with-rationale', 2), false);
  assert.equal(shouldPrompt('prompt-with-rationale', 3), false);
});

test('shouldPrompt never prompts on granted / denied / limited states', () => {
  for (const state of ['granted', 'denied', 'limited'] as const) {
    assert.equal(shouldPrompt(state, 0), false);
    assert.equal(shouldPrompt(state, 1), false);
  }
});

test('resolve: granted or limited (before or after a prompt) is granted', () => {
  assert.equal(resolvePermissionOutcome({ checked: 'granted', promptsShown: 0 }), 'granted');
  assert.equal(resolvePermissionOutcome({ checked: 'limited', promptsShown: 0 }), 'granted');
  assert.equal(resolvePermissionOutcome({ checked: 'prompt', requested: 'granted', promptsShown: 1 }), 'granted');
  assert.equal(
    resolvePermissionOutcome({ checked: 'prompt-with-rationale', requested: 'limited', promptsShown: 1 }),
    'granted',
  );
});

test('resolve: system permanent denial never prompts, whatever the cap', () => {
  assert.equal(resolvePermissionOutcome({ checked: 'denied', promptsShown: 0 }), 'permanently-denied');
  assert.equal(resolvePermissionOutcome({ checked: 'denied', promptsShown: 1 }), 'permanently-denied');
  assert.equal(
    resolvePermissionOutcome({ checked: 'denied', requested: 'denied', promptsShown: 2 }),
    'permanently-denied',
  );
});

test('resolve: first denial is retryable, second denial (after Retry) is permanent — no third prompt', () => {
  assert.equal(
    resolvePermissionOutcome({ checked: 'prompt', requested: 'prompt-with-rationale', promptsShown: 1 }),
    'denied-retryable',
  );
  assert.equal(
    resolvePermissionOutcome({ checked: 'prompt-with-rationale', requested: 'denied', promptsShown: 1 }),
    'denied-retryable',
  );
  assert.equal(
    resolvePermissionOutcome({ checked: 'prompt', requested: 'prompt-with-rationale', promptsShown: 2 }),
    'permanently-denied',
  );
  assert.equal(
    resolvePermissionOutcome({ checked: 'prompt-with-rationale', requested: 'denied', promptsShown: 2 }),
    'permanently-denied',
  );
  // Cap reached before any prompt this call: still permanent, never a prompt.
  assert.equal(resolvePermissionOutcome({ checked: 'prompt', promptsShown: 2 }), 'permanently-denied');
});

test('fallback mapping: a denied permission never bricks its feature', () => {
  assert.equal(fallbackFor('camera'), 'manual-barcode');
  assert.equal(fallbackFor('microphone'), 'typed-input');
  assert.equal(fallbackFor('bluetooth'), 'download-fallback');
  assert.equal(fallbackFor('photos'), 'system-picker');
});

test('rationale strings exist in EN and BN for every kind, and BN text is actually Bangla', () => {
  for (const kind of KINDS) {
    const en = permissionRationale(kind, 'en');
    const bn = permissionRationale(kind, 'bn');
    assert.ok(en.length > 10, `${kind} EN rationale`);
    assert.ok(bn.length > 10, `${kind} BN rationale`);
    assert.match(bn, BENGALI, `${kind} BN rationale must contain Bangla script`);
    assert.notEqual(en, bn, `${kind} locales must differ`);
  }
  // Keys live in the shared TRANSLATIONS (types.ts), not a local dict.
  for (const key of [
    'permRationaleCamera',
    'permRationaleMicrophone',
    'permRationaleBluetooth',
    'permRationalePhotos',
  ] as const) {
    assert.ok(TRANSLATIONS.en[key].length > 10, `en.${key}`);
    assert.ok(TRANSLATIONS.bn[key].length > 10, `bn.${key}`);
  }
});

test('settings guidance exists in EN and BN for camera/mic/bluetooth, and is null for photos', () => {
  for (const kind of ['camera', 'microphone', 'bluetooth'] as const) {
    const en = permissionSettingsGuidance(kind, 'en');
    const bn = permissionSettingsGuidance(kind, 'bn');
    assert.ok(en && en.includes('Settings'), `${kind} EN guidance names Settings`);
    assert.ok(en && en.includes('Amar Dokan POS'), `${kind} EN guidance names the app`);
    assert.ok(en && en.includes('Permissions'), `${kind} EN guidance names Permissions`);
    assert.ok(en && en.includes('Retry'), `${kind} EN guidance ends at Retry`);
    assert.ok(bn && bn.includes('Settings'), `${kind} BN guidance names Settings`);
    assert.match(bn ?? '', BENGALI, `${kind} BN guidance must contain Bangla script`);
  }
  assert.equal(permissionSettingsGuidance('photos', 'en'), null);
  assert.equal(permissionSettingsGuidance('photos', 'bn'), null);
  // The Bluetooth path is the Nearby-devices group on Android 12+, not a generic toggle.
  assert.match(permissionSettingsGuidance('bluetooth', 'en') ?? '', /Nearby devices/);
});

test('settings-section labels exist in both locales', () => {
  assert.equal(TRANSLATIONS.en.permTitle, 'App permissions');
  assert.ok(TRANSLATIONS.bn.permTitle.length > 0);
  assert.match(TRANSLATIONS.bn.permTitle, BENGALI);
  assert.ok(TRANSLATIONS.en.permOpenSettings.length > 0);
  assert.match(TRANSLATIONS.bn.permOpenSettings, BENGALI);
});

test('web-context passthrough: every kind returns not-required, nothing prompts, nothing throws', async () => {
  for (const kind of KINDS) {
    const result = await ensurePermission(kind);
    assert.equal(result.kind, kind);
    assert.equal(result.outcome, 'not-required', `${kind} on web must be neutral`);
    assert.equal(result.canPromptAgain, false);
    assert.equal(result.fallback, fallbackFor(kind));
  }
});

test('web-context: openAppSettings is a safe no-op returning false', async () => {
  assert.equal(await openAppSettings(), false);
});

test('prompt-attempt bookkeeping resets cleanly (used by native flows, no-op on web)', () => {
  resetPermissionAttempts();
  for (const kind of KINDS) assert.equal(getPermissionAttempts(kind), 0);
  resetPermissionAttempts('camera');
  assert.equal(getPermissionAttempts('camera'), 0);
});
