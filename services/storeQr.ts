// Per-store Smart QR helpers — pure functions, unit-tested in
// tests/storeQr.test.ts. The QR encodes a URL whose path is
// /s/<storeCode>; the code is a random handle, never a sequential id,
// and never the internal store (owner) id.
//
// RESOLUTION RULE (server side, see server/routes.ts): the code is
// looked up exactly, case-sensitively, against users.store_code. An
// unknown code returns STORE_NOT_FOUND — never another store, never
// a list of stores. A scanned value that is not a /s/<code> URL
// parses to null here and the UI shows "not a store QR" instead of
// opening any store.

/** A store code is 8–64 URL-safe characters (generated codes are 16 hex chars). */
export function isValidStoreCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(code);
}

/** Extract the store code from a URL pathname such as /s/abc123def4567890, or null. */
export function extractStoreCodeFromPath(pathname: unknown): string | null {
  if (typeof pathname !== 'string') return null;
  const match = /^\/s\/([A-Za-z0-9_-]{8,64})\/?$/.exec(pathname.trim());
  return match ? match[1] : null;
}

/**
 * Parse scanned text into a store code, or null when it is not a
 * store QR URL. Accepts an absolute URL on any origin (the code is
 * origin-independent — the app resolves it against its own API) and
 * a bare /s/<code> path. Anything else — a table QR URL
 * (?tableId=…), plain text, a bare code with no /s/ path, or a URL
 * with extra path segments — is null: the scanner must never guess
 * a store from non-store content. Query parameters are ignored: the
 * path code is authoritative, so a tracked link to the same code
 * still resolves to that code's store.
 */
export function parseStoreQrUrl(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/s/')) return extractStoreCodeFromPath(trimmed);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  return extractStoreCodeFromPath(url.pathname);
}

/** Build the storefront URL for a code against an origin (no trailing slash on the origin). */
export function buildStoreQrUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/s/${code}`;
}

/** Generate a fresh store code: 16 hex chars (64 bits) from crypto randomness. */
export function generateStoreCode(): string {
  const cryptoObj = (globalThis as any).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error('Secure random generation is unavailable in this environment.');
  }
  const bytes = new Uint8Array(8);
  cryptoObj.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
