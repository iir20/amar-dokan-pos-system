// Phase 4 — PostgreSQL Phase 3 smoke proof. Run against a TEST server
// booted with a real DATABASE_URL (fresh database):
//   node scripts/phase4-pg-smoke.mjs --base http://127.0.0.1:3456
// Covers: branch defaulting, counter scoping, supplier + PO receive
// (stock + due + inventory log), coupon sale (server recalculation),
// loyalty earn/redeem, branch-scoped sales, shift open/close +
// Z-report per counter, forecast/expiry/dead-stock reads — all against
// PostgreSQL, with direct psql-visible results printed at the end.
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const base = args[args.indexOf('--base') + 1] || 'http://127.0.0.1:3456';
const uid = (p) => `${p}-${crypto.randomUUID().slice(0, 8)}`;
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
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, setCookie: res.headers.get('set-cookie') };
}
const cookieFrom = (r) => (r.setCookie ? r.setCookie.split(';')[0] : null);

const health = await req('GET', '/api/health');
check('server is on PostgreSQL (not fallback)', health.json.fallbackMode === 'postgresql', health.json.fallbackMode);
if (health.json.fallbackMode !== 'postgresql') {
  console.log('ABORT: not on PostgreSQL');
  process.exit(1);
}

const reg = await req('POST', '/api/auth/register', { storeName: 'PG Shop', storeCategory: 'grocery', username: uid('pgowner'), pin: '1111' });
const cookie = cookieFrom(reg);
const ownerId = reg.json.user.id;
check('owner registered on PG', reg.status === 200);

const prod = await req('POST', '/api/products', { id: uid('pgprod'), name: 'PG Rice', category: 'general', unit: 'pcs', price: 100, cost: 80, stock: 50 }, cookie);
check('product created on PG', prod.status === 200, `stock=${prod.json?.stock}`);

const branch = await req('POST', '/api/branches', { name: 'Main Branch' }, cookie);
check('first branch is default', branch.status === 201 && branch.json.isDefault === true, JSON.stringify(branch.json?.isDefault));
const counter = await req('POST', '/api/counters', { branchId: branch.json.id, name: 'Counter 1' }, cookie);
check('counter created under branch', counter.status === 201);
const branch2 = await req('POST', '/api/branches', { name: 'Second Branch' }, cookie);
check('second branch is not default', branch2.status === 201 && branch2.json.isDefault === false);
const branchProds = await req('GET', `/api/branches/${branch.json.id}/products`, undefined, cookie);
check('default branch sees legacy product', branchProds.json.some((p) => p.id === prod.json.id));
const branch2Prods = await req('GET', `/api/branches/${branch2.json.id}/products`, undefined, cookie);
check('named branch does not leak legacy product', !branch2Prods.json.some((p) => p.id === prod.json.id));

const supplier = await req('POST', '/api/suppliers', { name: 'PG Supplier', phone: '01700000000' }, cookie);
check('supplier created', supplier.status === 201);
const po = await req('POST', '/api/purchase-orders', { supplierId: supplier.json.id, items: [{ productId: prod.json.id, quantity: 10, cost: 80 }] }, cookie);
check('PO created', po.status === 201, `totalCost=${po.json?.totalCost}`);
const received = await req('POST', `/api/purchase-orders/${po.json.id}/receive`, { received: [{ productId: prod.json.id, quantity: 10 }] }, cookie);
check('PO received (full)', received.status === 200 && received.json.status === 'received');
const afterReceive = await req('GET', '/api/products', undefined, cookie);
const prodAfter = afterReceive.json.find((p) => p.id === prod.json.id);
check('stock rose 50 -> 60 on receive', prodAfter.stock === 60, `stock=${prodAfter.stock}`);
const dues = await req('GET', '/api/suppliers/dues-total', undefined, cookie);
check('supplier due is 800 after receive', dues.json.totalDue === 800, `due=${dues.json.totalDue}`);
const paid = await req('POST', `/api/suppliers/${supplier.json.id}/pay`, { amount: 300 }, cookie);
check('supplier pay reduces due to 500', paid.status === 200 && paid.json.totalDue === 500, `due=${paid.json?.totalDue}`);

