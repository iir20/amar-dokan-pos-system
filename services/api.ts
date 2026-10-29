// Phase 6 — API client with bounded retry and truthful connection state.
//
// RETRY RULE (money-safe): only idempotent requests (GET / DELETE) are
// retried automatically, at most API_MAX_ATTEMPTS total attempts with
// capped backoff (see shared/phase6.ts). A POST / PUT that fails is
// NEVER re-sent by this layer: re-sending a sale, expense or profile
// write could duplicate it. The caller shows the error with a Retry
// button instead, so the user re-issues the action deliberately.
// A retry that is still in flight reports 'reconnecting'; once it
// settles, the state is 'online' or 'offline' from navigator.onLine
// plus the outcome — never a stale 'online' during a failure storm.
import { API_MAX_ATTEMPTS, apiRetryDelayMs, isIdempotentMethod, isRetryableStatus } from '../shared/phase6';
import { isNativePlatform } from './native';

// Native backend connection (see docs/android.md "Backend connection").
//
// The old code used a relative '/api' base everywhere. That works only
// when the web app is served BY the backend itself. Inside a Capacitor
// WebView the app is loaded from local assets, so a relative /api
// points at nothing and login fails mysteriously. Resolution order,
// evaluated fresh on every request (so a Settings change applies
// without an app restart):
//   1. A user-set override persisted in Settings (localStorage
//      amar-api-base-override) — wins over everything.
//   2. A build-time default from VITE_API_BASE_URL (the backend
//      origin, e.g. the Render service URL) — used for native builds.
//      The CI workflow passes it through from the repository variable
//      of the same name; it is NEVER hardcoded here and NEVER a
//      localhost/dev URL in a release build.
//   3. Relative '/api' — ONLY for web builds served by the same server.
// A native build with neither an override nor an env default does NOT
// silently fall back to '/api': getApiBase() reports
// NATIVE_API_BASE_MISSING and request() throws API_BASE_NOT_CONFIGURED
// before any fetch, so the failure is visible at login/config time
// with a message that names the fix (Settings → Server address, or a
// rebuild with VITE_API_BASE_URL).

export const API_BASE_OVERRIDE_KEY = 'amar-api-base-override';
export const API_BASE_NOT_CONFIGURED_MESSAGE =
  'Server address is not configured. Open Settings → Server address and enter the backend URL, or rebuild the app with VITE_API_BASE_URL.';
export const API_BACKEND_UNREACHABLE_MESSAGE =
  'Backend unreachable. Check the server address in Settings and your connection, then try again.';

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Normalise a backend origin (or a full /api base) into an API base,
 * or null when the value is empty or not an http(s) URL. A trailing
 * '/api' is kept; otherwise '/api' is appended. A bare origin without
 * a scheme is rejected rather than guessed.
 */
export function normalizeApiBase(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return /\/api$/i.test(trimmed) ? trimmed : `${trimmed}/api`;
}

export type ApiBaseResolution = { base: string; error: null } | { base: null; error: 'NATIVE_API_BASE_MISSING' };

/**
 * Pure URL-resolution logic (unit-tested in tests/apiBase.test.ts):
 * override wins; otherwise a native build uses the env default;
 * otherwise a web build falls back to relative '/api'. A native build
 * with no override and no env default is an explicit error state,
 * never a silent relative fallback.
 */
export function resolveApiBase(input: {
  isNative: boolean;
  envBase?: string | null;
  override?: string | null;
}): ApiBaseResolution {
  const overrideBase = normalizeApiBase(input.override ?? null);
  if (overrideBase) return { base: overrideBase, error: null };
  if (input.isNative) {
    const env = normalizeApiBase(input.envBase ?? null);
    if (env) return { base: env, error: null };
    return { base: null, error: 'NATIVE_API_BASE_MISSING' };
  }
  return { base: '/api', error: null };
}

function readStoredOverride(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(API_BASE_OVERRIDE_KEY);
  } catch {
    return null;
  }
}

export function getApiOverride(): string | null {
  return readStoredOverride();
}

export function setApiOverride(value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const trimmed = value.trim();
    if (!trimmed) localStorage.removeItem(API_BASE_OVERRIDE_KEY);
    else localStorage.setItem(API_BASE_OVERRIDE_KEY, trimmed);
  } catch {
    // Storage unavailable (private mode, etc.): the override simply
    // does not persist; the in-memory request still uses the value
    // the caller passed via setApiOverride only if it re-reads — so
    // callers must surface a save failure, not assume persistence.
  }
}

export function clearApiOverride(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(API_BASE_OVERRIDE_KEY);
  } catch {}
}

