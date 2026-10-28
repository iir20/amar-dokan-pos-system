-- Backward-compatible additions for server-calculated sales and stock audit.
-- Existing sales remain untouched: NULL cash/change fields identify legacy rows.
BEGIN;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS cash_received real,
  ADD COLUMN IF NOT EXISTS change_amount real;

ALTER TABLE inventory_logs
  ADD COLUMN IF NOT EXISTS actor_id text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locked_until timestamp;

CREATE INDEX IF NOT EXISTS products_store_id_idx
  ON products (store_id);
CREATE INDEX IF NOT EXISTS sales_store_date_idx
  ON sales (store_id, date);
CREATE INDEX IF NOT EXISTS expenses_store_date_idx
  ON expenses (store_id, date);
CREATE INDEX IF NOT EXISTS inventory_logs_store_date_idx
  ON inventory_logs (store_id, date);
CREATE INDEX IF NOT EXISTS inventory_logs_store_product_idx
  ON inventory_logs (store_id, product_id);
CREATE INDEX IF NOT EXISTS guest_orders_store_status_idx
  ON guest_orders (store_id, status, created_at);

COMMIT;
