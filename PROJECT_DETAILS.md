# Amar Dokan POS — Full Project Documentation

> **Historical beta snapshot:** This document describes an earlier browser-IndexedDB architecture and is not authoritative for the current repository. The current app uses React/Vite, an Express API, PostgreSQL, and server-side sessions. See `README.md` and `ENGINEERING_READINESS.md` for current, verified information. Public default administrator credentials have been retired.

## 1. What This Project Is

**Amar Dokan POS** ("My Shop POS") is an **offline-first Point of Sale (POS) and inventory management system** built for small businesses in Bangladesh. It is bilingual (English / Bangla), works fully without internet access, and stores 100% of business data locally on the user's own device (browser IndexedDB) rather than on a remote server.

It supports six different store types out of the box, each with its own specialized fields and workflows:
- Grocery
- Pharmacy (Medicine)
- Clothing (Fashion)
- Electronics
- Restaurant (with full table/kitchen/QR ordering system)
- Other (general store)

It is packaged as a **Progressive Web App (PWA)**, meaning it can be "installed" on a phone or desktop and used like a native app, including offline.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| UI Framework | React 18 (functional components, hooks, `React.lazy` + `Suspense` for code-splitting) |
| Language | TypeScript |
| Build Tool / Dev Server | Vite 5 |
| Local Database | Dexie.js (a wrapper around the browser's IndexedDB) |
| Styling | Tailwind CSS (loaded via CDN in `index.html`) |
| Icons | lucide-react |
| Charts / Analytics | Recharts |
| PDF/Invoice Export | jsPDF + html2canvas |
| PWA / Offline Support | vite-plugin-pwa (generates a service worker + manifest) |
| Currency Math | Custom precision-safe utilities (`utils/currency.ts`) — avoids floating point rounding bugs |
| Security | Custom PIN hashing (`utils/security.ts`) |

There is **no backend server** — this is a pure client-side single-page application. A "cloud sync" architecture exists in the code (a `syncQueue` table and hooks) but is currently disabled via a feature flag (`ENABLE_CLOUD_SYNC = false` in `constants.ts`), so the app runs 100% standalone today.

---

## 3. Project Structure

```
/
├── App.tsx                    # Root component: routing, auth state, RBAC, layout
├── index.tsx                  # React DOM entry point
├── index.html                 # HTML shell (loads Tailwind CDN, fonts, manifest)
├── db.ts                      # Dexie database schema & seeding logic
├── types.ts                   # All TypeScript interfaces/domain models
├── constants.ts                # Translations (EN/BN), pricing config, themes, limits
├── manifest.json / metadata.json  # PWA metadata
├── vite.config.ts             # Vite + PWA plugin configuration
├── GuestOrderTracking.tsx     # Public page for guests to track their restaurant order
├── components/
│   ├── POS.tsx                # Main point-of-sale / checkout screen
│   ├── Dashboard.tsx          # Business analytics dashboard (charts, KPIs)
│   ├── Inventory.tsx          # Product/stock management (category-aware forms)
│   ├── InventoryInsights.tsx  # Smart inventory analytics (reorder points, stagnant stock)
│   ├── DailyReport.tsx        # End-of-day cash flow / income-expense report
│   ├── DueList.tsx            # Tracks customers who owe money (credit sales)
│   ├── Expenses.tsx           # Expense tracking/logging
│   ├── Invoice.tsx            # Printable/exportable receipt component
│   ├── Auth.tsx               # Login & registration screen
│   ├── Profile.tsx            # Store owner profile, subscription status, settings
│   ├── SubscriptionModal.tsx  # Upgrade-to-premium flow & payment submission
│   ├── AdminPanel.tsx         # Super-admin dashboard (manage all stores/subscriptions/pricing)
│   ├── InstallPrompt.tsx      # Handles "Add to Home Screen" PWA install prompt
│   ├── ErrorBoundary.tsx      # Catches render errors gracefully
│   ├── Loader.tsx             # Loading spinner used during lazy-loading
│   └── restaurant/
│       ├── TableManager.tsx   # Create tables, generate QR codes per table
│       ├── KitchenDisplay.tsx # Live Kitchen Display System (KDS) for chefs
│       └── GuestMenu.tsx      # Customer-facing menu (scanned via QR) to place orders
├── services/
│   └── storage.ts             # Central business-logic/data-access layer (all DB operations)
├── utils/
│   ├── currency.ts            # Safe money math (add/sub/mul without float errors)
│   └── security.ts            # PIN hashing
└── public/                    # Static assets
```

**Total source size:** ~7,100 lines of TypeScript/TSX across ~28 files.

Largest files (core business logic lives here):
- `components/AdminPanel.tsx` — 850 lines (super-admin control center)
- `components/Inventory.tsx` — 556 lines
- `components/POS.tsx` — 494 lines
- `services/storage.ts` — 483 lines
- `App.tsx` — 385 lines
- `components/Profile.tsx` — 377 lines
- `components/DailyReport.tsx` — 468 lines

---

## 4. Data Model (`types.ts`)

### Product
Core fields: `id`, `storeId`, `name`, `nameBn` (Bangla name), `price`, `cost`, `category`, `stock`, `unit`, `image`, `barcode`, `supplier`.

Conditional fields depending on store category:
- **Medicine:** `expiryDate`, `batchNumber`, `genericName`
- **Clothing:** `color`, `size`, `style`, `brand`
- **Electronics:** `warranty`, `serialNumber`, `brand`
- **Restaurant:** `dietaryType` (`veg`/`non-veg`), `preparationTime`

### CartItem
Extends `Product` with `quantity` and an optional `note` (special instructions).

### Sale
`id`, `storeId`, `date`, `items[]`, `subTotal`, `discount`, `vat`, `totalAmount`, `totalProfit`, `paymentMethod` (`cash | bkash | nagad | card`), `customerName`, `customerPhone`, `paidAmount`, `dueAmount`, `storeName`, `servedBy` (which staff member processed it).

### User (Store Owner)
`id`, `storeName`, `storeCategory`, `username`, `pin` (hashed), `address`, `phone`, location fields (`zila`, `upozila`, `thana`), `plan` (`free`/`premium`), `defaultVatRate`, `subscriptionExpiry`, `subscriptionStatus`, `profilePicture` (base64), `failedLoginAttempts`, `isLocked`.

### Staff (RBAC)
`id`, `ownerId`, `name`, `username`, `pin`, `permissions[]` — permission values include: `manage_inventory`, `view_reports`, `manage_settings`, `manage_staff`, `process_sale`.

### InventoryLog
Audit trail of every stock movement: `id`, `storeId`, `productId`, `productName`, `type` (`in | out | adjustment | sale`), `quantity`, `reason`, `date`.

### Expense
`id`, `description`, `amount`, `date`, `category`.

### Subscription System
- `PlanType`: `free | premium`
- `SubscriptionPackage`: `monthly | yearly | 2yearly`
- `PricingDetail`: `price`, `label`, `labelBn`, `durationDays`
- `CategoryPricing`: pricing per package type
- `GlobalPricingConfig`: maps each `StoreCategory` to its own `CategoryPricing` (restaurants and electronics are priced differently than standard stores)
- `SubscriptionRequest`: a pending payment claim submitted by a store owner (`paymentNumber`, `trxId`, `status: pending|approved|rejected`) that an admin must manually approve

### Restaurant-Specific Models
- `RestaurantTable`: `id`, `storeId`, `name` (e.g. "Table 1"), `isActive`
- `GuestOrder`: `id`, `storeId`, `tableId`, `items[]`, `note`, `status` (`pending → accepted → preparing → ready → served`, or `cancelled`), `createdAt`, `totalAmount`

### System-Wide Settings
- `PaymentSettings`: bKash/Nagad numbers for receiving subscription payments
- `PricingSetting`: stores the `GlobalPricingConfig`
- `GlobalConfig` / `GlobalConfigSetting`: app-wide logo and WhatsApp support number
- `Announcement`: admin-broadcast messages targeted at `all` stores or specific store IDs, with a date range and active flag

### Language & Translation
- `Language`: `en | bn`
- `Translation` interface: an exhaustive dictionary (~140 keys) covering every UI label in the app — dashboard terms, POS terms, inventory fields, subscription terms, restaurant terms, reporting terms, etc. Every user-facing string is translated, not hardcoded.

---

## 5. Local Database (`db.ts` — Dexie/IndexedDB)

Database name: `AmarDokanDB`, currently at **schema version 11**.

Tables and their indexes:

| Table | Indexed Fields | Purpose |
|---|---|---|
| `products` | id, storeId, name, category, stock, expiryDate, barcode | Product catalog |
| `sales` | id, storeId, date, customerPhone, storeName | Transaction history |
| `expenses` | id, date, category | Business expenses |
| `users` | id, username, storeCategory | Store owner accounts |
| `staff` | id, ownerId, username | Employee accounts (linked to an owner) |
| `inventoryLogs` | id, storeId, productId, type, date | Full stock movement audit trail |
| `subscriptionRequests` | id, userId, status | Pending premium plan payment claims |
| `syncQueue` | auto-id, table, timestamp, status | Reserved for future cloud sync (currently unused) |
| `settings` | key | Key-value store for global settings (pricing, payment numbers, logo) |
| `restaurantTables` | id, storeId, name | Restaurant table registry |
| `guestOrders` | id, storeId, tableId, status, createdAt | Orders placed by restaurant guests via QR |
| `announcements` | id, isActive, date | System-wide announcements from admin |

**Retired beta bootstrap behavior:** Older versions described a predictable seeded administrator and browser-only database. Those credentials and that initialization path are no longer supported. The current server does not seed a public admin account; new owners use the free plan, and platform administration requires an explicit user-ID allowlist.

**Historical sync note:** The local sync-queue description below belongs to the older beta architecture. Current restaurant guest orders use the Express API and PostgreSQL; see `ENGINEERING_READINESS.md` for the remaining real-time and payment limitations.

---

## 6. Business Logic Layer (`services/storage.ts`)

This is the single source of truth for all reads/writes to the database — components never touch Dexie directly for business operations. Responsibilities include:

- **Product CRUD** — `getProducts`, `saveProduct` (create/update with validation), stock updates.
- **Free-plan enforcement** — `saveProduct` throws `FREE_LIMIT_REACHED` if a free-plan user tries to exceed `LIMITS.FREE_PRODUCT_LIMIT` (20 products).
- **Inventory movement logging** — `logInventoryMovement()` writes an `InventoryLog` entry for every stock change (initial stock, adjustments, sales), enabling full audit history.
- **Transactional integrity** — Dexie transactions (`db.transaction('rw', ...)`) wrap multi-table writes (e.g., saving a product also updates `inventoryLogs` and `syncQueue` atomically); it correctly reuses an existing transaction if already inside one (via `Dexie.currentTransaction`) to avoid nested-transaction errors.
- **Stock deduction on sale** — `updateProductStock()` decrements stock per cart item and logs a `'sale'` type movement referencing the sale ID.
- **Authentication** — user lookup, PIN verification against hashed values, current-user session handling.
- **Subscription logic** — checking plan status/expiry, computing days remaining, and handling upgrade/downgrade state.

---

## 7. Application Flow / Routing (`App.tsx`)

`App.tsx` is the root orchestrator. Key responsibilities:

1. **Authentication gate** — shows `Auth.tsx` (login/register) until a user or staff session exists.
2. **Role-based navigation (RBAC)** — reads the logged-in staff member's `permissions[]` array and conditionally shows/hides nav items (e.g., a cashier with only `process_sale` won't see Inventory or Reports; an owner sees everything).
3. **Lazy-loaded routes** — every major screen (`Dashboard`, `POS`, `Inventory`, `Expenses`, `DueList`, `Auth`, `AdminPanel`, and the restaurant screens `TableManager`, `KitchenDisplay`, `GuestMenu`) is loaded via `React.lazy()` + wrapped in `<Suspense>` with the `Loader` component as a fallback — this keeps the initial bundle small.
4. **Subscription gating** — premium-only features (e.g., restaurant module, unlimited products) are locked behind `SubscriptionModal` if the user is on the free plan or their subscription has expired.
5. **Language toggle** — a global `Language` state (`en`/`bn`) is threaded through nearly every component, swapping all text via the `TRANSLATIONS` dictionary.
6. **Error boundary** — wraps the whole app so a component crash shows a friendly fallback instead of a blank white screen.

