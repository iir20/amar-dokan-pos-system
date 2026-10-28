# Backup export — secure handling

> Phase 4 status change: the JSON export described below is a
> SECONDARY export only. The backup strategy is nightly `pg_dump` —
> see `docs/backup-runbook.md` (`scripts/backup-pg.sh` +
> `scripts/restore-pg.sh`). Do not present this export as the backup
> strategy: it omits credential verifiers by design, it is not a
> transaction-consistent snapshot, and it cannot be restored into
> PostgreSQL.

## What is (and is not) in an export

`GET /api/admin/backups/export` (platform-admin only) returns business data —
users, products, sales, expenses, inventory logs, orders, payment intents,
shifts, announcements — **with all credential material stripped**:

- `users[].pin`, `staff[].pin`, `customers[].pin` are removed (scrypt PIN
  verifiers are never exported, even though they are hashes — a backup file
  must never become a credential database).
- The export carries `redactedFields` and a `securityNotice` naming exactly
  what was stripped, so a consumer can verify the redaction instead of
  assuming it.

A stripped export therefore **cannot be used to restore logins**. Restoring
users requires re-issuing PINs through the normal registration / admin-unlock
flow (which hashes a fresh PIN with scrypt). Do not "restore" a backup by
re-inserting old `pin` values from any other copy.

## How to store and transfer exports

- Treat an export as sensitive business data: it contains customer names,
  phone numbers, sales, and dues.
- Store exports encrypted at rest (encrypted volume, encrypted object
  storage, or an age/GPG-encrypted file) with access limited to the store
  owner / platform admin.
- Transfer only over an encrypted channel (HTTPS, or an encrypted file over
  any channel). Never email an unencrypted export, never post one in chat,
  and never commit one to git.
- Delete exports when they are no longer needed; keep at most the retention
  window the store owner has agreed.

## Fallback store files (same rules)

The Phase 1 durable fallback files under `AMAR_DATA_DIR` (default `./data/`):

- `fallback-store.json` — the fallback store of record. It **does** contain
  live PIN verifiers (the store needs them to authenticate), so it must live
  on access-controlled, persistent storage and must never be copied to a
  shared host, a public bucket, or git. The directory is gitignored.
- `outbox.json` — pending replay entries; same sensitivity as the snapshot
  (it mirrors the same records).

If either file is ever exposed, rotate every PIN it contained and treat the
exposure as a credential incident.
