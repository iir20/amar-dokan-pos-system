
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

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Backend | Node.js + Express 5 |
| Database | PostgreSQL (via Drizzle ORM) |
| Sessions | `express-session` + `connect-pg-simple` |
| Charts | Recharts |
| PDF/Print | jsPDF, html2canvas |

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
- `DATABASE_URL` — PostgreSQL connection string (required)
- `SESSION_SECRET` — random secret used to sign session cookies (required in production)
- `PORT` — server port (defaults to `5000`)
- `NODE_ENV` — `development` or `production`

### Installation & Local Development
```bash
npm install
npm run dev          # starts the Express server + Vite dev middleware on :5000
```

Database schema changes are versioned in `migrations/`. The current development
database has the additive `0001_financial_stock_fields.sql` changes applied.
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

From then on, every push to `main` runs `.github/workflows/deploy.yml`: it type-checks and builds the app, then (only if that succeeds) calls the Render deploy hook to ship the new version. Pull requests only run `.github/workflows/ci.yml` (type-check + build, no deploy) so you can verify a change is safe before merging.

### Option C: Any other Node host (Railway, Fly.io, etc.)
The app is a standard Node/Express service — set `DATABASE_URL`, `SESSION_SECRET`, `PORT`, run `npm run build && npm start`, and it will work on any host that runs a persistent Node process. Adjust `.github/workflows/deploy.yml`'s final step to call that provider's deploy trigger instead of Render's.

---

## 📄 License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

## 🔒 Security

See [SECURITY.md](SECURITY.md) for supported versions and how to report a vulnerability.
