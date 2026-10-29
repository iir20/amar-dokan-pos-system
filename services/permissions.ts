// Native Android permission system — point-of-use only.
//
// This module is deliberately separate from services/native.ts (which
// another worker owns): it does NOT change any existing flow. It is a
// self-contained import the coordinator wires into the tap handlers
// (see docs/android-permissions.md "Integration notes"). Nothing here
// runs at app start and nothing here requests anything on the web.
//
// POINT OF USE (never a first-launch barrage):
//   camera     — user taps Scan (barcode photo, components/BarcodeScanner.tsx)
//   microphone — user taps a voice listen button (services/voice.ts)
//   bluetooth  — user taps Bluetooth Print (services/nativePrint.ts)
//   photos     — user taps a store-photo/logo picker (components/Settings.tsx,
//                components/Profile.tsx, components/AdminPanel.tsx). The
//                pickers are <input type="file" accept="image/*">, i.e. the
//                system picker, which needs NO runtime permission on any
//                Android version — so this kind always resolves to
//                'not-required' and the caller just opens the picker.
//
// OUTCOMES (what the caller branches on):
//   'granted'           — proceed with the native action.
//   'denied-retryable'  — denied once; show the rationale + a Retry
//                         button. One re-request is allowed, no more.
//   'permanently-denied'— do NOT prompt again: either the system says
//                         the permission can no longer be asked, or this
//                         module's two-prompt cap has been reached. Show
//                         the exact Settings path and offer
//                         openAppSettings().
//   'not-required'      — neutral passthrough: web builds, and the
//                         photos picker on native. The caller proceeds
//                         with the existing web prompts / picker exactly
//                         as today; no behaviour change on the web.
//   'unavailable'       — the native capability itself failed for a
//                         non-permission reason (plugin error, no BLE
//                         support, Bluetooth off). Fall back, never crash.
//
// TWO-PROMPT CAP (no re-prompt loop, enforced in-module):
//   prompts are counted per kind per session (in-memory only, reset on
//   app restart). Prompt 1 denied -> 'denied-retryable'. Prompt 2
//   (the one Retry) denied -> 'permanently-denied': a third prompt is
//   never shown even if the system would still allow one. Returning
//   from Settings and tapping Retry re-checks (not re-prompts): a fresh
//   grant is picked up because checkPermissions() runs first.
//
// BLUETOOTH HONEST LIMITS (read before wiring):
//   - @capacitor-community/bluetooth-le exposes NO checkPermissions /
//     requestPermissions JS API. Its Android plugin requests the
//     permission aliases itself inside initialize(). So for bluetooth,
//     ensurePermission() IS the prompt: it calls initialize() with NO
//     arguments — exactly the call services/nativePrint.ts already
//     makes — so the alias set can never disagree between the check
//     and the print. A later printViaBluetooth() initialize() then
//     succeeds without a second prompt when the grant stuck.
//   - Do NOT "fix" this by passing { androidNeverForLocation: true }
//     here alone: initialize() without that flag also requests
//     ACCESS_FINE_LOCATION on Android 12+, and checkPermission()
//     requires ALL aliases granted. Changing the flag in one place
//     and not the other makes every later print reject with
//     "Permission denied." Change it in BOTH places together, or in
//     neither (see docs/android-permissions.md).
//   - On Android 11 and below the same plugin requests location +
//     legacy Bluetooth as its scan gate. The app's own manifest
//     declares NO location permission (the app never uses location);
//     the location request on old Android comes from the plugin, not
//     from app code. See the permission table in the doc.
//
// SETTINGS DEEP LINK (implemented, with one honest limit):
//   openAppSettings() uses BluetoothLe.openAppSettings() from the
//   already-installed bluetooth-le plugin. Its Android implementation
//   is Intent(ACTION_APPLICATION_DETAILS_SETTINGS) with a
//   "package:<appId>" URI (verified in the plugin's Kotlin source) —
//   the documented Android settings path. It lands on the app's
//   Settings page, NOT on the individual permission toggle, so the
//   caller must still show the Permissions → <X> path text (the
//   permSettings* strings) alongside the button. On the web it
//   resolves false and the caller shows the manual path instead.

import { TRANSLATIONS } from '../constants';
import type { Language } from '../types';
import { isNativePlatform } from './native';

/** Point-of-use permission kinds. 'photos' needs no runtime permission (system picker). */
export type PermissionKind = 'camera' | 'microphone' | 'bluetooth' | 'photos';

