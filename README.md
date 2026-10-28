# Amar Dokan POS 🛍️

**Amar Dokan** is a professional, cloud-based multi-store marketplace and Point of Sale (POS) platform built for small and medium businesses in Bangladesh. A single PostgreSQL-backed Express API powers three connected experiences:

1. **Store Owner POS** — inventory, sales, due (credit) tracking, staff management, reporting.
2. **Customer Marketplace** — phone + PIN registration, browse every store, search products across the whole marketplace, cart & checkout.
3. **Delivery Tracking** — every online order flows through `Placed → Confirmed → Out for Delivery → Delivered` (or `Cancelled`), visible live to both the store owner and the customer.

All data lives in a central PostgreSQL database — there is no offline/local storage. Every action (a sale, a stock adjustment, an online order) is immediately visible to every authorized party.

---

## 🌟 Key Features

### 🛒 Point of Sale (POS)

- Fast checkout via search, category browsing, or barcode scan.
- Cash / bKash / Nagad / Card payment methods.
- Due (credit) sales tracking per customer.
- Thermal-printer-friendly invoices with PDF export.

### 🌐 Customer Marketplace

- Separate **phone + PIN** registration/login for shoppers — completely independent from store-owner accounts.
- Store directory: every store with at least one online-visible product appears in the marketplace.
- Cross-store product search.
- Cart & checkout with delivery address capture.
- Live order tracking: customers watch their order move through each delivery stage in real time.

### 🚚 Delivery Status Tracker

- Every marketplace order has a status: `placed → confirmed → out_for_delivery → delivered`, or `cancelled`.
- Store owners advance orders one step at a time from the **Online Orders** screen.
- Cancelling an order automatically restocks the reserved inventory; placing an order automatically deducts it — inventory numbers are always accurate.

### 📦 Inventory & Product Management

- Full cost/price/stock/supplier tracking per product, per store.
- Category-aware fields (medicine batch/expiry, clothing size/color, electronics warranty/serial, restaurant dietary type).
- Inventory movement log (sale, restock, adjustment, online order, cancellation) for full auditability.
- Per-product toggle for marketplace visibility (`isOnlineVisible`).
- **Phase 6:** camera barcode scanning (ZXing, in browser and the Capacitor shell) with graceful fallback to manual barcode entry, plus a server-side barcode lookup route (`GET /api/products/barcode/{code}`, own store only); products without barcodes stay reachable by name search.
- **Phase 6:** bulk actions (stock adjust, price set, delete with confirmation; per-product skips reported, never hidden), a low-stock list with visible badges, a per-product movement-history panel, and Bangla inventory voice (speak to search/add/update stock, with a typed-command fallback on every action — voice never gates an action).

### 👥 Staff & Security

- Role-based permissions (`process_sale`, `manage_inventory`, `view_reports`, `manage_staff`, `manage_settings`).
- PIN-based authentication, hashed server-side — never stored in plain text.
- Server-side sessions (`express-session` + PostgreSQL session store) — no client-side secrets.

### 📊 Financials & Analytics

- Live dashboard: sales, profit, expenses, cash-in-hand.
- Daily reports, hourly sales trends, top products, due list.
- Expense tracking against true net profit.

---

## 💻 Tech Stack

| Layer     | Technology                              |
| --------- | --------------------------------------- |
| Frontend  | React 18 + TypeScript + Vite            |
| Styling   | Tailwind CSS                            |
| Backend   | Node.js + Express 5                     |
| Database  | PostgreSQL (via Drizzle ORM)            |
| Sessions  | `express-session` + `connect-pg-simple` |
| Charts    | Recharts                                |
| PDF/Print | jsPDF, html2canvas                      |

---

## 🏗️ Architecture

```
Client (React/Vite)  ──HTTP/JSON──▶  Express API  ──Drizzle ORM──▶  PostgreSQL
       │                                  │
       ├─ services/api.ts (fetch wrapper) ├─ server/routes.ts   (all endpoints)
       ├─ services/storage.ts (typed API) ├─ server/storage.ts  (DB access layer)
       └─ hooks/useApiData.ts             └─ shared/schema.ts   (Drizzle schema, shared types)
```

There is **no client-side database**. All reads/writes go through the API, so store owners, staff, and customers always see the same, up-to-date data — sales, stock levels, dues, and delivery statuses stay in sync across every device automatically.

### Core data flow: an online order

1. Customer logs in (phone + PIN), browses the marketplace, adds items to cart, checks out.
2. Server validates stock, creates the order (`status: placed`), and immediately deducts stock + logs the inventory movement.
3. Store owner sees the order under **Online Orders** and advances it: `confirmed → out_for_delivery → delivered`.
4. If the store owner cancels instead, reserved stock is automatically restored and logged.
5. The customer's order-tracking screen polls for status changes and reflects them live.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A PostgreSQL database (Replit provisions one automatically; otherwise set `DATABASE_URL`)

### Environment Variables

Copy `.env.example` to `.env` and fill in the values (see file for details):

