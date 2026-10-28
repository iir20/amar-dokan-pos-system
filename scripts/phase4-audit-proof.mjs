// Phase 4 live security-audit proof. Run against a TEST server only:
//   AMAR_DATA_DIR=/tmp/phase4-audit PORT=3451 AUTH_RATE_LIMIT_MAX=500 \
//     node --import tsx server/index.ts   (dev boot; see phase-4 report)
// then: node scripts/phase4-audit-proof.mjs --base http://127.0.0.1:3451 --mode main
// Modes: main | admin (server must be booted with
// PLATFORM_ADMIN_USER_IDS=<ownerA id from state file>) | ratelimit
// (server must be booted with the DEFAULT limiter, fresh data dir).
// Writes ids/credentials (dev-only test values) to /tmp/phase4-audit-state.json.
import fs from 'node:fs';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const base = args[args.indexOf('--base') + 1] || 'http://127.0.0.1:3451';
const mode = args[args.indexOf('--mode') + 1] || 'main';
const STATE = '/tmp/phase4-audit-state.json';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function req(method, path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, text, setCookie };
}

function cookieFrom(res) {
  if (!res.setCookie) return null;
  return res.setCookie.split(';')[0];
}

async function registerOwner(username) {
  const r = await req('POST', '/api/auth/register', {
    storeName: `Shop ${username}`,
    storeCategory: 'grocery',
    username,
    pin: '1111',
  });
  if (r.status !== 200) throw new Error(`register ${username} -> ${r.status} ${r.text}`);
  return { cookie: cookieFrom(r), user: r.json.user, username, pin: '1111' };
}

async function login(username, pin) {
  const r = await req('POST', '/api/auth/login', { username, pin });
  return { status: r.status, cookie: cookieFrom(r), json: r.json };
}

async function createStaff(owner, username, permissions) {
  const r = await req('POST', '/api/staff', { name: username, username, pin: '2222', permissions }, owner.cookie);
  if (r.status !== 200) throw new Error(`create staff ${username} -> ${r.status} ${r.text}`);
  return r.json;
}

async function createProduct(owner, id, price, cost, stock) {
  const r = await req(
    'POST',
    '/api/products',
    { id, name: `Product ${id}`, category: 'general', unit: 'pcs', price, cost, stock },
    owner.cookie,
  );
  if (r.status !== 200) throw new Error(`create product ${id} -> ${r.status} ${r.text}`);
  return r.json;
}

const uid = (p) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