---

## 8. Feature Breakdown by Module

### 8.1 Point of Sale (`POS.tsx`)
- Product search + optional barcode scanning to quickly add items to a cart.
- Real-time calculation of `subTotal`, `discount`, `VAT`, and `totalAmount`.
- Multiple payment methods: Cash, bKash, Nagad, Card.
- Supports partial/due payments — if `paidAmount < totalAmount`, the difference becomes `dueAmount` and the sale is tracked in the Due List. Customer name is required for due/credit sales.
- Tracks which staff member (`servedBy`) processed the sale.
- On checkout, deducts stock via `StorageService.updateProductStock()` and can print/export an invoice.

### 8.2 Inventory (`Inventory.tsx`)
- Category-aware add/edit forms — e.g. a medicine product form requires expiry date & batch number; a clothing product form shows size/color/style fields; electronics show warranty/serial number.
- Enforces the free-plan product cap.
- Stock adjustments are logged to `InventoryLog` for auditability.

### 8.3 Inventory Insights (`InventoryInsights.tsx`)
Smart analytics layer on top of inventory data:
- Reorder point suggestions
- "Stagnant stock" detection (items not selling)
- "High demand" / money-maker product identification
- Stock value totals

### 8.4 Dashboard (`Dashboard.tsx`)
- KPI cards: total sales, net profit, total orders, total expenses, low-stock count.
- Recharts-based visualizations for sales trends.
- "Store health" indicators comparing performance vs. the previous day.

