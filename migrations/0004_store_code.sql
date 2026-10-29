-- Per-store Smart QR handle (see shared/schema.ts users.storeCode).
--
-- The public storefront URL is /s/<store_code>. The code must be
-- random, not a sequential id, so one store's code cannot be used to
-- enumerate other stores. Backfill uses a per-row random hash (not a
-- hash of the id, which would be derivable from ids already exposed
-- by table-QR URLs); 16 hex chars = 64 bits of entropy.
-- Idempotent: safe to re-run on old, new, and already-migrated DBs.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "store_code" text;

UPDATE "users"
SET "store_code" = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 16)
WHERE "store_code" IS NULL OR "store_code" = '';

CREATE UNIQUE INDEX IF NOT EXISTS "users_store_code_idx" ON "users" ("store_code") WHERE "store_code" IS NOT NULL;