function readEnvBase(): string | null {
  try {
    const fromVite = (import.meta as any).env?.VITE_API_BASE_URL;
    if (typeof fromVite === 'string' && fromVite.trim()) return fromVite;
  } catch {}
  try {
    const fromProcess = (globalThis as any).process?.env?.VITE_API_BASE_URL;
    if (typeof fromProcess === 'string' && fromProcess.trim()) return fromProcess;
  } catch {}
  return null;
}

/** Runtime resolution: override → env default (native) → relative (web). */
export function getApiBase(): ApiBaseResolution {
  return resolveApiBase({
    isNative: isNativePlatform(),
    envBase: readEnvBase(),
    override: readStoredOverride(),
  });
}

/** Human-readable API-base state for the Settings screen. */
export function getApiConfigError(): string | null {
  const resolved = getApiBase();
  return resolved.error === 'NATIVE_API_BASE_MISSING' ? API_BASE_NOT_CONFIGURED_MESSAGE : null;
}

export type ConnectionState = 'online' | 'offline' | 'reconnecting';

type ConnectionListener = (state: ConnectionState) => void;
const connectionListeners = new Set<ConnectionListener>();
let connectionState: ConnectionState = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online';

function setConnectionState(next: ConnectionState) {
  if (connectionState === next) return;
  connectionState = next;
  for (const listener of connectionListeners) listener(next);
}

export function getConnectionState(): ConnectionState {
  return connectionState;
}

export function subscribeConnection(listener: ConnectionListener): () => void {
  connectionListeners.add(listener);
  listener(connectionState);
  return () => {
    connectionListeners.delete(listener);
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setConnectionState('online'));
  window.addEventListener('offline', () => setConnectionState('offline'));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path: string, options: RequestInit = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const retryable = isIdempotentMethod(method);
  let lastError: any = null;

  // Fail visibly, before any network attempt, when a native build has
  // no configured backend. This error is NOT a connection-state
  // change: the device may be online while the app simply has nowhere
  // to send the request.
  const resolved = getApiBase();
  if (!resolved.base) {
    const error: any = new Error(API_BASE_NOT_CONFIGURED_MESSAGE);
    error.status = 0;
    error.code = 'API_BASE_NOT_CONFIGURED';
    throw error;
  }
  const BASE = resolved.base;

  for (let attempt = 1; attempt <= API_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...options,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        signal: controller.signal,
      });
      let body: any = null;
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (!res.ok) {
        const error: any = new Error(body?.message || body?.error || `Request failed (${res.status})`);
        error.status = res.status;
        error.body = body;
        // Retryable server/transient failures only, and only for
        // idempotent methods, and only while attempts remain.
        if (retryable && isRetryableStatus(res.status) && attempt < API_MAX_ATTEMPTS) {
          const retryAfter = Number(res.headers?.get?.('Retry-After'));
          setConnectionState('reconnecting');
          await sleep(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 2000)
              : apiRetryDelayMs(attempt),
          );
          lastError = error;
          continue;
        }
        setConnectionState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online');
        throw error;
      }
      setConnectionState('online');
      return body;
    } catch (cause) {
      if (cause instanceof Error && 'status' in cause) throw cause;
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      const error: any = new Error(
        offline
          ? 'You are offline. Nothing was sent — reconnect and try again.'
          : cause instanceof Error && cause.name === 'AbortError'
            ? 'The server did not respond in time. Check your connection and try again.'
            : API_BACKEND_UNREACHABLE_MESSAGE,
      );
      error.status = 0;
      // A network-level failure (no HTTP response at all) is a backend-
      // unreachable error, distinct from an HTTP error such as wrong
      // credentials (401), which carries its own status above.
      error.code = 'BACKEND_UNREACHABLE';
      error.cause = cause;
      // Network-level failure (no HTTP response at all): retry only
      // idempotent methods, bounded, with backoff.
      if (retryable && attempt < API_MAX_ATTEMPTS) {
        setConnectionState('reconnecting');
        await sleep(apiRetryDelayMs(attempt));
        lastError = error;
        continue;
      }
      // Wave 2 fix — truthful connection state: a final network failure
      // means the API is NOT reachable, even when the device radio
      // reports online (server down, captive portal, DNS failure). The
      // old code set 'online' here from navigator.onLine, so status UI
      // showed online while every request was failing. 'offline' here
      // means "no working connection to the API"; the next successful
      // request resets it to 'online'. HTTP error responses (server
      // reached) still report 'online' above.
      setConnectionState('offline');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export const api = {
  get: (path: string) => request(path, { method: 'GET' }),
  post: (path: string, data?: any) =>
    request(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: (path: string, data?: any) =>
    request(path, { method: 'PUT', body: data !== undefined ? JSON.stringify(data) : undefined }),
  del: (path: string) => request(path, { method: 'DELETE' }),
};
