# Phase 6 — Inventory efficiency, Bangla inventory voice, barcode + manual entry, profile fix, online reliability, GitHub hygiene

Final queued phase (user request 2026-10-29 ~01:12 +06, after Phases 1–5).
**Launch verdict: UNCHANGED — LAUNCH REMAINS BLOCKED on the 10
owner/staging steps from Phase 4** (listed at the end). Phase 6 changes
no verdict item: every one of the 10 still needs the owner on staging or
a real device.

## 1. Inventory efficiency (Phase 5 design system)

- Instant filtering as you type (name, Bangla name, category, barcode)
  — the existing filter, now with a `data-testid="inventory-search"`.
- Low-stock alerts: the count badge, a "Low stock (N)" toggle that
  filters to stock < 10, and a low-stock list of tappable badges.
- Bulk actions via `POST /api/products/bulk` (Zod-validated): stock
  adjust (integer delta, never below 0 — negative results are reported
  as `INSUFFICIENT_STOCK` skips, not applied), price set (≥ 0), delete
  (requires `confirmed: true`; the UI shows a confirmation dialog
  first). Response `{ updated, deleted, skipped: [{ id, reason }] }`
  is shown verbatim — no silent skips.
- Per-product movement history: the History button on each row reads
  `GET /inventory-logs` and filters by product (entries are written by
  product create / stock change / sale, with reason + actor).
- Layout fix found by testing: the last table row's action buttons
  used to stop exactly at the viewport's bottom edge with no scroll
  room left, so no click could land on them. The table container now
  has inner bottom padding (`pb-24`) so the last row scrolls fully
  into view. This was a real product wart, not a test artifact.

## 2. Bangla voice across inventory

`components/VoiceInventory.tsx` on the Phase 3 voice system
(`services/voice.ts`, `shared/phase3.ts` parsing + Bangla synthesis).
Commands (Bangla or English): search (`চাল খুঁজুন` / `search rice`),
add (`চাল যোগ কর` / `add rice`), stock (`চালের স্টক ২০ কর` /
`stock rice 20`). Parser rules that matter (`shared/phase6.ts`,
unit-tested):

- Quantity is a **standalone number token only**. A digit glued to a
  word (`Phase6`) is part of the product name — an earlier version
  stripped it and turned "Phase6 Fine Rice" into "Phase Fine Rice".
- Command keywords are removed **one occurrence only**: a product
  named "… Stock Item" survives `stock … Stock Item 42`.
- The Bangla possessive suffix is normalized (`চালের` → `চাল`) and
  matching is two-way (name-in-query or query-in-name).
- The returned query keeps the speaker's original casing.
- **Text fallback on every action** (typed command input + tappable
  buttons, same pattern as VoicePos). Voice never gates an inventory
  action. Voice confirmations are spoken in Bangla AND shown on
  screen (`voice-inventory-last-spoken`).

## 3. Barcode + manual entry, both working

- Server-side lookup: `GET /api/products/barcode/{code}` (owner/staff,
  own store only, exact match, 404 `PRODUCT_NOT_FOUND` otherwise).
  The POS already matched barcodes client-side; this route makes the
  lookup usable from inventory, from a scanner, and from typed entry.
- Camera scan: `components/BarcodeScanner.tsx` uses ZXing
  `@zxing/browser` (`BrowserMultiFormatReader`), which works in
  desktop Chrome, Android Chrome and the Capacitor WebView.
- Graceful degradation (never a dead end): no camera, denied
  permission, or ZXing start failure shows exactly why and points at
  the manual barcode entry next to it.
- Manual paths: type a barcode → same server lookup; no barcode →
  name search or "Add Product". No product is unreachable for lacking
  a barcode, and no barcode product requires typing when a camera is
  available (on a device with a camera — see the manual checklist).

## 4. Store owner profile — diagnosis (bug found and fixed)

**Root cause:** the data flow was correct but the screen was
incomplete. `GET /api/auth/me` (via `publicUser`, which strips only
the PIN) and `PUT /profile` already carried `storeName`, `username`,
`plan`, `address`, `phone`, `zila`, `upozila`, `thana` and
`profilePicture` — but `components/Profile.tsx` rendered **no
zila/upozila/thana field at all** (neither display nor input). Any
saved location value was invisible and uneditable, which is exactly
"profile does not display properly". `storeName`/`username`/`plan`/
`address`/`phone`/`profilePicture` did display; they were not the bug.

**Fix:** a profile summary card (`profile-summary`, one testid per
field) showing every field at a glance, plus zila/upozila/thana inputs
in the edit form (prefilled from the same data, saved through the
existing `PUT /profile`). Regression check: the Phase 6 E2E profile
spec sets all fields via the API and asserts every summary line and
every prefilled input.

## 5. Online reliability — what was fixed (not removed)

Offline-first behavior from Phases 1–3 is untouched; the existing
offline-sync E2E flow still passes. Fixes:

- `services/api.ts`: bounded retry — idempotent GET/DELETE only, max
  3 attempts, 150 ms / 300 ms backoff, `Retry-After` honored (capped
  2 s) for 429. POST/PUT are **never** auto-retried: re-sending a sale
  could duplicate money. Failures surface with a UI retry path.
- Connection state is truthful: `online` / `offline` /
  `reconnecting` (a retry in flight reports `reconnecting`, never a
  stale `online`); the sidebar shows it and the sync pill shows failed
  counts ("N failed — tap to retry").
