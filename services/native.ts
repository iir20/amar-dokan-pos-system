// Phase 2 — Capacitor native-shell detection, plus Phase 7 (Item 3)
// native permission flow for camera + microphone.
//
// On the web build, Capacitor is absent and every helper returns the web
// answer (isNativePlatform() === false). Inside the Android app built from
// `android/`, @capacitor/core reports the real platform. Nothing here
// changes behaviour on the web: it only lets the UI show the native badge
// and offer Bluetooth printing where a native shell actually exists.
//
// PERMISSION FLOW (Android runtime permissions, first-use request):
//   1. On first use of camera / voice, the caller calls
//      ensureCameraPermission() / ensureSpeechPermission() BEFORE opening
//      the camera or the recogniser. checkPermissions() first: if the
//      user already granted, no prompt appears. If the state is 'prompt'
//      (never asked) or 'prompt-with-rationale' (denied once, can still
//      be asked), requestPermissions() shows the system dialog once.
//   2. If the result is still 'denied', the system will NOT show the
//      dialog again — the caller must NOT loop requests. It shows the
//      settings guidance below (exact path the owner must follow) and
//      the manual/text fallback, with a Retry button that re-checks
//      (so returning from Settings picks the new grant up).
//   3. No permission is requested at app start. Camera and microphone
//      are asked only when the owner taps Scan / Speak.
//
// The two guidance strings are the single source of truth for the
// "permission denied" panels (BarcodeScanner, docs/android.md). They
// name the exact place to enable the permission; a denied permission
// is never presented as a dead end, because the manual barcode entry
// and the typed voice command always remain available.

import { Capacitor } from '@capacitor/core';

/** True only inside the installed Android app (never in a browser/PWA). */
export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** 'android' | 'ios' | 'web'. */
export function getPlatform(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}

export type NativePermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'limited';

/** Exact owner-facing path to re-enable the camera after a denial. */
export const CAMERA_SETTINGS_GUIDANCE =
  'Camera permission is denied for Amar Dokan POS. To turn it on: open Android Settings → Apps → Amar Dokan POS → Permissions → Camera, turn it on, then come back and tap Retry.';

/** Exact owner-facing path to re-enable the microphone after a denial. */
export const MIC_SETTINGS_GUIDANCE =
  'Microphone permission is denied for Amar Dokan POS. To turn it on: open Android Settings → Apps → Amar Dokan POS → Permissions → Microphone, turn it on, then come back and try again.';

export type CameraFailureKind = 'PERMISSION_DENIED' | 'CANCELLED' | 'NO_CAMERA' | 'CAMERA_IN_USE' | 'UNAVAILABLE';

export type MicFailureKind = 'PERMISSION_DENIED' | 'UNAVAILABLE' | 'NO_SPEECH';

/**
 * Classify a camera failure (Capacitor Camera error codes, getUserMedia
 * DOMException names, or plain messages) into one actionable kind.
 * Pure function — unit-tested in tests/nativePermissions.test.ts.
 * Never returns a kind that hides the cause: a denial is a denial, not
 * a generic "could not be started".
 */
export function classifyCameraError(err: unknown): CameraFailureKind {
  const code = (err as any)?.code;
  const name = (err as any)?.name as string | undefined;
  const message = String((err as any)?.message || err || '').toLowerCase();
  // Capacitor Camera 8 error codes (see @capacitor/camera definitions).
  if (code === 'OS-PLUG-CAMR-0003') return 'PERMISSION_DENIED';
  if (code === 'OS-PLUG-CAMR-0007') return 'NO_CAMERA';
  if (code === 'OS-PLUG-CAMR-0006') return 'CANCELLED';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'PERMISSION_DENIED';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'NO_CAMERA';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'CAMERA_IN_USE';
  if (/permission|denied|not allowed/.test(message)) return 'PERMISSION_DENIED';
  if (/cancelled|canceled|user cancelled|user canceled/.test(message)) return 'CANCELLED';
  if (/in use|already in use|being used|not readable/.test(message)) return 'CAMERA_IN_USE';
  if (/no camera|no video|device not found|not found/.test(message)) return 'NO_CAMERA';
  return 'UNAVAILABLE';
}

