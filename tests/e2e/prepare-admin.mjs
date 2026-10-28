// Phase 2 — E2E admin preparation.
//
// The subscription-approval flow needs a platform admin, and platform
// admins are recognised ONLY via PLATFORM_ADMIN_USER_IDS (user ids, not
// usernames). So before the suite runs, this script boots the real server
// against the E2E data dir, registers (or reuses) a dedicated admin
// owner, reads its id from /api/auth/me, and writes
// /tmp/amar-e2e-admin.json for playwright.config.ts and the subscription
// spec. It then stops the server; the suite's webServer reboots it with
// PLATFORM_ADMIN_USER_IDS set. No production code is changed and no
// backdoor exists: this is a test harness talking to the public API.
// Run via `npm run test:e2e:prepare` (part of `npm run test:e2e`).

import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 3201;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = '/tmp/amar-e2e-data';
const OUT = '/tmp/amar-e2e-admin.json';
const ADMIN = { username: 'e2e-admin', pin: '9999' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

function cookieFrom(res) {
  // Undici (Node fetch) does not expose set-cookie via get(); use the
  // dedicated getSetCookie() API when present.
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];
  return (cookies[0] || '').split(';')[0];
}

// NOTE: development mode on purpose. Production sets Secure cookies, which
// are never sent over plain-HTTP localhost, so API logins cannot hold a
// session in E2E (the Phase 1 "production HTTPS login" item stays
// UNVERIFIED for staging HTTPS). Dev mode serves the same app + API via
// Vite middleware on the same origin.
// detached:true so the finally block can SIGTERM the whole process group:
// killing only the npx parent orphans the tsx server child, which then
// holds port 3201 and breaks the suite's own webServer.
const server = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  detached: true,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    AMAR_DATA_DIR: DATA_DIR,
    // Phase 4: when the suite runs against PostgreSQL, the admin must be
    // prepared in THAT database, not in the fallback store — otherwise
    // the suite's server (which gets DATABASE_URL from
    // AMAR_E2E_DATABASE_URL) cannot log the admin in and the
    // subscription spec fails with 401. Same conditional-spread shape
    // as playwright.config.ts.
    ...(process.env.AMAR_E2E_DATABASE_URL ? { DATABASE_URL: process.env.AMAR_E2E_DATABASE_URL } : {}),
    SESSION_SECRET: 'e2e-test-secret-that-is-long-enough-0123456789',
  },
  stdio: 'ignore',
});

const state = { userId: null };
try {
  if (!(await waitForHealth(Date.now() + 60_000))) {
    throw new Error('E2E server did not become healthy');
  }
  // Try login first (repeat runs reuse the same data dir).
  let cookie = '';
  let login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  if (login.ok) {
    cookie = cookieFrom(login);
  } else {
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        storeName: 'E2E Admin Store',
        storeCategory: 'grocery',
        username: ADMIN.username,
        pin: ADMIN.pin,
      }),
    });
    if (!reg.ok) throw new Error(`admin register failed: ${reg.status} ${await reg.text()}`);
    cookie = cookieFrom(reg);
  }
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  const meJson = await me.json();
  state.userId = meJson?.user?.id;
  if (!state.userId) throw new Error(`could not read admin id from /auth/me: ${JSON.stringify(meJson)}`);
  fs.writeFileSync(OUT, JSON.stringify({ username: ADMIN.username, pin: ADMIN.pin, userId: state.userId }));
  console.log(`E2E admin prepared: ${ADMIN.username} id=${state.userId}`);
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    try {
      server.kill('SIGTERM');
    } catch {}
  }
  await new Promise((resolve) => {
    server.on('exit', resolve);
    setTimeout(resolve, 5000);
  });
}

if (!state.userId) process.exit(1);
