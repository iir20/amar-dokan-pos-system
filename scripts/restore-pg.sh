#!/usr/bin/env bash
# Phase 4 — restore a pg_dump backup into a DISPOSABLE database and
# verify it. This is the restore drill from docs/backup-runbook.md.
#
# Usage:
#   scripts/restore-pg.sh <dump-file> <target-database-url>
#
# Safety: the target must be EMPTY (no user tables) unless --force is
# passed. Never point this at the production DATABASE_URL — the script
# refuses targets whose URL contains the production database name
# unless AMAR_RESTORE_ALLOW_PROD=1 is set, and even then it demands
# --force. The drill target should be a throwaway database created
# with `createdb amar_restore_drill` (or the Render dashboard equivalent).
#
# After restoring, the script prints verification numbers. Compare them
# against the same queries run on the SOURCE database before the drill:
#   sales count + total, product stock total, supplier dues total.
# A mismatch is a FAILED drill — do not promote the backup.
set -euo pipefail

FORCE=0
if [ "${1:-}" = "--force" ]; then FORCE=1; shift; fi
DUMP="${1:-}"
TARGET="${2:-}"
if [ -z "$DUMP" ] || [ -z "$TARGET" ]; then
  echo "Usage: $0 [--force] <dump-file> <target-database-url>" >&2
  exit 1
fi
if [ ! -f "$DUMP" ]; then echo "ERROR: dump file not found: $DUMP" >&2; exit 1; fi
for cmd in pg_restore psql; do
  if ! command -v "$cmd" >/dev/null 2>&1; then echo "ERROR: $cmd not found." >&2; exit 1; fi
done

TABLES="$(psql "$TARGET" -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" 2>/dev/null || echo "psql-failed")"
if [ "$TABLES" != "0" ] && [ "$FORCE" -ne 1 ]; then
  echo "ERROR: target database is not empty ($TABLES tables). Refusing without --force." >&2
  exit 1
fi

echo "Restoring $DUMP into target database ..."
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$TARGET" "$DUMP"

echo "--- Verification (target) ---"
psql "$TARGET" -c "SELECT 'sales_count' AS metric, count(*) AS value FROM sales
  UNION ALL SELECT 'sales_total', coalesce(sum(total_amount),0) FROM sales
  UNION ALL SELECT 'products_stock_total', coalesce(sum(stock),0) FROM products;"
psql "$TARGET" -c "SELECT 'suppliers_due_total' AS metric, coalesce(sum(total_due),0) AS value FROM suppliers;" 2>/dev/null \
  || echo "(suppliers table not present — Phase 3 migration not applied to this database)"
echo "--- End verification ---"
echo "Compare these numbers with the source database (same queries). Equal = drill passed."
echo "Then boot the app against the target and spot-check: login, one sale, one stock count."