export type PermissionOutcome = 'granted' | 'denied-retryable' | 'permanently-denied' | 'not-required' | 'unavailable';

/** What the caller uses when the permission is not granted. Never a dead end. */
export type PermissionFallback = 'manual-barcode' | 'typed-input' | 'download-fallback' | 'system-picker' | 'none';

export interface PermissionResult {
  kind: PermissionKind;
  outcome: PermissionOutcome;
  /** True only for 'denied-retryable': a Retry button may call ensurePermission() once more. */
  canPromptAgain: boolean;
  fallback: PermissionFallback;
  /** Non-permission failure detail (only for 'unavailable'). Never a permission state. */
  detail?: string;
}

/** Raw Capacitor permission states (camera + speech plugins). */
export type RawPermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'limited';

/** Maximum system prompts per kind per session. The 2nd denial ends prompting. */
export const MAX_PERMISSION_PROMPTS = 2;

/** Fallback per kind — independent of outcome, so callers never guess. */
export function fallbackFor(kind: PermissionKind): PermissionFallback {
  switch (kind) {
    case 'camera':
      return 'manual-barcode';
    case 'microphone':
      return 'typed-input';
    case 'bluetooth':
      return 'download-fallback';
    case 'photos':
      return 'system-picker';
  }
}

/**
 * Pure: may the caller show a system prompt now? Only when the system
 * still allows asking AND this module's per-session cap is unreached.
 */
export function shouldPrompt(checked: RawPermissionState, promptsShown: number): boolean {
  if (checked !== 'prompt' && checked !== 'prompt-with-rationale') return false;
  return promptsShown < MAX_PERMISSION_PROMPTS;
}

/**
 * Pure state-machine transition, unit-tested without a device.
 *
 * checked:   state BEFORE any prompt this call (checkPermissions()).
 * requested: state AFTER the prompt, when one was shown (undefined when
 *            no prompt was shown — e.g. already granted, or capped).
 * promptsShown: prompts already shown for this kind this session,
 *            INCLUDING the one whose result `requested` carries.
 *
 * checked 'denied' (system will not re-prompt) -> 'permanently-denied'
 *   without ever prompting, regardless of the cap.
 * requested denied / still askable after prompt 1 -> 'denied-retryable'.
 * requested denied / still askable after prompt 2 -> 'permanently-denied'
 *   (module cap: no third prompt, even if the system would allow one).
 */
export function resolvePermissionOutcome(args: {
  checked: RawPermissionState;
  requested?: RawPermissionState;
  promptsShown: number;
}): PermissionOutcome {
  const { checked, requested, promptsShown } = args;
  if (checked === 'granted' || checked === 'limited') return 'granted';
  if (checked === 'denied') return 'permanently-denied';
  if (requested === 'granted' || requested === 'limited') return 'granted';
  if (requested !== undefined) {
    return promptsShown >= MAX_PERMISSION_PROMPTS ? 'permanently-denied' : 'denied-retryable';
  }
  // No prompt was shown and the state is not granted/denied: the only
  // remaining case is the cap being reached before prompting.
  return promptsShown >= MAX_PERMISSION_PROMPTS ? 'permanently-denied' : 'denied-retryable';
}

/** Short in-app rationale shown BEFORE the first-use prompt, in the user's language. */
export function permissionRationale(kind: PermissionKind, lang: Language): string {
  const t = TRANSLATIONS[lang];
  switch (kind) {
    case 'camera':
      return t.permRationaleCamera;
    case 'microphone':
      return t.permRationaleMicrophone;
    case 'bluetooth':
      return t.permRationaleBluetooth;
    case 'photos':
      return t.permRationalePhotos;
  }
}

/**
 * Exact Settings path shown on permanent denial, in the user's
 * language. Null for 'photos': the picker is never denied, so there
 * is no path to show.
 */
export function permissionSettingsGuidance(kind: PermissionKind, lang: Language): string | null {
  const t = TRANSLATIONS[lang];
  switch (kind) {
    case 'camera':
      return t.permSettingsCamera;
    case 'microphone':
      return t.permSettingsMicrophone;
    case 'bluetooth':
      return t.permSettingsBluetooth;
    case 'photos':
      return null;
  }
}

// In-memory prompt counts per kind. Session-scoped by design: a fresh
// app start resets the cap, which is correct — the user may grant in
// Settings between sessions and the next first-use check picks it up.
const promptAttempts = new Map<PermissionKind, number>();

