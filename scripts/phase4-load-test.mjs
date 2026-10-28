// Phase 4 load proof. Run against a TEST server (fresh data dir):
//   node scripts/phase4-load-test.mjs --base http://127.0.0.1:3451
// (a) 10 concurrent cashiers (one owner session, 10 parallel sales of
//     distinct products) — latency + success counts.
// (b) Last-unit contention: 10 parallel sales of qty 1 against stock 1
//     — exactly 1 must succeed, stock must end at 0, duplicate
//     deductions must be ZERO (any duplicate is a P0 stop).
// Two separate owners are used because the free plan caps at 10 sales
// per store per day; each part stays within its store's cap.
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const base = args[args.indexOf('--base') + 1] || 'http://127.0.0.1:3451';
const uid = (p) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

async function req(method, path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, setCookie: res.headers.get('set-cookie') };
}
const cookieFrom = (r) => (r.setCookie ? r.setCookie.split(';')[0] : null);

async function registerOwner(username) {
  const r = await req('POST', '/api/auth/register', { storeName: username, storeCategory: 'grocery', username, pin: '1111' });
  if (r.status !== 200) throw new Error(`register failed ${r.status} ${r.text}`);
  return { cookie: cookieFrom(r), user: r.json.user };
}
async function createProduct(owner, id, price, stock) {
  const r = await req('POST', '/api/products', { id, name: id, category: 'general', unit: 'pcs', price, cost: price - 10, stock }, owner.cookie);
  if (r.status !== 200) throw new Error(`product failed ${r.status} ${r.text}`);
  return r.json;
}
async function sale(owner, saleId, productId, qty, price) {
  const started = Date.now();
  const r = await req(
    'POST',
    '/api/sales',
    {
      id: saleId,
      items: [{ id: productId, quantity: qty, price }],
      paymentMethod: 'cash',
      paidAmount: qty * price,
      cashReceived: qty * price,
    },
    owner.cookie,
  );
  return { status: r.status, ms: Date.now() - started, body: r.json };
}
function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1],
  };
}

// (b) LAST-UNIT FIRST (1 success), so the free-plan daily cap is not hit.
const ownerLast = await registerOwner(uid('loadlast'));
const lastProd = await createProduct(ownerLast, uid('lastunit'), 100, 1);
const lastResults = await Promise.all(
  Array.from({ length: 10 }, (_, i) => sale(ownerLast, uid(`last-sale-${i}`), lastProd.id, 1, 100)),
);
const lastSuccess = lastResults.filter((r) => r.status === 200);
const lastFailCodes = {};
for (const r of lastResults.filter((x) => x.status !== 200)) lastFailCodes[r.body?.error || r.status] = (lastFailCodes[r.body?.error || r.status] || 0) + 1;
const afterLast = await req('GET', '/api/products', undefined, ownerLast.cookie);
const lastProdAfter = afterLast.json.find((p) => p.id === lastProd.id);
const salesAfter = await req('GET', '/api/sales', undefined, ownerLast.cookie);
const lastSales = salesAfter.json.filter((s) => (s.items || []).some((i) => i.id === lastProd.id));
console.log('LAST-UNIT: attempts=10 success=' + lastSuccess.length + ' failures=' + JSON.stringify(lastFailCodes));
console.log('LAST-UNIT: latency ms=' + JSON.stringify(stats(lastResults.map((r) => r.ms))));
console.log(`LAST-UNIT: stock 1 -> ${lastProdAfter.stock}; sales recorded for product: ${lastSales.length}; duplicate deductions: ${lastProdAfter.stock === 0 && lastSales.length === 1 ? 0 : 'MISMATCH'}`);
console.log(`LAST-UNIT VERDICT: ${lastSuccess.length === 1 && lastProdAfter.stock === 0 && lastSales.length === 1 ? 'PASS (zero duplicates)' : 'FAIL — P0 STOP'}`);

// (a) 10 CONCURRENT CASHIERS, distinct products.
const owner10 = await registerOwner(uid('load10'));
const products = [];
for (let i = 0; i < 10; i++) products.push(await createProduct(owner10, uid(`conc-${i}`), 50, 100));
const concResults = await Promise.all(products.map((p, i) => sale(owner10, uid(`conc-sale-${i}`), p.id, 1, 50)));
const concSuccess = concResults.filter((r) => r.status === 200);
console.log('CONCURRENT-10: attempts=10 success=' + concSuccess.length + ' failures=' + concResults.filter((r) => r.status !== 200).length);
console.log('CONCURRENT-10: latency ms=' + JSON.stringify(stats(concResults.map((r) => r.ms))));
const after10 = await req('GET', '/api/products', undefined, owner10.cookie);
const badStock = after10.json.filter((p) => products.some((q) => q.id === p.id) && p.stock !== 99);
console.log(`CONCURRENT-10 VERDICT: ${concSuccess.length === 10 && badStock.length === 0 ? 'PASS (each product 100 -> 99, no duplicates)' : 'FAIL'}`);
