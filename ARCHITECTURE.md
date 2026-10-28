# Amar Dokan POS — System Architecture & Data Flow

```
                           +----------------------------------------+
                           |       Amar Dokan POS PWA Client        |
                           | (React 18 + TypeScript + Tailwind CSS) |
                           +-------------------+--------------------+
                                               |
                   +---------------------------+---------------------------+
                   | (HTTP REST + Sessions)                                | (WebSocket /ws)
                   v                                                       v
     +---------------------------+                           +---------------------------+
     | Express 5 API Server      |                           | AmarLive WebSocket Hub    |
     | - Auth (Scrypt PIN)       |                           | Rooms:                    |
     | - Zod Input Validation    |                           | - store:{id}:orders       |
     | - AmarPay Ledger Engine   |                           | - store:{id}:kds          |
     | - Financial Math (Paisa)  |                           | - store:{id}:stock        |
     +-------------+-------------+                           +-------------+-------------+
                   |                                                       ^
                   +---------------------------+---------------------------+
                                               | (Domain Events Broadcast)
                                               v
                          +-----------------------------------------+
                          |   PostgreSQL 16 Database / Drizzle ORM  |
                          | (With In-Memory Resilient Fallback)     |
                          +-----------------------------------------+
```

---

## 1. Module Map

- **Auth & RBAC (`/server/routes.ts`, `/components/Auth.tsx`):**
  - Salted scrypt PIN verification.
  - Store owner vs. employee staff vs. marketplace customer roles.
  - Permission gating (`process_sale`, `manage_inventory`, `view_reports`, `manage_expenses`, `manage_restaurant`).

- **AmarSync Protocol (`/services/amarSync.ts`, `/components/SyncReconciliationModal.tsx`):**
  - Client-side outbox storing offline transactions with client UUID idempotency keys.
  - Pre-deduction of cached product stock during offline sales.
  - Automatic background synchronization when network re-establishes.
  - Conflict resolution: idempotent server replay and server-authoritative audit logs.
  - Phase 6 hardening: enqueue dedupes by sale id (no duplicate queue entries); a `SALE_ID_CONFLICT` flush counts as synced only, never also failed; `failed` records stay in the outbox, are counted separately, and are retryable from the modal (they used to be droppable via "Clear Synced"); the API layer (`/services/api.ts`) retries only idempotent GET/DELETE requests, bounded to 3 attempts with capped backoff, and reports online/offline/reconnecting truthfully — POST/PUT failures are never auto-retried (that could duplicate money).

- **Design system, Phase 5 (`/design/tokens.ts`, `/index.css`, `/components/ui.tsx`):**
  - Single token source of truth (light / dark / high-contrast themes, all text pairs ≥ 4.5:1 WCAG, unit-tested in `tests/phase5.test.ts`).
  - Shared `AdCard` / `AdButton` / `AdInput` used by POS, dashboard decision cards, checkout sheet, offline state and the Phase 6 inventory panels.
  - Global Bangla/English toggle + font scaling, persisted; two-tap checkout with receipt preview before printing.

- **Inventory, Phase 6 (`/components/Inventory.tsx`, `/components/VoiceInventory.tsx`, `/components/BarcodeScanner.tsx`, `/shared/phase6.ts`, `/server/routes.ts`):**
  - Instant name/Bangla-name/category/barcode filtering, low-stock (< 10) list + filter toggle, bulk stock/price/delete via `POST /api/products/bulk` (Zod-validated, stock never negative, delete requires confirmation, skips reported).
  - Server-side barcode lookup `GET /api/products/barcode/{code}` (own store only); camera scanning via ZXing `@zxing/browser` with graceful degradation to manual entry when no camera/permission exists.
  - Bangla inventory voice on the Phase 3 voice system (search / add / set-stock commands, standalone-token quantities only, typed-command fallback on every action).
  - Owner profile: `GET /api/auth/me` + `PUT /profile` already carried zila/upozila/thana/profilePicture; the Profile screen now displays and edits all of them (Phase 6 root-cause fix).

