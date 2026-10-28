# Contributing to Amar Dokan POS

Thanks for your interest in improving Amar Dokan POS! This is a full-stack
app (React/Vite client + Express/PostgreSQL backend, plus a Capacitor
Android shell), so please read this before opening a PR.

## Getting Set Up

1. Fork and clone the repository.
2. Copy `.env.example` to `.env`. `DATABASE_URL` is **optional**: without
   it the app runs on the disk-persisted fallback store
   (`AMAR_DATA_DIR`, default `<cwd>/data`) with an outbox that replays
   into PostgreSQL when a database appears. Point it at a PostgreSQL
   database you control for the full production path.
3. Install dependencies: `bun install` (supported; `bun.lock` is the
   lockfile). `npm install` also works; `npm ci` does **not** (there is
   no `package-lock.json`).
4. Apply the documented schema migrations. Use `npm run db:push` only
   for a brand-new empty database before starting the app; review and
   cancel any proposal to delete or rename existing tables.
5. Start the dev server: `npm run dev` (default port 3000).

## Commands (all must pass before you open a PR)

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (`tests/*.test.ts`, run with tsx) |
| `npx tsc --noEmit` | Type-check (also part of `npm run lint`) |
| `npm run lint` | ESLint (whole tree, 0 errors) + Prettier check on Phase 1/2 files + type-check |
| `npm run build` | Production web build (`dist/`, PWA service worker included) |
| `npm run docs:api` | Regenerate `docs/api.html` from `server/openapi.json` — commit the result if you changed the spec |
| `npm run test:e2e` | Playwright end-to-end suite (builds, prepares a test admin, runs `tests/e2e/`). Needs the Playwright Chromium browser: `npx playwright install chromium` once. Proof data lives under `/tmp`, never in a `data/` dir in the repo. |

The PR gate (`.github/workflows/preview.yml`) runs type-check, lint,
unit tests, build and the API-docs freshness check on every pull
request.

## Project Conventions

- **Money is sacred.** All money is integer paisa on the server path;
  the server recalculates every sale from server-side prices and never
  trusts client-supplied totals. Add Zod validation to every route you
  touch or add.
- **Offline is intentional, not a workaround.** AmarSync
  (`services/amarSync.ts`) is the offline story: a localStorage outbox
  + cached products, flushed on reconnect, with server-side sale-id
  conflict handling so a retried flush never double-deducts stock.
  Do not add a second offline cache, and do not let the PWA service
  worker into the Capacitor build (see `docs/android.md` — the
  `CAPACITOR_BUILD` gate in `vite.config.ts` exists for this).
- **No mocks for real things.** No fake gateways, no simulated
  payments, no placeholder sync. The gateway endpoint is an honest
  format check only (see `docs/gateway-callback-spec.md`); error
  tracking is an integration point that reports as unconfigured until
  credentials exist (see `docs/monitoring.md`).
- **Shared types.** Database shapes live in `shared/schema.ts`
  (Drizzle) and are re-exported as TypeScript types. Reuse these
  rather than redefining shapes in the client.
- **API client.** Add new endpoints to `services/storage.ts` on the
  client rather than calling `fetch` directly from components.
- **Data fetching.** Use the `useApiData` hook for reads and call
  `refetch()` after mutations, matching the existing components'
  pattern.
- **Structured logs, no secrets in logs.** Server logging goes through
  `server/logger.ts` (JSON lines, sensitive keys redacted). Never log
  a PIN, password, secret, token, cookie or DSN.
- **Never commit secrets, `.env`, `dist/`, `node_modules/`, or Android
  signing material** (`*.jks`, `keystore.properties`). Signing secrets
  live in GitHub Secrets only (see `docs/android.md`).

## Architecture pointers

- `server/routes.ts` — HTTP routes (session auth, RBAC, Zod/manual
  validation, money rules). `server/storage.ts` — storage dispatch
  (PostgreSQL when probed-connected, disk-persisted fallback
  otherwise). `server/memStorage.ts` — the fallback store itself,
  including server-side sale math, marketplace stock deduct/restock,
  guest-order idempotency and scrypt PIN auth.
- `server/db.ts` — real `SELECT 1` probe + 30 s re-probe.
  `server/durableStore.ts` — disk snapshot + replay outbox + last
  backup time. `server/logger.ts`, `server/errorTracking.ts` —
  monitoring.
- `components/` — POS, Inventory, Dashboard, restaurant (KDS, guest
  menu, settlement), marketplace, AdminPanel (incl. System Status tab).
- `android/` — Capacitor Android shell (generated project; edit
  `capacitor.config.ts` and `android/app/build.gradle` signing, not
  generated files, unless you know why).
- `docs/` — `staging.md` (environments, migration checklist, staging
  drill), `monitoring.md`, `android.md`, `api.html` (generated),
  `backup-handling.md`, `gateway-callback-spec.md`.
- `tests/e2e/` — Playwright flows: owner cash sale, staff denial,
  marketplace lifecycle, guest QR → KDS → settlement → receipt,
  offline → reconnect sync, subscription request → admin approval.

## Making Changes

1. Create a feature branch: `git checkout -b feature/my-change`
2. Make your changes, keeping commits focused and descriptive.
3. Run the commands above (at minimum: type-check, lint, unit tests;
   plus the E2E suite if you touched POS, checkout, ordering, sync or
   auth).
4. If you changed `server/openapi.json`, run `npm run docs:api` and
   commit `docs/api.html`.
5. Open a pull request describing what changed and why, with the
   command outputs as evidence. Never mark a test passed unless it ran
   and passed; name anything you could not verify as UNVERIFIED with
   the reason.

## Reporting Bugs / Requesting Features

Please open a GitHub issue with clear reproduction steps (for bugs) or
a clear use case (for features). For security vulnerabilities, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.
