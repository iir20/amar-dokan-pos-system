// Phase 2 — shared E2E helpers.
//
// All setup goes through the PUBLIC API (register / login / products /
// orders) with the page's own request context, so browser cookies from an
// API login are the same session the UI then uses. No test backdoors, no
// direct database access, no invented endpoints.

import { randomUUID } from 'node:crypto';
import type { Page, APIRequestContext } from '@playwright/test';

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function apiJson(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const res = await request.fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  // Playwright's APIResponse exposes status()/ok() as METHODS, not
  // properties — return plain numbers/booleans so callers cannot mistake
  // a function reference for a status code (that bug hid real failures).
  return { res, status: res.status(), ok: res.ok(), json, text };
}

export async function expectOk(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const { status, json, text } = await apiJson(request, method, path, body);
  if (status < 200 || status >= 300) throw new Error(`${method} ${path} -> ${status}: ${text}`);
  return json;
}

export type OwnerAccount = { username: string; pin: string; userId: string };

/** Register a fresh owner (free plan) and leave its session on this page. */
export async function registerOwner(
  page: Page,
  opts: { storeCategory?: string } = {},
): Promise<OwnerAccount> {
  const username = uid('e2eowner');
  const pin = '1234';
  const json = await expectOk(page.request, 'POST', '/api/auth/register', {
    storeName: `E2E Store ${username}`,
    storeCategory: opts.storeCategory || 'grocery',
    username,
    pin,
  });
  return { username, pin, userId: json.user.id };
}

export async function createProduct(
  page: Page,
  opts: { price: number; cost: number; stock: number; isOnlineVisible?: boolean; name?: string },
) {
  const id = `prod-${uid('p')}`;
  const name = opts.name || `E2E Product ${id.slice(-6)}`;
  const product = await expectOk(page.request, 'POST', '/api/products', {
    id,
    name,
    nameBn: name,
    category: 'general',
    unit: 'pcs',
    price: opts.price,
    cost: opts.cost,
    stock: opts.stock,
    isOnlineVisible: opts.isOnlineVisible !== false,
  });
  return product;
}

export async function getProducts(page: Page) {
  return expectOk(page.request, 'GET', '/api/products');
}

export async function getSales(page: Page) {
  return expectOk(page.request, 'GET', '/api/sales');
}

/** Log a fresh browser page in via the API, then load the app. */
export async function loginPage(page: Page, username: string, pin: string) {
  await expectOk(page.request, 'POST', '/api/auth/login', { username, pin });
  await page.goto('/');
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
