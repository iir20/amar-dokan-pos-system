# Monitoring (Phase 2)

## Structured logs

Server logs are one JSON object per line:
`{ ts, level, service: "amar-dokan", msg, ...meta }` (see
`server/logger.ts`). API request logs carry method, path, status and
duration only — never headers, cookies or bodies, because a body could
contain a PIN. Sensitive keys (`pin`, `password`, `secret`, `token`,
`cookie`, `authorization`, `api key`, `dsn`) are replaced with
`"[redacted]"` recursively before anything is printed.

On Render, these lines are the service logs. Useful filters:

- Slow / failing API calls: `msg:"api-request"` with `status >= 500`
  or large `ms`.
- Database trouble: `msg:"request-error"` plus the health endpoint's
  `databaseLastError` field.
- Outbox replay: `msg` containing `Outbox replay on reconnect`.

## Error tracking — integration point, NOT yet configured

`server/errorTracking.ts` posts captured errors to
`AMAR_ERROR_TRACKING_DSN` — but only when both of these are true:

- `AMAR_ERROR_TRACKING_ENABLED=true`
- `AMAR_ERROR_TRACKING_DSN` is set to an `https://` ingestion endpoint

**Current status: UNCONFIGURED.** No credentials exist in this repo or
in the build environment, so today nothing is reported anywhere and the
admin System Status tab honestly shows "Not configured". That is the
correct state until the owner completes this checklist:

1. Choose a vendor (Sentry, GlitchTip, or a self-hosted webhook
   collector — no vendor SDK is bundled yet; the DSN contract is a
   plain JSON POST `{ message, stack?, context?, at }`).
2. Create a project and copy its ingestion endpoint URL (the DSN).
3. Set `AMAR_ERROR_TRACKING_ENABLED=true` and
   `AMAR_ERROR_TRACKING_DSN=<the URL>` in the Render service's
   environment (never in the repo, never in `.env` committed files).
4. Redeploy, trigger a test error path, and confirm it arrives in the
   vendor dashboard.
5. Only then may anyone describe error tracking as "working". Until
   step 4 passes, report it as unconfigured.

The DSN is never logged and never returned by any API; the
system-status endpoint reports only `{ enabled, configured }` booleans.
Reporting failures are swallowed and logged — tracking must never break
a sale.

## Uptime monitoring

The health endpoint is `GET /api/health` (public, no session needed).
It pings PostgreSQL live (2 s timeout) and reports `fallbackMode` and
`outboxDepth`, so an uptime check on it detects both "app down" and
"app up but database down" (the latter shows as
`fallbackMode: "disk-persisted-fallback"`).

Recommended setup (any provider — UptimeRobot, Better Stack, or a cron
job running `scripts/uptime-check.sh`):

- Check `https://<your-service>/api/health` every 1–5 minutes.
- Alert when: HTTP status is not 200 for 2 consecutive checks, OR the
  body contains `"fallbackMode":"disk-persisted-fallback"` for more
  than 15 minutes (that means the database is down and the app is
  running on its fallback — survivable, but not normal).
- `scripts/uptime-check.sh <url>` exits non-zero on either condition
  and prints the health body, so it plugs into any cron/alerting tool.

## Admin system-status view

Platform admins: Admin Panel → **System Status** tab. It shows, from
`GET /api/admin/system-status` (live data, 30 s auto-refresh):

- Database state (configured / connected / live ping ms / last error)
- Fallback mode and whether a fallback snapshot exists on disk
- Server sync queue depth (outbox)
- Last backup-export time (or "Never")
- Error-tracking configured/enabled state
- Server uptime and version

If the tab shows an error instead of numbers, the endpoint is
unreachable — treat that as an outage signal, not a display bug.
