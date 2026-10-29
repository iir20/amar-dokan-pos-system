import type { CapacitorConfig } from '@capacitor/cli';

// Phase 2 — Capacitor native shell for the existing Vite app.
//
// CACHING STRATEGY (the "no double-caching" rule): the native app must NOT
// fight the PWA service worker. Web builds register the Workbox service
// worker (vite-plugin-pwa); Capacitor builds do NOT — vite.config.ts omits
// the VitePWA plugin entirely when CAPACITOR_BUILD=true, so `dist` for the
// native shell contains no sw.js / registerSW code at all. Offline-first in
// the native shell therefore comes from exactly one place: AmarSync
// (services/amarSync.ts) — localStorage outbox + cached products, flushed
// to the server on reconnect — never from a service-worker cache. The
// native shell loads the bundled web app from local assets (webDir: dist)
// and talks to the same server API over HTTPS; it does not cache API
// responses itself.
//
// androidScheme 'https' keeps the WebView origin secure-context so
// crypto.randomUUID() (used for sale / idempotency ids) keeps working.
//
// Phase 7 (Item 3) — native plugins registered in this shell (wired by
// `npx cap sync android` into android/capacitor.settings.gradle; no
// MainActivity edit is needed, Capacitor 8 auto-registers them):
//   - @capacitor/camera: native barcode photo (components/
//     BarcodeScanner.tsx). Declares CAMERA in AndroidManifest.
//   - @capacitor-community/speech-recognition: native Bangla voice
//     (services/voice.ts). Declares RECORD_AUDIO in AndroidManifest.
// Neither plugin needs a `plugins:` config block: both are used with
// their defaults (camera: rear, no gallery save; speech: system
// dialog, bn-BD / en-US). The live-preview barcode plugin was NOT
// added: @capacitor-community/barcode-scanner only supports
// Capacitor 5, so on Capacitor 8 the native scan is photo-based.

const config: CapacitorConfig = {
  appId: 'com.amardokan.pos',
  appName: 'Amar Dokan POS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
