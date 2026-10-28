# Phase 4 — adversarial security audit (route by route)

Method: every route in `server/routes.ts` was enumerated and tested
for cross-store access, staff permission boundaries, customer/owner/
admin separation, IDOR (predictable IDs), brute-force resistance, and
session/cookie flags. Where the storage layer already enforced the
rule in one branch (PostgreSQL) but not the other (fallback), the
fallback was fixed to match. Live proof:
`scripts/phase4-audit-proof.mjs` (main 38/38, admin 6/6, ratelimit
2/2), `scripts/phase4-ws-proof.mjs` (PASS), plus the legacy-collision
login proof in the Phase 4 report. All IDs in the app are
`crypto.randomUUID()` — no sequential or guessable IDs were found;
the guest/marketplace order IDs are client-generated UUIDv4, which is
why unauthenticated guest-order reads are acceptable (see P2-6).

## Holes found and fixed (re-tested live unless noted)

### P1-1 — WebSocket broadcast leaked every store's live sales (FIXED)

- **Routes:** `AmarLive` broadcast (`server/live.ts`), all
  `broadcastToStore` call sites.
- **Attack:** connect to `/ws` with no session (or any `?storeId=`) and
  receive every store's `SALE_COMPLETED` / `NEW_ORDER` events — the old
  code sent to clients with no storeId at all.
- **Fix:** session config moved to `server/sessionConfig.ts` (shared
  secret + store); `live.ts` unsigns `connect.sid` and looks the
  session up in the same store the HTTP routes use. A socket is
  subscribed only to its session's store; a foreign `storeId` claim is
  ignored; unauthenticated sockets get no store events.
- **Re-test:** WS proof — anon socket claiming victim store: no event;
  victim owner socket: event received; other owner claiming victim
  store: no event. PASS. The old global-listener behavior is gone;
  note the frontend already connects with its own storeId, so logged-in
  store users are unaffected.

### P1-2 — Public endpoints leaked product cost prices (FIXED)

- **Routes:** `GET /api/public/store/:storeId/menu`,
  `GET /api/marketplace/stores/:storeId/products`,
  `GET /api/marketplace/products`, `POST/GET /api/public/guest-orders`.
- **Attack:** unauthenticated `GET` of any store's menu/search returned
  full product records including `cost`.
- **Fix:** `server/publicView.ts` strips `cost` at the API boundary
  for all public responses. Internal owner/staff routes and the stored
  guest-order record are unchanged (settlement needs cost for profit).
- **Re-test:** audit script asserts no `cost` key in menu, search,
  guest-order create, or guest-order read. PASS.

### P1-3 — Guest orders accepted other stores' products + bad quantities (FIXED)

- **Route:** `POST /api/public/guest-orders` (fallback branch only;
  the PostgreSQL branch already checked both).