/** Owner-facing guidance for a camera failure kind. Always ends with the manual fallback. */
export function cameraFailureGuidance(kind: CameraFailureKind): string {
  switch (kind) {
    case 'PERMISSION_DENIED':
      return `${CAMERA_SETTINGS_GUIDANCE} Until then, type the printed code in the Barcode box above and tap Look up.`;
    case 'CANCELLED':
      return 'Scan cancelled. Tap Retake to try again, or type the printed code in the Barcode box above and tap Look up.';
    case 'NO_CAMERA':
      return 'No camera is available on this device. Type the printed code in the Barcode box above and tap Look up.';
    case 'CAMERA_IN_USE':
      return 'The camera is in use by another app. Close the other app using the camera, then tap Retry — or type the printed code in the Barcode box above and tap Look up.';
    case 'UNAVAILABLE':
    default:
      return 'Camera could not be started. Tap Retry, or type the printed code in the Barcode box above and tap Look up.';
  }
}

/**
 * Classify a speech-recognition failure into one actionable kind.
 * The plugin rejects with plain messages on Android; 'not allowed' /
 * permission wording maps to PERMISSION_DENIED, silence / no match to
 * NO_SPEECH, everything else to UNAVAILABLE (service missing, offline
 * recogniser, etc.) — all of which fall back to the typed command.
 */
export function classifyMicError(err: unknown): MicFailureKind {
  const message = String((err as any)?.message || err || '').toLowerCase();
  if (/permission|denied|not allowed|not authorized/.test(message)) return 'PERMISSION_DENIED';
  if (/no speech|no match|no result|empty/.test(message)) return 'NO_SPEECH';
  return 'UNAVAILABLE';
}

/** Owner-facing guidance for a mic failure kind. The typed command is always the fallback. */
export function micFailureGuidance(kind: MicFailureKind): string {
  switch (kind) {
    case 'PERMISSION_DENIED':
      return `${MIC_SETTINGS_GUIDANCE} Until then, type the command in the text box below.`;
    case 'NO_SPEECH':
      return 'Could not hear you — please speak again or type the command in the text box below.';
    case 'UNAVAILABLE':
    default:
      return 'Voice input is not available on this device right now — type the command in the text box below.';
  }
}

/**
 * Request-on-first-use camera permission (native only). Returns the
 * post-request state; callers treat anything but 'granted'/'limited'
 * as denied and show CAMERA_SETTINGS_GUIDANCE instead of retry-looping.
 * Throws NATIVE_ONLY on web — callers must guard with isNativePlatform().
 */
export async function ensureCameraPermission(): Promise<NativePermissionState> {
  if (!isNativePlatform()) throw new Error('NATIVE_ONLY');
  const { Camera } = await import('@capacitor/camera');
  const checked = await Camera.checkPermissions();
  if (checked.camera === 'granted' || checked.camera === 'limited') return checked.camera;
  const requested = await Camera.requestPermissions({ permissions: ['camera'] });
  return requested.camera;
}

/**
 * Request-on-first-use speech/microphone permission (native only).
 * Same contract as ensureCameraPermission: one system prompt at most
 * per call, 'denied' means "go to Settings", never a loop.
 * Throws NATIVE_ONLY on web — the plugin's web build is unimplemented
 * and must never be called there (see services/voice.ts).
 */
export async function ensureSpeechPermission(): Promise<NativePermissionState> {
  if (!isNativePlatform()) throw new Error('NATIVE_ONLY');
  const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
  const checked = await SpeechRecognition.checkPermissions();
  if (checked.speechRecognition === 'granted') return 'granted';
  const requested = await SpeechRecognition.requestPermissions();
  return requested.speechRecognition;
}
