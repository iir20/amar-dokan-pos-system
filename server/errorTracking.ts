// Phase 2 — error-tracking integration point.
//
// HONEST STATUS: this is an integration point, NOT a working integration.
// No error-tracking credentials exist in this environment, so nothing is
// reported anywhere today. When AMAR_ERROR_TRACKING_ENABLED=true and
// AMAR_ERROR_TRACKING_DSN is set to an HTTP(S) ingestion endpoint, captured
// errors are POSTed there (fire-and-forget, 3 s timeout, failures swallowed
// and logged — tracking must never break a sale). The DSN itself is never
// logged and never returned by any API; /api/admin/system-status reports
// only { enabled, configured } booleans. See docs/monitoring.md for the
// credentials checklist an owner must complete before this counts as
// "configured". No vendor SDK is bundled: the DSN contract is a plain
// JSON POST { message, stack?, context?, at }, which fits Sentry's
// envelope-free ingest proxies, GlitchTip, and simple webhook collectors;
// a vendor-specific SDK is a Phase 4 decision once a vendor is chosen.

import { logWarn, redact } from './logger';

export function errorTrackingStatus(): { enabled: boolean; configured: boolean } {
  const configured = Boolean(process.env.AMAR_ERROR_TRACKING_DSN);
  const enabled = process.env.AMAR_ERROR_TRACKING_ENABLED === 'true' && configured;
  return { enabled, configured };
}

/** Report an error to the configured endpoint, if any. Never throws. */
export async function reportError(err: unknown, context: Record<string, unknown> = {}): Promise<void> {
  const { enabled } = errorTrackingStatus();
  if (!enabled) return;
  const dsn = process.env.AMAR_ERROR_TRACKING_DSN!;
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(dsn, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          stack,
          context: redact(context),
          at: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    // Tracking failures are operational noise, never a request failure.
    logWarn('error-tracking-report-failed', { error: e?.message || String(e) });
  }
}
