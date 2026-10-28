// Phase 2 — Playwright E2E configuration.
//
// The suite runs against the real server in DEVELOPMENT mode (Vite dev
// middleware, same origin for app + API, so browser cookies from API
// logins work in the UI). Development mode is deliberate, not a
// shortcut: production sets Secure cookies, which are never sent over
// plain-HTTP localhost, so no session-based E2E could pass against a
// plain-HTTP production server (the production-HTTPS login check stays a
// staging item — see docs/staging.md). `npm run test:e2e` still builds
// the production bundle first, so the build itself is proven by the
// same command. Proof data lives under /tmp/amar-e2e-data (never in the
// repo). Tests run serially (workers: 1): they share one server and one
// data dir, and parallel tests could trip the free-plan daily-sales
// limit.

import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

const E2E_DATA_DIR = '/tmp/amar-e2e-data';
const E2E_PORT = 3201;

let adminId = '';
try {
  const admin = JSON.parse(fs.readFileSync('/tmp/amar-e2e-admin.json', 'utf8'));
  adminId = admin.userId || '';
} catch {
  // No prepared admin (direct `playwright test` without `npm run test:e2e`):
  // the subscription spec skips itself and names the missing step.
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx server/index.ts',
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'development',
      PORT: String(E2E_PORT),
      AMAR_DATA_DIR: E2E_DATA_DIR,
      // Phase 4: set AMAR_E2E_DATABASE_URL to run the suite against a
      // real PostgreSQL database (used for the Phase 4 PG proof run).
      // Unset = the default durable-fallback path, unchanged.
      ...(process.env.AMAR_E2E_DATABASE_URL ? { DATABASE_URL: process.env.AMAR_E2E_DATABASE_URL } : {}),
      // Phase 3: the suite now registers many owners (one per spec file
      // plus several per file); the default auth limit (12 per 15 min
      // per IP) trips mid-suite. Raised for the E2E server only — the
      // production default is unchanged.
      AUTH_RATE_LIMIT_MAX: '200',
      // Dev-only test secret. Never a real secret; used only by the E2E server.
      SESSION_SECRET: 'e2e-test-secret-that-is-long-enough-0123456789',
      PLATFORM_ADMIN_USER_IDS: adminId,
    },
  },
});
