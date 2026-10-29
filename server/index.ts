import express from 'express';
import { createServer } from 'http';
import { registerRoutes } from './routes';
import { setupVite, serveStatic } from './vite';
import { setupAmarLive } from './live';
import { probeDatabase, startDbReprobe, db } from './db';
import { replayOutbox, getOutboxDepth } from './durableStore';
import { logInfo, logError } from './logger';
import { reportError } from './errorTracking';

async function main() {
  const app = express();
  // Phase 4: keep the raw request body for gateway callback signature
  // verification (HMAC must run over the exact bytes the gateway sent,
  // not a re-serialized JSON object). Stored on the request object only;
  // never logged (bodies can contain PINs).
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));

  // Phase 4: minimal security headers. No CSP is set here on purpose:
  // the app serves inline styles/scripts in places and a wrong CSP
  // would break the POS UI; CSP belongs to a staging pass with a real
  // browser test, not a blind header.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Phase 2 — structured request logs (method/path/status/duration only;
  // never headers, cookies or bodies — a body could contain a PIN).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        logInfo('api-request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - start,
        });
      }
    });
    next();
  });

  // Phase 1 fix: probe PostgreSQL for real before routes are registered,
  // so the session-store choice and the first /api/health answer reflect a
  // probed state. A failed probe never blocks boot — the disk-persisted
  // fallback store serves traffic instead.
  const bootProbe = await probeDatabase(3000);
  console.log(
    `[AmarDokan] Database boot probe: ${bootProbe.connected ? 'connected' : 'fallback'}${bootProbe.error ? ` (${bootProbe.error})` : ''}`,
  );

  // Phase 4: if PostgreSQL is connected, the Phase 3 tables must exist
  // (migrations/0002 + 0003). Without them, storage operations would
  // silently fall back to the durable fallback store per operation —
  // correct data would never reach PostgreSQL and Phase 3 reads would
  // look empty. This check makes that state loud at boot instead of
  // silent; it never blocks boot (the fallback still serves traffic).
  if (bootProbe.connected) {
    try {
      const { pool: bootPool } = await import('./db');
      const tables = await bootPool!.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('branches','counters','suppliers','purchase_orders','coupons','loyalty_accounts')`,
      );
      const present = new Set(tables.rows.map((r: any) => r.table_name));
      const missing = ['branches', 'counters', 'suppliers', 'purchase_orders', 'coupons', 'loyalty_accounts'].filter(
        (t) => !present.has(t),
      );
      if (missing.length > 0) {
        console.warn(
          `[AmarDokan] WARNING: PostgreSQL is connected but Phase 3 tables are missing: ${missing.join(', ')}. Apply migrations/0002_phase3_depth.sql and migrations/0003_loyalty_store_phone_pk.sql before relying on Phase 3 features on PostgreSQL — until then those operations fall back to the durable fallback store.`,
        );
      } else {
        console.log(
          '[AmarDokan] Phase 3 PostgreSQL tables present (branches, counters, suppliers, purchase_orders, coupons, loyalty_accounts).',
        );
      }
    } catch (e: any) {
      console.warn('[AmarDokan] Phase 3 table check failed (continuing on fallback behavior):', e?.message);
    }
  }

  // Smart QR readiness: the store_code column (migration 0004) and
  // the nullable guest_orders.table_id (migration 0005) must exist
  // before store-QR resolution can work on PostgreSQL. Missing
  // columns do not block boot (reads fall back to the disk store),
  // but they are loud here so a deploy that skipped migrations is
  // noticed instead of silently serving empty storefronts.
  if (bootProbe.connected) {
    try {
      const { pool: bootPool } = await import('./db');
      const cols = await bootPool!.query(
        `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'users' AND column_name = 'store_code') OR (table_name = 'guest_orders' AND column_name = 'table_id'))`,
      );
      const byKey = new Map(cols.rows.map((r: any) => [`${r.table_name}.${r.column_name}`, r.is_nullable]));
      if (!byKey.has('users.store_code')) {
        console.warn(
          '[AmarDokan] WARNING: PostgreSQL is connected but users.store_code is missing. Apply migrations/0004_store_code.sql (node scripts/migrate.mjs) before relying on store QR codes.',
        );
      }
      if (byKey.get('guest_orders.table_id') === 'NO') {
        console.warn(
          '[AmarDokan] WARNING: PostgreSQL guest_orders.table_id is still NOT NULL. Apply migrations/0005_pickup_guest_orders.sql (node scripts/migrate.mjs) before relying on store-QR pickup orders.',
        );
      }
    } catch (e: any) {
      console.warn('[AmarDokan] Store-QR column check failed (continuing on fallback behavior):', e?.message);
    }
  }

  registerRoutes(app);

  // Re-probe on a timer; on reconnect, replay the disk outbox into PostgreSQL.
  startDbReprobe(async () => {
    if (!db || getOutboxDepth() === 0) return;
    const result = await replayOutbox(db);
    console.log(`[AmarDokan] Outbox replay on reconnect: ${JSON.stringify(result)}`);
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    // Structured error log + tracking hook. The response still carries no
    // stack or internal detail; the tracking call never blocks the reply.
    logError('request-error', { method: req.method, path: req.path, status });
    void reportError(err, { method: req.method, path: req.path, status });
    res.status(status).json({ error: message });
  });

  const server = createServer(app);
  setupAmarLive(server);

  if (process.env.NODE_ENV === 'production') {
    serveStatic(app);
  } else {
    await setupVite(app, server);
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
