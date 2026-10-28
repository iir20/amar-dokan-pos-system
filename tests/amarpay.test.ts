import assert from 'node:assert/strict';
import test from 'node:test';

test('AmarPay: split bill distributes equal shares accurately in integer paisa', () => {
  const total = 1000; // ৳1000
  const parts = 3;
  const rawShare = Math.floor((total / parts) * 100) / 100; // 333.33
  const remainder = Math.round((total - rawShare * parts) * 100) / 100; // 0.01

  assert.equal(rawShare, 333.33);
  assert.equal(remainder, 0.01);
  assert.equal(Math.round((rawShare * parts + remainder) * 100) / 100, 1000);
});

test('AmarPay: validates bKash/Nagad transaction ID formats', () => {
  const isValidTrxId = (id: string) => /^[A-Z0-9]{8,12}$/i.test(id.trim());

  assert.equal(isValidTrxId('TRX98765432'), true);
  assert.equal(isValidTrxId('BK12345678'), true);
  assert.equal(isValidTrxId(''), false);
  assert.equal(isValidTrxId('TRX-123'), false); // Hyphens invalid
  assert.equal(isValidTrxId('TOO_LONG_TRANSACTION_ID_12345'), false);
});

test('AmarPay: payment intent states enforce valid transitions', () => {
  type IntentState = 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'voided';

  const validTransitions: Record<IntentState, IntentState[]> = {
    pending: ['authorized', 'captured', 'failed', 'voided'],
    authorized: ['captured', 'voided'],
    captured: ['refunded'],
    failed: [],
    refunded: [],
    voided: [],
  };

  const canTransition = (from: IntentState, to: IntentState) => validTransitions[from].includes(to);

  assert.equal(canTransition('pending', 'captured'), true);
  assert.equal(canTransition('pending', 'authorized'), true);
  assert.equal(canTransition('captured', 'refunded'), true);
  assert.equal(canTransition('captured', 'voided'), false); // Cannot void an already captured transaction; must refund
  assert.equal(canTransition('voided', 'captured'), false);
});
