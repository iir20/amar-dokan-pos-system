// Phase 4 unit tests: gateway HMAC/idempotency/refunds/reconciliation
// and public-view cost stripping. These use self-generated HMAC vectors
// with known keys (they prove the code path, not a real gateway) and a
// throwaway AMAR_DATA_DIR under /tmp — never a real secret, never the
// workspace data dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AMAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amar-gateway-test-'));
process.env.AMAR_GATEWAY_CALLBACKS_ENABLED = 'true';
process.env.AMAR_BKASH_CALLBACK_SECRET = 'dev-only-test-secret-bkash-123456';
process.env.AMAR_NAGAD_CALLBACK_SECRET = 'dev-only-test-secret-nagad-123456';

const gateway = await import('../server/gateway.ts');
const { publicProductView, publicGuestOrderView } = await import('../server/publicView.ts');

test('gateway: HMAC signature verifies for the exact body and rejects tampering', () => {
  const body = JSON.stringify({ merchantRef: 'REF-1', amountMinor: 50000, status: 'completed' });
  const sig = gateway.signCallbackBody('bkash', body);
  assert.equal(gateway.verifyCallbackSignature('bkash', body, sig), true);
  assert.equal(gateway.verifyCallbackSignature('bkash', body + ' ', sig), false);
  assert.equal(
    gateway.verifyCallbackSignature(
      'bkash',
      body,
      'sha256=0000000000000000000000000000000000000000000000000000000000000000',
    ),
    false,
  );
  assert.equal(gateway.verifyCallbackSignature('bkash', body, undefined), false);
  assert.equal(gateway.verifyCallbackSignature('bkash', body, 'not-a-signature'), false);
  // Cross-gateway secret must not verify.
  assert.equal(gateway.verifyCallbackSignature('nagad', body, sig), false);
  // Independent recomputation with node:crypto matches the module.
  const expected = `sha256=${crypto.createHmac('sha256', 'dev-only-test-secret-bkash-123456').update(body).digest('hex')}`;
  assert.equal(sig, expected);
});

test('gateway: capture is idempotent and amount mismatch never captures', () => {
  const intent = gateway.createGatewayIntent('store-a', 'bkash', 75000, 'REF-CAP-1');
  assert.equal(intent.status, 'pending');
  const first = gateway.applyGatewayCallback('bkash', {
    merchantRef: 'REF-CAP-1',
    gatewayTrxId: 'TRX-100',
    amountMinor: 75000,
    status: 'completed',
  });
  assert.equal(first.outcome, 'captured');
  assert.equal(first.intent?.status, 'captured');
  const replay = gateway.applyGatewayCallback('bkash', {
    merchantRef: 'REF-CAP-1',
    gatewayTrxId: 'TRX-100',
    amountMinor: 75000,
    status: 'completed',
  });
  assert.equal(replay.outcome, 'already_captured');
  assert.equal(replay.intent?.capturedAmountMinor, 75000);
  const conflict = gateway.applyGatewayCallback('bkash', {
    merchantRef: 'REF-CAP-1',
    gatewayTrxId: 'TRX-999',
    amountMinor: 75000,
    status: 'completed',
  });
  assert.equal(conflict.outcome, 'gateway_trx_mismatch');
  assert.equal(conflict.intent?.gatewayTrxId, 'TRX-100');

  gateway.createGatewayIntent('store-a', 'bkash', 10000, 'REF-CAP-2');
  const mismatch = gateway.applyGatewayCallback('bkash', {
    merchantRef: 'REF-CAP-2',
    gatewayTrxId: 'TRX-101',
    amountMinor: 9999,
    status: 'completed',
  });
  assert.equal(mismatch.outcome, 'amount_mismatch');
  assert.equal(mismatch.intent?.status, 'pending');
  assert.equal(mismatch.intent?.gatewayTrxId, null);
  const unknown = gateway.applyGatewayCallback('bkash', {
    merchantRef: 'REF-NOPE',
    gatewayTrxId: 'TRX-102',
    amountMinor: 100,
    status: 'completed',
  });
  assert.equal(unknown.outcome, 'unknown_reference');
});

