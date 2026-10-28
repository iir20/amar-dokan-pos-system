-- Phase 3 (Depth): branches, counters, suppliers, purchase orders,
-- coupons, loyalty accounts, plus branch/counter/promo columns on
-- products, sales and shifts. Run with `npm run db:push` or apply in
-- staging before wiring these tables into the PostgreSQL storage branch
-- (the live Phase 3 server path is the durable fallback store, same
-- precedent as shifts; see server/storage.ts).
CREATE TABLE IF NOT EXISTS "branches" (
  "id" text PRIMARY KEY NOT NULL,
  "store_id" text NOT NULL,
  "name" text NOT NULL,
  "address" text,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "branches_store_idx" ON "branches" ("store_id");
CREATE TABLE IF NOT EXISTS "counters" (
  "id" text PRIMARY KEY NOT NULL,
  "store_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "counters_branch_idx" ON "counters" ("branch_id");
CREATE TABLE IF NOT EXISTS "suppliers" (
  "id" text PRIMARY KEY NOT NULL,
  "store_id" text NOT NULL,
  "name" text NOT NULL,
  "phone" text,
  "address" text,
  "notes" text,
  "total_due" real DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "suppliers_store_idx" ON "suppliers" ("store_id");
CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "store_id" text NOT NULL,
  "supplier_id" text NOT NULL,
  "branch_id" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "items" jsonb NOT NULL,
  "total_cost" real DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "received_at" timestamp
);
CREATE TABLE IF NOT EXISTS "coupons" (
  "id" text PRIMARY KEY NOT NULL,
  "store_id" text NOT NULL,
  "code" text NOT NULL,
  "type" text NOT NULL,
  "value" real NOT NULL,
  "min_purchase" real DEFAULT 0 NOT NULL,
  "max_uses" integer DEFAULT 0 NOT NULL,
  "used_count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "coupons_store_code_idx" ON "coupons" ("store_id", "code");
CREATE TABLE IF NOT EXISTS "loyalty_accounts" (
  "phone" text PRIMARY KEY NOT NULL,
  "store_id" text NOT NULL,
  "name" text,
  "points" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "loyalty_store_idx" ON "loyalty_accounts" ("store_id");
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "branch_id" text;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "branch_id" text;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "counter_id" text;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "coupon_code" text;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "loyalty_redeemed" integer DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "loyalty_earned" integer DEFAULT 0;
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "branch_id" text;
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "counter_id" text;
