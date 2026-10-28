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

const BASE = '/api';
const REQUEST_TIMEOUT_MS = 20_000;

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
          ? 'You are offline. Reconnect before saving changes; this action was not queued.'
          : cause instanceof Error && cause.name === 'AbortError'
            ? 'The server did not respond in time. Check your connection and try again.'
            : 'Could not reach the server. Check your connection and try again.',
      );
      error.status = 0;
      error.cause = cause;
      // Network-level failure (no HTTP response at all): retry only
      // idempotent methods, bounded, with backoff.
      if (retryable && attempt < API_MAX_ATTEMPTS) {
        setConnectionState('reconnecting');
        await sleep(apiRetryDelayMs(attempt));
        lastError = error;
        continue;
      }
      setConnectionState(offline ? 'offline' : 'online');
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