export function getPermissionAttempts(kind: PermissionKind): number {
  return promptAttempts.get(kind) ?? 0;
}

export function resetPermissionAttempts(kind?: PermissionKind): void {
  if (kind) promptAttempts.delete(kind);
  else promptAttempts.clear();
}

function buildResult(kind: PermissionKind, outcome: PermissionOutcome, detail?: string): PermissionResult {
  return {
    kind,
    outcome,
    canPromptAgain: outcome === 'denied-retryable',
    fallback: fallbackFor(kind),
    ...(detail ? { detail } : {}),
  };
}

/**
 * Point-of-use permission gate. Call from the tap handler, never at
 * app start. On the web, or for the photos picker, returns
 * 'not-required' immediately — the caller proceeds with the existing
 * web prompts / system picker exactly as today.
 *
 * Camera/microphone: check first (a grant or a system permanent denial
 * never prompts), then at most one system prompt per call, counted
 * against the per-session cap.
 *
 * Bluetooth: the plugin has no check API, so the prompt IS the check
 * (initialize() requests the aliases and rejects "Permission denied."
 * when they are not all granted). A non-permission rejection (no BLE
 * support, Bluetooth off) resolves 'unavailable', not a denial.
 */
export async function ensurePermission(kind: PermissionKind): Promise<PermissionResult> {
  if (!isNativePlatform()) return buildResult(kind, 'not-required');
  if (kind === 'photos') return buildResult(kind, 'not-required');

  if (kind === 'camera') {
    try {
      const { Camera } = await import('@capacitor/camera');
      const checked = (await Camera.checkPermissions()).camera;
      if (!shouldPrompt(checked, getPermissionAttempts(kind))) {
        return buildResult(kind, resolvePermissionOutcome({ checked, promptsShown: getPermissionAttempts(kind) }));
      }
      const requested = (await Camera.requestPermissions({ permissions: ['camera'] })).camera;
      promptAttempts.set(kind, getPermissionAttempts(kind) + 1);
      return buildResult(
        kind,
        resolvePermissionOutcome({ checked, requested, promptsShown: getPermissionAttempts(kind) }),
      );
    } catch (err) {
      return buildResult(kind, 'unavailable', err instanceof Error ? err.message : String(err));
    }
  }

  if (kind === 'microphone') {
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
      const checked = (await SpeechRecognition.checkPermissions()).speechRecognition;
      if (!shouldPrompt(checked, getPermissionAttempts(kind))) {
        return buildResult(kind, resolvePermissionOutcome({ checked, promptsShown: getPermissionAttempts(kind) }));
      }
      const requested = (await SpeechRecognition.requestPermissions()).speechRecognition;
      promptAttempts.set(kind, getPermissionAttempts(kind) + 1);
      return buildResult(
        kind,
        resolvePermissionOutcome({ checked, requested, promptsShown: getPermissionAttempts(kind) }),
      );
    } catch (err) {
      return buildResult(kind, 'unavailable', err instanceof Error ? err.message : String(err));
    }
  }

  // bluetooth: no check API — initialize() prompts and reports.
  try {
    const { BluetoothLe } = await import('@capacitor-community/bluetooth-le');
    // NO arguments on purpose: this must stay identical to the
    // initialize() call in services/nativePrint.ts (see header).
    await BluetoothLe.initialize();
    return buildResult(kind, 'granted');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/permission denied/i.test(message)) {
      promptAttempts.set(kind, getPermissionAttempts(kind) + 1);
      const outcome = getPermissionAttempts(kind) >= MAX_PERMISSION_PROMPTS ? 'permanently-denied' : 'denied-retryable';
      return buildResult(kind, outcome);
    }
    return buildResult(kind, 'unavailable', message);
  }
}

/**
 * Open the app's page in Android system Settings (deep link).
 * Returns true when the settings page was opened, false on the web
 * or when the plugin call failed — in both cases the caller shows
 * the manual Settings path (permissionSettingsGuidance) instead.
 * The link lands on the app page, NOT on the individual permission
 * toggle; the Permissions → <X> step still comes from the guidance
 * text shown next to the button.
 */
export async function openAppSettings(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    const { BluetoothLe } = await import('@capacitor-community/bluetooth-le');
    await BluetoothLe.openAppSettings();
    return true;
  } catch {
    return false;
  }
}
