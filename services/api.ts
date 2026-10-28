const BASE = '/api';
const REQUEST_TIMEOUT_MS = 20_000;

async function request(path: string, options: RequestInit = {}) {
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
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!res.ok) {
      const error: any = new Error(body?.message || body?.error || `Request failed (${res.status})`);
      error.status = res.status;
      error.body = body;
      throw error;
    }
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
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get: (path: string) => request(path, { method: 'GET' }),
  post: (path: string, data?: any) => request(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: (path: string, data?: any) => request(path, { method: 'PUT', body: data !== undefined ? JSON.stringify(data) : undefined }),
  del: (path: string) => request(path, { method: 'DELETE' }),
};
