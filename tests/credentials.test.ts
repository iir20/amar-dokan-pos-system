import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { hashPin, verifyPin } from '../server/credentials';

test('PIN verifiers use unique salted scrypt hashes and verify only the matching PIN', async () => {
  const [first, second] = await Promise.all([hashPin('test-pin-4321'), hashPin('test-pin-4321')]);
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$32768\$8\$1\$/);
  assert.deepEqual(await verifyPin('test-pin-4321', first), { valid: true, needsRehash: false });
  assert.deepEqual(await verifyPin('wrong-pin', first), { valid: false, needsRehash: false });
});

test('legacy unsalted SHA-256 PIN hashes verify only for migration to scrypt', async () => {
  const legacyHash = createHash('sha256').update('legacy-test-pin').digest('hex');
  assert.deepEqual(await verifyPin('legacy-test-pin', legacyHash), { valid: true, needsRehash: true });
  assert.deepEqual(await verifyPin('wrong-pin', legacyHash), { valid: false, needsRehash: true });
});

test('rejects short new PINs and malformed stored verifier formats', async () => {
  await assert.rejects(hashPin('123'), /between 4 and 128/);
  assert.deepEqual(await verifyPin('anything', 'not-a-verifier'), { valid: false, needsRehash: false });
});
