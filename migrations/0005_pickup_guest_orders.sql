-- Store-QR pickup orders (see shared/schema.ts guestOrders.tableId).
--
-- A guest who orders from a store's public storefront (/s/<code>) has
-- no restaurant table, so guest_orders.table_id must accept NULL for
-- pickup orders. This is the SAME guest-order pipeline (same table,
-- lifecycle, KDS queue and settlement) — only the fulfilment mode
-- differs. Table orders keep a non-null table_id; nothing else about
-- the table changes. Idempotent: DROP NOT NULL on an already-nullable
-- column is a no-op in PostgreSQL.
ALTER TABLE "guest_orders" ALTER COLUMN "table_id" DROP NOT NULL;