- `DATABASE_URL` — PostgreSQL connection string (optional; when unset or unreachable, the disk-persisted fallback store in `AMAR_DATA_DIR` is used and the outbox replays into PostgreSQL on reconnect)
- `SESSION_SECRET` — random secret used to sign session cookies (required in production)
- `PORT` — server port (defaults to `3000`)
- `NODE_ENV` — `development` or `production`
- `AMAR_DATA_DIR` — directory for the disk-persisted fallback store (`fallback-store.json`) and replay outbox (`outbox.json`); default `./data` (gitignored). Must be on persistent storage in production. When `DATABASE_URL` is unset or PostgreSQL is unreachable, business data is written here and survives restarts; when PostgreSQL reconnects, the outbox replays into it.
- `AMAR_DEMO_SEED` — set to `true` ONLY to seed the demo store (`admin` / `1234`, demo products). Default off; without it no demo account exists. Never enable on a real deployment.
- `PLATFORM_ADMIN_USER_IDS` — comma-separated user IDs that are platform admins (the only admin mechanism; there is no default admin account).
- `AMAR_GATEWAY_CALLBACKS_ENABLED` — `true` to accept bKash/Nagad gateway callbacks (HMAC-verified; see `docs/gateway-callback-spec.md`). Default off; callbacks return 503 when off.
- `AMAR_BKASH_CALLBACK_SECRET`, `AMAR_NAGAD_CALLBACK_SECRET` — per-gateway HMAC secrets (≥16 chars) for callback verification.
- `AMAR_ERROR_TRACKING_ENABLED`, `AMAR_ERROR_TRACKING_DSN` — error tracking is only active when both are set (DSN must be an `https://` endpoint); otherwise the integration point exists but nothing is sent.
- `AUTH_RATE_LIMIT_MAX` (default 12), `AUTH_RATE_LIMIT_WINDOW_MS` (default 15 minutes) — auth-attempt rate limit per IP.
- `OWNER_MAX_DISCOUNT_PERCENT` (default 100), `STAFF_MAX_DISCOUNT_PERCENT` (default 10) — caps enforced server-side on sale discounts.

### Installation & Local Development

```bash
bun install          # supported install (bun.lock is the lockfile); npm install also works, npm ci does not
npm run dev          # starts the Express server + Vite dev middleware on :3000
```

Phase 2 additions: browsable API docs at `/docs` (raw spec at
`/api/openapi.json`, generated by `npm run docs:api`); Playwright E2E
suite via `npm run test:e2e` (see `tests/e2e/`); Capacitor Android shell
in `android/` (see `docs/android.md`); staging + PR-preview setup in
`render.yaml` and `docs/staging.md`; monitoring in `docs/monitoring.md`
(structured logs, error-tracking integration point, admin System Status
tab). Error tracking is currently **unconfigured** (no credentials) —
see `docs/monitoring.md` before describing it as working.

Database schema changes are versioned in `migrations/`. There are three
migrations, applied in order: `0001_financial_stock_fields.sql`,
`0002_phase3_depth.sql`, `0003_loyalty_store_phone_pk.sql`. A deployment
that skips 0002/0003 serves fallback data for the affected operations
(the boot check only warns) — **always apply migrations before deploying
the code that needs them** (see "Releases" below).
Do not run `npm run db:push` against a database after the app has created its
PostgreSQL session table without reviewing the proposed diff: Drizzle does not
own that table and may propose dropping it.

### Production Build

```bash
npm run build        # builds the client into dist/
npm start             # NODE_ENV=production node/tsx server/index.ts, serving the built client
```

### First login

There is no default administrator account or default PIN. Register a store owner
account; public registration starts on the free plan. Platform administrator
access is granted only to explicitly configured user IDs through
`PLATFORM_ADMIN_USER_IDS`. Existing legacy bootstrap accounts are not privileged
by username, and the old legacy account requires explicit allowlisting before
its legacy PIN can be used.

For one-time server-side owner provisioning, set `BOOTSTRAP_OWNER_USERNAME`,
`BOOTSTRAP_OWNER_PIN`, `BOOTSTRAP_STORE_NAME`, and `BOOTSTRAP_STORE_CATEGORY`
through the hosting provider's secret/configuration flow, then run
`npm run seed:owner`. The script does not create an administrator role.

---

## 📂 Project Structure

```
├── components/            # React components (POS, Dashboard, Inventory, StoreOrders, ...)
│   ├── marketplace/        # Customer-facing marketplace app (auth, browse, cart, tracking)
│   └── restaurant/          # Restaurant-specific components (KDS, Guest Menu, Tables)
├── services/
│   ├── api.ts               # Thin fetch() wrapper (adds credentials, JSON handling)
│   └── storage.ts           # Typed client-side API for every backend endpoint
├── hooks/useApiData.ts      # Generic data-fetching hook (loading/error/refetch)
├── server/
│   ├── index.ts             # Express app bootstrap
│   ├── routes.ts            # All REST endpoints (auth, POS, marketplace, delivery, admin)
│   ├── storage.ts           # Database access layer (Drizzle queries)
│   ├── db.ts                 # PostgreSQL connection pool
│   └── vite.ts               # Dev-mode Vite middleware / production static serving
├── shared/schema.ts         # Drizzle table definitions + inferred types (shared client/server)
├── types.ts                  # Shared TypeScript interfaces
└── constants.ts               # Translations, limits, app-wide constants
```

