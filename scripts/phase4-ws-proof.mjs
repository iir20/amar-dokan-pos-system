// Phase 4 WebSocket auth proof. Run against a TEST server:
//   node scripts/phase4-ws-proof.mjs --base http://127.0.0.1:3451
// (1) Unauthenticated socket claiming victim storeId receives NOTHING
//     when the victim sells (old code broadcast to all no-store clients).
// (2) Victim owner's authenticated socket DOES receive SALE_COMPLETED.
// (3) Another owner's authenticated socket claiming the victim store
//     receives NOTHING.
import WebSocket from 'ws';
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

const victim = await req('POST', '/api/auth/register', { storeName: 'victim', storeCategory: 'grocery', username: uid('victim'), pin: '1111' });
const other = await req('POST', '/api/auth/register', { storeName: 'other', storeCategory: 'grocery', username: uid('other'), pin: '1111' });
const vCookie = cookieFrom(victim);
const oCookie = cookieFrom(other);
const prod = await req('POST', '/api/products', { id: uid('vprod'), name: 'V Prod', category: 'general', unit: 'pcs', price: 60, cost: 40, stock: 20 }, vCookie);

function connect(cookie, storeIdQuery) {
  return new Promise((resolve) => {
    const url = base.replace('http', 'ws') + '/ws' + (storeIdQuery ? `?storeId=${storeIdQuery}` : '');
    const ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
    const events = [];
    ws.on('message', (d) => {
      try {
        events.push(JSON.parse(d.toString()));
      } catch {}
    });
    ws.on('open', () => setTimeout(() => resolve({ ws, events }), 900));
  });
}

const anon = await connect(null, victim.json.user.id);
const ownerSock = await connect(vCookie, null);
const otherSock = await connect(oCookie, victim.json.user.id);
const sale = await req('POST', '/api/sales', { id: uid('wsproof-sale'), items: [{ id: prod.json.id, quantity: 1, price: 60 }], paymentMethod: 'cash', paidAmount: 60, cashReceived: 60 }, vCookie);
await new Promise((r) => setTimeout(r, 900));
const hasSale = (e) => e.events.some((m) => m.type === 'SALE_COMPLETED');
console.log(`WS-PROOF: victim sale status=${sale.status}`);
console.log(`WS-PROOF: unauthenticated socket claiming victim store got SALE_COMPLETED: ${hasSale(anon)} (must be false)`);
console.log(`WS-PROOF: victim owner socket got SALE_COMPLETED: ${hasSale(ownerSock)} (must be true)`);
console.log(`WS-PROOF: other owner socket claiming victim store got SALE_COMPLETED: ${hasSale(otherSock)} (must be false)`);
console.log(`WS-PROOF VERDICT: ${!hasSale(anon) && hasSale(ownerSock) && !hasSale(otherSock) ? 'PASS' : 'FAIL'}`);
for (const s of [anon, ownerSock, otherSock]) s.ws.close();
process.exit(!hasSale(anon) && hasSale(ownerSock) && !hasSale(otherSock) ? 0 : 1);
