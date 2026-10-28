import type { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import { Storage, genId, DEFAULT_GLOBAL_PRICING, LIMITS, StorageRuleError, isPlatformAdminId } from './storage';
import { hashPin, verifyPin } from './credentials';
import { pool, getDbStatus, pingDatabase } from './db';
import { getSessionSecret, getSessionStore } from './sessionConfig';
import { publicProductList, publicGuestOrderView } from './publicView';
import {
  gatewayCallbacksEnabled,
  gatewaySecret,
  verifyCallbackSignature,
  createGatewayIntent,
  applyGatewayCallback,
  createGatewayRefund,
  listGatewayIntents,
  getGatewayIntent,
  reconcileGatewayVsLedger,
  GatewayError,
} from './gateway';
import { getOutboxDepth, snapshotExists, replayOutbox, getLastBackup, recordBackupExport } from './durableStore';
import { errorTrackingStatus } from './errorTracking';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { broadcastToStore } from './live';
import { z } from 'zod';

declare module 'express-session' {
  interface SessionData {
    role?: 'owner' | 'staff' | 'customer';
    userId?: string;
    staffId?: string;
    staffName?: string;
    customerId?: string;
  }
}

function requireAuth(roles: Array<'owner' | 'staff' | 'customer'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.role || !roles.includes(req.session.role)) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    next();
  };
}

function requirePermission(...required: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.session.role === 'owner' && req.session.userId) return next();
    if (req.session.role !== 'staff' || !req.session.userId || !req.session.staffId) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const staffMember = await Storage.getStaffById(req.session.staffId);
    if (!staffMember || staffMember.ownerId !== req.session.userId) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    if (!required.some((permission) => staffMember.permissions.includes(permission))) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    next();
  };
}

// resolves the storeId that owns the data being accessed, for both owner and staff sessions
async function currentStoreId(req: Request): Promise<string | null> {
  if (req.session.role === 'owner' && req.session.userId) return req.session.userId;
  if (req.session.role === 'staff' && req.session.userId) return req.session.userId;
  return null;
}

const authRateBuckets = new Map<string, { count: number; resetAt: number }>();
const ALLOWED_STAFF_PERMISSIONS = new Set([
  'manage_inventory',
  'view_reports',
  'manage_settings',
  'manage_staff',
  'process_sale',
  'manage_expenses',
  'manage_restaurant',
]);

