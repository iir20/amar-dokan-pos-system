// Phase 4 failure drills. Run against a TEST server (fresh data dir):
//   node scripts/phase4-failure-drill.mjs --base http://127.0.0.1:3451 --mode ws
//   node scripts/phase4-failure-drill.mjs --base http://127.0.0.1:3452 --mode dboutage
// ws: kill the socket mid-order — order must stay pending (no phantom
//     completion), settle afterwards must succeed exactly once, and a
//     later sale must still broadcast (server did not crash).
// dboutage: run against a server booted with an UNREACHABLE DATABASE_URL
//     (e.g. postgres://127.0.0.1:59999/amar). A sale must still record
//     to the durable fallback with zero loss across a restart. What this
//     does NOT prove (no real PG here): outbox replay into PostgreSQL —
//     that stays UNVERIFIED until staging (see phase-4 report).
import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';

const args = process.argv.slice(2);
const base = args[args.indexOf('--base') + 1] || 'http://127.0.0.1:3451';
const mode = args[args.indexOf('--mode') + 1] || 'ws';
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

if (mode === 'ws') {
  const reg = await req('POST', '/api/auth/register', { storeName: 'ws-shop', storeCategory: 'grocery', username: uid('wsowner'), pin: '1111' });
  const cookie = cookieFrom(reg);
  const ownerId = reg.json.user.id;
  const prod = await req('POST', '/api/products', { id: uid('wsprod'), name: 'WS Prod', category: 'general', unit: 'pcs', price: 100, cost: 80, stock: 10 }, cookie);
  const table = await req('POST', '/api/restaurant/tables', { name: 'WT1' }, cookie);

  const wsUrl = base.replace('http', 'ws') + '/ws';
  const ws = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
  const connected = await new Promise((resolve) => {
    ws.on('message', (d) => {
      try {
        const m = JSON.parse(d.toString());
        if (m.type === 'CONNECTED') resolve(m);
      } catch {}
    });
    setTimeout(() => resolve(null), 3000);
  });
  console.log('WS connected ack:', JSON.stringify(connected));
  const order = await req('POST', '/api/public/guest-orders', {
    idempotencyKey: crypto.randomUUID(),
    tableId: table.json.id,
    items: [{ id: prod.json.id, quantity: 1 }],
  });
  console.log('WS-DRILL: guest order created, status=' + order.json.status);
  // Kill the socket MID-ORDER (before settlement).
  ws.terminate();
  await new Promise((r) => setTimeout(r, 500));
  const mid = await req('GET', `/api/public/guest-orders/${order.json.id}`);
  console.log(`WS-DRILL: after socket kill, order status=${mid.json.status} (must be pending — no phantom completion)`);
  const settle = await req('POST', `/api/restaurant/guest-orders/${order.json.id}/settle`, { paymentMethod: 'cash', paidAmount: 100, cashReceived: 100 }, cookie);
  console.log(`WS-DRILL: settle after kill status=${settle.status} (must be 200, no lost paid order)`);
  const after = await req('GET', `/api/public/guest-orders/${order.json.id}`);
  console.log(`WS-DRILL: final order status=${after.json.status} (must be served)`);
  // Server still alive + broadcasts: reconnect and sell.
  const ws2 = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
  const events = [];
  ws2.on('message', (d) => {
    try {
      events.push(JSON.parse(d.toString()));
    } catch {}
  });
  await new Promise((r) => setTimeout(r, 800));
  const sale = await req('POST', '/api/sales', { id: uid('ws-sale'), items: [{ id: prod.json.id, quantity: 1, price: 100 }], paymentMethod: 'cash', paidAmount: 100, cashReceived: 100 }, cookie);
  await new Promise((r) => setTimeout(r, 800));
  console.log(`WS-DRILL: post-kill sale status=${sale.status}; broadcast SALE_COMPLETED received on reconnected socket: ${events.some((e) => e.type === 'SALE_COMPLETED')}`);
  console.log(`WS-DRILL VERDICT: ${mid.json.status === 'pending' && settle.status === 200 && after.json.status === 'served' && events.some((e) => e.type === 'SALE_COMPLETED') ? 'PASS' : 'FAIL'}`);
  ws2.close();
  process.exit(0);
}

if (mode === 'dboutage') {
  const health = await req('GET', '/api/health');
  console.log('DBOUTAGE: health fallbackMode=' + health.json.fallbackMode + ' database=' + health.json.database + ' outboxDepth=' + health.json.outboxDepth);
  const reg = await req('POST', '/api/auth/register', { storeName: 'outage-shop', storeCategory: 'grocery', username: uid('dbowner'), pin: '1111' });
  const cookie = cookieFrom(reg);
  const prod = await req('POST', '/api/products', { id: uid('dbprod'), name: 'DB Prod', category: 'general', unit: 'pcs', price: 70, cost: 50, stock: 5 }, cookie);
  const sale = await req('POST', '/api/sales', { id: uid('db-sale'), items: [{ id: prod.json.id, quantity: 1, price: 70 }], paymentMethod: 'cash', paidAmount: 70, cashReceived: 70 }, cookie);
  console.log(`DBOUTAGE: sale during outage status=${sale.status} total=${sale.json?.totalAmount} (must be 200 via fallback)`);
  const health2 = await req('GET', '/api/health');
  console.log(`DBOUTAGE: after sale outboxDepth=${health2.json.outboxDepth} fallbackSnapshotExists=${health2.json.fallbackSnapshotExists}`);
  console.log('DBOUTAGE: restart the server with the SAME AMAR_DATA_DIR and re-run with --mode dboutage-check --sale <id> to verify zero loss.');
  if (process.env.SALE_ID) console.log('SALE_ID=' + process.env.SALE_ID);
  console.log(JSON.stringify({ saleId: sale.json?.id, productId: prod.json.id }));
}