test('gateway: refunds are idempotent and cannot exceed the capture', () => {
  gateway.createGatewayIntent('store-b', 'nagad', 20000, 'REF-RF-1');
  gateway.applyGatewayCallback('nagad', {
    merchantRef: 'REF-RF-1',
    gatewayTrxId: 'NAG-1',
    amountMinor: 20000,
    status: 'completed',
  });
  const intent = gateway.listGatewayIntents('store-b').find((i: any) => i.merchantRef === 'REF-RF-1');
  assert.ok(intent);
  const first = gateway.createGatewayRefund('store-b', intent.id, 'RF-1', 5000);
  assert.equal(first.intent.status, 'partially_refunded');
  assert.equal(first.intent.refundedAmountMinor, 5000);
  const replay = gateway.createGatewayRefund('store-b', intent.id, 'RF-1', 5000);
  assert.equal(replay.refund.id, first.refund.id);
  assert.equal(replay.intent.refundedAmountMinor, 5000);
  assert.throws(
    () => gateway.createGatewayRefund('store-b', intent.id, 'RF-2', 16000),
    (e: any) => e.code === 'REFUND_EXCEEDS_CAPTURED',
  );
  const full = gateway.createGatewayRefund('store-b', intent.id, 'RF-3', 15000);
  assert.equal(full.intent.status, 'refunded');
  assert.throws(
    () => gateway.createGatewayRefund('store-b', intent.id, 'RF-4', 1),
    (e: any) => e.code === 'REFUND_NOT_CAPTURED',
  );
});

test('gateway: reconciliation lists every mismatch and drops none', () => {
  gateway.createGatewayIntent('store-c', 'bkash', 30000, 'REF-RC-1');
  gateway.applyGatewayCallback('bkash', {
    merchantRef: 'REF-RC-1',
    gatewayTrxId: 'TRX-RC-1',
    amountMinor: 30000,
    status: 'completed',
  });
  gateway.createGatewayIntent('store-c', 'bkash', 40000, 'REF-RC-2');
  gateway.applyGatewayCallback('bkash', {
    merchantRef: 'REF-RC-2',
    gatewayTrxId: 'TRX-RC-2',
    amountMinor: 40000,
    status: 'completed',
  });
  const report = gateway.reconcileGatewayVsLedger('store-c', [
    { id: 'led-1', gatewayTrxId: 'TRX-RC-1', paidAmount: 300, status: 'captured' },
    { id: 'led-orphan', gatewayTrxId: 'TRX-ORPHAN', paidAmount: 50, status: 'captured' },
  ]);
  // TRX-RC-1 matches exactly; TRX-RC-2 has no ledger entry; the orphan
  // ledger entry has no intent. Both mismatches must be listed.
  assert.equal(report.mismatches.length, 2);
  const types = report.mismatches.map((m: any) => m.type).sort();
  assert.deepEqual(types, ['captured_without_ledger', 'ledger_without_gateway_intent']);
  const clean = gateway.reconcileGatewayVsLedger('store-c', [
    { id: 'led-1', gatewayTrxId: 'TRX-RC-1', paidAmount: 300, status: 'captured' },
    { id: 'led-2', gatewayTrxId: 'TRX-RC-2', paidAmount: 400, status: 'captured' },
  ]);
  assert.equal(clean.mismatches.length, 0);
  const wrongAmount = gateway.reconcileGatewayVsLedger('store-c', [
    { id: 'led-1', gatewayTrxId: 'TRX-RC-1', paidAmount: 299, status: 'captured' },
    { id: 'led-2', gatewayTrxId: 'TRX-RC-2', paidAmount: 400, status: 'captured' },
  ]);
  assert.equal(wrongAmount.mismatches.length, 1);
  assert.equal(wrongAmount.mismatches[0].type, 'amount_mismatch');
});

test('public view: cost is stripped from public products and guest orders', () => {
  const product = { id: 'p1', name: 'Rice', price: 100, cost: 80, stock: 5, storeId: 's1' };
  const view = publicProductView(product);
  assert.equal('cost' in view, false);
  assert.equal(view.price, 100);
  assert.equal(product.cost, 80); // source record untouched
  const order = { id: 'o1', items: [product], totalAmount: 100 };
  assert.equal('cost' in publicGuestOrderView(order).items[0], false);
});
