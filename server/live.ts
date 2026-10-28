// Phase 4 — AmarLive WebSocket layer, session-authenticated.
//
// HISTORY OF THE HOLE (fixed here): previously any socket client could
// pass ?storeId=<any store> (or send {action:'join', storeId}) and the
// server broadcast every store's SALE_COMPLETED / NEW_ORDER events to
// any client with no storeId at all (`if (!client.storeId || ...)`).
// An unauthenticated observer therefore received other stores' live
// sales data. That fallback is removed.
//
// Now: on connection the server unsigns the `connect.sid` session cookie
// (same cookie the HTTP routes use) and looks the session up in the
// shared session store. The socket is subscribed ONLY to the store its
// session belongs to (owner userId, or a staff member's ownerId).
// A query/join storeId that does not match the session's store is
// ignored. Unauthenticated sockets stay connected for the handshake
// ack but receive no store events. Customer sessions have no store and
// likewise receive no store events.
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import crypto from 'node:crypto';
import { getSessionSecret, getSessionStore } from './sessionConfig';

export type AmarLiveEvent = {
  type: 'NEW_ORDER' | 'ORDER_STATUS_CHANGED' | 'STOCK_ADJUSTED' | 'SALE_COMPLETED' | 'TABLE_UPDATED' | 'ANNOUNCEMENT';
  storeId: string;
  payload: any;
  timestamp: string;
};

interface ClientMeta {
  ws: WebSocket;
  storeId?: string;
  room?: string;
  isAlive: boolean;
}

const clients = new Set<ClientMeta>();

let wss: WebSocketServer | null = null;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// cookie-signature's unsign, implemented directly so this module does
// not depend on an undeclared transitive package: express-session signs
// the session id as 's:<id>.<hmac-sha256-base64-no-padding>'.
function unsignSessionId(cookieValue: string, secret: string): string | null {
  if (!cookieValue.startsWith('s:')) return null;
  const signed = cookieValue.slice(2);
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const signature = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret).update(value).digest('base64').replace(/=+$/, '');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try {
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return value;
}

function sessionStoreId(session: any): string | null {
  if (!session) return null;
  // Owner sessions: userId IS the store id. Staff sessions: userId is
  // the owning store id. Customer sessions carry no userId.
  if ((session.role === 'owner' || session.role === 'staff') && typeof session.userId === 'string') {
    return session.userId;
  }
  return null;
}

function lookupSessionStoreId(req: { headers: Record<string, string | string[] | undefined> }): Promise<string | null> {
  return new Promise((resolve) => {
    const raw = req.headers.cookie;
    const cookieHeader = Array.isArray(raw) ? raw.join('; ') : raw;
    const cookies = parseCookies(cookieHeader);
    const rawSid = cookies['connect.sid'];
    if (!rawSid) return resolve(null);
    let sessionId: string | null;
    try {
      sessionId = unsignSessionId(rawSid, getSessionSecret());
    } catch {
      return resolve(null);
    }
    if (!sessionId) return resolve(null);
    try {
      getSessionStore().get(sessionId, (_err: any, sess: any) => {
        resolve(sessionStoreId(sess));
      });
    } catch {
      resolve(null);
    }
  });
}

export function setupAmarLive(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: any) => {
    const room = 'general';
    const client: ClientMeta = { ws, storeId: undefined, room, isAlive: true };
    clients.add(client);

    // Authenticate asynchronously; until it resolves the socket is
    // subscribed to nothing, so no event can leak in the meantime.
    void lookupSessionStoreId(req).then((authorizedStoreId) => {
      if (ws.readyState !== WebSocket.OPEN) {
        clients.delete(client);
        return;
      }
      client.storeId = authorizedStoreId || undefined;
      try {
        ws.send(
          JSON.stringify({
            type: 'CONNECTED',
            message: 'AmarLive real-time connected',
            storeId: client.storeId || null,
            authenticated: authorizedStoreId !== null,
            room,
          }),
        );
      } catch {}
    });

    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // A join may only re-affirm the session's own store — never
        // claim a different one.
        if (msg.action === 'join' && typeof msg.storeId === 'string' && msg.storeId === client.storeId) {
          client.room = msg.room || client.room;
        }
      } catch {}
    });

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.on('error', () => {
      clients.delete(client);
    });
  });

  // Heartbeat interval to prune stale connections
  const interval = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        client.ws.terminate();
        clients.delete(client);
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}

export function broadcastToStore(storeId: string, event: Omit<AmarLiveEvent, 'storeId' | 'timestamp'>) {
  if (!wss) return;
  const fullEvent: AmarLiveEvent = {
    ...event,
    storeId,
    timestamp: new Date().toISOString(),
  };
  const payloadStr = JSON.stringify(fullEvent);

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      // Phase 4 fix: only sockets authenticated to THIS store receive
      // its events. The old `!client.storeId` fallback broadcast every
      // store's events to unauthenticated listeners.
      if (client.storeId === storeId) {
        client.ws.send(payloadStr);
      }
    }
  }
}

export function getLiveClientsCount(storeId?: string): number {
  if (!storeId) return clients.size;
  let count = 0;
  for (const client of clients) {
    if (client.storeId === storeId && client.ws.readyState === WebSocket.OPEN) {
      count++;
    }
  }
  return count;
}