### 8.5 Daily Report (`DailyReport.tsx`)
- End-of-day cash flow report: income breakdown (by payment method), expense breakdown, net cash.
- Printable/exportable.

### 8.6 Due List (`DueList.tsx`)
- Lists every customer with an outstanding balance from credit sales, with purchase history and ability to view/settle dues.

### 8.7 Expenses (`Expenses.tsx`)
- Simple CRUD for logging business expenses by category and date, feeding into the Dashboard and Daily Report.

### 8.8 Invoice (`Invoice.tsx`)
- Renders a printable money-receipt for a completed sale, using `html2canvas` + `jsPDF` to export as an image/PDF.

### 8.9 Authentication (`Auth.tsx`)
- **Register:** creates a new store owner account with store name, category, username, and PIN (PIN is hashed before storage, never stored/transmitted in plaintext).
- **Login:** validates username + PIN against the hashed value in the local database.
- **Account lockout:** after repeated failed login attempts, `failedLoginAttempts` increments and the account can become `isLocked` — unlockable by an admin via the Admin Panel.
- Supports both store-owner and staff logins.

### 8.10 Staff Management / RBAC
- Store owners can create staff accounts with a name, username, PIN, and a specific set of `permissions`.
- The UI dynamically hides/shows features based on the logged-in staff member's permission set, effectively implementing role-based access control without a hardcoded role enum — permissions are granular and composable.

