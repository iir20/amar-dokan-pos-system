// Phase 4 — shared session configuration.
//
// The session secret and the session store used to live inside
// registerRoutes() in server/routes.ts, which meant the WebSocket layer
// (server/live.ts) could not verify a browser session at all: any client
// could claim any storeId on the socket and receive that store's live
// sale/order events. Moving the secret + store here lets live.ts unsign
// the session cookie and look the session up in the SAME store the HTTP
// routes use, so a socket is only ever subscribed to the store its
// session belongs to. Unauthenticated sockets receive no store events.
//
// The production rule is unchanged from Phase 1: production refuses to
// boot without a SESSION_SECRET of at least 32 characters. In
// development only, a process-random secret is used (sessions do not
// survive a dev restart, by design).
import crypto from 'node:crypto';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool, getDbStatus } from './db';

const PgSession = connectPgSimple(session);

let sessionSecret: string | null = null;
let sessionStore: session.Store | null = null;

export function getSessionSecret(): string {
  if (sessionSecret) return sessionSecret;
  const configured = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production' && (!configured || configured.length < 32)) {
    throw new Error(
      'SESSION_SECRET must be set to at least 32 characters in production — refusing to boot with a default secret.',
    );
  }
  sessionSecret = configured || crypto.randomBytes(32).toString('hex');
  if (!configured) {
    console.warn(
      '[AmarDokan] SESSION_SECRET not set — using a process-random development secret (sessions will not survive restart).',
    );
  }
  return sessionSecret;
}

// Phase 4 (outage continuity): when PostgreSQL is the session store,
// a database outage used to break ALL authenticated traffic —
// PgSession errors propagate through express-session as 500s, even
// though the data layer itself falls back to the durable store. That
// made the "sell during a database outage" story false for logged-in
// users. FallbackSessionStore wraps the PG store with an in-memory
// store: reads try PostgreSQL first and fall through to memory on
// error or miss (so sessions created during an outage keep working
// after it), writes go to PostgreSQL when it is up and to memory when
// it is not, and destroy clears both. Sessions created during an
// outage live only in this process's memory — they do not survive a
// restart — which matches the development-secret behavior and is the
// honest price of outage continuity.
type StoreCallback<T = any> = (err?: any, result?: T) => void;

class FallbackSessionStore extends session.Store {
  private memory = new session.MemoryStore();

  constructor(private primary: session.Store) {
    super();
  }

  get(sid: string, fn: StoreCallback<session.SessionData | null>) {
    this.primary.get(sid, (err: any, sess: any) => {
      if (!err && sess) return fn(null, sess);
      this.memory.get(sid, (memoryErr: any, memorySess: any) => fn(memoryErr || null, memorySess ?? null));
    });
  }

  set(sid: string, sess: session.SessionData, fn?: StoreCallback) {
    this.primary.set(sid, sess, (err: any) => {
      if (err) {
        this.memory.set(sid, sess, fn);
      } else {
        // Best-effort mirror so a session created just before an
        // outage is still readable while PostgreSQL is down.
        this.memory.set(sid, sess, () => {});
        if (fn) fn(null);
      }
    });
  }

  destroy(sid: string, fn?: StoreCallback) {
    // Best-effort by design: express-session's regenerate() rejects the
    // whole login/registration when destroy reports an error, so a dead
    // PostgreSQL must never fail a destroy — if either store cleared
    // the id, the session is gone. Errors are swallowed deliberately.
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending === 0 && fn) fn(null);
    };
    this.primary.destroy(sid, done);
    this.memory.destroy(sid, done);
  }

  touch(sid: string, sess: session.SessionData, fn?: StoreCallback) {
    if (typeof (this.primary as any).touch === 'function') {
      (this.primary as any).touch(sid, sess, (err: any) => {
        if (err) {
          if (typeof (this.memory as any).touch === 'function') (this.memory as any).touch(sid, sess, fn);
          else if (fn) fn(err);
        } else if (fn) {
          fn(null);
        }
      });
    } else if (fn) {
      fn(null);
    }
  }

  all(fn: StoreCallback<session.SessionData[]>) {
    (this.primary as any).all((err: any, sessions: any) => {
      if (err) (this.memory as any).all(fn);
      else fn(null, sessions);
    });
  }

  clear(fn?: StoreCallback) {
    (this.primary as any).clear((err: any) => {
      (this.memory as any).clear(() => {
        if (fn) fn(err || null);
      });
    });
  }

  length(fn: StoreCallback<number>) {
    (this.primary as any).length((err: any, len: any) => {
      if (err) (this.memory as any).length(fn);
      else fn(null, len);
    });
  }
}

// Must be called after the boot database probe (server/index.ts probes
// before registering routes), so the store choice reflects probed state.
export function getSessionStore(): session.Store {
  if (sessionStore) return sessionStore;
  sessionStore =
    pool && getDbStatus().connected
      ? new FallbackSessionStore(new PgSession({ pool, createTableIfMissing: true }))
      : new session.MemoryStore();
  return sessionStore;
}
