// Phase 3 — Bangla Voice POS wrappers around the browser/platform
// speech APIs, plus Phase 7 (Item 3) native voice for the Android app.
//
// FALLBACK CHAIN for recognition (listenOnce), in order — never a dead
// end, because every caller also renders a typed-command text input:
//   1. NATIVE (installed Android app): @capacitor-community/speech-
//      recognition (Android SpeechRecognizer via the system dialog).
//      This is REQUIRED on device: the Capacitor WebView has no
//      window.SpeechRecognition, so the old web-only check disabled the
//      listen button inside the app entirely. Permission is requested
//      on first use (services/native.ts); a denial rejects with
//      PERMISSION_DENIED and the caller falls back to typing.
//   2. WEB: the Web Speech API (window.SpeechRecognition /
//      webkitSpeechRecognition) in desktop/Android Chrome.
//   3. UNSUPPORTED: neither path exists — callers show the "voice not
//      supported" note and the text input does the same job.
//
// The plugin's web build throws "not implemented" on every method, so
// the native path is entered ONLY when isNativePlatform() is true —
// listenOnce must never call the plugin on the web.
//
// HARD RULE (unchanged): every voice action has a text fallback.
// `speak()` returns false when synthesis is unavailable, and callers
// must already show the same text on screen with tappable controls.
// Voice never gates a sale: the POS works fully with voice off or
// unsupported.
//
// On-device Bangla recognition accuracy on a low-end Android phone is
// UNVERIFIED in this sandbox (no phone, no microphone, headless
// browser) — see docs/android.md for the owner checklist. The parsing
// and formatting logic itself is unit-tested in tests/phase3.test.ts;
// the native branching + error classification is unit-tested in
// tests/nativePermissions.test.ts (web-environment side only).
import { parseVoiceCommand, speakItemText, speakTotalText, type VoiceCommand } from '../shared/phase3';
import { isNativePlatform, classifyMicError, micFailureGuidance } from './native';
import { ensurePermission } from './permissions';
import { voiceAnnouncementEnabled, VOICE_CONFIRM_KEY } from '../shared/distinctive';

export { micFailureGuidance };
export type { MicFailureKind } from './native';

export const isSpeechSynthesisSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * True when EITHER recognition path exists: the native plugin inside
 * the installed app, or the Web Speech API in a browser. Previously
 * this checked only the web API, which wrongly disabled the listen
 * buttons inside the native app (WebViews expose no SpeechRecognition).
 */
export const isSpeechRecognitionSupported = (): boolean => {
  if (isNativePlatform()) return true;
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
};

/**
 * DISTINCTIVE FEATURES (2026-10-29) — speaker mode: every speak call
 * now consults the persisted Settings toggle (amar-voice-confirm,
 * default on). When the owner turned voice confirmations off, no
 * speech is produced at all — the caller still shows the same text on
 * screen, so voice never gates a sale. The amar-sound-confirm key has
 * no sound effect to gate (the app plays no beeps), so it is left
 * untouched rather than pretended.
 */
export function isVoiceAnnouncementOn(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return voiceAnnouncementEnabled(window.localStorage.getItem(VOICE_CONFIRM_KEY));
  } catch {
    return true;
  }
}