function configuredPercent(name: string, defaultValue: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? defaultValue : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be a number between 0 and 100.`);
  }
  return value;
}

function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const windowMs = Math.max(60_000, Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60_000);
  const maxAttempts = Math.max(1, Number(process.env.AUTH_RATE_LIMIT_MAX) || 12);
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  let bucket = authRateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    authRateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > maxAttempts) {
    res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
    return res.status(429).json({ error: 'AUTH_RATE_LIMITED' });
  }
  if (authRateBuckets.size > 10_000) {
    for (const [bucketKey, value] of authRateBuckets) {
      if (value.resetAt <= now) authRateBuckets.delete(bucketKey);
    }
  }
  next();
}

function establishSession(
  req: Request,
  details: Pick<session.SessionData, 'role' | 'userId' | 'staffId' | 'staffName' | 'customerId'>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      Object.assign(req.session, details);
      req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

function publicUser(user: any) {
  const { pin: _pin, ...safeUser } = user;
  return { ...safeUser, isPlatformAdmin: isPlatformAdminId(user.id) };
}

export function registerRoutes(app: Express) {
  app.set('trust proxy', 1);
  // Phase 1 fix (P0-3), moved to server/sessionConfig.ts in Phase 4 so
  // the WebSocket layer can verify the same sessions: production
  // REFUSES to boot without a real secret; development uses a
  // process-random secret. The store choice reflects the probed DB
  // state (server/index.ts probes before registering routes).
  const sessionSecret = getSessionSecret();
  const sessionStore = getSessionStore();

  app.use(
    session({
      store: sessionStore,
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );

  const api = (path: string) => `/api${path}`;

  // =========================================================
  // PHASE 2 — BROWSABLE API DOCS (generated static page + raw spec)
  // =========================================================
  // docs/api.html is generated from server/openapi.json by
  // `npm run docs:api` (scripts/generate-api-docs.mjs) and committed, so
  // the docs page works offline with no CDN and no JS framework. The raw
  // spec is served live so tooling can fetch it from a running server.
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  app.get('/docs', (_req, res) => {
    const docPath = path.join(serverDir, '..', 'docs', 'api.html');
    if (!fs.existsSync(docPath)) {
      return res.status(503).send('API docs not generated yet — run `npm run docs:api` and redeploy.');
    }
    res.sendFile(docPath);
  });
  app.get(api('/openapi.json'), (_req, res) => {
    const specPath = path.join(serverDir, 'openapi.json');
    res.sendFile(specPath);
  });

  // =========================================================
  // HEALTH & OBSERVABILITY
  // =========================================================
  // Phase 1 fix (P1-4 + fix 7): live database ping (with timeout) on every
  // health check, plus the fallback mode and outbox depth — never a stale
  // boot-time flag.
  app.get(api('/health'), async (req, res) => {
    let databasePing: { connected: boolean; ms: number | null; error: string | null } | null = null;
    if (pool) databasePing = await pingDatabase(2000);
    const connected = databasePing?.connected === true;
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: connected ? 'connected' : 'in-memory-fallback',
      databaseConfigured: pool !== null,
      databasePingMs: databasePing?.ms ?? null,
      databaseLastError: databasePing?.error ?? getDbStatus().lastError,
      databaseLastProbeAt: getDbStatus().lastProbeAt,
      fallbackMode: connected ? 'postgresql' : 'disk-persisted-fallback',
      fallbackSnapshotExists: snapshotExists(),
      outboxDepth: getOutboxDepth(),
      outboxPending: getOutboxDepth(),
      version: '2.0.0-os',
      memory: process.memoryUsage(),
    });
  });

  // =========================================================
  // AUTH - Store Owner / Staff
  // =========================================================
  app.post(api('/auth/register'), authRateLimit, async (req, res) => {
    try {
      const { storeName, storeCategory, username, pin, address, phone } = req.body;
      if (
        typeof storeName !== 'string' ||
        !storeName.trim() ||
        typeof storeCategory !== 'string' ||
        !storeCategory.trim() ||
        typeof username !== 'string' ||
        !username.trim() ||
        typeof pin !== 'string'
      ) {
        return res.status(400).json({ error: 'MISSING_FIELDS' });
      }
      const existing = await Storage.getUserByUsername(username);
      if (existing) return res.status(400).json({ error: 'USERNAME_TAKEN' });

      const user = await Storage.createUser({
        id: genId(),
        storeName: storeName.trim(),
        storeCategory,
        username: username.trim(),
        pin: await hashPin(pin),
        address,
        phone,
        plan: 'free',
        subscriptionStatus: 'active',
        subscriptionExpiry: null,
        failedLoginAttempts: 0,
        isLocked: false,
      });

      await establishSession(req, { role: 'owner', userId: user.id });
      res.json({ user: publicUser(user) });
    } catch (e: any) {
      res.status(400).json({ error: 'REGISTRATION_FAILED', message: e.message });
    }
  });

  app.post(api('/auth/login'), authRateLimit, async (req, res) => {
    try {
      const { username, pin } = req.body;
      if (typeof username !== 'string' || typeof pin !== 'string') {
        return res.status(400).json({ error: 'INVALID' });
      }

      let user = await Storage.getUserByUsername(username);
      if (user) {
        if (user.isLocked) {
          const lockExpired = user.lockedUntil && new Date(user.lockedUntil).getTime() <= Date.now();
          if (!lockExpired) return res.status(403).json({ error: 'LOCKED' });
          user = await Storage.updateUser(user.id, {
            isLocked: false,
            failedLoginAttempts: 0,
            lockedUntil: null,
          });
        }
        const verification = await verifyPin(pin, user.pin);
        if (verification.valid) {
          // The former public bootstrap account must be explicitly allowlisted
          // before any legacy PIN can be used to sign into it.
          if (user.username === 'admin0130' && verification.needsRehash && !isPlatformAdminId(user.id)) {
            return res.status(403).json({ error: 'CREDENTIAL_RESET_REQUIRED' });
          }
          const updates: any = { failedLoginAttempts: 0, isLocked: false, lockedUntil: null };
          if (verification.needsRehash) updates.pin = await hashPin(pin);
          await Storage.updateUser(user.id, updates);
          await establishSession(req, { role: 'owner', userId: user.id });
          return res.json({ success: true, type: 'owner' });
        } else {
          const attempts = (user.failedLoginAttempts || 0) + 1;
          const updates: any = { failedLoginAttempts: attempts };
          if (attempts >= 3) {
            updates.isLocked = true;
            updates.lockedUntil = new Date(Date.now() + 15 * 60_000);
          }
          await Storage.updateUser(user.id, updates);
          return res.status(401).json({ error: 'INVALID' });
        }
      }

      // Phase 4 fix: staff usernames were only unique in PostgreSQL.
      // In the fallback store two owners could create the same staff
      // username, and login tried only the FIRST match — so the second
      // owner's staff could log into the first owner's store (if the
      // PINs matched) or be locked out. Login now verifies the PIN
      // against EVERY staff row sharing the username.
      const staffCandidates = await Storage.getStaffByUsernameAll(username);
      let matchedStaff: any = null;
      for (const candidate of staffCandidates) {
        const verification = await verifyPin(pin, candidate.pin);
        if (verification.valid) {
          matchedStaff = candidate;
          if (verification.needsRehash) {
            await Storage.updateStaff(candidate.id, { pin: await hashPin(pin) });
          }
          break;
        }
      }
      const staffMember = matchedStaff;
      if (staffMember) {
        await establishSession(req, {
          role: 'staff',
          userId: staffMember.ownerId,
          staffId: staffMember.id,
          staffName: staffMember.name,
        });
        return res.json({ success: true, type: 'staff' });
      }

      res.status(401).json({ error: 'INVALID' });
    } catch (e: any) {
      res.status(500).json({ error: 'AUTHENTICATION_FAILED' });
    }
  });

  app.post(api('/auth/logout'), (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  app.get(api('/auth/me'), async (req, res) => {
    if (req.session.role === 'owner' && req.session.userId) {
      let user = await Storage.getUserById(req.session.userId);
      if (!user) return res.json({ role: null });
      user = await Storage.ensureFreshPlan(user);
      return res.json({ role: 'owner', user: publicUser(user) });
    }
    if (req.session.role === 'staff' && req.session.userId) {
      const user = await Storage.getUserById(req.session.userId);
      const staffMember = req.session.staffId ? await Storage.getStaffById(req.session.staffId) : null;
      return res.json({
        role: 'staff',
        user: user ? { ...publicUser(user), isPlatformAdmin: false } : null,
        staff: staffMember ? { ...staffMember, pin: undefined } : null,
      });
    }
    if (req.session.role === 'customer' && req.session.customerId) {
      const customer = await Storage.getCustomerById(req.session.customerId);
      if (!customer) return res.json({ role: null });
      const { pin: _pin, ...safeCustomer } = customer;
      return res.json({ role: 'customer', customer: safeCustomer });
    }
    res.json({ role: null });
  });

  // =========================================================
  // AUTH - Customers (marketplace)
  // =========================================================
  app.post(api('/customer/register'), authRateLimit, async (req, res) => {
    try {
      const { name, phone, pin, address } = req.body;
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        typeof phone !== 'string' ||
        !phone.trim() ||
        typeof pin !== 'string'
      )
        return res.status(400).json({ error: 'MISSING_FIELDS' });
      const existing = await Storage.getCustomerByPhone(phone);
      if (existing) return res.status(400).json({ error: 'PHONE_TAKEN' });
      const customer = await Storage.createCustomer({
        id: genId(),
        name: name.trim(),
        phone: phone.trim(),
        pin: await hashPin(pin),
        address,
      });
      await establishSession(req, { role: 'customer', customerId: customer.id });
      const { pin: _pin, ...safeCustomer } = customer;
      res.json({ customer: safeCustomer });
    } catch (e: any) {
      res.status(400).json({ error: 'REGISTRATION_FAILED', message: e.message });
    }
  });

  app.post(api('/customer/login'), authRateLimit, async (req, res) => {
    try {
      const { phone, pin } = req.body;
      if (typeof phone !== 'string' || typeof pin !== 'string') {
        return res.status(400).json({ error: 'INVALID' });
      }
      const customer = await Storage.getCustomerByPhone(phone);
      if (!customer) {
        return res.status(401).json({ error: 'INVALID' });
      }
      const verification = await verifyPin(pin, customer.pin);
      if (!verification.valid) return res.status(401).json({ error: 'INVALID' });
      if (verification.needsRehash) {
        await Storage.updateCustomer(customer.id, { pin: await hashPin(pin) });
      }
      await establishSession(req, { role: 'customer', customerId: customer.id });
      const { pin: _pin, ...safeCustomer } = customer;
      res.json({ customer: safeCustomer });
    } catch (e: any) {
      res.status(500).json({ error: 'AUTHENTICATION_FAILED' });
    }
  });

  // =========================================================
  // OWNER/STAFF PROTECTED ROUTES
  // =========================================================
  const ownerOrStaff = requireAuth(['owner', 'staff']);
  // Sync status + manual replay trigger (owner/staff). Replay itself lives
  // in server/durableStore.ts; live PostgreSQL replay still needs staging
  // verification (no PostgreSQL server exists in this sandbox).
  app.get(api('/sync/status'), ownerOrStaff, async (req, res) => {
    const status = getDbStatus();
    res.json({
      databaseConfigured: status.configured,
      databaseConnected: status.connected,
      lastDbError: status.lastError,
      lastProbeAt: status.lastProbeAt,
      fallbackMode: status.connected ? 'postgresql' : 'disk-persisted-fallback',
      fallbackSnapshotExists: snapshotExists(),
      outboxDepth: getOutboxDepth(),
    });
  });

  app.get(
    api('/products'),
    ownerOrStaff,
    requirePermission('view_reports', 'manage_inventory', 'process_sale'),
    async (req, res) => {
      const storeId = await currentStoreId(req);
      res.json(await Storage.getProductsByStore(storeId!));
    },
  );

  // Phase 6 — server-side barcode lookup. Scoped to the caller's own
  // store (never a global search), exact match on the printed code.
  // The POS already matched barcodes client-side; this route makes the
  // lookup usable from inventory, from a scanner, and from typed entry
  // alike — and it is what the barcode E2E test asserts.
  app.get(
    api('/products/barcode/:code'),
    ownerOrStaff,
    requirePermission('view_reports', 'manage_inventory', 'process_sale'),
    async (req, res) => {
      const code = ((req.params.code as string) || '').trim();
      if (!code || code.length > 128) return res.status(400).json({ error: 'INVALID_BARCODE' });
      const storeId = await currentStoreId(req);
      const products = await Storage.getProductsByStore(storeId!);
      const product = products.find((p: any) => p.barcode === code);
      if (!product) return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
      res.json(product);
    },
  );

  // Phase 6 — bulk inventory actions. Every mutation re-validates
  // server-side: stock can never go negative, prices are non-negative,
  // and delete requires confirmed:true (the client shows a confirmation
  // dialog first). Per-product results are reported, never silently
  // skipped: { updated, deleted, skipped: [{ id, reason }] }.
  const bulkSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    action: z.enum(['adjust-stock', 'set-price', 'delete']),
    delta: z.number().int().optional(),
    price: z.number().min(0).optional(),
    confirmed: z.boolean().optional(),
  });

  app.post(api('/products/bulk'), ownerOrStaff, requirePermission('manage_inventory'), async (req, res) => {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_BULK_REQUEST' });
    const { ids, action, delta, price, confirmed } = parsed.data;
    if (action === 'adjust-stock' && delta === undefined) return res.status(400).json({ error: 'INVALID_DELTA' });
    if (action === 'set-price' && price === undefined) return res.status(400).json({ error: 'INVALID_PRICE' });
    if (action === 'delete' && confirmed !== true) return res.status(400).json({ error: 'DELETE_NOT_CONFIRMED' });
    const storeId = await currentStoreId(req);
    const actorId = req.session.role === 'staff' ? req.session.staffId : req.session.userId;
    const skipped: Array<{ id: string; reason: string }> = [];
    let updated = 0;
    let deleted = 0;
    for (const id of new Set(ids)) {
      const existing = await Storage.getProductById(id);
      if (!existing || (existing as any).storeId !== storeId) {
        skipped.push({ id, reason: 'PRODUCT_NOT_FOUND' });
        continue;
      }
      if (action === 'delete') {
        const ok = await Storage.deleteProduct(id, storeId!);
        if (ok) deleted++;
        else skipped.push({ id, reason: 'DELETE_FAILED' });
        continue;
      }
      if (action === 'adjust-stock') {
        const next = (existing as any).stock + delta!;
        if (next < 0) {
          skipped.push({ id, reason: 'INSUFFICIENT_STOCK' });
          continue;
        }
        await Storage.upsertProduct({ ...(existing as any), stock: next }, storeId!, actorId);
        updated++;
        continue;
      }
      await Storage.upsertProduct({ ...(existing as any), price: price! }, storeId!, actorId);
      updated++;
    }
    res.json({ updated, deleted, skipped });
  });

  app.post(api('/products'), ownerOrStaff, requirePermission('manage_inventory'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      const owner = await Storage.getUserById(storeId!);
      // Phase 6 fix (PG): clients echo the full product object back,
      // including createdAt as a JSON string — but createdAt is a
      // Drizzle timestamp, and the PG serializer calls .toISOString()
      // on it, which throws for a string and used to be silently masked
      // by the fallback store (PG data never updated, fallback data
      // diverged). createdAt is server-managed and immutable: strip it
      // at the boundary. (Storage's PG branch strips it again.)
      const { createdAt: _createdAt, ...body } = req.body || {};
      const product = { ...body, storeId };

      if (owner?.plan === 'free') {
        const existing = await Storage.getProductById(product.id);
        const count = await Storage.countProductsByStore(storeId!);
        if ((!existing || existing.storeId !== storeId) && count >= LIMITS.FREE_PRODUCT_LIMIT) {
          return res.status(403).json({ error: 'FREE_LIMIT_REACHED' });
        }
      }

      if (
        typeof product.id !== 'string' ||
        typeof product.name !== 'string' ||
        typeof product.category !== 'string' ||
        typeof product.unit !== 'string' ||
        typeof product.price !== 'number' ||
        !Number.isFinite(product.price) ||
        product.price < 0 ||
        typeof product.cost !== 'number' ||
        !Number.isFinite(product.cost) ||
        product.cost < 0 ||
        typeof product.stock !== 'number' ||
        !Number.isFinite(product.stock) ||
        product.stock < 0
      ) {
        return res.status(400).json({ error: 'INVALID_PRODUCT' });
      }
      const { product: saved } = await Storage.upsertProduct(
        product,
        storeId!,
        req.session.role === 'staff' ? req.session.staffId : req.session.userId,
      );
      res.json(saved);
    } catch (e: any) {
      if (e instanceof StorageRuleError) {
        return res.status(e.status).json({ error: e.code, message: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.delete(api('/products/:id'), ownerOrStaff, requirePermission('manage_inventory'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const deleted = await Storage.deleteProduct(req.params.id as string, storeId!);
    if (!deleted) return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
    res.json({ success: true });
  });

  app.get(api('/sales'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getSalesByStore(storeId!));
  });

  app.post(api('/sales'), ownerOrStaff, requirePermission('process_sale'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      // Phase 4: coupon/loyalty/branch/counter fields are honoured by
      // BOTH the fallback and the PostgreSQL sale transactions now
      // (server/storage.ts) — the old PHASE3_PG_PENDING refusal is gone.
      const owner = await Storage.getUserById(storeId!);
      if (owner?.plan === 'free') {
        const todayCount = await Storage.countTodaySalesByStore(storeId!);
        if (todayCount >= LIMITS.FREE_DAILY_SALES_LIMIT) {
          return res.status(403).json({ error: 'FREE_LIMIT_REACHED' });
        }
      }

      const saved = await Storage.createSale({
        sale: req.body,
        storeId: storeId!,
        storeName: owner?.storeName,
        vatRate: owner?.defaultVatRate || 0,
        maxDiscountPercent:
          req.session.role === 'owner'
            ? configuredPercent('OWNER_MAX_DISCOUNT_PERCENT', 100)
            : configuredPercent('STAFF_MAX_DISCOUNT_PERCENT', 10),
        servedBy: req.session.role === 'staff' ? req.session.staffName : 'Owner',
        actorId: req.session.role === 'staff' ? req.session.staffId : req.session.userId,
      });

      broadcastToStore(storeId!, {
        type: 'SALE_COMPLETED',
        payload: saved,
      });

      res.json(saved);
    } catch (e: any) {
      if (e instanceof StorageRuleError || e?.name === 'StorageRuleError') {
        return res.status(e.status || 400).json({ error: e.code, message: e.message });
      }
      if (e instanceof Error && /^INVALID_[A-Z_]+:/.test(e.message)) {
        const [code, ...details] = e.message.split(':');
        return res.status(400).json({ error: code, message: details.join(':') });
      }
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  app.get(api('/expenses'), ownerOrStaff, requirePermission('view_reports', 'manage_expenses'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getExpensesByStore(storeId!));
  });

  app.post(api('/expenses'), ownerOrStaff, requirePermission('manage_expenses'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const { description, amount, category } = req.body;
    if (
      typeof description !== 'string' ||
      !description.trim() ||
      typeof category !== 'string' ||
      !category.trim() ||
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({ error: 'INVALID_EXPENSE' });
    }
    res.status(201).json(
      await Storage.createExpense({
        id: genId(),
        description: description.trim(),
        amount,
        category: category.trim(),
        date: new Date(),
        storeId: storeId!,
      }),
    );
  });

  app.delete(api('/expenses/:id'), ownerOrStaff, requirePermission('manage_expenses'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const deleted = await Storage.deleteExpense(req.params.id as string, storeId!);
    if (!deleted) return res.status(404).json({ error: 'EXPENSE_NOT_FOUND' });
    res.json({ success: true });
  });

  app.get(
    api('/inventory-logs'),
    ownerOrStaff,
    requirePermission('view_reports', 'manage_inventory'),
    async (req, res) => {
      const storeId = await currentStoreId(req);
      res.json(await Storage.getInventoryLogsByStore(storeId!));
    },
  );

  // ---- Staff Management (owner only) ----
  const ownerOnly = requireAuth(['owner']);

  app.get(api('/staff'), ownerOnly, async (req, res) => {
    const staff = await Storage.getStaffByOwner(req.session.userId!);
    res.json(staff.map(({ pin: _pin, ...safeStaff }: any) => safeStaff));
  });

  app.post(api('/staff'), ownerOnly, async (req, res) => {
    try {
      if (
        typeof req.body.name !== 'string' ||
        !req.body.name.trim() ||
        typeof req.body.username !== 'string' ||
        !req.body.username.trim() ||
        typeof req.body.pin !== 'string' ||
        !Array.isArray(req.body.permissions) ||
        req.body.permissions.some(
          (permission: unknown) => typeof permission !== 'string' || !ALLOWED_STAFF_PERMISSIONS.has(permission),
        )
      ) {
        return res.status(400).json({ error: 'INVALID_STAFF' });
      }
      const existingStaff = await Storage.getStaffByUsernameAll(req.body.username.trim());
      if (existingStaff.length > 0) {
        return res.status(409).json({ error: 'USERNAME_TAKEN' });
      }
      const staffMember = await Storage.createStaff({
        id: genId(),
        ownerId: req.session.userId!,
        name: req.body.name.trim(),
        username: req.body.username.trim(),
        pin: await hashPin(req.body.pin),
        permissions: req.body.permissions,
      });
      res.json({ ...staffMember, pin: undefined });
    } catch (e: any) {
      res.status(400).json({ error: 'STAFF_CREATE_FAILED', message: e.message });
    }
  });

  app.put(api('/staff/:id'), ownerOnly, async (req, res) => {
    const updates: Record<string, any> = {};
    if (typeof req.body.name === 'string') updates.name = req.body.name;
    if (typeof req.body.username === 'string') updates.username = req.body.username;
    if (Array.isArray(req.body.permissions)) {
      if (
        req.body.permissions.some(
          (permission: unknown) => typeof permission !== 'string' || !ALLOWED_STAFF_PERMISSIONS.has(permission),
        )
      ) {
        return res.status(400).json({ error: 'INVALID_PERMISSIONS' });
      }
      updates.permissions = req.body.permissions;
    }
    if (typeof req.body.pin === 'string' && req.body.pin.trim()) updates.pin = await hashPin(req.body.pin);
    const staff = await Storage.updateStaffForOwner(req.params.id as string, req.session.userId!, updates);
    if (!staff) return res.status(404).json({ error: 'STAFF_NOT_FOUND' });
    res.json({ ...staff, pin: undefined });
  });

  app.delete(api('/staff/:id'), ownerOnly, async (req, res) => {
    const deleted = await Storage.deleteStaffForOwner(req.params.id as string, req.session.userId!);
    if (!deleted) return res.status(404).json({ error: 'STAFF_NOT_FOUND' });
    res.json({ success: true });
  });

  // ---- Profile ----
  app.put(api('/profile'), requireAuth(['owner']), async (req, res) => {
    const updates: Record<string, any> = {};
    for (const field of [
      'storeName',
      'storeCategory',
      'address',
      'phone',
      'zila',
      'upozila',
      'thana',
      'profilePicture',
    ]) {
      if (typeof req.body[field] === 'string') updates[field] = req.body[field];
    }
    if (req.body.defaultVatRate !== undefined) {
      const vat = req.body.defaultVatRate;
      if (typeof vat !== 'number' || !Number.isFinite(vat) || vat < 0 || vat > 100) {
        return res.status(400).json({ error: 'INVALID_VAT_RATE' });
      }
      updates.defaultVatRate = vat;
    }
    if (typeof req.body.pin === 'string' && req.body.pin.trim()) {
      try {
        updates.pin = await hashPin(req.body.pin);
      } catch {
        return res.status(400).json({ error: 'INVALID_PIN' });
      }
    }
    const user = await Storage.updateUser(req.session.userId!, updates);
    res.json(publicUser(user));
  });

  // ---- Subscription Requests ----
  app.post(api('/subscription-requests'), requireAuth(['owner']), async (req, res) => {
    // Phase 4 fix: the request body used to be spread into the record,
    // so an owner could submit status:'approved' for their own request.
    // Approval alone never upgraded a plan (only the admin approve flow
    // does), but the record must still start pending — status is forced.
    const request = await Storage.createSubscriptionRequest({
      ...req.body,
      id: genId(),
      userId: req.session.userId!,
      status: 'pending',
    });
    await Storage.updateUser(req.session.userId!, { subscriptionStatus: 'pending_approval' });
    res.json(request);
  });

  app.get(api('/pricing-config'), async (req, res) => {
    const config = await Storage.getSetting('pricing_config');
    res.json(config || DEFAULT_GLOBAL_PRICING);
  });

  app.get(api('/payment-settings'), async (req, res) => {
    const settings = await Storage.getSetting('payment_info');
    res.json(settings || { bkash: '01700000000', nagad: '01800000000' });
  });

  app.get(api('/global-config'), async (req, res) => {
    const config = await Storage.getSetting('global_config');
    res.json(config || {});
  });

  // =========================================================
  // RESTAURANT MODULE
  // =========================================================
  app.get(
    api('/restaurant/tables'),
    ownerOrStaff,
    requirePermission('manage_restaurant', 'manage_settings'),
    async (req, res) => {
      const storeId = await currentStoreId(req);
      res.json(await Storage.getTablesByStore(storeId!));
    },
  );

  app.post(
    api('/restaurant/tables'),
    ownerOrStaff,
    requirePermission('manage_restaurant', 'manage_settings'),
    async (req, res) => {
      const storeId = await currentStoreId(req);
      if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
        return res.status(400).json({ error: 'INVALID_TABLE_NAME' });
      }
      const table = await Storage.createTable({
        id: genId(),
        storeId: storeId!,
        name: req.body.name.trim(),
        isActive: true,
      });
      res.json(table);
    },
  );

  app.delete(
    api('/restaurant/tables/:id'),
    ownerOrStaff,
    requirePermission('manage_restaurant', 'manage_settings'),
    async (req, res) => {
      const storeId = await currentStoreId(req);
      const deleted = await Storage.deleteTable(req.params.id as string, storeId!);
      if (!deleted) return res.status(404).json({ error: 'TABLE_NOT_FOUND' });
      res.json({ success: true });
    },
  );

  app.get(api('/restaurant/guest-orders'), ownerOrStaff, requirePermission('manage_restaurant'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getGuestOrdersByStore(storeId!));
  });

  app.put(
    api('/restaurant/guest-orders/:id'),
    ownerOrStaff,
    requirePermission('manage_restaurant'),
    async (req, res) => {
      try {
        const storeId = await currentStoreId(req);
        const order = await Storage.updateGuestOrder(req.params.id as string, storeId!, req.body.status);
        res.json(order);
      } catch (e: any) {
        if (e instanceof StorageRuleError || e?.name === 'StorageRuleError') {
          return res.status(e.status || 400).json({ error: e.code, message: e.message });
        }
        if (e instanceof Error && /^INVALID_[A-Z_]+:/.test(e.message)) {
          const [code, ...details] = e.message.split(':');
          return res.status(400).json({ error: code, message: details.join(':') });
        }
        res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    },
  );

  app.post(
    api('/restaurant/guest-orders/:id/settle'),
    ownerOrStaff,
    requirePermission('manage_restaurant', 'process_sale'),
    async (req, res) => {
      try {
        const storeId = await currentStoreId(req);
        const { paymentMethod, paidAmount, cashReceived, discount, vatRate, splitDetails, gatewayTrxId } = req.body;
        const result = await Storage.settleGuestOrder({
          orderId: req.params.id as string,
          storeId: storeId!,
          paymentMethod: paymentMethod || 'cash',
          paidAmount,
          cashReceived,
          discount,
          vatRate,
          servedBy: req.session.role === 'staff' ? req.session.staffName : 'Owner',
          gatewayTrxId,
          splitDetails,
        });
        res.json(result);
      } catch (e: any) {
        if (e instanceof StorageRuleError || e?.name === 'StorageRuleError') {
          return res.status(e.status || 400).json({ error: e.code, message: e.message });
        }
        res.status(500).json({ error: 'SETTLEMENT_FAILED', message: e.message });
      }
    },
  );

  app.post(
    api('/restaurant/guest-orders/:id/void'),
    ownerOrStaff,
    requirePermission('manage_restaurant'),
    async (req, res) => {
      try {
        const storeId = await currentStoreId(req);
        const { reason } = req.body;
        const order = await Storage.voidGuestOrder(req.params.id as string, storeId!, reason);
        res.json(order);
      } catch (e: any) {
        if (e instanceof StorageRuleError || e?.name === 'StorageRuleError') {
          return res.status(e.status || 400).json({ error: e.code, message: e.message });
        }
        res.status(500).json({ error: 'VOID_FAILED', message: e.message });
      }
    },
  );

  // Public guest-facing routes (no auth - accessed via QR code)
  // Phase 4: public product responses are stripped of `cost` (see
  // server/publicView.ts) — the full record used to leak store margins
  // to any unauthenticated visitor.
  app.get(api('/public/store/:storeId/menu'), async (req, res) => {
    const products = await Storage.getProductsByStore(req.params.storeId as string);
    res.json(publicProductList(products.filter((product: any) => product.isOnlineVisible !== false)));
  });

  app.get(api('/public/table/:tableId'), async (req, res) => {
    const table = await Storage.getTableById(req.params.tableId as string);
    if (!table || !table.isActive) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(table);
  });

  app.post(api('/public/guest-orders'), async (req, res) => {
    try {
      if (typeof req.body.idempotencyKey !== 'string') {
        return res.status(400).json({ error: 'INVALID_IDEMPOTENCY_KEY', message: 'A request id is required.' });
      }
      if (typeof req.body.tableId !== 'string' || !req.body.tableId.trim()) {
        return res.status(400).json({ error: 'INVALID_TABLE', message: 'A table is required.' });
      }
      if (!Array.isArray(req.body.items) || req.body.items.length === 0 || req.body.items.length > 100) {
        return res.status(400).json({ error: 'INVALID_ORDER', message: 'Between 1 and 100 items are required.' });
      }
      if (req.body.note !== undefined && (typeof req.body.note !== 'string' || req.body.note.length > 500)) {
        return res.status(400).json({ error: 'INVALID_ORDER_NOTE', message: 'Note must be at most 500 characters.' });
      }
      const order = await Storage.createGuestOrder({
        idempotencyKey: req.body.idempotencyKey,
        tableId: req.body.tableId,
        items: Array.isArray(req.body.items)
          ? req.body.items.map((item: any) => ({
              id: item?.id,
              quantity: item?.quantity,
              note: item?.note,
            }))
          : [],
        note: req.body.note,
      });

      broadcastToStore(order.storeId!, {
        type: 'NEW_ORDER',
        payload: order,
      });

      res.status(201).json(publicGuestOrderView(order));
    } catch (e: any) {
      if (e instanceof StorageRuleError || e?.name === 'StorageRuleError') {
        return res.status(e.status || 400).json({ error: e.code, message: e.message });
      }
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  app.get(api('/public/guest-orders/:id'), async (req, res) => {
    const order = await Storage.getGuestOrderById(req.params.id as string);
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(publicGuestOrderView(order));
  });

  // =========================================================
  // SHIFTS & CASH RECONCILIATION
  // =========================================================
  app.get(api('/shifts/current'), ownerOrStaff, requirePermission('process_sale'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const cashierId = req.session.role === 'staff' ? req.session.staffId! : req.session.userId!;
    const shift = await Storage.getCurrentShift(
      storeId!,
      cashierId,
      (req.query.counterId as string | undefined) || undefined,
    );
    res.json(shift);
  });

  app.post(api('/shifts/open'), ownerOrStaff, requirePermission('process_sale'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      const cashierId = req.session.role === 'staff' ? req.session.staffId! : req.session.userId!;
      const cashierName = req.session.role === 'staff' ? req.session.staffName! : 'Store Owner';
      const openingCash = Number(req.body.openingCash) || 0;
      if (!Number.isFinite(openingCash) || openingCash < 0) {
        return res.status(400).json({ error: 'INVALID_OPENING_CASH', message: 'Opening cash must be non-negative.' });
      }
      const shift = await Storage.openShift({
        storeId: storeId!,
        cashierId,
        cashierName,
        openingCash,
        notes: req.body.notes,
        branchId: typeof req.body.branchId === 'string' ? req.body.branchId : undefined,
        counterId: typeof req.body.counterId === 'string' ? req.body.counterId : undefined,
      });
      res.status(201).json(shift);
    } catch (e: any) {
      if (e instanceof StorageRuleError || e?.name === 'StorageRuleError') {
        return res.status(e.status || 400).json({ error: e.code, message: e.message });
      }
      res.status(400).json({ error: 'SHIFT_OPEN_FAILED', message: e.message });
    }
  });

  app.post(api('/shifts/:id/close'), ownerOrStaff, requirePermission('process_sale'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      const actualCash = Number(req.body.actualCash);
      if (!Number.isFinite(actualCash) || actualCash < 0) {
        return res.status(400).json({ error: 'INVALID_ACTUAL_CASH', message: 'Valid counted cash is required.' });
      }
      // Phase 4 fix: any staff member in the store could close ANY
      // cashier's shift with an arbitrary counted-cash figure, falsifying
      // that cashier's Z-report. Staff may now close only their own
      // shifts; owners may close any shift in their store.
      if (req.session.role === 'staff') {
        const shift = await Storage.getShiftById(req.params.id as string);
        if (!shift || (shift as any).storeId !== storeId) {
          return res.status(404).json({ error: 'SHIFT_NOT_FOUND' });
        }
        if ((shift as any).cashierId !== req.session.staffId) {
          return res.status(403).json({ error: 'FORBIDDEN', message: 'Staff can only close their own shifts.' });
        }
      }
      const shift = await Storage.closeShift(req.params.id as string, storeId!, actualCash, req.body.notes);
      res.json(shift);
    } catch (e: any) {
      res.status(400).json({ error: 'SHIFT_CLOSE_FAILED', message: e.message });
    }
  });

  app.get(api('/shifts'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getShiftsByStore(storeId!));
  });

  // =========================================================
  // PAYMENT GATEWAY SIMULATION & VERIFICATION (AmarPay)
  // =========================================================
  // Phase 1 fix (P1-2): HONEST format check only. This endpoint never
  // contacts bKash/Nagad, checks no signature, and verifies nothing — the
  // old response claiming "verified successfully via gateway" was false.
  // No payment capture depends on it: settleGuestOrder records the
  // gatewayTrxId supplied by the operator as opaque metadata and never
  // calls this endpoint. Real signature-verified gateway callbacks are a
  // Phase 4 deliverable; the spec is docs/gateway-callback-spec.md.
  app.post(api('/payments/verify-gateway'), async (req, res) => {
    try {
      const { gateway, trxId, amount, phone } = req.body;
      if (!trxId || typeof trxId !== 'string' || trxId.trim().length < 6) {
        return res.status(400).json({
          formatValid: false,
          gatewayVerified: false,
          valid: false,
          error: 'INVALID_TRX_ID',
          message: 'Valid transaction ID format required for the format check',
        });
      }
      const sanitizedTrx = trxId.trim().toUpperCase();
      res.json({
        formatValid: true,
        gatewayVerified: false,
        verified: false,
        valid: false,
        verificationMethod: 'format-check-only',
        trxId: sanitizedTrx,
        gateway: gateway || (sanitizedTrx.startsWith('NAGAD') ? 'nagad' : 'bkash'),
        amount: Number(amount) || 0,
        phone: phone || null,
        checkedAt: new Date().toISOString(),
        message:
          'Format check only — no gateway was contacted and no payment was verified. Do not treat this as proof of payment. See docs/gateway-callback-spec.md for the Phase 4 real-callback design.',
      });
    } catch (e: any) {
      res.status(500).json({ formatValid: false, gatewayVerified: false, valid: false, error: 'GATEWAY_ERROR' });
    }
  });

  // =========================================================
  // PHASE 4 — GATEWAY CALLBACKS (bKash/Nagad), flag-gated.
  // Disabled unless AMAR_GATEWAY_CALLBACKS_ENABLED=true AND the
  // per-gateway secret is set (see server/gateway.ts). The
  // format-check-only endpoint above is NOT part of this flow and is
  // never consulted by capture. No real gateway credentials exist in
  // this sandbox: live verification stays UNVERIFIED; the code path is
  // proven by unit tests (self-generated HMAC vectors) and a live HTTP
  // proof with a dev-only test secret (see phase-4 report).
  // =========================================================
  const gatewayGate = (gateway: string): gateway is 'bkash' | 'nagad' => gateway === 'bkash' || gateway === 'nagad';
  const gatewayNotConfigured = (res: Response) =>
    res.status(503).json({
      error: 'GATEWAY_NOT_CONFIGURED',
      message:
        'Gateway callbacks are disabled: set AMAR_GATEWAY_CALLBACKS_ENABLED=true and the per-gateway callback secret. See docs/gateway-callback-spec.md.',
    });

  app.post(api('/payments/gateway-intents'), ownerOrStaff, requirePermission('process_sale'), async (req, res) => {
    try {
      if (!gatewayCallbacksEnabled() || !gatewaySecret(req.body.gateway)) return gatewayNotConfigured(res);
      const storeId = await currentStoreId(req);
      const intent = createGatewayIntent(storeId!, req.body.gateway, req.body.amountMinor, req.body.merchantRef);
      res.status(201).json(intent);
    } catch (e: any) {
      if (e instanceof GatewayError) return res.status(e.status).json({ error: e.code, message: e.message });
      res.status(500).json({ error: 'INTENT_CREATE_FAILED' });
    }
  });

  app.get(api('/payments/gateway-intents'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(listGatewayIntents(storeId!));
  });

  app.post(api('/payments/callback/:gateway'), async (req, res) => {
    const gateway = req.params.gateway as string;
    if (!gatewayGate(gateway)) return res.status(400).json({ error: 'INVALID_GATEWAY' });
    if (!gatewayCallbacksEnabled() || !gatewaySecret(gateway)) return gatewayNotConfigured(res);
    const signature = req.headers['x-gateway-signature'] as string | undefined;
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!verifyCallbackSignature(gateway, rawBody || JSON.stringify(req.body || {}), signature)) {
      return res.status(401).json({ error: 'INVALID_CALLBACK_SIGNATURE' });
    }
    const { intent, outcome } = applyGatewayCallback(gateway, {
      merchantRef: req.body.merchantRef,
      gatewayTrxId: req.body.gatewayTrxId,
      amountMinor: req.body.amountMinor,
      status: req.body.status,
    });
    if (outcome === 'unknown_reference') {
      return res.status(404).json({ error: 'UNKNOWN_MERCHANT_REF', outcome });
    }
    if (outcome === 'amount_mismatch' || outcome === 'gateway_trx_mismatch') {
      return res.status(409).json({ error: outcome.toUpperCase(), outcome, intent });
    }
    if (outcome === 'invalid_status') {
      return res.status(400).json({ error: 'INVALID_CALLBACK', outcome, intent });
    }
    res.json({ outcome, intent });
  });

  app.post(api('/payments/gateway-intents/:id/refund'), ownerOnly, async (req, res) => {
    try {
      if (!gatewayCallbacksEnabled()) return gatewayNotConfigured(res);
      const { intent, refund } = createGatewayRefund(
        req.session.userId!,
        req.params.id as string,
        req.body.refundRef,
        req.body.amountMinor,
      );
      res.json({ intent, refund });
    } catch (e: any) {
      if (e instanceof GatewayError) return res.status(e.status).json({ error: e.code, message: e.message });
      res.status(500).json({ error: 'REFUND_FAILED' });
    }
  });

  app.get(api('/payments/reconciliation'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const ledger = await Storage.getPaymentIntentsByStore(storeId!);
    const report = reconcileGatewayVsLedger(
      storeId!,
      (ledger as any[]).map((entry: any) => ({
        id: entry.id,
        gatewayTrxId: entry.gatewayTrxId || null,
        paidAmount: entry.paidAmount,
        status: entry.status,
      })),
    );
    res.json(report);
  });

  // =========================================================
  // PHASE 3 (DEPTH)
  // =========================================================
  // Phase 4: these routes are PostgreSQL-wired now (server/storage.ts
  // op() branches + migrations/0002 + 0003). The old fail-closed
  // PHASE3_PG_PENDING guard was removed with the wiring; the
  // accountant CSV exports below read through the same PG-aware
  // getters they always did.
  const phase3Error = (e: any, res: Response, fallback: string) => {
    if (e instanceof StorageRuleError || e?.name === 'StorageRuleError') {
      return res.status(e.status || 400).json({ error: e.code, message: e.message });
    }
    if (e instanceof z.ZodError) {
      return res.status(400).json({
        error: 'VALIDATION_FAILED',
        message: e.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    return res.status(500).json({ error: fallback, message: e?.message });
  };
  const branchSchema = z.object({
    name: z.string().trim().min(1).max(200),
    address: z.string().max(500).optional(),
    isDefault: z.boolean().optional(),
  });
  const counterSchema = z.object({ branchId: z.string().min(1), name: z.string().trim().min(1).max(200) });
  const supplierSchema = z.object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().max(50).optional(),
    address: z.string().max(500).optional(),
    notes: z.string().max(1000).optional(),
  });
  const poSchema = z.object({
    supplierId: z.string().min(1),
    branchId: z.string().optional(),
    items: z
      .array(
        z.object({ productId: z.string().min(1), quantity: z.number().positive(), cost: z.number().nonnegative() }),
      )
      .min(1),
  });
  const receiveSchema = z.object({
    received: z.array(z.object({ productId: z.string().min(1), quantity: z.number().positive() })).min(1),
  });
  const couponSchema = z.object({
    code: z.string().trim().min(1).max(50),
    type: z.enum(['percent', 'fixed']),
    value: z.number().nonnegative(),
    minPurchase: z.number().nonnegative().optional(),
    maxUses: z.number().int().nonnegative().optional(),
    expiresAt: z.string().optional().nullable(),
    active: z.boolean().optional(),
  });

  // ---- Insights: forecast / expiry / dead stock (visible basis) ----
  app.get(api('/insights/forecast'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    try {
      const windowDays = Math.min(365, Math.max(1, Number(req.query.windowDays) || 30));
      const leadTimeDays = Math.min(90, Math.max(0, Number(req.query.leadTimeDays) || 7));
      const storeId = await currentStoreId(req);
      const forecast = await Storage.getForecast(storeId!, windowDays, leadTimeDays);
      res.json({
        windowDays,
        leadTimeDays,
        rule:
          forecast[0]?.rule ||
          'suggested = ceil(average daily sales over the last N days x lead-time days - current stock), minimum 0',
        items: forecast,
      });
    } catch (e: any) {
      phase3Error(e, res, 'FORECAST_FAILED');
    }
  });

  app.get(api('/insights/expiry'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      res.json({ thresholdsDays: [30, 14, 7], alerts: await Storage.getExpiryAlerts(storeId!) });
    } catch (e: any) {
      phase3Error(e, res, 'EXPIRY_FAILED');
    }
  });

  app.get(api('/insights/dead-stock'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    try {
      const windowDays = Math.min(365, Math.max(1, Number(req.query.windowDays) || 90));
      const storeId = await currentStoreId(req);
      res.json({ windowDays, items: await Storage.getDeadStock(storeId!, windowDays) });
    } catch (e: any) {
      phase3Error(e, res, 'DEAD_STOCK_FAILED');
    }
  });

  // ---- Branches & counters ----
  app.get(
    api('/branches'),
    ownerOrStaff,
    requirePermission('view_reports', 'manage_inventory', 'manage_settings', 'process_sale'),
    async (req, res) => {
      const storeId = await currentStoreId(req);
      res.json(await Storage.getBranchesByStore(storeId!));
    },
  );
  app.post(api('/branches'), ownerOrStaff, requirePermission('manage_settings'), async (req, res) => {
    try {
      const body = branchSchema.parse(req.body);
      const storeId = await currentStoreId(req);
      res.status(201).json(await Storage.createBranch({ storeId: storeId!, ...body }));
    } catch (e: any) {
      phase3Error(e, res, 'BRANCH_CREATE_FAILED');
    }
  });
  app.get(
    api('/branches/:id/products'),
    ownerOrStaff,
    requirePermission('view_reports', 'manage_inventory'),
    async (req, res) => {
      try {
        const storeId = await currentStoreId(req);
        res.json(await Storage.getProductsByBranch(storeId!, req.params.id as string));
      } catch (e: any) {
        phase3Error(e, res, 'BRANCH_PRODUCTS_FAILED');
      }
    },
  );
  app.get(api('/branches/:id/sales'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      res.json(await Storage.getSalesByBranch(storeId!, req.params.id as string));
    } catch (e: any) {
      phase3Error(e, res, 'BRANCH_SALES_FAILED');
    }
  });
  app.get(
    api('/branches/:id/counters'),
    ownerOrStaff,
    requirePermission('view_reports', 'manage_inventory', 'manage_settings', 'process_sale'),
    async (req, res) => {
      try {
        const storeId = await currentStoreId(req);
        res.json(await Storage.getCountersByBranch(storeId!, req.params.id as string));
      } catch (e: any) {
        phase3Error(e, res, 'COUNTERS_FAILED');
      }
    },
  );
  app.post(api('/counters'), ownerOrStaff, requirePermission('manage_settings'), async (req, res) => {
    try {
      const body = counterSchema.parse(req.body);
      const storeId = await currentStoreId(req);
      res.status(201).json(await Storage.createCounter({ storeId: storeId!, ...body }));
    } catch (e: any) {
      phase3Error(e, res, 'COUNTER_CREATE_FAILED');
    }
  });

  // ---- Z-report per counter ----
  app.get(api('/shifts/z-report'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      res.json({ perCounter: await Storage.getZReportsByCounter(storeId!) });
    } catch (e: any) {
      phase3Error(e, res, 'Z_REPORT_FAILED');
    }
  });

  // ---- Suppliers & purchase orders ----
  app.get(api('/suppliers'), ownerOrStaff, requirePermission('view_reports', 'manage_inventory'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getSuppliersByStore(storeId!));
  });
  app.post(api('/suppliers'), ownerOrStaff, requirePermission('manage_inventory'), async (req, res) => {
    try {
      const body = supplierSchema.parse(req.body);
      const storeId = await currentStoreId(req);
      res.status(201).json(await Storage.createSupplier({ storeId: storeId!, ...body }));
    } catch (e: any) {
      phase3Error(e, res, 'SUPPLIER_CREATE_FAILED');
    }
  });
  app.delete(api('/suppliers/:id'), ownerOrStaff, requirePermission('manage_inventory'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const deleted = await Storage.deleteSupplier(req.params.id as string, storeId!);
    if (!deleted) return res.status(404).json({ error: 'SUPPLIER_NOT_FOUND' });
    res.json({ success: true });
  });
  app.get(api('/suppliers/dues-total'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json({ totalDue: await Storage.getSupplierDuesTotal(storeId!) });
  });
  app.post(api('/suppliers/:id/pay'), ownerOrStaff, requirePermission('manage_expenses'), async (req, res) => {
    try {
      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'INVALID_PAYMENT' });
      const storeId = await currentStoreId(req);
      res.json(await Storage.paySupplier(req.params.id as string, storeId!, amount, req.session.userId));
    } catch (e: any) {
      phase3Error(e, res, 'SUPPLIER_PAY_FAILED');
    }
  });
  app.get(
    api('/purchase-orders'),
    ownerOrStaff,
    requirePermission('view_reports', 'manage_inventory'),
    async (req, res) => {
      const storeId = await currentStoreId(req);
      res.json(await Storage.getPurchaseOrdersByStore(storeId!));
    },
  );
  app.post(api('/purchase-orders'), ownerOrStaff, requirePermission('manage_inventory'), async (req, res) => {
    try {
      const body = poSchema.parse(req.body);
      const storeId = await currentStoreId(req);
      res.status(201).json(await Storage.createPurchaseOrder({ storeId: storeId!, ...body }));
    } catch (e: any) {
      phase3Error(e, res, 'PO_CREATE_FAILED');
    }
  });
  app.post(
    api('/purchase-orders/:id/receive'),
    ownerOrStaff,
    requirePermission('manage_inventory'),
    async (req, res) => {
      try {
        const body = receiveSchema.parse(req.body);
        const storeId = await currentStoreId(req);
        const actorId = req.session.role === 'staff' ? req.session.staffId : req.session.userId;
        res.json(await Storage.receivePurchaseOrder(req.params.id as string, storeId!, body.received, actorId));
      } catch (e: any) {
        phase3Error(e, res, 'PO_RECEIVE_FAILED');
      }
    },
  );
  app.post(
    api('/purchase-orders/:id/cancel'),
    ownerOrStaff,
    requirePermission('manage_inventory'),
    async (req, res) => {
      try {
        const storeId = await currentStoreId(req);
        res.json(await Storage.cancelPurchaseOrder(req.params.id as string, storeId!));
      } catch (e: any) {
        phase3Error(e, res, 'PO_CANCEL_FAILED');
      }
    },
  );

  // ---- Coupons & loyalty (coupons: owner only — money rules) ----
  app.get(api('/coupons'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getCouponsByStore(storeId!));
  });
  app.post(api('/coupons'), ownerOnly, async (req, res) => {
    try {
      const body = couponSchema.parse(req.body);
      if (body.type === 'percent' && body.value > 100)
        return res.status(400).json({ error: 'INVALID_COUPON', message: 'Percent coupons cannot exceed 100.' });
      res.status(201).json(await Storage.createCoupon({ storeId: req.session.userId!, ...body }));
    } catch (e: any) {
      phase3Error(e, res, 'COUPON_CREATE_FAILED');
    }
  });
  app.delete(api('/coupons/:id'), ownerOnly, async (req, res) => {
    const deleted = await Storage.deleteCoupon(req.params.id as string, req.session.userId!);
    if (!deleted) return res.status(404).json({ error: 'COUPON_NOT_FOUND' });
    res.json({ success: true });
  });
  app.get(api('/loyalty'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getLoyaltyAccountsByStore(storeId!));
  });
  app.get(api('/loyalty/:phone'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const account = await Storage.getLoyaltyAccount(storeId!, req.params.phone as string);
    res.json(account || { phone: req.params.phone, storeId, name: null, points: 0 });
  });

  // ---- Accountant exports (PG-aware reads; CSV opens in Excel) ----
  const csvResponse = (res: Response, filename: string, rows: Array<Array<string | number>>) => {
    // Lazy import keeps the reports block dependency-free.
    import('../shared/phase3')
      .then(({ toCsv }) => {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(toCsv(rows));
      })
      .catch(() => {
        if (!res.headersSent) res.status(500).json({ error: 'EXPORT_FAILED' });
      });
  };
  app.get(api('/reports/vat.csv'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const sales = await Storage.getSalesByStore(storeId!);
    const { vatReportRows } = await import('../shared/phase3');
    csvResponse(res, 'vat-report.csv', vatReportRows(sales as any));
  });
  app.get(api('/reports/profit-by-category.csv'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const sales = await Storage.getSalesByStore(storeId!);
    const { profitByCategoryRows } = await import('../shared/phase3');
    csvResponse(res, 'profit-by-category.csv', profitByCategoryRows(sales as any));
  });
  app.get(api('/reports/staff-performance.csv'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const sales = await Storage.getSalesByStore(storeId!);
    const { staffPerformanceRows } = await import('../shared/phase3');
    csvResponse(res, 'staff-performance.csv', staffPerformanceRows(sales as any));
  });
  app.get(api('/reports/excel.csv'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const sales = await Storage.getSalesByStore(storeId!);
    const { vatReportRows, profitByCategoryRows, staffPerformanceRows } = await import('../shared/phase3');
    const rows: Array<Array<string | number>> = [
      ['Amar Dokan — Accountant export (CSV, opens in Excel)'],
      [],
      ['VAT REPORT'],
      ...vatReportRows(sales as any),
      [],
      ['PROFIT BY CATEGORY'],
      ...profitByCategoryRows(sales as any),
      [],
      ['STAFF PERFORMANCE'],
      ...staffPerformanceRows(sales as any),
    ];
    csvResponse(res, 'amar-dokan-accountant-export.csv', rows);
  });
  // Full data export (owner-scoped, PIN-free — no user/staff/customer
  // credential material is included at all) + validated import.
  app.get(api('/reports/full-export'), ownerOrStaff, requirePermission('view_reports'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json({
      version: '3.0.0-phase3',
      exportedAt: new Date().toISOString(),
      storeId,
      // Phase 4: Phase 3 sections now come from the same store as the
      // core sections (PostgreSQL when connected, fallback otherwise) —
      // the old stale-fallback warning is gone.
      phase3FromFallbackStore: !getDbStatus().connected,
      phase3FallbackWarning: null,
      redactedFields: ['users[].pin', 'staff[].pin', 'customers[].pin'],
      securityNotice: 'This export contains no PIN verifiers or other credentials.',
      data: {
        products: await Storage.getProductsByStore(storeId!),
        sales: await Storage.getSalesByStore(storeId!),
        expenses: await Storage.getExpensesByStore(storeId!),
        inventoryLogs: await Storage.getInventoryLogsByStore(storeId!),
        shifts: await Storage.getShiftsByStore(storeId!),
        branches: await Storage.getBranchesByStore(storeId!),
        suppliers: await Storage.getSuppliersByStore(storeId!),
        purchaseOrders: await Storage.getPurchaseOrdersByStore(storeId!),
        coupons: await Storage.getCouponsByStore(storeId!),
        loyaltyAccounts: await Storage.getLoyaltyAccountsByStore(storeId!),
      },
    });
  });
  app.post(api('/reports/import'), ownerOnly, async (req, res) => {
    try {
      const { validateImport } = await import('../shared/phase3');
      const storeId = req.session.userId!;
      const existingIds: Record<string, Set<string>> = {
        products: new Set((await Storage.getProductsByStore(storeId)).map((p: any) => p.id)),
        suppliers: new Set((await Storage.getSuppliersByStore(storeId)).map((s: any) => s.id)),
        coupons: new Set((await Storage.getCouponsByStore(storeId)).map((c: any) => c.id)),
        branches: new Set((await Storage.getBranchesByStore(storeId)).map((b: any) => b.id)),
        counters: new Set(),
      };
      const validation = validateImport(req.body || {}, existingIds);
      const imported: Record<string, number> = {};
      const importSkips = [...validation.skips];
      const importErrors = [...validation.errors];
      // Reference data only; money records (sales/expenses) are never
      // imported — validateImport already counted them as skips.
      const productEntries = new Map<string, any>(
        (Array.isArray(req.body?.products) ? req.body.products : []).map((p: any) => [p?.id, p]),
      );
      for (const id of validation.creatable.products || []) {
        const p = productEntries.get(id);
        try {
          if (
            !p ||
            typeof p.name !== 'string' ||
            typeof p.price !== 'number' ||
            typeof p.cost !== 'number' ||
            typeof p.category !== 'string' ||
            typeof p.unit !== 'string' ||
            typeof p.stock !== 'number'
          ) {
            importSkips.push({ section: 'products', id, reason: 'INVALID_PRODUCT_FIELDS' });
            continue;
          }
          await Storage.upsertProduct({ ...p, storeId }, storeId, storeId);
          imported.products = (imported.products || 0) + 1;
        } catch (e: any) {
          importSkips.push({ section: 'products', id, reason: `IMPORT_FAILED: ${e?.message || 'unknown'}` });
        }
      }
      // Phase 4: Phase 3 sections import on PostgreSQL too now
      // (storage.ts PG branch) — the old PHASE3_PG_PENDING skip is gone.
      const supplierEntries = new Map<string, any>(
        (Array.isArray(req.body?.suppliers) ? req.body.suppliers : []).map((s: any) => [s?.id, s]),
      );
      for (const id of validation.creatable.suppliers || []) {
        const s = supplierEntries.get(id);
        if (!s || typeof s.name !== 'string') {
          importSkips.push({ section: 'suppliers', id, reason: 'INVALID_SUPPLIER_FIELDS' });
          continue;
        }
        await Storage.createSupplier({ storeId, name: s.name, phone: s.phone, address: s.address, notes: s.notes });
        imported.suppliers = (imported.suppliers || 0) + 1;
      }
      const couponEntries = new Map<string, any>(
        (Array.isArray(req.body?.coupons) ? req.body.coupons : []).map((c: any) => [c?.id, c]),
      );
      for (const id of validation.creatable.coupons || []) {
        const c = couponEntries.get(id);
        if (!c || typeof c.code !== 'string' || (c.type !== 'percent' && c.type !== 'fixed')) {
          importSkips.push({ section: 'coupons', id, reason: 'INVALID_COUPON_FIELDS' });
          continue;
        }
        await Storage.createCoupon({
          storeId,
          code: c.code,
          type: c.type,
          value: Number(c.value) || 0,
          minPurchase: Number(c.minPurchase) || 0,
          maxUses: Number(c.maxUses) || 0,
          expiresAt: c.expiresAt || null,
        });
        imported.coupons = (imported.coupons || 0) + 1;
      }
      const branchEntries = new Map<string, any>(
        (Array.isArray(req.body?.branches) ? req.body.branches : []).map((b: any) => [b?.id, b]),
      );
      for (const id of validation.creatable.branches || []) {
        const b = branchEntries.get(id);
        if (!b || typeof b.name !== 'string') {
          importSkips.push({ section: 'branches', id, reason: 'INVALID_BRANCH_FIELDS' });
          continue;
        }
        await Storage.createBranch({ storeId, name: b.name, address: b.address });
        imported.branches = (imported.branches || 0) + 1;
      }
      const counterEntries = new Map<string, any>(
        (Array.isArray(req.body?.counters) ? req.body.counters : []).map((c: any) => [c?.id, c]),
      );
      const liveBranches = await Storage.getBranchesByStore(storeId);
      for (const id of validation.creatable.counters || []) {
        const c = counterEntries.get(id);
        const branchMatch = liveBranches.find((b: any) => b.id === c?.branchId || b.name === c?.branchName);
        if (!c || typeof c.name !== 'string' || !branchMatch) {
          importSkips.push({ section: 'counters', id, reason: 'INVALID_COUNTER_BRANCH' });
          continue;
        }
        await Storage.createCounter({ storeId, branchId: branchMatch.id, name: c.name });
        imported.counters = (imported.counters || 0) + 1;
      }
      res.json({ counts: validation.counts, imported, skips: importSkips, errors: importErrors });
    } catch (e: any) {
      res.status(500).json({ error: 'IMPORT_FAILED', message: e?.message });
    }
  });

  // =========================================================
  // ADMIN
  // =========================================================
  async function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (req.session.role !== 'owner' || !req.session.userId) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    if (!isPlatformAdminId(req.session.userId)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    next();
  }

  app.get(api('/admin/users'), requireAdmin, async (req, res) => {
    const users = await Storage.getAllUsers();
    res.json(users.map((u: any) => ({ ...u, pin: undefined })));
  });

  app.delete(api('/admin/users/:id'), requireAdmin, async (req, res) => {
    // Phase 4: an admin could delete their own account and lock every
    // admin out of the platform. Self-deletion is refused.
    if (req.params.id === req.session.userId) {
      return res.status(403).json({ error: 'CANNOT_DELETE_SELF' });
    }
    await Storage.deleteUser(req.params.id as string);
    res.json({ success: true });
  });

  app.post(api('/admin/users/:id/unlock'), requireAdmin, async (req, res) => {
    // Phase 4: an absent/short newPin used to throw inside hashPin and
    // surface as a 500. It is validated up front now.
    if (typeof req.body.newPin !== 'string' || req.body.newPin.length < 4 || req.body.newPin.length > 128) {
      return res.status(400).json({ error: 'INVALID_PIN', message: 'New PIN must be 4–128 characters.' });
    }
    await Storage.updateUser(req.params.id as string, {
      isLocked: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      pin: await hashPin(req.body.newPin),
    });
    res.json({ success: true });
  });

  app.get(api('/admin/sales'), requireAdmin, async (req, res) => {
    res.json(await Storage.getAllSales());
  });

  app.get(api('/admin/subscription-requests'), requireAdmin, async (req, res) => {
    res.json(await Storage.getAllSubscriptionRequests());
  });

  app.post(api('/admin/subscription-requests/:id/approve'), requireAdmin, async (req, res) => {
    try {
      const request = await Storage.getSubscriptionRequestById(req.params.id as string);
      if (!request) return res.status(404).json({ error: 'NOT_FOUND' });
      const user = await Storage.getUserById(request.userId);
      if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

      const globalPricing: any = (await Storage.getSetting('pricing_config')) || DEFAULT_GLOBAL_PRICING;
      const categoryPricing = globalPricing[user.storeCategory] || globalPricing.grocery;
      const durationDays = categoryPricing[request.package]?.durationDays || 30;

      let newExpiry = new Date();
      if (user.plan === 'premium' && user.subscriptionExpiry) {
        const currentExpiry = new Date(user.subscriptionExpiry);
        if (!isNaN(currentExpiry.getTime()) && currentExpiry > newExpiry) newExpiry = currentExpiry;
      }
      newExpiry.setDate(newExpiry.getDate() + durationDays);

      await Storage.updateUser(user.id, {
        plan: 'premium',
        subscriptionStatus: 'active',
        subscriptionExpiry: newExpiry,
      });
      await Storage.updateSubscriptionRequest(request.id, { status: 'approved' });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post(api('/admin/subscription-requests/:id/reject'), requireAdmin, async (req, res) => {
    const request = await Storage.getSubscriptionRequestById(req.params.id as string);
    if (!request) return res.status(404).json({ error: 'NOT_FOUND' });
    await Storage.updateSubscriptionRequest(request.id, { status: 'rejected' });
    const user = await Storage.getUserById(request.userId);
    if (user && user.subscriptionStatus === 'pending_approval') {
      await Storage.updateUser(user.id, { subscriptionStatus: 'active' });
    }
    res.json({ success: true });
  });

  app.put(api('/admin/payment-settings'), requireAdmin, async (req, res) => {
    // Phase 4: settings used to accept any JSON shape, so a malformed
    // admin save could break every store's payment display. Shapes are
    // validated now; pricing/global config must be objects.
    if (
      (req.body.bkash !== undefined && typeof req.body.bkash !== 'string') ||
      (req.body.nagad !== undefined && typeof req.body.nagad !== 'string')
    ) {
      return res.status(400).json({ error: 'INVALID_PAYMENT_SETTINGS' });
    }
    await Storage.setSetting('payment_info', { bkash: req.body.bkash, nagad: req.body.nagad });
    res.json({ success: true });
  });

  app.put(api('/admin/pricing-config'), requireAdmin, async (req, res) => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'INVALID_PRICING_CONFIG' });
    }
    await Storage.setSetting('pricing_config', req.body);
    res.json({ success: true });
  });

  app.put(api('/admin/global-config'), requireAdmin, async (req, res) => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'INVALID_GLOBAL_CONFIG' });
    }
    await Storage.setSetting('global_config', req.body);
    res.json({ success: true });
  });

  app.get(api('/admin/announcements'), requireAdmin, async (req, res) => {
    res.json(await Storage.getAllAnnouncements());
  });

  app.post(api('/admin/announcements'), requireAdmin, async (req, res) => {
    res.json(await Storage.createAnnouncement({ ...req.body, id: genId() }));
  });

  app.delete(api('/admin/announcements/:id'), requireAdmin, async (req, res) => {
    await Storage.deleteAnnouncement(req.params.id as string);
    res.json({ success: true });
  });

  app.post(api('/admin/sync/replay'), requireAdmin, async (req, res) => {
    try {
      const { db: pgDb } = await import('./db');
      if (!pgDb)
        return res.json({ replayed: 0, failed: 0, remaining: getOutboxDepth(), reason: 'database-not-configured' });
      const result = await replayOutbox(pgDb);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: 'REPLAY_FAILED', message: e.message });
    }
  });

  // Phase 2 — admin system-status view. Wired to the SAME live sources the
  // health endpoint uses (live DB ping, disk outbox depth) plus the last
  // backup-export time — never a cached or invented value. The error
  // tracking DSN is never exposed, only its configured/enabled booleans.
  app.get(api('/admin/system-status'), requireAdmin, async (req, res) => {
    let databasePing: { connected: boolean; ms: number | null; error: string | null } | null = null;
    if (pool) databasePing = await pingDatabase(2000);
    const dbStatus = getDbStatus();
    const backup = getLastBackup();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
      version: '2.0.0-os',
      database: {
        configured: dbStatus.configured,
        connected: databasePing?.connected === true,
        pingMs: databasePing?.ms ?? null,
        lastError: databasePing?.error ?? dbStatus.lastError,
        lastProbeAt: dbStatus.lastProbeAt,
      },
      fallbackMode: databasePing?.connected === true ? 'postgresql' : 'disk-persisted-fallback',
      fallbackSnapshotExists: snapshotExists(),
      syncQueueDepth: getOutboxDepth(),
      lastBackupAt: backup.lastBackupAt,
      lastBackupBy: backup.lastBackupBy,
      errorTracking: errorTrackingStatus(),
    });
  });

  app.get(api('/admin/backups/export'), requireAdmin, async (req, res) => {
    try {
      const backup = await Storage.exportDatabaseBackup();
      // Phase 2: record the export time so system-status can report it.
      recordBackupExport(req.session.userId ?? null);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="amar-dokan-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      res.json(backup);
    } catch (e: any) {
      res.status(500).json({ error: 'BACKUP_EXPORT_FAILED', message: e.message });
    }
  });

  app.get(api('/announcements'), async (req, res) => {
    res.json(await Storage.getAllAnnouncements());
  });

  // =========================================================
  // MARKETPLACE (Customer-facing: browse all stores, search, order, track)
  // =========================================================
  app.get(api('/marketplace/stores'), async (req, res) => {
    res.json(await Storage.getStoresDirectory());
  });

  app.get(api('/marketplace/stores/:storeId/products'), async (req, res) => {
    const products = await Storage.getProductsByStore(req.params.storeId as string);
    res.json(publicProductList(products.filter((p: any) => p.isOnlineVisible)));
  });

  app.get(api('/marketplace/products'), async (req, res) => {
    const { q, category } = req.query;
    const products = await Storage.searchAllProducts(q as string | undefined, category as string | undefined);
    // attach store names
    const storeCache = new Map<string, string>();
    const enriched = await Promise.all(
      products.map(async (p: any) => {
        if (!storeCache.has(p.storeId)) {
          const owner = await Storage.getUserById(p.storeId);
          storeCache.set(p.storeId, owner?.storeName || 'Store');
        }
        return { ...publicProductList([p])[0], storeName: storeCache.get(p.storeId) };
      }),
    );
    res.json(enriched);
  });

  const customerOnly = requireAuth(['customer']);

  app.post(api('/marketplace/orders'), customerOnly, async (req, res) => {
    try {
      const customer = await Storage.getCustomerById(req.session.customerId!);
      if (!customer) return res.status(401).json({ error: 'UNAUTHORIZED' });
      const { storeId, items, deliveryAddress, paymentMethod, note, idempotencyKey } = req.body;
      if (
        typeof idempotencyKey !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
      )
        return res.status(400).json({ error: 'INVALID_IDEMPOTENCY_KEY' });
      if (typeof storeId !== 'string' || !Array.isArray(items)) {
        return res.status(400).json({ error: 'INVALID_ORDER' });
      }
      if (typeof deliveryAddress !== 'string' || !deliveryAddress.trim() || deliveryAddress.length > 500) {
        return res.status(400).json({ error: 'INVALID_DELIVERY_ADDRESS' });
      }
      if (paymentMethod !== undefined && paymentMethod !== 'cod') {
        return res.status(400).json({ error: 'UNSUPPORTED_PAYMENT_METHOD' });
      }
      if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
        return res.status(400).json({ error: 'INVALID_ORDER_NOTE' });
      }
      const owner = await Storage.getUserById(storeId);
      if (!owner) return res.status(404).json({ error: 'STORE_NOT_FOUND' });
      const orderItems = items.map((item: any) => ({
        id: typeof item?.id === 'string' ? item.id : '',
        quantity: item?.quantity,
        note: typeof item?.note === 'string' ? item.note.slice(0, 200) : undefined,
      }));
      const order = await Storage.createMarketplaceOrder({
        id: idempotencyKey,
        customerId: customer.id,
        storeId,
        storeName: owner.storeName,
        customerName: customer.name,
        customerPhone: customer.phone,
        deliveryAddress: deliveryAddress.trim(),
        items: orderItems,
        paymentMethod: 'cod',
        note: note?.trim(),
      });
      res.status(201).json(order);
    } catch (e: any) {
      if (e instanceof StorageRuleError) {
        return res.status(e.status).json({ error: e.code, message: e.message });
      }
      if (e instanceof Error && /^INVALID_[A-Z_]+:/.test(e.message)) {
        const [code, ...details] = e.message.split(':');
        return res.status(400).json({ error: code, message: details.join(':') });
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.get(api('/marketplace/orders/mine'), customerOnly, async (req, res) => {
    res.json(await Storage.getOnlineOrdersByCustomer(req.session.customerId!));
  });

  app.get(api('/marketplace/orders/:id'), customerOnly, async (req, res) => {
    const order = await Storage.getOnlineOrderById(req.params.id as string);
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
    if (order.customerId !== req.session.customerId) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(order);
  });

  // Store owner side: view + update online orders
  app.get(api('/orders/store'), ownerOrStaff, requirePermission('process_sale'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getOnlineOrdersByStore(storeId!));
  });

  app.put(api('/orders/:id/status'), ownerOrStaff, requirePermission('process_sale'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      const actorId = req.session.role === 'staff' ? req.session.staffId! : req.session.userId!;
      const order = await Storage.updateOnlineOrderStatusForStore(
        req.params.id as string,
        storeId!,
        req.body.status,
        actorId,
      );
      if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
      res.json(order);
    } catch (e: any) {
      if (e instanceof StorageRuleError) {
        return res.status(e.status).json({ error: e.code, message: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.put(
    api('/products/:id/online-visibility'),
    ownerOrStaff,
    requirePermission('manage_inventory'),
    async (req, res) => {
      try {
        const storeId = await currentStoreId(req);
        const existing = await Storage.getProductById(req.params.id as string);
        if (!existing || existing.storeId !== storeId) {
          return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
        }
        if (typeof req.body.isOnlineVisible !== 'boolean') {
          return res.status(400).json({ error: 'INVALID_VISIBILITY' });
        }
        const { product } = await Storage.upsertProduct(
          { ...existing, isOnlineVisible: req.body.isOnlineVisible },
          storeId!,
          req.session.role === 'staff' ? req.session.staffId : req.session.userId,
        );
        res.json(product);
      } catch (e: any) {
        if (e instanceof StorageRuleError) {
          return res.status(e.status).json({ error: e.code, message: e.message });
        }
        res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    },
  );
}
