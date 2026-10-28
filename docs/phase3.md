# Phase 3 (Depth) — what was built, and what is honestly not yet proven

## What Phase 3 adds

1. **Demand forecasting + draft purchase orders** — `GET /insights/forecast`
   (defaults: last 30 days, 7 lead-time days). The UI always prints the
   window and the rule: `suggested = ceil(average daily sales over the
last N days × lead-time days − current stock), minimum 0`, plus a
   per-product basis line. Suggestions become **draft** purchase orders
   (`POST /purchase-orders`) that the owner reviews; creating a draft
   orders nothing.
2. **Medicine expiry alerts** — `GET /insights/expiry`: 30 / 14 / 7-day
   thresholds, severity watch → warning → critical → expired, sorted by
   nearness. Products without expiry dates produce no alerts.
3. **Dead stock** — `GET /insights/dead-stock?windowDays=90`: stock with
   no sale in the window (or never sold) plus a discount/clearance note.
4. **Suppliers + purchasing** — supplier CRUD, purchase orders
   (draft → partial → received, draft-only cancel). Goods-received
   (`POST /purchase-orders/:id/receive`) updates stock, writes
   inventory-log entries (`Purchase Order #… received`), and raises the
   supplier due by the received value. Paying a supplier
   (`POST /suppliers/:id/pay`) reduces the due and records a
   `supplier_payment` expense. Supplier dues total is shown on the Due
   List and in the Depth panel. Receipt itself is a payable, not an
   expense — the payment is the expense (accrual-correct).
5. **Multi-branch + multi-counter + shifts** — branches
   (`POST /branches`, first branch becomes default), counters inside a
   branch, branch-scoped product/sale reads
   (`/branches/:id/products`, `/branches/:id/sales`). A product with no
   branchId (created before branches existed) is visible only in the
   default branch's product read, so it never leaks into a new branch.
   Shifts accept `branchId`/`counterId`; one open shift per cashier per
   counter. Closing a counter shift counts **only that counter's**
   sales, and store expenses are excluded from counter Z-reports
   (expenses carry no counter, so attributing them would corrupt the
   report). `GET /shifts/z-report` groups closed shifts per counter:
   expected cash, actual cash, discrepancy.
6. **Loyalty + coupons** — 1 point per full ৳100 of the final bill;
   1 point = ৳1 when redeemed. Coupons are created by the owner
   (owner-only route) and **validated server-side at sale time**:
   inactive, expired, over-limit, or below-minimum coupons are rejected
   with `COUPON_*` errors even if the client claimed a discount. The
   server recalculates every sale total; client totals are never
   trusted. Requesting more points than the balance is rejected
   (`LOYALTY_INSUFFICIENT`); redemption is additionally capped by the
   remaining bill, so a discount can never exceed the bill.
7. **Full Bangla Voice POS** — `components/VoicePos.tsx` +
   `services/voice.ts` (Web Speech API, same APIs inside the Capacitor
   shell). Speak item names/prices, hear totals and change, voice input
   for add/total/checkout/clear. **Every voice action has a text
   fallback**: the spoken text is shown on screen, and the same actions
   exist as tappable buttons plus a plain text command input
   (`২ টা চাল যোগ কর`, `মোট কত`). Voice never gates a sale.
8. **Accountant exports** — VAT, profit-by-category, and staff
   performance as **CSV** (`/reports/*.csv`, combined
   `/reports/excel.csv`). The format is labelled CSV honestly: it opens
   in Excel but is not a native `.xlsx` file. Full data export
   (`/reports/full-export`, PIN-free) and validated import
   (`POST /reports/import`, owner only): reference data (products,
   suppliers, coupons, branches, counters) may be created; **sales and
   expenses are counted as skipped and never imported**, so an import
   can never silently overwrite a bill or an expense. The response
   reports counts, imported, skips, and errors. Imported
   suppliers/coupons/branches/counters get new ids (source ids are not
   reused across stores); imported products keep their id when new.

## Money rules (unchanged, enforced)

- Integer-paisa math via `shared/finance.ts`; server recalculates every
  sale; Zod validation on every new route; staff manual-discount caps
  still apply (coupon/loyalty are server-validated promotions on top,
  and the total discount can never exceed the subtotal).

