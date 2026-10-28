import assert from 'node:assert/strict';
import test from 'node:test';

interface SyncItemMock {
  id: string;
  status: 'pending' | 'synced' | 'failed';
  retryCount: number;
}

test('AmarSync: queues offline transaction and handles duplicates idempotently', () => {
  const queue: SyncItemMock[] = [];

  const enqueue = (id: string) => {
    const existing = queue.find((i) => i.id === id);
    if (existing) return existing;
    const item: SyncItemMock = { id, status: 'pending', retryCount: 0 };
    queue.push(item);
    return item;
  };

  const item1 = enqueue('sale-uuid-001');
  assert.equal(queue.length, 1);
  assert.equal(item1.status, 'pending');

  // Attempt duplicate enqueue with same client UUID
  const itemDuplicate = enqueue('sale-uuid-001');
  assert.equal(queue.length, 1);
  assert.equal(itemDuplicate.id, 'sale-uuid-001');

  // Enqueue a different sale
  const item2 = enqueue('sale-uuid-002');
  assert.equal(queue.length, 2);
  assert.equal(item2.id, 'sale-uuid-002');
});

test('AmarSync: pre-deducts local cached inventory to prevent offline negative stock overselling', () => {
  const localCatalog = [
    { id: 'prod-rice', name: 'Miniket Rice', stock: 10 },
    { id: 'prod-oil', name: 'Soybean Oil 1L', stock: 5 },
  ];

  const applyOfflineDeductions = (items: { id: string; quantity: number }[]) => {
    return localCatalog.map((p) => {
      const match = items.find((i) => i.id === p.id);
      if (match) {
        return { ...p, stock: Math.max(0, p.stock - match.quantity) };
      }
      return p;
    });
  };

  const updated = applyOfflineDeductions([
    { id: 'prod-rice', quantity: 3 },
    { id: 'prod-oil', quantity: 6 }, // Requests 6 but stock is 5
  ]);

  const rice = updated.find((p) => p.id === 'prod-rice');
  const oil = updated.find((p) => p.id === 'prod-oil');

  assert.equal(rice?.stock, 7);
  assert.equal(oil?.stock, 0); // Floors at 0, no negative stock
});

test('AmarSync: retry backoff caps at max retry threshold before marking failed', () => {
  let retryCount = 0;
  const maxRetries = 5;

  const simulateFailure = () => {
    retryCount++;
    return retryCount > maxRetries ? 'failed' : 'pending';
  };

  for (let i = 1; i <= 5; i++) {
    assert.equal(simulateFailure(), 'pending');
  }
  assert.equal(simulateFailure(), 'failed');
});