### 8.11 Profile & Subscription (`Profile.tsx`, `SubscriptionModal.tsx`)
- View/edit store profile (name, address, phone, location, profile picture).
- View current plan, expiry date, days remaining.
- Submit a subscription upgrade request: choose package (monthly/yearly/2-yearly), see category-specific pricing (restaurant and electronics pricing differ from standard), and submit proof of payment (payment number + transaction ID for bKash/Nagad). This request goes into `subscriptionRequests` with status `pending` until an admin approves it — **there is no automated payment gateway; approval is manual.**

### 8.12 Admin Panel (`AdminPanel.tsx`) — the largest file in the app
A super-admin-only control center (accessed via the seeded admin account) for managing the entire platform:
- Review and approve/reject pending `SubscriptionRequest`s.
- Manage global pricing (`GlobalPricingConfig`) per store category and package.
- Configure payment receiving numbers (bKash/Nagad) shown to all store owners.
- Manage global branding (app logo, support WhatsApp number).
- Create and broadcast `Announcement`s to all stores or specific stores, with a scheduled date range.
- Unlock accounts that were locked due to failed login attempts.
- Likely: view/manage all registered stores across the platform.

### 8.13 Restaurant Module (Premium Feature)
A full dine-in ordering system layered on top of the base POS, unlocked for restaurant-category premium accounts:

