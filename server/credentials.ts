import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAXMEM = 64 * 1024 * 1024;
const LEGACY_SHA256_HEX = /^[a-f0-9]{64}$/i;

function deriveKey(pin: string, salt: Buffer, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      pin,
      salt,
      KEY_LENGTH,
      { ...options, maxmem: MAXMEM },
      (error, key) => error ? reject(error) : resolve(key as Buffer),
    );
  });
}

export async function hashPin(pin: string): Promise<string> {
  if (typeof pin !== 'string' || pin.length < 4 || pin.length > 128) {
    throw new Error('PIN must contain between 4 and 128 characters.');
  }
  const salt = randomBytes(16);
  const key = await deriveKey(pin, salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPin(
  pin: string,
  storedHash: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (typeof pin !== 'string' || typeof storedHash !== 'string') {
    return { valid: false, needsRehash: false };
  }

  if (LEGACY_SHA256_HEX.test(storedHash)) {
    const expected = createHash('sha256').update(pin).digest();
    const stored = Buffer.from(storedHash, 'hex');
    return {
      valid: stored.length === expected.length && timingSafeEqual(stored, expected),
      needsRehash: true,
    };
  }

  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return { valid: false, needsRehash: false };
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isInteger(N) || N < 16_384 || N > 65_536 ||
    !Number.isInteger(r) || r < 1 || r > 16 ||
    !Number.isInteger(p) || p < 1 || p > 4
  ) {
    return { valid: false, needsRehash: false };
  }

  try {
    const salt = Buffer.from(parts[4], 'base64url');
    const stored = Buffer.from(parts[5], 'base64url');
    if (salt.length < 16 || salt.length > 64 || stored.length !== KEY_LENGTH) {
      return { valid: false, needsRehash: false };
    }
    const expected = await deriveKey(pin, salt, { N, r, p });
    return {
      valid: timingSafeEqual(stored, expected),
      needsRehash: N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P,
    };
  } catch {
    return { valid: false, needsRehash: false };
  }
}
