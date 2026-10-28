// Phase 3 — Bangla Voice POS wrappers around the browser/platform
// speech APIs (Web Speech API on the web, same APIs inside the Capacitor
// shell — no native plugin is assumed).
//
// HARD RULE: every voice action has a text fallback. `speak()` returns
// false when synthesis is unavailable, and callers must already show the
// same text on screen with tappable controls. Voice never gates a sale:
// the POS works fully with voice off or unsupported.
//
// On-device Bangla recognition accuracy on a low-end Android phone is
// UNVERIFIED in this sandbox (no phone, no microphone, headless
// browser) — see docs/phase3.md for the owner checklist. The parsing
// and formatting logic itself is unit-tested in tests/phase3.test.ts.
import { parseVoiceCommand, speakItemText, speakTotalText, type VoiceCommand } from '../shared/phase3';

export const isSpeechSynthesisSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

export const isSpeechRecognitionSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
};

/** Speak Bangla text. Returns false when synthesis is unavailable. */
export function speakBangla(text: string): boolean {
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
 * Listen once via the browser recognition API. Resolves with the parsed
 * command, or rejects with 'UNSUPPORTED' / 'NO_SPEECH' / 'LISTEN_ERROR'
 * so the caller can fall back to the visible text input.
 */
export function listenOnce(lang: 'bn' | 'en' = 'bn'): Promise<VoiceCommand> {
  return new Promise((resolve, reject) => {
    if (!isSpeechRecognitionSupported()) {
      reject(new Error('UNSUPPORTED'));
      return;
    }
    const w = window as any;
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
      reject(new Error(event?.error === 'no-speech' ? 'NO_SPEECH' : 'LISTEN_ERROR'));
    };
    rec.onend = () => {
      // Recognition can end without a result (e.g. silence with no
      // error event): settle as NO_SPEECH so the UI falls back to text
      // instead of hanging on a listening spinner.
      if (!settled) {
        settled = true;
        reject(new Error('NO_SPEECH'));
      }
    };
    try {
      rec.start();
    } catch {
      reject(new Error('LISTEN_ERROR'));
    }
  });
}
