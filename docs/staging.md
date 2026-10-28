# Staging, PR Previews & Database Upgrades (Phase 2)

## Environments

| Environment | Render service               | Database                    | Deploys from     |
| ----------- | ---------------------------- | --------------------------- | ---------------- |
| Production  | `amar-dokan-pos`             | `amar-dokan-pos-db`         | `main` branch    |
| Staging     | `amar-dokan-pos-staging`     | `amar-dokan-pos-staging-db` | `staging` branch |
| PR preview  | Ephemeral, created by Render | Ephemeral                   | The pull request |

Both services are defined in `render.yaml`. Staging is a separate service
with a separate database on purpose: staging experiments (killing the
database, replaying the outbox) must never touch production data.

## PR previews

Render preview environments are enabled in the Render dashboard
(Blueprint → Preview Environments → Enable) — there is no YAML flag for
this that can be verified from the repo, so the owner must flip that
toggle once. After that, every pull request gets a preview service +
ephemeral database automatically, and Render posts the preview URL on the
PR. No preview URL is claimed anywhere in this repo until Render creates
one.

Every PR is also gated by `.github/workflows/preview.yml` (type-check,
lint, unit tests, production build, API-docs freshness). A PR that fails
that gate must not be merged even if its preview looks fine.

## Staging drill — PROVEN IN PHASE 4 (sandbox PostgreSQL 16; re-run on staging as smoke)

Live PostgreSQL outbox replay was proven in Phase 4 against a real
PostgreSQL 16 database (sandbox, not staging): auto-replay on reconnect
(5/5 entries, outbox 5 → 0, log line `Outbox replay on reconnect`) and
manual admin replay (5/5) were both exercised, and the replayed sale,
product, and stock values were confirmed in PostgreSQL with `psql`.
The drill below is still worth re-running once on staging as a smoke
test (it costs minutes and proves the deployed wiring, not just the
code), but it is no longer an unverified leftover. Two Phase 4
findings to carry into the staging run:

- Sessions survive a database outage: the PG session store now falls
  back to memory when PostgreSQL is unreachable (see
  `server/sessionConfig.ts`), so logged-in users can keep selling
  during the outage. Sessions created during an outage live only in
  that process's memory.
- Auto-replay triggers when a 30s re-probe tick observes the outage.
  An outage shorter than the tick interval may leave the outbox queued
  until the next transition or a manual admin replay — the data is
  never lost, but the drain is not instant. If step 4 below does not
  drain within ~60 seconds, use `POST /api/admin/sync/replay` as a
  platform admin instead of waiting.

1. Deploy the staging service with a real `DATABASE_URL` (staging DB).
   Confirm `GET /api/health` reports `fallbackMode: "postgresql"` and a
   successful `databasePingMs`.
2. Stop (or network-isolate) the staging database only — leave the app
   running. Confirm health now reports
   `fallbackMode: "disk-persisted-fallback"` and the app still serves
   traffic.
3. While the database is down, create real data through the app: a
   product, a sale, a marketplace order. Confirm the server outbox grows
   (`GET /api/sync/status` → `outboxDepth` increases; the admin
   System Status tab shows the same number).
4. Restore the database. Within ~30 seconds (the re-probe interval) the
   app must replay the outbox: `outboxDepth` returns to 0.
5. Query PostgreSQL directly (e.g. `psql`) and confirm the sale, product
   and order created in step 3 are present with the same ids and totals.
6. Only then record the result (date, staging URL, outbox depth before /
   after, row counts) in the Phase 2 report's successor. If any step
   fails, the outbox stays queued by design — inspect
   `AMAR_DATA_DIR/outbox.json`, fix the cause, and re-run
   `POST /api/admin/sync/replay` as a platform admin; never hand-edit
   `outbox.json` to "fix" a count.

Also re-check over staging HTTPS (not plain HTTP): production
secure-cookie login cannot be exercised over plain-HTTP curl.

## Free → paid PostgreSQL upgrade path (Render)

Render's free PostgreSQL databases expire (currently after 30 days on the
free plan — check the Render dashboard for the exact expiry of
`amar-dokan-pos-db`). The paid upgrade keeps the same connection string
pattern but a new database; plan it before expiry, not on expiry day.

### Migration checklist (in order)

1. **Freeze writes briefly.** Announce a maintenance window; shopkeepers
   can keep selling offline (AmarSync queues locally), but avoid
   relying on that — prefer a quiet window.
2. **Export a backup.** As a platform admin, download
   `GET /api/admin/backups/export` and store it encrypted and
   off-device. Note: the export strips PIN verifiers by design
   (see `docs/backup-handling.md`).
3. **Snapshot the old database.** In Render, take a backup/snapshot of
   the free database if the plan offers one; otherwise `pg_dump` it
   from a machine that can reach it.
4. **Create the paid database** in the same region (Singapore) and note
   its connection string.
5. **Restore into the paid database:** `pg_restore` / `psql < dump`,
   then run `npm run db:push` only if the schema drift check asks for
   it — review any proposed table drop/rename and cancel it if it
   would destroy data (same rule as CONTRIBUTING.md).
6. **Point the service at the new database.** In Render, change the
   service's `DATABASE_URL` to the paid database (or re-bind the
   Blueprint database reference) and redeploy.
7. **Verify before reopening.** `GET /api/health` →
   `fallbackMode: "postgresql"`; log in; check the newest sale, product
   count and an old order are all present; check the admin System
   Status tab (database connected, sync queue 0).
8. **Keep the old database for 7 days** before deleting it, as rollback
   material.

### Rollback

If step 7 fails: point `DATABASE_URL` back at the old (free) database,
redeploy, and re-verify. The app's disk-persisted fallback + outbox
means sales taken during the incident are not lost: if the app ran in
fallback mode during the window, replay the outbox after the database is
back (`POST /api/admin/sync/replay`) and confirm `outboxDepth` is 0
before declaring the incident over.

## Persistent disk (fallback durability)

The disk-persisted fallback store lives in `AMAR_DATA_DIR`
(default: `<cwd>/data`). On Render's free plan there is no persistent
disk, so fallback data survives restarts but **not** redeploys. Before
relying on the fallback in production, attach a Render persistent disk
(paid) and set `AMAR_DATA_DIR` to its mount path. Until then, treat the
fallback as a restart-survival net, not a backup — the backup export in
step 2 above is the real backup.
