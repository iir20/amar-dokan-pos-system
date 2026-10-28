#!/usr/bin/env bash
# Phase 4 — nightly PostgreSQL backup (pg_dump, custom format).
#
# This script REPLACES the JSON snapshot export as the backup strategy.
# The JSON export (GET /api/admin/backups/export) remains available as a
# secondary, human-readable export, but it is NOT a backup: it omits
# credentials by design, is not a consistent snapshot, and cannot be
# restored into PostgreSQL. See docs/backup-runbook.md.
#
# Required: DATABASE_URL (must point at the production/staging database).
# Optional: AMAR_BACKUP_DIR (default: /var/backups/amar-dokan),
#           AMAR_BACKUP_RETENTION_DAYS (default: 7),
#           AMAR_BACKUP_PREFIX (default: amar-dokan).
#
# Output: $AMAR_BACKUP_DIR/$PREFIX-YYYYMMDD-HHMMSS.dump plus a manifest
# line (timestamp, file, sha256, pg_restore --list exit code). The dump
# is verified immediately with `pg_restore --list` (integrity check that
# needs no database). Non-zero exit on any failure — a cron job must
# alert on it, never silently pass.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set — refusing to back up nothing." >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found (install postgresql-client)." >&2
  exit 1
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  echo "ERROR: pg_restore not found (install postgresql-client)." >&2
  exit 1
fi

BACKUP_DIR="${AMAR_BACKUP_DIR:-/var/backups/amar-dokan}"
RETENTION_DAYS="${AMAR_BACKUP_RETENTION_DAYS:-7}"
PREFIX="${AMAR_BACKUP_PREFIX:-amar-dokan}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/$PREFIX-$STAMP.dump"

echo "Backing up to $FILE ..."
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$FILE"

echo "Verifying dump integrity (pg_restore --list) ..."
pg_restore --list "$FILE" > /dev/null

SHA="$(sha256sum "$FILE" | awk '{print $1}')"
SIZE="$(stat -c%s "$FILE")"
echo "$STAMP $FILE $SIZE $SHA pg_restore_list_ok" >> "$BACKUP_DIR/manifest.txt"

echo "Pruning dumps older than $RETENTION_DAYS days ..."
find "$BACKUP_DIR" -maxdepth 1 -name "$PREFIX-*.dump" -type f -mtime "+$RETENTION_DAYS" -delete

echo "OK: $FILE ($SIZE bytes, sha256 $SHA)"