- **AmarLive Protocol (`/server/live.ts`, `/hooks/useAmarLive.ts`):**
  - Multiplexed room management on `/ws`.
  - Push notifications on `SALE_COMPLETED`, `NEW_ORDER`, `ORDER_STATUS_CHANGED`, `STOCK_ADJUSTED`.
  - Fallback polling timer (5s) activates only if WebSocket disconnects.

- **AmarPay Protocol & Dining Settlement (`/shared/schema.ts`, `/components/restaurant/RestaurantSettlementModal.tsx`):**
  - Unified `payment_intents` ledger with explicit states: `pending` -> `authorized` -> `captured` -> `refunded` / `voided`.
  - Dining bill splitting (equal split or custom amounts), discount, and VAT calculation.
  - bKash / Nagad gateway callbacks with HMAC-SHA256 verification, behind the `AMAR_GATEWAY_CALLBACKS_ENABLED` flag (callbacks return 503 when off); live gateway verification with real credentials is still an owner/staging step, not a sandbox proof.
  - Audited order voiding with required cancellation reason.

- **Hardware & Receipts (`/components/Invoice.tsx`):**
  - Dual roll format: 58mm (32 cols) and 80mm (42 cols).
  - ESC/POS raw text export with standard line cuts (`\x1D\x56\x00`).
  - High-resolution PDF rendering via html2canvas and jsPDF.

- **Cashier Shifts & Z-Report (`/components/ShiftModal.tsx`):**
  - Shift opening with float cash.
  - Live system calculation of cash sales during active shift.
  - Shift closure with actual cash counted and over/short discrepancy report.
  - Printable Z-Report for daily accounting.

---

## 2. End-to-End Data Flows

### A. Point-of-Sale (POS) In-Store Sale

1. **Cart Selection:** Cashier searches by name, barcode, or category. Quantities and line items are validated against available stock.
2. **Financial Computation:** Integer-paisa math recalculates subtotal, discount, VAT, total, and cash change.
3. **Execution:**
   - _Online Mode:_ POST `/api/sales` with client UUID. Express validates with Zod, checks stock in transaction, inserts into `sales`, updates product inventory, logs to `inventory_logs`, records payment intent, and broadcasts `SALE_COMPLETED` via AmarLive.
   - _Offline Mode:_ Sale is placed into AmarSync outbox. Stock is decremented in local cache. Upon reconnect, AmarSync flushes the outbox with idempotent retry.
4. **Invoice Generation:** Modal displays receipt with 58mm/80mm format options, direct print, and ESC/POS download.

### B. Customer Marketplace Order

1. **Browse & Search:** Customer browses participating stores at `/marketplace`.
2. **Checkout:** Customer submits cart with delivery address, phone, and idempotency key.
3. **Server Processing:** POST `/api/marketplace/orders` verifies current store prices, locks stock, creates `online_orders` record in `placed` state, and pushes `NEW_ORDER` to store owner's live room.
4. **Fulfillment:** Store owner confirms, packs, marks `out_for_delivery`, and completes delivery. If cancelled, stock is automatically restocked in a transactional rollback.

### C. Restaurant Dining QR Order & Settlement

1. **Dine-In Seating:** Customer scans table QR code (`/guest_menu?tableId=...&storeId=...`).
2. **Order Placement:** Guest places food order. Server inserts into `guest_orders` with status `pending`.
3. **Kitchen Display System (KDS):** Kitchen receives order in real-time (`store:{id}:kds`). Chef advances state: `accepted` -> `preparing` -> `ready` -> `served`.
4. **Dining Settlement (AmarPay):** Cashier opens `RestaurantSettlementModal`. Staff selects payment method (Cash with change calculator, bKash, Nagad, Card, or Split Bill), applies dining discount/VAT, and finalizes. Order transitions to `settled`, and a corresponding `sales` record and `payment_intents` entry are permanently committed.
