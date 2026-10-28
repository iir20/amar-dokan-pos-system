# Backup runbook — Phase 4 (PostgreSQL is the backup strategy)

## What changed in Phase 4

- **Primary backup: nightly `pg_dump`** (`scripts/backup-pg.sh`, custom
  format, integrity-checked with `pg_restore --list`, manifest with
  SHA-256, retention pruning).
- **The JSON export is demoted.** `GET /api/admin/backups/export`
  (platform-admin only) stays as a secondary, human-readable export, but
  it is **not** a backup: it omits credential verifiers by design, it is
  not a transaction-consistent snapshot, and it cannot be restored into
  PostgreSQL. Never present it as the backup strategy again. Its handling
  rules (who may download it, no PIN verifiers inside) are unchanged —
  see `docs/backup-handling.md`.

## Nightly schedule

Run `scripts/backup-pg.sh` once a night with the production
`DATABASE_URL` in the environment:

```cron
# 02:30 Asia/Dhaka, every night (server time must match — check `date`)
30 2 * * * DATABASE_URL="$PROD_DATABASE_URL" AMAR_BACKUP_DIR=/var/backups/amar-dokan /opt/amar-dokan/scripts/backup-pg.sh >> /var/log/amar-dokan-backup.log 2>&1
```

Defaults: `AMAR_BACKUP_DIR=/var/backups/amar-dokan`,
`AMAR_BACKUP_RETENTION_DAYS=7`. A non-zero exit means the backup
FAILED — the cron job must alert (email / monitoring), never silently
pass. Check `manifest.txt` in the backup dir after the first run.

### Render note (production runs on Render)

A Render Cron Job's filesystem is ephemeral: a dump written to a cron
job's disk **disappears when the job ends**. On Render, either attach
a persistent disk to the backup job or add an upload step after the
dump (object storage, e.g. `aws s3 cp "$FILE" s3://bucket/` — the
bucket, credentials, and upload command are a deployment-time decision,
not shipped here). Until one of those is wired, the nightly script as
shipped is proven only on a host with persistent disk (staging below).
Do not claim "nightly backups run on Render" until the disk/upload step
is verified there.

## Restore drill (staging — required before launch)

The live restore drill is **UNVERIFIED** in the Phase 4 sandbox (no
PostgreSQL server exists there — see the Phase 4 report). Run it
exactly like this on staging:

```bash
# 1. On the SOURCE database, record the numbers to match:
psql "$SOURCE_DATABASE_URL" -c "SELECT count(*) AS sales_count, coalesce(sum(total_amount),0) AS sales_total FROM sales;"
psql "$SOURCE_DATABASE_URL" -c "SELECT coalesce(sum(stock),0) AS products_stock_total FROM products;"
psql "$SOURCE_DATABASE_URL" -c "SELECT coalesce(sum(total_due),0) AS suppliers_due_total FROM suppliers;"

# 2. Take a backup:
DATABASE_URL="$SOURCE_DATABASE_URL" AMAR_BACKUP_DIR=/tmp/amar-backup-drill scripts/backup-pg.sh
#    -> note the .dump path it prints

# 3. Create a DISPOSABLE database (never the production one):
createdb amar_restore_drill   # or the Render dashboard equivalent

# 4. Restore + verify (the script refuses a non-empty target without --force):
scripts/restore-pg.sh /tmp/amar-backup-drill/amar-dokan-<stamp>.dump "postgres://user:pass@host:5432/amar_restore_drill"

# 5. Compare the verification numbers with step 1. Equal = drill passed.
#    Then boot the app against the disposable database:
DATABASE_URL="postgres://user:pass@host:5432/amar_restore_drill" AMAR_DATA_DIR=/tmp/amar-drill-data PORT=3455 npm start
#    -> log in, confirm one sale and one stock count match the source.

# 6. Drop the disposable database when done:
dropdb amar_restore_drill
```

Pass criteria: restore exit 0, all three verification numbers equal to
the source, app boots against the restored database, one sale and one
stock count spot-checked. Anything else = drill FAILED; fix the backup
before launch.

## Rollback note

A backup restores **data**, not code. For a bad release, restore the
previous release zip AND (only if the release migrated the schema) the
matching database snapshot, in the order in
`docs/support-and-rollback.md`. Never restore a database snapshot over
a newer schema without checking the migration first.