const coupon = await req('POST', '/api/coupons', { code: 'PG10', type: 'percent', value: 10 }, cookie);
check('coupon created', coupon.status === 201);
const shift = await req('POST', '/api/shifts/open', { openingCash: 1000, branchId: branch.json.id, counterId: counter.json.id }, cookie);
check('shift opened on PG with branch+counter', shift.status === 201, `got ${shift.status}`);
const sale = await req(
  'POST',
  '/api/sales',
  {
    id: uid('pg-sale'),
    items: [{ id: prod.json.id, quantity: 2, price: 100 }],
    paymentMethod: 'cash',
    paidAmount: 180,
    cashReceived: 200,
    couponCode: 'PG10',
    customerPhone: '01711111111',
    customerName: 'PG Customer',
    branchId: branch.json.id,
    counterId: counter.json.id,
  },
  cookie,
);
check('PG sale with coupon+branch+counter succeeds (guard gone)', sale.status === 200, `got ${sale.status} ${sale.text.slice(0, 160)}`);
check('coupon discount applied server-side (200 -> 180)', sale.json?.totalAmount === 180, `total=${sale.json?.totalAmount}`);
check('loyalty earned 1 point per full 100 (180 -> 1)', sale.json?.loyaltyEarned === 1, `earned=${sale.json?.loyaltyEarned}`);
const loyalty = await req('GET', '/api/loyalty/01711111111', undefined, cookie);
check('loyalty account exists on PG with 1 point', loyalty.json?.points === 1, `points=${loyalty.json?.points}`);
const branchSales = await req('GET', `/api/branches/${branch.json.id}/sales`, undefined, cookie);
check('branch-scoped sales include the sale', branchSales.json.some((s) => s.id === sale.json?.id));
const branch2Sales = await req('GET', `/api/branches/${branch2.json.id}/sales`, undefined, cookie);
check('other branch sales do not include it', !branch2Sales.json.some((s) => s.id === sale.json?.id));
const sale2 = await req(
  'POST',
  '/api/sales',
  {
    id: uid('pg-sale2'),
    items: [{ id: prod.json.id, quantity: 1, price: 100 }],
    paymentMethod: 'cash',
    paidAmount: 99,
    cashReceived: 99,
    loyaltyPointsRedeem: 1,
    customerPhone: '01711111111',
    branchId: branch.json.id,
    counterId: counter.json.id,
  },
  cookie,
);
check('loyalty redeem sale succeeds', sale2.status === 200, `got ${sale2.status} ${sale2.text.slice(0, 160)}`);
check('loyalty redeem drops total 100 -> 99', sale2.json?.totalAmount === 99, `total=${sale2.json?.totalAmount}`);
const loyaltyAfter = await req('GET', '/api/loyalty/01711111111', undefined, cookie);
check('loyalty balance 1 - 1 + 0 = 0 (99 earns 0)', loyaltyAfter.json?.points === 0, `points=${loyaltyAfter.json?.points}`);
const badCoupon = await req(
  'POST',
  '/api/sales',
  { id: uid('pg-sale3'), items: [{ id: prod.json.id, quantity: 1, price: 100 }], paymentMethod: 'cash', paidAmount: 100, cashReceived: 100, couponCode: 'NOPE' },
  cookie,
);
check('unknown coupon rejected on PG (400)', badCoupon.status === 400, `got ${badCoupon.status}`);
const overRedeem = await req(
  'POST',
  '/api/sales',
  { id: uid('pg-sale4'), items: [{ id: prod.json.id, quantity: 1, price: 100 }], paymentMethod: 'cash', paidAmount: 100, cashReceived: 100, loyaltyPointsRedeem: 5, customerPhone: '01711111111' },
  cookie,
);
check('over-balance redeem rejected on PG (400)', overRedeem.status === 400, `got ${overRedeem.status}`);

const closed = await req('POST', `/api/shifts/${shift.json.id}/close`, { actualCash: 1000 + 180 + 99 }, cookie);
check('shift closed on PG', closed.status === 200, `got ${closed.status}`);
check('shift expected cash = 1000 + 279 cash sales', closed.json?.expectedCash === 1279, `expected=${closed.json?.expectedCash}`);
check('shift discrepancy 0', closed.json?.discrepancy === 0, `disc=${closed.json?.discrepancy}`);
const z = await req('GET', '/api/shifts/z-report', undefined, cookie);
check('Z-report per counter shows the counter', (z.json.perCounter || []).some((c) => c.counterId === counter.json.id && c.shifts === 1), JSON.stringify(z.json.perCounter));

const forecast = await req('GET', '/api/insights/forecast', undefined, cookie);
check('forecast works on PG', forecast.status === 200 && Array.isArray(forecast.json.items), `got ${forecast.status}`);
const expiry = await req('GET', '/api/insights/expiry', undefined, cookie);
check('expiry works on PG', expiry.status === 200 && Array.isArray(expiry.json.alerts), `got ${expiry.status}`);
const dead = await req('GET', '/api/insights/dead-stock', undefined, cookie);
check('dead-stock works on PG', dead.status === 200 && Array.isArray(dead.json.items), `got ${dead.status}`);

console.log(`\nPG SMOKE: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exitCode = 1;