- `services/amarSync.ts` audit fixes:
  1. Enqueue dedupes by sale id — the same sale can never queue twice.
  2. `SALE_ID_CONFLICT` on flush counts as synced only (the old code
     counted it as failed AND synced).
  3. `failed` records stay in the outbox, are counted separately, are
     retried by flush, and are retryable from the modal ("Retry N
     failed"). `clearSyncedOutbox` used to keep only `pending` and
     silently discard failed records.
- Failure tests: unit tests for bounded GET retry (fails twice, then
  succeeds; always-fails stops at exactly 3 attempts; POST never
  retries; 503 retries), real-outbox tests for dedupe and conflict
  counting, and a Playwright dropped-connection test (first inventory
  fetch aborted, UI still loads via retry). No-duplicate-sync is
  proven by the dedupe + conflict tests plus the existing offline-sync
  E2E flow.

## 5b. Pre-existing PG bug found by the Phase 6 tests (fixed)

The first PostgreSQL run failed 2 Phase 6 tests with the server log
`Database operation failed, falling back to disk-persisted store:
value.toISOString is not a function`. Cause: clients echo the full
product object back on save, including `createdAt` as a JSON string —
but `createdAt` is a Drizzle timestamp, whose serializer calls
`.toISOString()` on the value. The PG upsert threw, `op()` fell back
to the disk store, and PG data silently never updated while the UI
showed the fallback write as success — exactly the divergence class
Phase 4's P1-8 warned about, never before exercised on PG because no
earlier PG test edited a product via the full-object path. Fix (two
layers): `POST /products` strips `createdAt` at the route boundary,
and `upsertProduct`'s PG branch strips it from the write payload
(`createdAt` is server-managed via `defaultNow` and immutable).
Re-run: PostgreSQL suite 20/20, fallback suite 20/20.

## 6. GitHub hygiene

- All 4 workflows parse (verified with PyYAML) and use working
  install commands (`npm install` in ci/deploy, `bun install` in
  preview/android — never `npm ci`; `npm ci` appears only in comments
  explaining why it cannot work: there is no `package-lock.json`,
  only `bun.lock`). Gates: ci.yml runs type-check, lint, unit tests,
  build, plus a new Playwright E2E job (Chromium, fallback store);
  deploy.yml adds lint to its gate; preview.yml already ran
  type-check, lint, tests, build and the API-docs freshness check.
- `server/openapi.json` bumped to `3.0.0-phase6` with the new routes
  (`/products/barcode/{code}`, `/products/bulk`) plus `/inventory-logs`
  and `/profile`; `docs/api.html` regenerated (`npm run docs:api`,
  42 paths). Honest limit: the spec documents the most-used routes,
  not literally every route in `server/routes.ts` — it says so.
- README/ARCHITECTURE corrected: full `AMAR_*`/auth/discount env-var
  list, migrations 0001→0002→0003 in order, deploy.yml gates,
  Phase 6 features, and a "Releases" procedure (migrations before
  code, merge to `main` for the Render deploy, then tag `v*` for the
  signed Android APK/AAB build; a tag push does not re-trigger the
  web deploy).
- `.gitignore` verified by the milestone zip listing: `node_modules/`,
  `.env`, `dist/`, `test-results/`, `data/`, Android generated assets
  and keystore material are all excluded; `.github/workflows` and
  `.gitignore` itself are included.

## 7. Drive-by fix (inside Phase 6 scope, per the task)

GuestMenu language toggle (Phase 5 gap): `GuestMenu` now accepts an
optional `setLang` prop, `App.tsx` passes it, and the guest header has
a `guest-lang-toggle` button. The guest-KDS E2E flow still passes.

## 8. Manual verification — owner checklist (cannot be proven headless)

1. **Camera barcode scan on a real Android phone:** open Inventory →
   "Scan with camera" → allow camera → point at a printed company
   barcode. Expect the product found and its Edit / +1 stock actions.
   If the camera is denied, expect the "no camera / permission"
   message and the manual entry to still work.
2. **Bangla voice on a low-end phone:** Inventory voice panel → speak
   "চাল খুঁজুন", "চাল যোগ কর", "চালের স্টক ২০ কর". Expect the Bangla
   confirmation spoken AND shown; with voice unsupported, the typed
   input must do the same job.
3. **Dropped connection in the shop:** with the app open, kill Wi-Fi
   mid-inventory-load, then restore it. Expect "Reconnecting…" then
   the list, no frozen UI, no lost sale; a failed sale must appear in
   the outbox with a visible Retry, never silently vanish.

## 9. Launch blockers carried forward (UNCHANGED, Phase 4 verdict stands)

1. Play Store screenshots (real device) + privacy-policy URL.
2. 5-minute setup test, live run with a real non-technical user.
3. Production HTTPS secure-cookie login (staging check).
4. Signed APK/AAB (Android workflow never run; Gradle never compiled).
5. Bluetooth printing on a real device.
6. Live gateway verification (no real bKash/Nagad credentials).
7. Nightly `pg_dump` on Render (Cron Job filesystem is ephemeral).
8. Live staging / PR-preview URLs (no staging deployment yet).
9. Error tracking as "working" (hooks exist, no provider configured).
10. Bangla voice accuracy on a low-end Android phone.

Phase 4 deferred findings carried forward unchanged: settlement never
deducts stock; no staff/customer per-account lockout; no CSP; admin
JSON export on PG reads fallback data; concurrent shift-open race on
PG; 30-day sessions / no idle timeout / PIN change doesn't revoke
sessions; outage data-visibility limit; sub-tick auto-replay caveat;
PG last-unit contention unmeasured. Phase 5 gaps carried forward
except the GuestMenu toggle (fixed above): on-device low-end pass;
voice/sound on a real device; sync-spin verified by class only.
