# Support path + rollback plan — Phase 4

## How a shop owner gets help

1. **In-app first:** check `docs/onboarding.md` step for the feature
   you are stuck on, and the 5-minute setup test
   (`docs/setup-test-5min.md`) if the basics feel wrong.
2. **Message support** (the channel the platform publishes — phone /
   WhatsApp / email on the shop's support page) with ALL of the
   following, or the reply will just ask for them:
   - Shop name + username (never your PIN — support never asks for it).
   - Date + time of the problem (with AM/PM).
   - What you tapped, step by step, and what you expected.
   - The exact error text on screen (photo/screenshot if possible).
   - Sale ID, order ID, or product name if the problem is about one.
   - Whether you were online or offline when it happened.
3. **Money problems first:** a wrong bill, a missing sale, or a stock
   number that does not match is treated as urgent. Do not re-enter
   the same sale to "fix" it — that creates a duplicate. Note the sale
   ID and wait for support to check the ledger.
4. **What support will NOT do:** ask for your PIN, your gateway
   credentials, or your database password. Anyone asking for those is
   not support.

## Rollback plan (bad release)

Order matters. Do these in sequence, and stop at the first step that
fails — do not skip ahead.

1. **Freeze:** put up the maintenance notice / stop new logins if the
   release breaks selling. Note the current release (zip name + deploy
   time) and the previous release zip (every milestone zip is kept in
   the milestones directory — the previous one is the rollback target).
2. **Snapshot first (if the release migrated the schema):** take a
   fresh `pg_dump` of the CURRENT database before touching it
   (`scripts/backup-pg.sh` with a dated backup dir). If the release
   did not migrate the schema, skip to step 3 — restoring data you do
   not need to restore loses the sales made since the release.
3. **Restore data ONLY if the schema changed:** restore the
   pre-release database snapshot into the production database with
   `scripts/restore-pg.sh` (read its safety warnings — it refuses a
   non-empty target without `--force`). Verify the three numbers
   (sales count/total, stock total, dues total) against the
   pre-release record.
4. **Deploy the previous release:** deploy the previous milestone zip
   (same Termux push / Render deploy path as the release). Do not mix
   old code with a new schema, or new code with an old schema.
5. **Verify (all must pass):**
   - `/api/health` returns `status: ok` and the expected database mode.
   - An owner can log in; one test sale records and stock drops by
     exactly the sold quantity; one dues entry reads correctly.
   - The outbox depth is 0 or draining (if PostgreSQL is connected).
6. **Reopen:** remove the maintenance notice and tell affected shops
   what happened, what was restored, and which sales (if any) need
   re-entry. Never silently re-enter a shop's sales for them.
7. **After-action:** record the release, the failure, the snapshot
   used, and the verification numbers in the milestone report for the
   next release. A rollback without a record will be repeated.
