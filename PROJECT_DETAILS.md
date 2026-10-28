# Amar Dokan POS — Architecture & Technical Dossier

## 1. Overview
**Amar Dokan POS** ("My Shop POS") is a production-grade, full-stack Point of Sale, inventory management, restaurant dining, and multi-store marketplace platform built for Bangladeshi small and medium enterprises. It is bilingual (Bangla / English), PWA-installable, and features offline-first transaction resilience (**AmarSync Protocol**), real-time WebSocket state distribution (**AmarLive Protocol**), and an integer-paisa payment ledger (**AmarPay Protocol**).

---

## 2. Production Technology Stack

| Layer | Component | Notes |
|---|---|---|
| **Frontend Framework** | React 18 + TypeScript + Vite 5 | Modular SPA with code-splitting via `React.lazy` |
| **Styling** | Tailwind CSS 3.4 + PostCSS + Autoprefixer | Bundled at build time; zero CDN runtime dependencies |
| **Backend API** | Node.js (20/22 LTS) + Express 5 | RESTful JSON API with Zod validation on every route |
| **Database & ORM** | PostgreSQL 16 + Drizzle ORM | Normalized schema, foreign keys, integer paisa financial fields |
| **Persistence Fallback** | Ephemeral Dual Memory Storage | Instant zero-config fallback if PostgreSQL network is unreachable |
| **Realtime Sync** | WebSockets (`ws` library) on `/ws` | Multiplexed room broadcasts: `store:{id}:orders`, `:kds`, `:stock` |
| **Offline Protocol** | AmarSync Protocol | Client-side outbox with UUID idempotency, stock pre-deduction, auto-reconciliation |
| **Ledger System** | AmarPay Protocol | `payment_intents` state machine (`pending` → `authorized` → `captured` → `refunded`/`voided`) |
| **Thermal Printing** | ESC/POS 58mm & 80mm | Direct raw command printing & PDF receipt exports (jsPDF + html2canvas) |
| **Session Security** | `express-session` + `connect-pg-simple` | Salted scrypt PIN verification, cookie-based session tokens |

---

## 3. Data Model (15 Tables)

1. `users` — Store owners & platform admins (salt, scrypt PIN hash, store category, plan, currency, VAT rate).
2. `staff` — Employee PIN logins with granular RBAC permissions.
3. `customers` — Marketplace shoppers & POS customers (name, phone, address).
4. `products` — Inventory catalog with store scoping, integer paisa prices, barcodes, and category variants (expiry, batch, color, size, warranty).
5. `sales` — Audited transaction records with integer paisa totals, payment method, discount, VAT, and customer linking.
6. `expenses` — Store overhead costs with categorization and date stamps.
7. `inventory_logs` — Immutable audit trail of every stock increase, decrease, or adjustment.
8. `restaurant_tables` — Dine-in table identifiers, QR code tokens, and active seating statuses.
9. `guest_orders` — QR menu orders with item snapshots, order status, table assignment, and settlement linking.
10. `online_orders` — Multi-store marketplace delivery orders with status progression.
11. `payment_intents` — Financial ledger recording all payment attempts, transitions, split bills, and gateway transaction IDs.
12. `shifts` — Cashier shift records with opening float, live drawer calculations, close counts, and discrepancy analysis.
13. `subscription_requests` — Store owner premium tier upgrade submissions.
14. `settings` — Store-specific and platform-wide key-value configurations.
15. `announcements` — Broadcast notifications for store staff and marketplace shoppers.
