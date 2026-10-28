import { Product, Sale, SyncItem } from '../types';
import { StorageService } from './storage';

const OUTBOX_KEY = 'amar_sync_outbox';
const CACHED_PRODUCTS_KEY = 'amar_cached_products';
const SYNC_HISTORY_KEY = 'amar_sync_history';

// Phase 6 audit fixes (see docs/phase6.md):
//  (1) enqueue dedupes by sale id — the same sale can never sit in the
//      outbox twice, so a client retry cannot create a duplicate sale.
//  (2) a SALE_ID_CONFLICT flush result is counted as synced, never also
//      as failed (the old code incremented both counters).
//  (3) 'failed' items are NEVER silently dropped: they stay in the
//      outbox, are counted separately, are retried by flushOutbox, and
//      clearSyncedOutbox keeps them (it used to keep only 'pending',
//      silently discarding failed records).
type SyncListener = (state: {
  outboxCount: number;
  failedCount: number;
  isOnline: boolean;
  isSyncing: boolean;
}) => void;
const listeners = new Set<SyncListener>();

let isSyncing = false;

function notifyListeners() {
  const outbox = getOutbox();
  const pendingCount = outbox.filter((item) => item.status === 'pending').length;
  const failedCount = outbox.filter((item) => item.status === 'failed').length;
  for (const listener of listeners) {
    listener({
      outboxCount: pendingCount,
      failedCount,
      isOnline: navigator.onLine,
      isSyncing,
    });
  }
}

export function getOutbox(): SyncItem[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveOutbox(items: SyncItem[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
    notifyListeners();
  } catch {}
}

export function getCachedProducts(): Product[] {
  try {
    const raw = localStorage.getItem(CACHED_PRODUCTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function cacheProducts(products: Product[]) {
  try {
    localStorage.setItem(CACHED_PRODUCTS_KEY, JSON.stringify(products));
  } catch {}
}

export function enqueueOfflineSale(sale: any): SyncItem {
  const id = sale.id || crypto.randomUUID();
  const salePayload = { ...sale, id };

  // Phase 6 (1): dedupe — an already-queued sale id is returned as-is,
  // never queued a second time.
  const existingOutbox = getOutbox();
  const existing = existingOutbox.find((i) => i.id === id);
  if (existing) return existing;

  const item: SyncItem = {
    id,
    sale: salePayload,
    queuedAt: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
  };

  const outbox = getOutbox();
  outbox.push(item);
  saveOutbox(outbox);

  // Locally deduct stock from cached products so subsequent offline scans reflect it
  try {
    const cached = getCachedProducts();
    if (cached.length > 0 && Array.isArray(sale.items)) {
      const updated = cached.map((p) => {
        const itemLine = sale.items.find((i: any) => i.id === p.id);
        if (itemLine) {
          return { ...p, stock: Math.max(0, p.stock - (itemLine.quantity || 1)) };
        }
        return p;
      });
      cacheProducts(updated);
    }
  } catch {}

  // Attempt immediate flush if currently online
  if (navigator.onLine) {
    setTimeout(() => {
      flushOutbox().catch(() => {});
    }, 100);
  }

  return item;
}

export async function flushOutbox(): Promise<{ synced: number; failed: number }> {
  if (isSyncing || !navigator.onLine) return { synced: 0, failed: 0 };
  isSyncing = true;
  notifyListeners();

  const outbox = getOutbox();
  let synced = 0;
  let failed = 0;

  const remaining: SyncItem[] = [];

  for (const item of outbox) {
    if (item.status === 'synced') continue;

    try {
      await StorageService.createSale(item.sale);
      synced++;
      // Save to sync history
      try {
        const historyRaw = localStorage.getItem(SYNC_HISTORY_KEY);
        const history = historyRaw ? JSON.parse(historyRaw) : [];
        history.unshift({ ...item, status: 'synced', syncedAt: new Date().toISOString() });
        localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
      } catch {}
    } catch (err: any) {
      // If error is duplicate sale ID conflict, the server already has it recorded:
      // count it as synced ONLY (Phase 6 fix — the old code counted it as
      // failed AND synced). It is not re-queued.
      if (err.body?.error === 'SALE_ID_CONFLICT') {
        synced++;
        continue;
      }
      failed++;
      // After 5 failed attempts the record becomes 'failed' — it stays
      // in the outbox (visible, retryable), it is never dropped.
      const nextRetry = item.retryCount + 1;
      remaining.push({
        ...item,
        retryCount: nextRetry,
        status: nextRetry >= 5 ? 'failed' : 'pending',
        error: err.message || 'Network error during sync',
      });
    }
  }

  saveOutbox(remaining);
  isSyncing = false;
  notifyListeners();

  return { synced, failed };
}

export function clearSyncedOutbox() {
  // Phase 6 (3): keep BOTH pending and failed records. Dropping failed
  // records here used to silently discard unsynced sales.
  const outbox = getOutbox();
  const kept = outbox.filter((i) => i.status === 'pending' || i.status === 'failed');
  saveOutbox(kept);
}

/** Move every 'failed' record back to 'pending' so the next flush retries it. */
export function retryFailedOutbox() {
  const outbox = getOutbox();
  const updated = outbox.map((i) =>
    i.status === 'failed' ? { ...i, status: 'pending' as const, error: undefined } : i,
  );
  saveOutbox(updated);
}

export function subscribeToSync(listener: SyncListener): () => void {
  listeners.add(listener);
  listener({
    outboxCount: getOutbox().filter((i) => i.status === 'pending').length,
    failedCount: getOutbox().filter((i) => i.status === 'failed').length,
    isOnline: navigator.onLine,
    isSyncing,
  });
  return () => {
    listeners.delete(listener);
  };
}

export const subscribeSync = subscribeToSync;

// Global online / periodic listener
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    notifyListeners();
    flushOutbox().catch(() => {});
  });
  window.addEventListener('offline', () => {
    notifyListeners();
  });
  // Auto-sync heartbeat every 20 seconds
  setInterval(() => {
    if (navigator.onLine && getOutbox().some((i) => i.status === 'pending')) {
      flushOutbox().catch(() => {});
    }
  }, 20000);
}
