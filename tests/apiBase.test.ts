// Native backend-connection tests: API-base resolution order and
// override persistence, plus the distinct backend-unreachable error.
// The pure resolver (resolveApiBase) carries the matrix; the runtime
// client (api) is tested for the web path (relative '/api') and for
// the unreachable-vs-HTTP-error distinction. A native build with no
// config is an explicit error state in the resolver — it never
// silently falls back to relative '/api'.
import test from 'node:test';
import assert from 'node:assert/strict';

// Node's built-in navigator has no onLine boolean (undefined reads as
// offline in the client). Stub it before importing services/api, the
// same way tests/phase6.test.ts does, so network failures report as
// backend-unreachable rather than offline.
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

const { resolveApiBase, normalizeApiBase } = await import('../services/api.ts');

test('apiBase normalize: origin gains /api, a full /api base is kept, junk is rejected', () => {
  assert.equal(normalizeApiBase('https://shop.example'), 'https://shop.example/api');
  assert.equal(normalizeApiBase('https://shop.example/'), 'https://shop.example/api');
  assert.equal(normalizeApiBase('https://shop.example/api'), 'https://shop.example/api');
  assert.equal(normalizeApiBase('https://shop.example/api/'), 'https://shop.example/api');
  assert.equal(normalizeApiBase(''), null);
  assert.equal(normalizeApiBase('   '), null);
  assert.equal(normalizeApiBase('shop.example'), null, 'a scheme-less value is never guessed');
  assert.equal(normalizeApiBase('ftp://shop.example'), null);
  assert.equal(normalizeApiBase(null), null);
  assert.equal(normalizeApiBase(undefined), null);
});

test('apiBase resolution: override wins over env and web defaults', () => {
  assert.deepEqual(
    resolveApiBase({ isNative: true, envBase: 'https://env.example', override: 'https://override.example' }),
    { base: 'https://override.example/api', error: null },
  );
  assert.deepEqual(
    resolveApiBase({ isNative: false, envBase: 'https://env.example', override: 'https://override.example/api' }),
    { base: 'https://override.example/api', error: null },
  );
});

test('apiBase resolution: native uses the env default, web falls back to relative /api', () => {
  assert.deepEqual(resolveApiBase({ isNative: true, envBase: 'https://backend.example', override: null }), {
    base: 'https://backend.example/api',
    error: null,
  });
  assert.deepEqual(resolveApiBase({ isNative: false, envBase: null, override: null }), { base: '/api', error: null });
  // A web build ignores the env default: it is served by its own server.
  assert.deepEqual(resolveApiBase({ isNative: false, envBase: 'https://backend.example', override: '' }), {
    base: '/api',
    error: null,
  });
});

test('apiBase resolution: a native build with no config is an explicit error, never a silent /api', () => {
  assert.deepEqual(resolveApiBase({ isNative: true, envBase: null, override: null }), {
    base: null,
    error: 'NATIVE_API_BASE_MISSING',
  });
  assert.deepEqual(resolveApiBase({ isNative: true, envBase: '', override: '  ' }), {
    base: null,
    error: 'NATIVE_API_BASE_MISSING',
  });
  // An invalid override does not poison the fallback: native falls
  // through to the env default, web to relative '/api'.
  assert.deepEqual(resolveApiBase({ isNative: true, envBase: 'https://backend.example', override: 'not-a-url' }), {
    base: 'https://backend.example/api',
    error: null,
  });
});

test('apiBase override persistence: set / get / clear round-trips through localStorage', async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  const { getApiOverride, setApiOverride, clearApiOverride, getApiBase } = await import('../services/api.ts');
  assert.equal(getApiOverride(), null);
  setApiOverride('https://my-backend.example');
  assert.equal(getApiOverride(), 'https://my-backend.example');
  // On the web runtime the override wins over the relative default.
  assert.equal(getApiBase().base, 'https://my-backend.example/api');
  setApiOverride('   ');
  assert.equal(getApiOverride(), null, 'a blank override clears instead of persisting junk');
  setApiOverride('https://other.example/api');
  clearApiOverride();
  assert.equal(getApiOverride(), null);
  assert.equal(getApiBase().base, '/api');
});

function fakeResponse(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

test('apiBase client: a network failure is BACKEND_UNREACHABLE, distinct from wrong credentials', async () => {
  const { api } = await import('../services/api.ts');
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    throw new Error('network down');
  };
  await assert.rejects(
    () => api.get('/products'),
    (err: any) => {
      assert.equal(err.code, 'BACKEND_UNREACHABLE');
      assert.match(err.message, /Backend unreachable/);
      return true;
    },
  );
  assert.equal(calls, 3, 'idempotent GET retries boundedly before reporting unreachable');

  // An HTTP 401 is NOT unreachable: the backend was reached, the
  // credentials were wrong. It must keep its status, not the
  // unreachable code.
  (globalThis as any).fetch = async () => fakeResponse(401, { error: 'UNAUTHORIZED' });
  await assert.rejects(
    () => api.get('/products'),
    (err: any) => {
      assert.equal(err.status, 401);
      assert.notEqual(err.code, 'BACKEND_UNREACHABLE');
      return true;
    },
  );
});