---

## 🔑 User Guide

### Store Owners

1. Open the app → **Register Store** → choose a category (Grocery, Medicine, Clothing, Electronics, Restaurant, Other).
2. Add products in **Inventory**. Toggle **online visibility** on any product you want listed in the marketplace.
3. Sell in-store via **POS**, track dues via **Due List**, and manage online deliveries via **Online Orders**.

### Customers

1. From the login screen, choose **Shop as a Customer**.
2. Register with your name, phone number, and a PIN (separate from any store-owner account).
3. Browse stores, search products across the marketplace, add to cart, and check out.
4. Track your order's delivery status live from **My Orders**.

### Subscription Model

- **Free Plan**: limited products/daily sales, for evaluation.
- **Premium Plan**: unlimited, unlocked via the admin-approved subscription request flow.

---

## 🚢 Deployment

This is a **stateful full-stack application** (Express server + PostgreSQL + server-side sessions) — it is not a static site. It needs a host that runs a persistent Node process, not a pure static/CDN host. Netlify's free tier only serves static files and short-lived serverless functions and cannot run this backend, so it is intentionally not used here.

### Option A: Replit Deployments (zero setup)

This project already runs on Replit. Use the built-in **Publish/Deploy** button — Replit Deployments builds, hosts, and manages TLS for the Express server and its PostgreSQL database automatically.

### Option B: GitHub → Render (automated CI/CD)

This repo includes everything needed to auto-deploy to [Render](https://render.com) on every push to `main`:

1. **Push this repository to GitHub** (if you haven't already).
2. **Create a Render account** and click **New → Blueprint**, then point it at your GitHub repo. Render will read `render.yaml` in the repo root and provision:
   - a free Node web service (`amar-dokan-pos`) running `npm run build` + `npm start`
   - a free PostgreSQL database (`amar-dokan-pos-db`), automatically wired to the web service via `DATABASE_URL`
   - a random `SESSION_SECRET`, generated automatically
3. After the first deploy succeeds, open the web service in Render → **Settings → Deploy Hook**, and copy the Deploy Hook URL.
4. In your GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `RENDER_DEPLOY_HOOK_URL`, and paste the URL.
5. Initialize a brand-new empty database before the application creates its
   `connect-pg-simple` session table. Review any Drizzle schema diff and cancel
   if it proposes deleting or renaming existing tables. For an existing
   database, back it up and apply the incremental SQL in `migrations/` instead
   of using `db:push` blindly. Then register an owner account or use the
   documented one-time owner bootstrap.

From then on, every push to `main` runs `.github/workflows/deploy.yml`: it type-checks, lints, unit-tests and builds the app, then (only if all of that succeeds) calls the Render deploy hook to ship the new version. Pull requests run `.github/workflows/preview.yml` (type-check, lint, unit tests, build, API-docs freshness) plus `.github/workflows/ci.yml` (type-check, lint, unit tests, build, and the Playwright E2E suite against the fallback store), so you can verify a change is safe before merging. `render.yaml` also defines a staging service (`amar-dokan-pos-staging`, staging branch, separate database) — see `docs/staging.md` for the staging drill and the free → paid PostgreSQL upgrade checklist.

### Releases (tagging + deploy order)

1. **Apply migrations first.** On the target database, in order: `drizzle-kit push` (schema baseline, reviewed — never blind on a database that already has the session table), then `migrations/0001`, `0002`, `0003`. Deploying code before its migrations is the one order that silently degrades (fallback data for the affected operations).
2. **Merge to `main`.** That push runs `deploy.yml` and ships the web service via the Render deploy hook.
3. **Cut the release tag only after the web deploy is healthy:**
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
4. **What the tag triggers:** `.github/workflows/android.yml` (tags `v*` only, plus manual dispatch) type-checks, unit-tests, builds the Capacitor web assets, syncs the Android project, then — only if the four Android signing secrets are set — builds a signed APK + AAB with Gradle and attaches both to the GitHub release for that tag. If any signing secret is missing the workflow fails closed; it never ships a debug-signed or unsigned "release" build. A tag push does **not** re-trigger the Render web deploy (deploy.yml runs on `main` pushes only).
5. **Never commit** `node_modules/`, `.env`, `dist/`, `data/`, `test-results/`, Android generated assets (`android/app/src/main/assets/`), or any keystore material (`*.jks`, `*.keystore`, `android/keystore.properties`) — all are gitignored; see `.gitignore`.

### Option C: Any other Node host (Railway, Fly.io, etc.)

The app is a standard Node/Express service — set `DATABASE_URL`, `SESSION_SECRET`, `PORT`, run `npm run build && npm start`, and it will work on any host that runs a persistent Node process. Adjust `.github/workflows/deploy.yml`'s final step to call that provider's deploy trigger instead of Render's.

---

## 📄 License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

## 🔒 Security

See [SECURITY.md](SECURITY.md) for supported versions and how to report a vulnerability.
