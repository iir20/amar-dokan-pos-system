-- Phase 4: loyalty accounts must be per-store, not per-phone globally.
-- The original definition (migrations/0002 + shared/schema.ts) made
-- `phone` the sole primary key, so two stores could not hold loyalty
-- balances for the same customer phone — the second store's insert
-- would fail (or, worse, be attributed to the first store). Fresh
-- databases get the composite key from `drizzle-kit push` directly
-- (see shared/schema.ts); existing databases apply this migration.
--
-- Idempotency note: drizzle-kit names a fresh composite PK
-- `loyalty_accounts_store_id_phone_pk`, while the old phone-only PK
-- was `loyalty_accounts_pkey`. This migration drops the old name if
-- present and adds the composite key only if no primary key exists,
-- so it is safe to run on old, new, and already-migrated databases.
--
-- CAUTION: if a database already holds loyalty rows for the same phone
-- under two different stores, ADD PRIMARY KEY will fail. Resolve those
-- duplicates first (merge points into one row per phone per store is
-- impossible by definition — pick the owning store, or drop the
-- conflicting row after exporting it); do not force the constraint.
ALTER TABLE "loyalty_accounts" DROP CONSTRAINT IF EXISTS "loyalty_accounts_pkey";
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'loyalty_accounts'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE "loyalty_accounts" ADD PRIMARY KEY ("store_id", "phone");
  END IF;
END $$;
