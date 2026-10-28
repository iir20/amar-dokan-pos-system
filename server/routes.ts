import type { Express, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Storage, genId, DEFAULT_GLOBAL_PRICING, LIMITS, StorageRuleError, isPlatformAdminId } from './storage';
import { hashPin, verifyPin } from './credentials';
import { pool } from './db';
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

const PgSession = connectPgSimple(session);

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
      req.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });
}

function publicUser(user: any) {
  const { pin: _pin, ...safeUser } = user;
  return { ...safeUser, isPlatformAdmin: isPlatformAdminId(user.id) };
}

export function registerRoutes(app: Express) {
  app.set('trust proxy', 1);
  const configuredSessionSecret = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production' && (!configuredSessionSecret || configuredSessionSecret.length < 32)) {
    throw new Error('SESSION_SECRET must be configured with at least 32 characters in production.');
  }
  app.use(
    session({
      store: new PgSession({ pool, createTableIfMissing: true }),
      secret: configuredSessionSecret || crypto.randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    })
  );

  const api = (path: string) => `/api${path}`;

  // =========================================================
  // AUTH - Store Owner / Staff
  // =========================================================
  app.post(api('/auth/register'), authRateLimit, async (req, res) => {
    try {
      const { storeName, storeCategory, username, pin, address, phone } = req.body;
      if (
        typeof storeName !== 'string' || !storeName.trim() ||
        typeof storeCategory !== 'string' || !storeCategory.trim() ||
        typeof username !== 'string' || !username.trim() ||
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

      const staffMember = await Storage.getStaffByUsername(username);
      if (staffMember) {
        const verification = await verifyPin(pin, staffMember.pin);
        if (!verification.valid) return res.status(401).json({ error: 'INVALID' });
        if (verification.needsRehash) {
          await Storage.updateStaff(staffMember.id, { pin: await hashPin(pin) });
        }
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
        typeof name !== 'string' || !name.trim() ||
        typeof phone !== 'string' || !phone.trim() ||
        typeof pin !== 'string'
      ) return res.status(400).json({ error: 'MISSING_FIELDS' });
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

  app.get(api('/products'), ownerOrStaff, async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getProductsByStore(storeId!));
  });

  app.post(api('/products'), ownerOrStaff, requirePermission('manage_inventory'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      const owner = await Storage.getUserById(storeId!);
      const product = { ...req.body, storeId };

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
    const deleted = await Storage.deleteProduct((req.params.id as string), storeId!);
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
        maxDiscountPercent: req.session.role === 'owner'
          ? configuredPercent('OWNER_MAX_DISCOUNT_PERCENT', 100)
          : configuredPercent('STAFF_MAX_DISCOUNT_PERCENT', 10),
        servedBy: req.session.role === 'staff' ? req.session.staffName : 'Owner',
        actorId: req.session.role === 'staff' ? req.session.staffId : req.session.userId,
      });
      res.json(saved);
    } catch (e: any) {
      if (e instanceof StorageRuleError) {
        return res.status(e.status).json({ error: e.code, message: e.message });
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
      typeof description !== 'string' || !description.trim() ||
      typeof category !== 'string' || !category.trim() ||
      typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0
    ) {
      return res.status(400).json({ error: 'INVALID_EXPENSE' });
    }
    res.status(201).json(await Storage.createExpense({
      id: genId(),
      description: description.trim(),
      amount,
      category: category.trim(),
      date: new Date(),
      storeId: storeId!,
    }));
  });

  app.delete(api('/expenses/:id'), ownerOrStaff, requirePermission('manage_expenses'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const deleted = await Storage.deleteExpense((req.params.id as string), storeId!);
    if (!deleted) return res.status(404).json({ error: 'EXPENSE_NOT_FOUND' });
    res.json({ success: true });
  });

  app.get(api('/inventory-logs'), ownerOrStaff, requirePermission('view_reports', 'manage_inventory'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getInventoryLogsByStore(storeId!));
  });

  // ---- Staff Management (owner only) ----
  const ownerOnly = requireAuth(['owner']);

  app.get(api('/staff'), ownerOnly, async (req, res) => {
    const staff = await Storage.getStaffByOwner(req.session.userId!);
    res.json(staff.map(({ pin: _pin, ...safeStaff }) => safeStaff));
  });

  app.post(api('/staff'), ownerOnly, async (req, res) => {
    try {
      if (
        typeof req.body.name !== 'string' || !req.body.name.trim() ||
        typeof req.body.username !== 'string' || !req.body.username.trim() ||
        typeof req.body.pin !== 'string' ||
        !Array.isArray(req.body.permissions) ||
        req.body.permissions.some((permission: unknown) =>
          typeof permission !== 'string' || !ALLOWED_STAFF_PERMISSIONS.has(permission))
      ) {
        return res.status(400).json({ error: 'INVALID_STAFF' });
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
      if (req.body.permissions.some((permission: unknown) =>
        typeof permission !== 'string' || !ALLOWED_STAFF_PERMISSIONS.has(permission))) {
        return res.status(400).json({ error: 'INVALID_PERMISSIONS' });
      }
      updates.permissions = req.body.permissions;
    }
    if (typeof req.body.pin === 'string' && req.body.pin.trim()) updates.pin = await hashPin(req.body.pin);
    const staff = await Storage.updateStaffForOwner(
      req.params.id as string,
      req.session.userId!,
      updates,
    );
    if (!staff) return res.status(404).json({ error: 'STAFF_NOT_FOUND' });
    res.json({ ...staff, pin: undefined });
  });

  app.delete(api('/staff/:id'), ownerOnly, async (req, res) => {
    const deleted = await Storage.deleteStaffForOwner(
      req.params.id as string,
      req.session.userId!,
    );
    if (!deleted) return res.status(404).json({ error: 'STAFF_NOT_FOUND' });
    res.json({ success: true });
  });

  // ---- Profile ----
  app.put(api('/profile'), requireAuth(['owner']), async (req, res) => {
    const updates: Record<string, any> = {};
    for (const field of ['storeName', 'storeCategory', 'address', 'phone', 'zila', 'upozila', 'thana', 'profilePicture']) {
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
    const request = await Storage.createSubscriptionRequest({ ...req.body, id: genId(), userId: req.session.userId! });
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
  app.get(api('/restaurant/tables'), ownerOrStaff, requirePermission('manage_restaurant', 'manage_settings'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getTablesByStore(storeId!));
  });

  app.post(api('/restaurant/tables'), ownerOrStaff, requirePermission('manage_restaurant', 'manage_settings'), async (req, res) => {
    const storeId = await currentStoreId(req);
    if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
      return res.status(400).json({ error: 'INVALID_TABLE_NAME' });
    }
    const table = await Storage.createTable({ id: genId(), storeId: storeId!, name: req.body.name.trim(), isActive: true });
    res.json(table);
  });

  app.delete(api('/restaurant/tables/:id'), ownerOrStaff, requirePermission('manage_restaurant', 'manage_settings'), async (req, res) => {
    const storeId = await currentStoreId(req);
    const deleted = await Storage.deleteTable((req.params.id as string), storeId!);
    if (!deleted) return res.status(404).json({ error: 'TABLE_NOT_FOUND' });
    res.json({ success: true });
  });

  app.get(api('/restaurant/guest-orders'), ownerOrStaff, requirePermission('manage_restaurant'), async (req, res) => {
    const storeId = await currentStoreId(req);
    res.json(await Storage.getGuestOrdersByStore(storeId!));
  });

  app.put(api('/restaurant/guest-orders/:id'), ownerOrStaff, requirePermission('manage_restaurant'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      const order = await Storage.updateGuestOrder(
        req.params.id as string,
        storeId!,
        req.body.status,
      );
      res.json(order);
    } catch (e: any) {
      if (e instanceof StorageRuleError) {
        return res.status(e.status).json({ error: e.code, message: e.message });
      }
      if (e instanceof Error && /^INVALID_[A-Z_]+:/.test(e.message)) {
        const [code, ...details] = e.message.split(':');
        return res.status(400).json({ error: code, message: details.join(':') });
      }
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // Public guest-facing routes (no auth - accessed via QR code)
  app.get(api('/public/store/:storeId/menu'), async (req, res) => {
    const products = await Storage.getProductsByStore((req.params.storeId as string));
    res.json(products.filter((product) => product.isOnlineVisible !== false));
  });

  app.get(api('/public/table/:tableId'), async (req, res) => {
    const table = await Storage.getTableById((req.params.tableId as string));
    if (!table || !table.isActive) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(table);
  });

  app.post(api('/public/guest-orders'), async (req, res) => {
    try {
      if (typeof req.body.idempotencyKey !== 'string') {
        return res.status(400).json({ error: 'INVALID_IDEMPOTENCY_KEY', message: 'A request id is required.' });
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
      res.status(201).json(order);
    } catch (e: any) {
      if (e instanceof StorageRuleError) {
        return res.status(e.status).json({ error: e.code, message: e.message });
      }
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  app.get(api('/public/guest-orders/:id'), async (req, res) => {
    const order = await Storage.getGuestOrderById((req.params.id as string));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(order);
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
    res.json(users.map(u => ({ ...u, pin: undefined })));
  });

  app.delete(api('/admin/users/:id'), requireAdmin, async (req, res) => {
    await Storage.deleteUser((req.params.id as string));
    res.json({ success: true });
  });

  app.post(api('/admin/users/:id/unlock'), requireAdmin, async (req, res) => {
    await Storage.updateUser((req.params.id as string), {
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
      const request = await Storage.getSubscriptionRequestById((req.params.id as string));
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

      await Storage.updateUser(user.id, { plan: 'premium', subscriptionStatus: 'active', subscriptionExpiry: newExpiry });
      await Storage.updateSubscriptionRequest(request.id, { status: 'approved' });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post(api('/admin/subscription-requests/:id/reject'), requireAdmin, async (req, res) => {
    const request = await Storage.getSubscriptionRequestById((req.params.id as string));
    if (!request) return res.status(404).json({ error: 'NOT_FOUND' });
    await Storage.updateSubscriptionRequest(request.id, { status: 'rejected' });
    const user = await Storage.getUserById(request.userId);
    if (user && user.subscriptionStatus === 'pending_approval') {
      await Storage.updateUser(user.id, { subscriptionStatus: 'active' });
    }
    res.json({ success: true });
  });

  app.put(api('/admin/payment-settings'), requireAdmin, async (req, res) => {
    await Storage.setSetting('payment_info', { bkash: req.body.bkash, nagad: req.body.nagad });
    res.json({ success: true });
  });

  app.put(api('/admin/pricing-config'), requireAdmin, async (req, res) => {
    await Storage.setSetting('pricing_config', req.body);
    res.json({ success: true });
  });

  app.put(api('/admin/global-config'), requireAdmin, async (req, res) => {
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
    await Storage.deleteAnnouncement((req.params.id as string));
    res.json({ success: true });
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
    const products = await Storage.getProductsByStore((req.params.storeId as string));
    res.json(products.filter(p => p.isOnlineVisible));
  });

  app.get(api('/marketplace/products'), async (req, res) => {
    const { q, category } = req.query;
    const products = await Storage.searchAllProducts(q as string | undefined, category as string | undefined);
    // attach store names
    const storeCache = new Map<string, string>();
    const enriched = await Promise.all(products.map(async (p) => {
      if (!storeCache.has(p.storeId)) {
        const owner = await Storage.getUserById(p.storeId);
        storeCache.set(p.storeId, owner?.storeName || 'Store');
      }
      return { ...p, storeName: storeCache.get(p.storeId) };
    }));
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
      ) return res.status(400).json({ error: 'INVALID_IDEMPOTENCY_KEY' });
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
    const order = await Storage.getOnlineOrderById((req.params.id as string));
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

  app.put(api('/products/:id/online-visibility'), ownerOrStaff, requirePermission('manage_inventory'), async (req, res) => {
    try {
      const storeId = await currentStoreId(req);
      const existing = await Storage.getProductById((req.params.id as string));
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
  });
}
