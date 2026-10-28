import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendOutbox,
  readOutbox,
  getOutboxDepth,
  loadSnapshot,
  saveSnapshot,
  replayEntries,
  type OutboxEntry,
} from '../server/durableStore';

// NOTE ON TEST DOUBLES: the replay test below uses a FAKE apply function
// (an in-memory collector) to exercise replayEntries' ordering /
// failure-retention logic only. It does NOT prove replay against a real
// PostgreSQL database — no PostgreSQL server exists in this sandbox, so
// live PG replay verification is documented as requiring staging.

test('durableStore: outbox append/read/depth round-trips through AMAR_DATA_DIR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amar-outbox-'));
  process.env.AMAR_DATA_DIR = dir;
  assert.equal(getOutboxDepth(), 0);
  const entry = appendOutbox('sales', 'sale-test-1', 'upsert', { id: 'sale-test-1', totalAmount: 399 });
  assert.ok(entry);
  assert.equal(getOutboxDepth(), 1);
  const [back] = readOutbox();
  assert.equal(back.kind, 'sales');
  assert.equal(back.recordId, 'sale-test-1');
  assert.equal((back.record as any).totalAmount, 399);
});

test('durableStore: snapshot save/load round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amar-snap-'));
  process.env.AMAR_DATA_DIR = dir;
  assert.equal(loadSnapshot(), null);
  saveSnapshot({
    version: 1,
    savedAt: new Date().toISOString(),
    collections: { sales: [['sale-test-2', { id: 'sale-test-2', totalAmount: 100 }]] },
  });
  const loaded = loadSnapshot();
  assert.ok(loaded);
  assert.equal(loaded.collections.sales[0][0], 'sale-test-2');
});

test('durableStore: replay applies in order, keeps failures queued, drops successes', async () => {
  const applied: string[] = [];
  const entries: OutboxEntry[] = [
    {
      id: 'e1',
      kind: 'sales',
      recordId: 's1',
      op: 'upsert',
      record: { id: 's1' },
      createdAt: new Date().toISOString(),
    },
    {
      id: 'e2',
      kind: 'sales',
      recordId: 's2',
      op: 'upsert',
      record: { id: 's2' },
      createdAt: new Date().toISOString(),
    },
    {
      id: 'e3',
      kind: 'sales',
      recordId: 's3',
      op: 'upsert',
      record: { id: 's3' },
      createdAt: new Date().toISOString(),
    },
  ];
  // FAKE apply function (test double only): fails for s2, succeeds otherwise.
  const result = await replayEntries(entries, async (entry) => {
    if (entry.recordId === 's2') throw new Error('fake database outage');
    applied.push(entry.recordId);
  });
  assert.deepEqual(applied, ['s1', 's3']);
  assert.equal(result.replayed, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(
    result.remaining.map((e) => e.recordId),
    ['s2'],
  );
});

test('durableStore: replay of an empty outbox is a no-op', async () => {
  const result = await replayEntries([], async () => {});
  assert.deepEqual(result, { replayed: 0, failed: 0, remaining: [] });
});

test('fallback store: without AMAR_DEMO_SEED, demo credentials do not exist and a real user persists to disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amar-mem-'));
  process.env.AMAR_DATA_DIR = dir;
  delete process.env.AMAR_DEMO_SEED;
  // Dynamic import AFTER setting the env vars, so module-load seeding (if
  // any) runs under exactly these conditions.
  const { MemStorage } = await import('../server/memStorage');
  const { loadSnapshot: reload } = await import('../server/durableStore');
  assert.equal(await MemStorage.getUserByUsername('admin'), null);
  assert.equal(await MemStorage.getUserByUsername('dhakacafe'), null);
  const user = await MemStorage.createUser({
    id: 'test-owner-1',
    storeName: 'Test Store',
    storeCategory: 'grocery',
    username: 'testowner',
    pin: 'scrypt-test-verifier-not-a-real-pin',
    plan: 'free',
    subscriptionStatus: 'active',
  } as any);
  assert.equal(user.username, 'testowner');
  // The write must already be on disk (synchronous persist), not just in memory.
  const snapshot = reload();
  assert.ok(snapshot);
  const users = snapshot.collections.users || [];
  assert.ok(users.some(([id]) => id === 'test-owner-1'));
  assert.equal(fs.existsSync(path.join(dir, 'fallback-store.json')), true);
});