/** Speak Bangla text. Returns false when synthesis is unavailable or voice is toggled off. */
export function speakBangla(text: string): boolean {
  if (!isVoiceAnnouncementOn()) return false;
  if (!isSpeechSynthesisSupported() || !text) return false;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'bn-BD';
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function speakItem(name: string, price: number): { text: string; spoken: boolean } {
  const text = speakItemText(name, price);
  return { text, spoken: speakBangla(text) };
}

export function speakTotal(total: number, change: number): { text: string; spoken: boolean } {
  const text = speakTotalText(total, change);
  return { text, spoken: speakBangla(text) };
}

export function parseVoiceInput(raw: string): VoiceCommand {
  return parseVoiceCommand(raw);
}

/**
 * Native listen-once via @capacitor-community/speech-recognition.
 * popup:true shows the Android system speech dialog (the reliable
 * on-device path); the dialog's result is the transcript. Rejects with
 * 'PERMISSION_DENIED' / 'UNAVAILABLE' / 'NO_SPEECH' / 'LISTEN_ERROR'
 * so the caller can fall back to the visible text input. The Google
 * speech service must exist on the device — if available() is false
 * (no Google app / service), this rejects UNAVAILABLE rather than
 * hanging on a spinner.
 */
async function listenOnceNative(lang: 'bn' | 'en'): Promise<VoiceCommand> {
  const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
  const available = await SpeechRecognition.available().then(
    (r) => r.available,
    () => false,
  );
  if (!available) throw new Error('UNAVAILABLE');
  // Shared point-of-use permission module: at most two prompts per
  // session, then a permanent denial. Both cases throw
  // PERMISSION_DENIED and the caller falls back to the visible typed
  // input with its Settings guidance, so no prompt loop is possible.
  const outcome = (await ensurePermission('microphone')).outcome;
  if (outcome !== 'granted' && outcome !== 'not-required') throw new Error('PERMISSION_DENIED');
  let matches: string[] | undefined;
  try {
    const result = await SpeechRecognition.start({
      language: lang === 'bn' ? 'bn-BD' : 'en-US',
      maxResults: 1,
      popup: true,
      prompt: lang === 'bn' ? 'বলুন…' : 'Speak…',
    });
    matches = result.matches;
  } catch (err) {
    const kind = classifyMicError(err);
    throw new Error(kind === 'PERMISSION_DENIED' ? 'PERMISSION_DENIED' : 'LISTEN_ERROR', {
      cause: err,
    });
  }
  const transcript = (matches?.[0] || '').trim();
  if (!transcript) throw new Error('NO_SPEECH');
  return parseVoiceCommand(transcript);
}

/** Web listen-once via the Web Speech API with explicit mic permission pre-check. */
async function listenOnceWeb(lang: 'bn' | 'en'): Promise<VoiceCommand> {
  if (typeof window === 'undefined') {
    throw new Error('UNSUPPORTED');
  }
  const w = window as any;
  if (!w.SpeechRecognition && !w.webkitSpeechRecognition) {
    throw new Error('UNSUPPORTED');
  }

  // Ensure browser microphone permission prompt is triggered cleanly if needed
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        throw new Error('PERMISSION_DENIED', { cause: err });
      }
    }
  }

  return new Promise((resolve, reject) => {
    const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = lang === 'bn' ? 'bn-BD' : 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let settled = false;
    rec.onresult = (event: any) => {
      settled = true;
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      resolve(parseVoiceCommand(transcript));
    };
    rec.onerror = (event: any) => {
      settled = true;
      const errName = event?.error;
      if (errName === 'not-allowed' || errName === 'service-not-allowed') {
        reject(new Error('PERMISSION_DENIED'));
      } else if (errName === 'no-speech') {
        reject(new Error('NO_SPEECH'));
      } else {
        reject(new Error('LISTEN_ERROR'));
      }
    };
    rec.onend = () => {
      if (!settled) {
        settled = true;
        reject(new Error('NO_SPEECH'));
      }
    };
    try {
      rec.start();
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') {
        reject(new Error('PERMISSION_DENIED'));
      } else {
        reject(new Error('LISTEN_ERROR'));
      }
    }
  });
}

/**
 * Listen once via the best available path: native plugin on device,
 * Web Speech in a browser. Resolves with the parsed command, or
 * rejects with 'UNSUPPORTED' / 'PERMISSION_DENIED' / 'UNAVAILABLE' /
 * 'NO_SPEECH' / 'LISTEN_ERROR' so the caller can fall back to the
 * visible text input.
 */
export function listenOnce(lang: 'bn' | 'en' = 'bn'): Promise<VoiceCommand> {
  if (isNativePlatform()) return listenOnceNative(lang);
  return listenOnceWeb(lang);
}
