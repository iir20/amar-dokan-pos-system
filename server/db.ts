import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../shared/schema';

// Phase 1 fix (P0-1): this module previously exported `isDbConnected = false`
// and nothing ever set it to true, so PostgreSQL was never used even when
// DATABASE_URL was set. The flag is now driven by a real `SELECT 1` probe
// at boot, re-probed on a timer, and updated on pool errors and on every
// failed storage operation (see `markDbDisconnected`, called from
// server/storage.ts). Importers should prefer `getDbStatus()` over the raw
// binding, because the binding alone cannot convey the last error/probe time.

let pool: Pool | null = null;
let db: any = null;
let isDbConnected = false;
let lastDbError: string | null = null;
let lastProbeAt: string | null = null;
let lastProbeMs: number | null = null;

if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
    });
    pool.on('error', (err) => {
      console.warn('[AmarDokan] PostgreSQL pool error (using disk-persisted fallback):', err.message);
      markDbDisconnected(err);
    });
    db = drizzle(pool, { schema });
  } catch (err: any) {
    console.warn('[AmarDokan] PostgreSQL initialization failed:', err.message);
    pool = null;
    db = null;
    isDbConnected = false;
    lastDbError = err?.message || String(err);
  }
} else {
  console.warn('[AmarDokan] DATABASE_URL not set — using disk-persisted fallback store');
}

export function getDbStatus() {
  return {
    configured: pool !== null,
    connected: isDbConnected,
    lastError: lastDbError,
    lastProbeAt,
    lastProbeMs,
  };
}

export function markDbDisconnected(err: unknown) {
  isDbConnected = false;
  lastDbError = err instanceof Error ? err.message : String(err);
}

/** Run a real `SELECT 1` against the pool (when configured) with a timeout. */
export async function probeDatabase(timeoutMs = 3000): Promise<{
  connected: boolean;
  ms: number | null;
  error: string | null;
}> {
  if (!pool) {
    lastProbeAt = new Date().toISOString();
    lastProbeMs = null;
    lastDbError = 'DATABASE_URL not configured';
    return { connected: false, ms: null, error: 'DATABASE_URL not configured' };
  }
  const started = Date.now();
  try {
    const probe = pool.query('SELECT 1');
    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`database ping timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    await Promise.race([probe, timeout]);
    isDbConnected = true;
    lastDbError = null;
    lastProbeMs = Date.now() - started;
    lastProbeAt = new Date().toISOString();
    return { connected: true, ms: lastProbeMs, error: null };
  } catch (err: any) {
    markDbDisconnected(err);
    lastProbeMs = Date.now() - started;
    lastProbeAt = new Date().toISOString();
    return { connected: false, ms: lastProbeMs, error: err?.message || String(err) };
  }
}

/** Live ping used by /api/health — same probe, with a short timeout. */
export async function pingDatabase(timeoutMs = 2000) {
  return probeDatabase(timeoutMs);
}

// Kick off the boot probe without blocking module load; server/index.ts
// also awaits it before registering routes so the session-store choice is
// made against a probed (not assumed) database state.
if (pool) {
  probeDatabase().catch(() => {
    // Errors are already recorded on the status object; never crash boot
    // just because the database is unreachable — the fallback store runs.
  });
}

/**
 * Re-probe periodically. On a false -> true transition, `onReconnect` runs
 * (server/index.ts uses it to replay the disk outbox into PostgreSQL).
 * The timer is unref'd so it never keeps a short-lived process alive.
 */
export function startDbReprobe(onReconnect?: () => Promise<void> | void, intervalMs = 30_000): NodeJS.Timeout | null {
  if (!pool) return null;
  let wasConnected = isDbConnected;
  const timer = setInterval(async () => {
    const result = await probeDatabase();
    if (result.connected && !wasConnected) {
      try {
        await onReconnect?.();
      } catch (err: any) {
        console.warn('[AmarDokan] Reconnect handler failed:', err?.message || String(err));
      }
    }
    wasConnected = result.connected;
  }, intervalMs);
  if (typeof (timer as any).unref === 'function') (timer as any).unref();
  return timer;
}

export { pool, db, isDbConnected };