## PostgreSQL status — WIRED IN PHASE 4 (was fail-closed in Phase 3)

Phase 4 wired the Phase 3 entities into the PostgreSQL branch of
`server/storage.ts` (branches, counters, suppliers, purchase orders,
coupons, loyalty, forecast, expiry, dead stock, Z-reports by counter,
plus shifts and coupon/loyalty/branch/counter handling inside the
transactional PG sale). The `PHASE3_PG_PENDING` guard is GONE: Phase 3
routes work on PostgreSQL, and sales carrying coupon/loyalty/
branch/counter fields are honoured by both the PG and fallback sale
transactions. Proof: the Phase 4 PG smoke run (34/34) and the full E2E
suite re-run against a PostgreSQL-backed server (see
`../amar-dokan-upgrade-milestones/phase-4-report.md`).

**Deploy order on PostgreSQL — migrations BEFORE this build:**

1. `npm run db:push` (or `drizzle-kit push`) for the base schema.
2. `migrations/0001_financial_stock_fields.sql`.
3. `migrations/0002_phase3_depth.sql`.
4. `migrations/0003_loyalty_store_phone_pk.sql` — changes the
   `loyalty_accounts` primary key from phone-only to
   `(store_id, phone)`; if a database already holds loyalty rows for
   the same phone under two stores, resolve duplicates first (the
   constraint will fail rather than silently merge them).

**Boot-time safety net (Phase 4):** on boot with PostgreSQL connected,
the server checks `information_schema` for the six Phase 3 tables
(`branches`, `counters`, `suppliers`, `purchase_orders`, `coupons`,
`loyalty_accounts`) and logs a loud WARNING listing any missing table
and telling the operator to apply migrations 0002 + 0003. It does not
block boot. WARNING — the flip side: because `op()` now rethrows
validation errors instead of masking them, a PG deployment WITHOUT
migrations 0002/0003 serves Phase 3 data from the fallback store
per-operation on missing-table errors (the old fail-closed guard is
gone). Apply the migrations; do not rely on the warning as the
control.

**Staging checklist — Phase 4 status:**

1. ~~Apply `migrations/0002_phase3_depth.sql`~~ — done (plus 0003).
2. ~~Wire the Phase 3 entities into the PostgreSQL branch~~ — done.
3. ~~Re-run the Phase 3 E2E spec against PostgreSQL~~ — done (full
   suite, see the Phase 4 report).
4. ~~Re-check the live PostgreSQL outbox replay~~ — done: proven live
   in Phase 4 (auto-replay on reconnect + manual admin replay; the
   auto trigger fires when a 30s re-probe tick observes the outage —
   see the Phase 4 report for the sub-tick caveat).

## UNVERIFIED — Bangla voice on a real phone (owner checklist)

Voice accuracy on a low-end Android phone **cannot be verified in this
sandbox** (no phone, no microphone, headless browser). What is verified:
command parsing, Bangla digit formatting, and speak-text construction
(unit tests), plus the fallback UI (text input + buttons) in the browser
automation. Before relying on voice in the shop, the owner should run:

| Device                                 | Phrase to speak     | Expected                                                           | Actual |
| -------------------------------------- | ------------------- | ------------------------------------------------------------------ | ------ |
| Android phone model + Android version  | `২ টা চাল যোগ কর`   | Rice ×2 added to cart                                              |        |
| Same device                            | `মোট কত`            | Total spoken + shown in text                                       |        |
| Same device                            | `চেকআউট করো`        | Checkout runs (or asks for missing info)                           |        |
| Same device, noisy shop                | `৫ কেজি ডাল যোগ কর` | Correct product + qty, or a clear "not understood" + text fallback |        |
| Same device, voice off / no permission | (no voice)          | Full POS usable via buttons + text input                           |        |

If recognition is poor on the device, the POS still works fully with
voice off — that fallback is the requirement, not a workaround.

## Also still unverified (carried from Phases 1–2, unchanged)

Signed APK, Bluetooth printing on device, live staging URLs,
production HTTPS login, error-tracking-as-working. (Live PostgreSQL
outbox replay was verified in Phase 4 — see the Phase 4 report — and
is removed from this list.)
