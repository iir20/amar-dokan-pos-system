import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import * as schema from '../shared/schema';

// Phase 1 fix (P0-2): durable fallback storage.
//
// Previously the fallback store lived only in module-level Maps: every sale,
// order, intent and shift vanished on restart/redeploy, and nothing was ever
// replayed into PostgreSQL. Now every fallback mutation is recorded twice:
//  1. A full snapshot (`fallback-store.json`) — the fallback store of record.
//     It is reloaded on boot, so if PostgreSQL is never configured the data
//     still survives restarts. Writes are atomic (temp file + rename).
//  2. An append-only outbox (`outbox.json`) — one entry per upsert/delete,
//     in mutation order. When PostgreSQL comes back, `replayOutbox` replays
//     the outbox into it (last write wins, in order) and drops only the
//     entries that applied cleanly.
//
// Money records are therefore never silent in-memory-only: a mutation that
// reaches the fallback store has already hit disk before the API returns
// (MemStorage persists synchronously on every Map mutation).
//
// Directory: AMAR_DATA_DIR, default `<cwd>/data`. It is gitignored; it must
// be on persistent storage in production (a Render disk, a volume, etc.),
// otherwise a redeploy still loses it — see docs/backup-handling.md.

export function getDataDir(): string {
  const configured = process.env.AMAR_DATA_DIR;
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), 'data');
}

export function getSnapshotPath(): string {
  return path.join(getDataDir(), 'fallback-store.json');
}

export function getOutboxPath(): string {
  return path.join(getDataDir(), 'outbox.json');
}

export type Snapshot = {
  version: 1;
  savedAt: string;
  collections: Record<string, Array<[string, unknown]>>;
};

export type OutboxEntry = {
  id: string;
  kind: string;
  recordId: string;
  op: 'upsert' | 'delete';
  record: unknown;
  createdAt: string;
};

function writeAtomic(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, contents);
  fs.renameSync(tmpPath, filePath);
}

export function loadSnapshot(): Snapshot | null {
  try {
    const raw = fs.readFileSync(getSnapshotPath(), 'utf8');
    const parsed = JSON.parse(raw) as Snapshot;
    if (!parsed || parsed.version !== 1 || typeof parsed.collections !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSnapshot(snapshot: Snapshot): void {
  writeAtomic(getSnapshotPath(), JSON.stringify(snapshot));
}

export function snapshotExists(): boolean {
  try {
    return fs.existsSync(getSnapshotPath());
  } catch {
    return false;
  }
}

export function readOutbox(): OutboxEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(getOutboxPath(), 'utf8')) as OutboxEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getOutboxDepth(): number {
  return readOutbox().length;
}

function writeOutbox(entries: OutboxEntry[]): void {
  writeAtomic(getOutboxPath(), JSON.stringify(entries));
}

export function appendOutbox(
  kind: string,
  recordId: string,
  op: 'upsert' | 'delete',
  record: unknown,
): OutboxEntry | null {
  try {
    const entries = readOutbox();
    const entry: OutboxEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      recordId,
      op,
      record: record ?? null,
      createdAt: new Date().toISOString(),
    };
    entries.push(entry);
    writeOutbox(entries);
    return entry;
  } catch (err: any) {
    // The snapshot is the store of record, so a failed outbox append must
    // never break a sale — but it must never be silent either.
    console.warn('[AmarDokan] Outbox append failed (snapshot still persisted):', err?.message || String(err));
    return null;
  }
}

export function replaceOutbox(entries: OutboxEntry[]): void {
  writeOutbox(entries);
}

/** Date fields that arrive from JSON as ISO strings and must be Dates again. */
export const DATE_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'date',
  'openedAt',
  'closedAt',
  'subscriptionExpiry',
  'lockedUntil',
  'startDate',
  'endDate',
]);

export function reviveDates<T>(record: T): T {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const out: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (DATE_KEYS.has(key) && typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
      out[key] = new Date(value);
    }
  }
  return out as T;
}

/**
 * Pure replay core, testable without a database: apply each entry in order
 * through `apply` (a test double is acceptable here — this function itself
 * never touches production code paths). Entries that throw stay in the
 * returned `remaining` list, in order, so a later replay retries them;
 * entries that applied are dropped. Never partially reorders the outbox.
 */
