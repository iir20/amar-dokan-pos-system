// Phase 2 — Capacitor native-shell detection.
//
// On the web build, Capacitor is absent and every helper returns the web
// answer (isNativePlatform() === false). Inside the Android app built from
// `android/`, @capacitor/core reports the real platform. Nothing here
// changes behaviour on the web: it only lets the UI show the native badge
// and offer Bluetooth printing where a native shell actually exists.

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