- **Attack:** order a product from store B through store A's table
  (bill computed from B's price, recorded under A); or a negative
  quantity to shrink the bill.
- **Fix:** fallback `createGuestOrder` now validates quantity
  (`quantityToUnits`), rejects duplicate lines, requires
  `product.storeId === table.storeId`, and rejects idempotency replays
  whose table/items/note differ (409) instead of returning the old
  order. Route-level validation (table, 1–100 items, note ≤ 500) added.
- **Re-test:** cross-store item 409, negative qty 400, replay-diff 409.
  PASS.

### P1-4 — Marketplace orders: negative qty, cross-store items, cross-customer replay (FIXED)

- **Route:** `POST /api/marketplace/orders` (fallback branch only;
  PostgreSQL branch already checked all three).
- **Attack:** negative quantity increased stock on deduct and shrank
  the bill; another store's product could be ordered; replaying another
  customer's idempotency key returned that customer's order (with phone
  - address).
- **Fix:** fallback `createMarketplaceOrder` now validates quantities,
  duplicates, `product.storeId === order.storeId`, and idempotency
  replays (customer + store + items must match, else 409).
- **Re-test:** negative qty 400, cross-store 404, other-customer replay
  409, own order read isolation 404 for the other customer. PASS.

### P1-5 — Staff username collision across stores (FIXED)

- **Routes:** `POST /api/staff`, `POST /api/auth/login`.
- **Attack:** the fallback store never enforced staff-username
  uniqueness (PostgreSQL's unique column did), and login tried only
  the FIRST staff row with that username — so a second owner's staff
  could log into the first owner's store if PINs matched, or be locked
  out entirely.
- **Fix:** creation now rejects any existing username (409
  `USERNAME_TAKEN`); login verifies the PIN against EVERY staff row
  sharing the username (`getStaffByUsernameAll`) and logs into the
  matching row's store.
- **Re-test:** second-owner create 409; legacy duplicate rows seeded
  directly into the fallback snapshot (same username, two owners, two
  PINs) log into the correct store per PIN. PASS.

### P1-6 — Marketplace order status could be forced + double restock (FIXED)

- **Route:** `PUT /api/orders/:id/status` (fallback branch only;
  PostgreSQL branch already enforced transitions).
- **Attack:** any status string, e.g. `placed → delivered` directly, or
  `delivered → cancelled` to restock a delivered order a second time.
- **Fix:** fallback `updateOnlineOrderStatusForStore` now enforces the
  same transition map as PostgreSQL
  (`placed→confirmed/cancelled`, `confirmed→out_for_delivery/cancelled`,
  `out_for_delivery→delivered/cancelled`, terminal `delivered`/
  `cancelled`).
- **Re-test:** skip 409, valid lifecycle 200s, delivered→cancelled 409.
  PASS.

### P1-7 — Any staff could close any cashier's shift (FIXED)

- **Route:** `POST /api/shifts/:id/close`.
- **Attack:** a staff member with any permission closed another
  cashier's shift with an arbitrary counted-cash figure, falsifying
  that cashier's Z-report.
- **Fix:** staff may close only shifts whose `cashierId` is their own
  (403 otherwise); owners may close any shift in their store. Close
  also requires `process_sale` now.
- **Re-test:** other-staff close 403, owner close 200. PASS.

### P2-1 — Staff permission gaps on read/shift routes (FIXED)

- **Routes:** `GET /api/products`, `GET /api/branches`,
  `GET /api/branches/:id/counters`, `GET /api/shifts/current`,
  `POST /api/shifts/open` had no `requirePermission` at all — a
  zero-permission staff member could list products (with cost) and open
  shifts.
- **Fix:** products require `view_reports`/`manage_inventory`/
  `process_sale` (POS cashiers keep working); branches/counters require
  those plus `manage_settings`; shifts current/open/close require
  `process_sale` (owners bypass as before).
- **Re-test:** zero-permission staff: products 403, sales 403,
  shift-open 403; process_sale staff: products 200. PASS.

### P2-2 — Settlement inputs unvalidated (FIXED)

- **Route:** `POST /api/restaurant/guest-orders/:id/settle`
  (`settleGuestOrder` is fallback-only by design).
- **Attack:** negative `vatRate` shrank the bill; negative `paidAmount`
  was stored; any `paymentMethod` string was recorded.
- **Fix:** payment method enum, discount ≥ 0, VAT 0–100, paid/cash ≥ 0
  validated before any sale is created.
- **Re-test:** negative VAT 400, valid settle 200. PASS.

### P2-3 — Guest-order status / void terminality (FIXED)

- **Routes:** `PUT /api/restaurant/guest-orders/:id`,
  `POST /api/restaurant/guest-orders/:id/void`.
- **Attack:** any status string was accepted (garbage statuses, or
  re-opening a served order); voiding a served order flipped it to
  cancelled while its sale stayed on the books, and double-void stacked
  void intents.
- **Fix:** KDS lifecycle enforced as the transition map the
  PostgreSQL branch already used (`pending → accepted → preparing →
ready → served`, cancel from any open state); served/cancelled are
  terminal; void refuses served/cancelled (409).
- **Re-test:** garbage status 400, void-after-serve 409. PASS.
- **Correction during the final gate (honest):** the first version of
  this fix whitelisted `pending/preparing/ready/served/cancelled` but
  missed `accepted` — the KDS UI's first step (`Accept` sends
  `accepted`). The fallback E2E caught it (guest-kds failed at "Start
  Cooking" because the card never left `pending`). The whitelist was
  corrected to the full map above and the suite re-ran 12/12. The
  lesson is recorded, not hidden: a security tightening that does not
  match the real UI flow is a regression, and the E2E gate is what
  catches it.

### P1-9 — Session store had no fallback during a database outage (FIXED, found by the outage drill)

- **Location:** `server/sessionConfig.ts` (session store choice).
- **Attack/impact (availability, not data theft):** when PostgreSQL
  was the session store, a database outage broke ALL authenticated
  traffic with 500s — `PgSession` errors propagate through
  express-session — even though the data layer itself fell back to the
  durable store. The "sell during an outage" story was false for
  logged-in users. Worse, a NEW registration during an outage failed
  outright: `establishSession` calls `regenerate()`, which destroys
  the old session, and the dead store's destroy error rejected the
  whole registration (`REGISTRATION_FAILED: connect ECONNREFUSED`).
- **Fix:** `FallbackSessionStore` wraps the PG store with an
  in-memory store — reads try PostgreSQL first and fall through to
  memory on error or miss, writes go to PostgreSQL when up and to
  memory when down, and `destroy` is best-effort (it never reports an
  error, so `regenerate()` cannot fail a login/registration because
  the database is down).
- **Re-test (live, PostgreSQL 16):** with the database stopped, a
  brand-new owner registered, created a product, and recorded a sale
  (outbox depth 6); after the database returned, the outage-created
  session still authenticated, and an admin replay drained all 6
  entries (outbox 0) — the owner then logged in against PostgreSQL
  and saw the product (stock 2, i.e. 3 − 1) and the sale (40). PASS.
- **Residual (honest):** a logout during an outage clears the browser
  cookie, but the PostgreSQL session row cannot be deleted while the
  database is down, so it lingers until expiry (30 days) or the next
  successful destroy. The cookie is gone, so the session cannot be
  reused from that browser; only someone who already copied the
  session id could replay it, and only until expiry. PIN change does
  not revoke sessions either (see the session section below).

### P1-10 — Restaurant settlement/voiding were fallback-only on PostgreSQL (FIXED, found by the PG E2E run)

- **Routes:** `POST /api/restaurant/guest-orders/:id/settle`,
  `POST /api/restaurant/guest-orders/:id/void`.
- **Impact:** both delegated directly to `MemStorage`, bypassing the
  database branch entirely. On a PostgreSQL deployment the order lived
  in PostgreSQL while settle/void looked in the (empty) fallback
  store — the KDS settle click did nothing and the order stayed
  `ready`; the PG E2E run caught it (guest-kds stuck at `ready`,
  subscription spec failed only on the harness side, see below).
- **Fix:** PostgreSQL branches in `server/storage.ts` mirroring the
  fallback math exactly (same sale id `sale-<last 8 of order id>`,
  same totals, same payment-intent shape, same 404/409 guards, same
  broadcasts, no stock deduction — matching the deferred finding
  below, not changing it here). Settlement validation now also runs
  in the wrapper before branching, so both paths share it.
- **Re-test:** full E2E suite against a fresh PostgreSQL database:
  12/12 PASS, including guest-kds end to end (settle → `served` +
  sale receipt).
- **Harness fix in the same pass:** `tests/e2e/prepare-admin.mjs`
  did not forward `AMAR_E2E_DATABASE_URL` to `DATABASE_URL`, so the
  E2E admin was prepared in the fallback store while the suite ran
  against PostgreSQL (admin login 401). It now forwards the URL with
  the same conditional spread as `playwright.config.ts`. This was a
  test-harness bug, not a production hole.

### P2-4 — Subscription request status self-set (FIXED)

- **Route:** `POST /api/subscription-requests`.
- **Attack:** body spread let an owner submit `status: 'approved'`.
  (Plan upgrade never depended on this — only the admin approve flow
  upgrades — but the record lied.)
- **Fix:** route forces `status: 'pending'`.
- **Re-test:** submitted `approved` → stored `pending`. PASS.

### P2-5 — Admin unlock / settings validation (FIXED)

- **Routes:** `POST /api/admin/users/:id/unlock`,
  `PUT /api/admin/payment-settings|pricing-config|global-config`,
  `DELETE /api/admin/users/:id`.
- **Attack/impact:** missing/short `newPin` threw inside `hashPin` → 500;
  any JSON shape could be saved as pricing/global config; an admin
  could delete their own account and lock all admins out.
- **Fix:** PIN validated (400, not 500); pricing/global config must be
  objects; payment settings fields must be strings; self-delete
  refused (403).
- **Re-test:** admin mode 6/6 PASS.

### P2-6 — Public guest-order read (REVIEWED, not a hole)

- **Route:** `GET /api/public/guest-orders/:id` (unauthenticated).
- **Assessment:** order IDs are client-generated UUIDv4 (unguessable),
  and guest orders carry no customer phone/name — only table, items,
  and totals (now cost-stripped). The QR guest flow needs this read for
  the guest's own order tracking. No change; brute-force enumeration
  of UUIDv4 space is infeasible.

## Checked and already sound (no change)

- Cross-store scoping on products/sales/expenses/inventory-logs/
  tables/guest-orders/staff/branches/counters/suppliers/POs/coupons/
  loyalty (route `storeId` comes from the session, never the body;
  storage methods verify `storeId` on mutate; product upsert throws
  404 on foreign ids — proven live for delete + overwrite).
- Owner/staff/customer/admin separation: `requireAuth` roles,
  `requirePermission` (owner bypass, staff permission list, staff's
  `ownerId` must match session), `requireAdmin` (platform-admin
  allowlist only). Customer sessions cannot reach owner routes;
  marketplace order reads return 404 (not 403) on foreign orders.
- Sale math: server recalculates every sale from its own product
  prices, rejects client price mismatches (409), enforces staff
  discount caps, validates coupons/loyalty server-side; sale-id
  replay requires identical details (409 on reuse with changes).
- PIN auth: scrypt, owner 3-attempt lock (15 min), legacy hash rehash
  on login, PINs stripped from every user/staff/customer response and
  from exports.
- `POST /api/products` body `storeId` is overridden by the session
  store; profile updates use an allowlist (no plan escalation);
  announcements/payment-settings/pricing-config reads are public by
  design (payment numbers are what customers pay to — noted, not a
  leak).

## Brute-force resistance + the limiter's honest limit

- Live proof (default limiter, fresh server): 15 bad logins from one
  IP → first 12 are 401, attempts 13–15 are 429 with `Retry-After`.
  Default is 12 attempts / 15 minutes / IP (`AUTH_RATE_LIMIT_MAX`,
  `AUTH_RATE_LIMIT_WINDOW_MS`); owner accounts additionally lock after
  3 bad PINs for 15 minutes.
- **Multi-instance limitation (documented, not hidden):** the limiter
  is in-memory per process (`authRateBuckets` in `routes.ts`). With N
  app instances behind a load balancer, an attacker gets roughly N ×
  the budget, and a single instance restart resets its buckets.
  Staff and customer accounts have no per-account lockout (only the
  IP limiter) — the schema has no lockout fields for them.
- **Mitigation checklist (deployment, not code claims):**
  1. Run a single app instance until a shared limiter lands, OR put a
     shared rate limit at the reverse proxy / WAF (e.g. Cloudflare or
     nginx `limit_req`) keyed by IP + path `/api/auth/*` and
     `/api/customer/*`, stricter than 12/15min.
  2. Alert on 429 spikes (they indicate a brute-force attempt).
  3. Do not raise `AUTH_RATE_LIMIT_MAX` in production to "fix" a
     shared-office NAT lockout — instead, put staff behind distinct
     egress IPs or accept the shared budget.
  4. Future work (not built here): a shared limiter backend (Redis or
     a PostgreSQL table) behind config, with the in-memory limiter as
     fallback. Claiming distributed limiting without building it would
     be false, so this stays a documented limitation.

## Session / cookie flags

- Cookies: `HttpOnly` always, `SameSite=Lax`, `Secure` only when
  `NODE_ENV=production` (correct — Secure cookies over plain HTTP
  would never be sent). Live dev proof shows `HttpOnly; SameSite=Lax`
  on the session cookie.
- **Production HTTPS login is still staging-verified only:** Secure
  cookies cannot be exercised over plain-HTTP curl. The staging
  checklist must confirm a production login sets `Secure` over HTTPS.
- Residual notes (not launch blockers, but real): session lifetime is
  30 days with no idle timeout; changing a PIN does not revoke other
  sessions; there is no CSRF token (SameSite=Lax blocks cross-site
  POSTs, which covers the browser attack, but a same-site XSS would
  still ride the session — that is why the CSP item below matters).
  No CSP header is set yet on purpose: the app serves inline
  styles/scripts and a blind CSP would break the POS UI. CSP belongs
  to a staging pass with a real browser test.
- Security headers added in Phase 4: `X-Content-Type-Options:
nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy:
strict-origin-when-cross-origin`.

## Found during audit, NOT fixed here (deferred, honestly)

- **Guest-order settlement does not deduct stock.** `settleGuestOrder`
  creates a Sale but never reduces product stock (POS sales do deduct).
  This is a pre-existing functional inconsistency, not a cross-store
  or auth hole, and changing it at the launch gate risks the KDS E2E
  flow (void/restock semantics would need a matching change). Flagged
  for the next functional pass with an E2E stock assertion — not
  silently "fixed" here.
- **Staff/customer per-account lockout** does not exist (see limiter
  section). Mitigated by the IP limiter + proxy-limit checklist.