export async function replayEntries(
  entries: OutboxEntry[],
  apply: (entry: OutboxEntry) => Promise<void>,
): Promise<{ replayed: number; failed: number; remaining: OutboxEntry[] }> {
  const remaining: OutboxEntry[] = [];
  let replayed = 0;
  for (const entry of entries) {
    try {
      await apply(entry);
      replayed += 1;
    } catch (err: any) {
      console.warn(
        `[AmarDokan] Outbox replay failed for ${entry.kind}/${entry.recordId}, keeping it queued:`,
        err?.message || String(err),
      );
      remaining.push(entry);
    }
  }
  return { replayed, failed: remaining.length, remaining };
}

const ID_TABLES: Record<string, any> = {
  users: schema.users,
  staff: schema.staff,
  customers: schema.customers,
  products: schema.products,
  sales: schema.sales,
  expenses: schema.expenses,
  inventoryLogs: schema.inventoryLogs,
  subscriptionRequests: schema.subscriptionRequests,
  restaurantTables: schema.restaurantTables,
  guestOrders: schema.guestOrders,
  announcements: schema.announcements,
  onlineOrders: schema.onlineOrders,
  paymentIntents: schema.paymentIntents,
  shifts: schema.shifts,
};

/**
 * Replay the disk outbox into PostgreSQL via drizzle. Only entries whose
 * kind maps to a known table are applied; unknown kinds are left queued
 * (never silently dropped) so an operator can inspect them.
 *
 * NOTE: live PostgreSQL replay cannot be verified in this sandbox (no
 * PostgreSQL server exists here). It is verified by unit tests against a
 * fake apply function (see tests/durableStore.test.ts, labelled as such)
 * and must be re-verified against staging PostgreSQL before it is relied
 * on in production.
 */
export async function replayOutbox(db: any): Promise<{
  replayed: number;
  failed: number;
  remaining: number;
  skippedUnknownKind: number;
}> {
  if (!db) return { replayed: 0, failed: 0, remaining: getOutboxDepth(), skippedUnknownKind: 0 };
  const entries = readOutbox();
  let skippedUnknownKind = 0;
  const result = await replayEntries(entries, async (entry) => {
    if (entry.kind === 'settings') {
      const record = (entry.record || {}) as { key?: string; value?: unknown };
      const key = record.key || entry.recordId;
      if (entry.op === 'delete') {
        await db.delete(schema.settings).where(eq(schema.settings.key, key));
        return;
      }
      await db
        .insert(schema.settings)
        .values({ key, value: record.value ?? null })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: record.value ?? null } });
      return;
    }
    const table = ID_TABLES[entry.kind];
    if (!table) {
      skippedUnknownKind += 1;
      throw new Error(`unknown outbox kind: ${entry.kind}`);
    }
    if (entry.op === 'delete') {
      await db.delete(table).where(eq(table.id, entry.recordId));
      return;
    }
    const record = reviveDates((entry.record || {}) as Record<string, unknown>);
    const { id: _id, ...rest } = record as Record<string, unknown>;
    await db.insert(table).values(record).onConflictDoUpdate({ target: table.id, set: rest });
  });
  replaceOutbox(result.remaining);
  return {
    replayed: result.replayed,
    failed: result.failed,
    remaining: result.remaining.length,
    skippedUnknownKind,
  };
}

// Phase 2 — last-backup bookkeeping. The admin backup export is the only
// backup this app produces, so the admin system-status view reports the
// time of the last export. Stored beside the snapshot in AMAR_DATA_DIR
// (never in the repo); a missing file means "never" — never a fabricated
// timestamp.
export type BackupMeta = { lastBackupAt: string | null; lastBackupBy: string | null };

export function getBackupMetaPath(): string {
  return path.join(getDataDir(), 'backup-meta.json');
}

export function getLastBackup(): BackupMeta {
  try {
    const parsed = JSON.parse(fs.readFileSync(getBackupMetaPath(), 'utf8')) as BackupMeta;
    if (parsed && typeof parsed.lastBackupAt === 'string') return parsed;
  } catch {}
  return { lastBackupAt: null, lastBackupBy: null };
}

export function recordBackupExport(byUserId: string | null): BackupMeta {
  const meta: BackupMeta = { lastBackupAt: new Date().toISOString(), lastBackupBy: byUserId };
  try {
    fs.mkdirSync(path.dirname(getBackupMetaPath()), { recursive: true });
    writeAtomic(getBackupMetaPath(), JSON.stringify(meta));
  } catch (err: any) {
    console.warn('[AmarDokan] Failed to record backup time:', err?.message || String(err));
  }
  return meta;
}

export function getFallbackStatus() {
  return {
    dataDirConfigured: Boolean(process.env.AMAR_DATA_DIR),
    snapshotExists: snapshotExists(),
    outboxDepth: getOutboxDepth(),
  };
}