- **Table Manager (`restaurant/TableManager.tsx`)** — create/manage physical tables; generates a unique QR code per table encoding the `storeId` + `tableId`, which customers scan to reach the Guest Menu.
- **Guest Menu (`restaurant/GuestMenu.tsx`)** — a public-facing menu page (no login required) that a diner opens by scanning the table's QR code. They browse the store's product/menu list (with dietary type veg/non-veg and prep time shown), build a cart, add notes, and submit the order directly into `guestOrders`.
- **Kitchen Display System / KDS (`restaurant/KitchenDisplay.tsx`)** — a live, continuously-updating screen for kitchen staff showing incoming orders and allowing status transitions: `pending → accepted → preparing → ready → served` (or `cancelled`).
- **Guest Order Tracking (`GuestOrderTracking.tsx`, top-level file)** — a standalone public page letting the customer who placed the order check its live status without needing an account.

### 8.14 PWA / Offline Support
- `vite-plugin-pwa` auto-generates a service worker with Workbox.
- App is installable ("Add to Home Screen") — handled by `components/InstallPrompt.tsx`.
- Runtime caching rules cache external icon/image CDNs (Flaticon, Unsplash, Picsum) so they still render offline.
- `navigateFallback: '/index.html'` ensures client-side routing works offline.
- Manifest defines app name ("Amar Dokan POS"), theme color, icons, shortcuts (quick-launch straight into POS), and Bangla locale (`bn-BD`).
- Because all real data lives in IndexedDB (not fetched from a server), the app is fully functional with **zero internet connection** after first load — only the seed/asset download requires connectivity.

### 8.15 Multi-Language Support
- Every UI string is defined once in `constants.ts` under `TRANSLATIONS.en` and `TRANSLATIONS.bn` (~140 keys covering navigation, POS, inventory, subscriptions, restaurant terms, reporting, etc.).
- A single `Language` state toggle switches the entire app's text instantly — no page reload, no external i18n library needed.
- Product names also have a dedicated `nameBn` field so merchandise itself can be labeled bilingually on receipts and the POS screen.

### 8.16 Currency & Precision (`utils/currency.ts`)
- Custom `addMoney`, `subMoney`, `mulMoney`, `formatCurrency` helpers that avoid classic JavaScript floating-point rounding errors (e.g. `0.1 + 0.2 !== 0.3`) — critical for financial accuracy in a POS system handling real money.

### 8.17 Security (historical beta note)
- The old client-side hashing description is obsolete. The server now stores new PIN verifiers with salted scrypt and upgrades legacy SHA-256 verifiers on successful login.

---

## 9. Subscription / Pricing Model

Two plans:
- **Free:** capped at 20 products (`FREE_PRODUCT_LIMIT`) and 10 sales/day (`FREE_DAILY_SALES_LIMIT`); no restaurant module.
- **Premium:** unlimited products/sales, unlocks the full restaurant ordering system (tables, KDS, guest menu, QR codes).

Pricing is **category-specific** and configurable by the admin:
- Standard stores (grocery, medicine, clothing, other): ৳100/month, ৳1,000/year, ৳1,500/2-years.
- Electronics: ৳150/month, ৳1,500/year, ৳2,500/2-years (slightly higher, reflecting extra fields like warranty/serial tracking).
- Restaurant: ৳300/month, ৳3,000/year, ৳5,000/2-years (highest tier — includes the full KDS/table/QR system).

Payments are collected manually via **bKash/Nagad** (popular Bangladeshi mobile payment services) — the user submits a transaction ID, and an admin manually verifies and approves it in the Admin Panel. There is no integrated payment gateway/API.

---

## 10. Environment & Deployment Notes (Replit Setup)

This deployment section is historical and does not describe the current service. The app now requires PostgreSQL and a strong production `SESSION_SECRET`; consult `README.md` and `ENGINEERING_READINESS.md` for the current setup.

---

## 11. Summary

This file documents a previous beta snapshot. The current repository is a bilingual React/Vite client backed by an Express API and PostgreSQL; it is not browser-only or offline-synchronized.
- **Business logic** (`services/storage.ts`)
- **Presentation** (`components/*`, category-aware and RBAC-aware)

...with a dormant but ready-to-activate cloud-sync layer for a future multi-device/online version. It differentiates itself with category-specific product intelligence (medicine expiry tracking, clothing variants, electronics warranty/serial, restaurant dietary/prep-time data) and a genuinely complete restaurant ordering sub-system (QR-based guest ordering + kitchen display) rather than being a generic POS clone.