if (mode === 'main') {
  const ownerA = await registerOwner(uid('p4ownera'));
  const ownerB = await registerOwner(uid('p4ownerb'));
  const prodA = await createProduct(ownerA, uid('prod-a'), 100, 80, 50);
  const prodB = await createProduct(ownerB, uid('prod-b'), 200, 150, 50);
  const staffSale = await createStaff(ownerA, uid('staffsale'), ['process_sale']);
  const staffSale2 = await createStaff(ownerA, uid('staffsale2'), ['process_sale']);
  const staffZero = await createStaff(ownerA, uid('staffzero'), []);
  const s1 = await login(staffSale.username, '2222');
  const s2 = await login(staffSale2.username, '2222');
  const s0 = await login(staffZero.username, '2222');
  check('staff login works', s1.status === 200 && s2.status === 200 && s0.status === 200);

  // 1. Cross-store reads/mutations
  const bProducts = await req('GET', '/api/products', undefined, ownerB.cookie);
  check('ownerB product list excludes ownerA product', !bProducts.json.some((p) => p.id === prodA.id));
  const bDelete = await req('DELETE', `/api/products/${prodA.id}`, undefined, ownerB.cookie);
  check('ownerB cannot delete ownerA product (404)', bDelete.status === 404, `got ${bDelete.status}`);
  const bHijack = await req(
    'POST',
    '/api/products',
    { id: prodA.id, name: 'Hijacked', category: 'general', unit: 'pcs', price: 1, cost: 1, stock: 1 },
    ownerB.cookie,
  );
  check('ownerB cannot overwrite ownerA product id (404)', bHijack.status === 404, `got ${bHijack.status} ${JSON.stringify(bHijack.json)}`);
  const bSales = await req('GET', '/api/sales', undefined, ownerB.cookie);
  check('ownerB sales list is empty (no cross-store sales)', Array.isArray(bSales.json) && bSales.json.length === 0);

  // 2. Staff permission boundaries
  const s1Products = await req('GET', '/api/products', undefined, s1.cookie);
  check('process_sale staff CAN list products (POS needs it)', s1Products.status === 200);
  const s0Products = await req('GET', '/api/products', undefined, s0.cookie);
  check('zero-permission staff CANNOT list products (403)', s0Products.status === 403, `got ${s0Products.status}`);
  const s0Sales = await req('GET', '/api/sales', undefined, s0.cookie);
  check('zero-permission staff CANNOT list sales (403)', s0Sales.status === 403, `got ${s0Sales.status}`);
  const s0Shift = await req('POST', '/api/shifts/open', { openingCash: 0 }, s0.cookie);
  check('zero-permission staff CANNOT open shift (403)', s0Shift.status === 403, `got ${s0Shift.status}`);
  const negShift = await req('POST', '/api/shifts/open', { openingCash: -50 }, ownerA.cookie);
  check('negative opening cash rejected (400)', negShift.status === 400, `got ${negShift.status}`);

  // 3. Shift close ownership
  const shift1 = await req('POST', '/api/shifts/open', { openingCash: 100 }, s1.cookie);
  check('staff1 opens shift', shift1.status === 201, `got ${shift1.status}`);
  const closeByOther = await req('POST', `/api/shifts/${shift1.json.id}/close`, { actualCash: 99999 }, s2.cookie);
  check('staff2 CANNOT close staff1 shift (403)', closeByOther.status === 403, `got ${closeByOther.status}`);
  const closeByOwner = await req('POST', `/api/shifts/${shift1.json.id}/close`, { actualCash: 100 }, ownerA.cookie);
  check('owner CAN close staff shift (200)', closeByOwner.status === 200, `got ${closeByOwner.status}`);

  // 4. Public cost leak + guest-order validation
  const menu = await req('GET', `/api/public/store/${ownerA.user.id}/menu`);
  check('public menu strips cost', menu.json.every((p) => !('cost' in p)));
  const search = await req('GET', `/api/marketplace/products?q=Product`);
  check('marketplace search strips cost', search.json.every((p) => !('cost' in p)));
  const table = await req('POST', '/api/restaurant/tables', { name: 'T1' }, ownerA.cookie);
  check('owner creates table', table.status === 200, `got ${table.status}`);
  const guestCross = await req('POST', '/api/public/guest-orders', {
    idempotencyKey: crypto.randomUUID(),
    tableId: table.json.id,
    items: [{ id: prodB.id, quantity: 1 }],
  });
  check('guest order with another store product rejected (409)', guestCross.status === 409, `got ${guestCross.status}`);
  const guestNeg = await req('POST', '/api/public/guest-orders', {
    idempotencyKey: crypto.randomUUID(),
    tableId: table.json.id,
    items: [{ id: prodA.id, quantity: -2 }],
  });
  check('guest order with negative qty rejected', guestNeg.status === 400 || guestNeg.status === 409, `got ${guestNeg.status}`);
  const guestOk = await req('POST', '/api/public/guest-orders', {
    idempotencyKey: crypto.randomUUID(),
    tableId: table.json.id,
    items: [{ id: prodA.id, quantity: 2 }],
  });
  check('guest order created', guestOk.status === 201, `got ${guestOk.status}`);
  check('guest order response strips cost', (guestOk.json.items || []).every((i) => !('cost' in i)));
  const guestGet = await req('GET', `/api/public/guest-orders/${guestOk.json.id}`);
  check('public guest-order read strips cost', (guestGet.json.items || []).every((i) => !('cost' in i)));
  const guestReplayDiff = await req('POST', '/api/public/guest-orders', {
    idempotencyKey: guestOk.json.id,
    tableId: table.json.id,
    items: [{ id: prodA.id, quantity: 3 }],
  });
  check('guest idempotency replay with different items rejected (409)', guestReplayDiff.status === 409, `got ${guestReplayDiff.status}`);
  const guestBadStatus = await req('PUT', `/api/restaurant/guest-orders/${guestOk.json.id}`, { status: 'bogus' }, ownerA.cookie);
  check('guest order garbage status rejected (400)', guestBadStatus.status === 400, `got ${guestBadStatus.status}`);

  // 5. Settlement validation + void terminality
  const settleNegVat = await req(
    'POST',
    `/api/restaurant/guest-orders/${guestOk.json.id}/settle`,
    { paymentMethod: 'cash', vatRate: -5 },
    ownerA.cookie,
  );
  check('settle with negative VAT rejected (400)', settleNegVat.status === 400, `got ${settleNegVat.status}`);
  const settleOk = await req(
    'POST',
    `/api/restaurant/guest-orders/${guestOk.json.id}/settle`,
    { paymentMethod: 'cash', paidAmount: 200, cashReceived: 200 },
    ownerA.cookie,
  );
  check('settle succeeds', settleOk.status === 200, `got ${settleOk.status} ${settleOk.text.slice(0, 200)}`);
  const voidServed = await req('POST', `/api/restaurant/guest-orders/${guestOk.json.id}/void`, { reason: 'test' }, ownerA.cookie);
  check('voiding a served order rejected (409)', voidServed.status === 409, `got ${voidServed.status}`);

  // 6. Marketplace: cross-store items, negative qty, idempotency, transitions
  const cust1 = await req('POST', '/api/customer/register', { name: 'Cust One', phone: '01700000001', pin: '3333' });
  const cust2 = await req('POST', '/api/customer/register', { name: 'Cust Two', phone: '01700000002', pin: '3333' });
  const c1 = cookieFrom(cust1);
  const c2 = cookieFrom(cust2);
  const mktKey = crypto.randomUUID();
  const mktNeg = await req(
    'POST',
    '/api/marketplace/orders',
    { storeId: ownerA.user.id, items: [{ id: prodA.id, quantity: -1 }], deliveryAddress: 'Dhaka', idempotencyKey: crypto.randomUUID() },
    c1,
  );
  check('marketplace negative qty rejected', mktNeg.status === 400 || mktNeg.status === 409, `got ${mktNeg.status}`);
  const mktCross = await req(
    'POST',
    '/api/marketplace/orders',
    { storeId: ownerA.user.id, items: [{ id: prodB.id, quantity: 1 }], deliveryAddress: 'Dhaka', idempotencyKey: crypto.randomUUID() },
    c1,
  );
  check('marketplace cross-store item rejected (404)', mktCross.status === 404, `got ${mktCross.status}`);
  const mktOk = await req(
    'POST',
    '/api/marketplace/orders',
    { storeId: ownerA.user.id, items: [{ id: prodA.id, quantity: 1 }], deliveryAddress: 'Dhaka', idempotencyKey: mktKey },
    c1,
  );
  check('marketplace order created', mktOk.status === 201, `got ${mktOk.status}`);
  const mktReplay = await req(
    'POST',
    '/api/marketplace/orders',
    { storeId: ownerA.user.id, items: [{ id: prodA.id, quantity: 1 }], deliveryAddress: 'Dhaka', idempotencyKey: mktKey },
    c2,
  );
  check('marketplace idempotency replay by another customer rejected (409)', mktReplay.status === 409, `got ${mktReplay.status}`);
  const c2Mine = await req('GET', '/api/marketplace/orders/mine', undefined, c2);
  check('customer2 order list excludes customer1 order', !c2Mine.json.some((o) => o.id === mktOk.json.id));
  const c2Read = await req('GET', `/api/marketplace/orders/${mktOk.json.id}`, undefined, c2);
  check('customer2 cannot read customer1 order (404)', c2Read.status === 404, `got ${c2Read.status}`);
  const skipTransition = await req('PUT', `/api/orders/${mktOk.json.id}/status`, { status: 'delivered' }, ownerA.cookie);
  check('placed -> delivered skip rejected (409)', skipTransition.status === 409, `got ${skipTransition.status}`);
  const toConfirmed = await req('PUT', `/api/orders/${mktOk.json.id}/status`, { status: 'confirmed' }, ownerA.cookie);
  const toOut = await req('PUT', `/api/orders/${mktOk.json.id}/status`, { status: 'out_for_delivery' }, ownerA.cookie);
  const toDelivered = await req('PUT', `/api/orders/${mktOk.json.id}/status`, { status: 'delivered' }, ownerA.cookie);
  check('valid lifecycle reaches delivered', toConfirmed.status === 200 && toOut.status === 200 && toDelivered.status === 200);
  const cancelDelivered = await req('PUT', `/api/orders/${mktOk.json.id}/status`, { status: 'cancelled' }, ownerA.cookie);
  check('delivered -> cancelled rejected (409, no double restock)', cancelDelivered.status === 409, `got ${cancelDelivered.status}`);

  // 7. Staff username collision now blocked at creation
  const dupName = uid('dupstaff');
  await createStaff(ownerA, dupName, ['process_sale']);
  const dupSecond = await req('POST', '/api/staff', { name: dupName, username: dupName, pin: '2222', permissions: ['process_sale'] }, ownerB.cookie);
  check('second owner cannot reuse staff username (409)', dupSecond.status === 409, `got ${dupSecond.status}`);

  // 8. Subscription status cannot be self-approved
  const subReq = await req('POST', '/api/subscription-requests', { package: 'monthly', amount: 100, paymentNumber: '01700000000', trxId: 'TRX1', status: 'approved' }, ownerA.cookie);
  check('subscription request forced to pending', subReq.json.status === 'pending', `got ${subReq.json.status}`);

  // 9. Session cookie flags (dev boot: HttpOnly yes, Secure only in production)
  const loginRes = await req('POST', '/api/auth/login', { username: ownerA.username, pin: '1111' });
  check('session cookie is HttpOnly', /httponly/i.test(loginRes.setCookie || ''), loginRes.setCookie || '(none)');

  fs.writeFileSync(STATE, JSON.stringify({ ownerA, ownerB, prodA, prodB, table: table.json }, null, 2));
  console.log(`\nmain: ${pass} pass, ${fail} fail — state written to ${STATE}`);
} else if (mode === 'admin') {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const adminLogin = await login(state.ownerA.username, state.ownerA.pin);
  check('admin login works', adminLogin.status === 200);
  const adminUsers = await req('GET', '/api/admin/users', undefined, adminLogin.cookie);
  check('platform admin CAN list users', adminUsers.status === 200, `got ${adminUsers.status}`);
  const nonAdmin = await login(state.ownerB.username, state.ownerB.pin);
  const nonAdminUsers = await req('GET', '/api/admin/users', undefined, nonAdmin.cookie);
  check('non-admin owner CANNOT list users (403)', nonAdminUsers.status === 403, `got ${nonAdminUsers.status}`);
  const selfDelete = await req('DELETE', `/api/admin/users/${state.ownerA.user.id}`, undefined, adminLogin.cookie);
  check('admin self-delete refused (403)', selfDelete.status === 403, `got ${selfDelete.status}`);
  const badUnlock = await req('POST', `/api/admin/users/${state.ownerB.user.id}/unlock`, {}, adminLogin.cookie);
  check('admin unlock without newPin rejected (400, not 500)', badUnlock.status === 400, `got ${badUnlock.status}`);
  const badPricing = await req('PUT', '/api/admin/pricing-config', 'not-an-object', adminLogin.cookie);
  check('admin pricing-config with non-object rejected (400)', badPricing.status === 400, `got ${badPricing.status}`);
  console.log(`\nadmin: ${pass} pass, ${fail} fail`);
} else if (mode === 'ratelimit') {
  const statuses = [];
  for (let i = 0; i < 15; i++) {
    const r = await req('POST', '/api/auth/login', { username: 'nobody-here', pin: '0000' });
    statuses.push(r.status);
  }
  console.log(`ratelimit statuses (15 bad logins, default limiter 12/15min): ${statuses.join(',')}`);
  check('13th+ attempt is rate-limited (429)', statuses.slice(12).every((s) => s === 429));
  check('first 12 attempts are not rate-limited', statuses.slice(0, 12).every((s) => s !== 429));
  console.log(`\nratelimit: ${pass} pass, ${fail} fail`);
}

if (fail > 0) process.exitCode = 1;
