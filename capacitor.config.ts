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
