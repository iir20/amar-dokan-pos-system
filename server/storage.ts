import { db, pool, getDbStatus, markDbDisconnected } from './db';
import * as schema from '../shared/schema';
import { eq, desc, gte, and, or, ilike, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { calculateSaleTotals, moneyToMinor, PaymentMethod, quantityToUnits } from '../shared/finance';
import {
  forecastDemand,
  expiryAlerts,
  deadStock,
  validateCoupon,
  loyaltyEarned,
  loyaltyRedeemable,
  type Coupon as Phase3Coupon,
} from '../shared/phase3';
import { MemStorage } from './memStorage';
import { broadcastToStore } from './live';

export const genId = () => crypto.randomUUID();

export const DEFAULT_GLOBAL_PRICING = {
  grocery: {
    monthly: { price: 100, label: 'Monthly', labelBn: 'মাসিক', durationDays: 30 },
    yearly: { price: 1000, label: 'Yearly', labelBn: 'বাৎসরিক', durationDays: 365 },
    '2yearly': { price: 1500, label: '2 Years', labelBn: '২ বছর', durationDays: 730 },
  },
  medicine: {
    monthly: { price: 100, label: 'Monthly', labelBn: 'মাসিক', durationDays: 30 },
    yearly: { price: 1000, label: 'Yearly', labelBn: 'বাৎসরিক', durationDays: 365 },
    '2yearly': { price: 1500, label: '2 Years', labelBn: '২ বছর', durationDays: 730 },
  },
  clothing: {
    monthly: { price: 100, label: 'Monthly', labelBn: 'মাসিক', durationDays: 30 },
    yearly: { price: 1000, label: 'Yearly', labelBn: 'বাৎসরিক', durationDays: 365 },
    '2yearly': { price: 1500, label: '2 Years', labelBn: '২ বছর', durationDays: 730 },
  },
  electronics: {
    monthly: { price: 150, label: 'Tech Monthly', labelBn: 'টেক মাসিক', durationDays: 30 },
    yearly: { price: 1500, label: 'Tech Yearly', labelBn: 'টেক বাৎসরিক', durationDays: 365 },
    '2yearly': { price: 2500, label: 'Tech 2 Years', labelBn: 'টেক ২ বছর', durationDays: 730 },
  },
  restaurant: {
    monthly: { price: 300, label: 'Rest. Monthly', labelBn: 'রেস্টুরেন্ট মাসিক', durationDays: 30 },
    yearly: { price: 3000, label: 'Rest. Yearly', labelBn: 'রেস্টুরেন্ট বাৎসরিক', durationDays: 365 },
    '2yearly': { price: 5000, label: 'Rest. 2 Years', labelBn: 'রেস্টুরেন্ট ২ বছর', durationDays: 730 },
  },
  other: {
    monthly: { price: 100, label: 'Monthly', labelBn: 'মাসিক', durationDays: 30 },
    yearly: { price: 1000, label: 'Yearly', labelBn: 'বাৎসরিক', durationDays: 365 },
    '2yearly': { price: 1500, label: '2 Years', labelBn: '২ বছর', durationDays: 730 },
  },
} as const;

export const LIMITS = { FREE_PRODUCT_LIMIT: 20, FREE_DAILY_SALES_LIMIT: 10 };

export { StorageRuleError } from './errors';
import { StorageRuleError } from './errors';

// Phase 1 fix (P1-1): platform admin ONLY via PLATFORM_ADMIN_USER_IDS.
// The old unconditional DEMO_OWNER_ID / 'admin-id' bypass is removed: a demo
// or legacy id is never an admin unless explicitly allowlisted here.
export function isPlatformAdminId(userId?: string): boolean {
  if (!userId) return false;
  const allowedIds = (process.env.PLATFORM_ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return allowedIds.includes(userId);
}

type RequestedSale = {
  id: string;
  items: Array<{ id: string; quantity: number; price?: number; note?: string }>;
  discount?: number;
  paymentMethod: PaymentMethod;
  paidAmount?: number;
  cashReceived?: number;
  customerName?: string;
  customerPhone?: string;
  couponCode?: string;
  loyaltyPointsRedeem?: number;
  branchId?: string;
  counterId?: string;
};

function requestedSaleReceivedAmount(sale: RequestedSale): number | null {
  if (sale.paymentMethod === 'cash') {
    return sale.cashReceived ?? sale.paidAmount ?? null;
  }
  return sale.paidAmount ?? null;
}

function isIdempotentSaleReplay(existing: schema.Sale, incoming: RequestedSale): boolean {
  if (
    existing.paymentMethod !== incoming.paymentMethod ||
    moneyToMinor(existing.discount, 'discount') !== moneyToMinor(incoming.discount ?? 0, 'discount') ||
    existing.customerName !== (incoming.customerName || null) ||
    existing.customerPhone !== (incoming.customerPhone || null)
  )
    return false;

  const savedItems = existing.items as Array<{ id: string; quantity: number; price: number; note?: string }>;
  if (savedItems.length !== incoming.items.length) return false;
  for (let index = 0; index < savedItems.length; index += 1) {
    const saved = savedItems[index];
    const requested = incoming.items[index];
    if (
      saved.id !== requested.id ||
      saved.quantity !== requested.quantity ||
      (requested.price !== undefined &&
        moneyToMinor(saved.price, 'price') !== moneyToMinor(requested.price, 'price')) ||
      (saved.note || '') !== (requested.note || '')
    )
      return false;
  }

  const requestedReceived = requestedSaleReceivedAmount(incoming);
  if (requestedReceived === null) return existing.paidAmount === existing.totalAmount;
  const expectedReceived =
    incoming.paymentMethod === 'cash' ? (existing.cashReceived ?? existing.paidAmount) : existing.paidAmount;
  return moneyToMinor(expectedReceived, 'payment') === moneyToMinor(requestedReceived, 'payment');
}

// Phase 1 fix (P0-1): try PostgreSQL whenever a pool exists and fall back
// ONLY on an actual error (the old code gated on a flag that was never set
// to true, so the database branch was dead). A failed operation marks the
// database disconnected so /api/health reports the live state; the next
// operation (or the re-probe timer) retries the database.
//
// Phase 4 fix: business validation errors must NEVER fall back. A
// StorageRuleError (or a finance INVALID_* error) thrown by the PG
// branch means "this request is invalid", not "the database is down".
// Falling back on it used to mask the real error (a PG coupon rejection
// surfaced as a fallback PRODUCT_NOT_FOUND 409) and could even let a
// request the database rejected succeed against stale fallback data.
// Only genuine database errors fall back now.
async function op<T>(dbFn: () => Promise<T>, memFn: () => Promise<T>): Promise<T> {
  if (!pool || !db) {
    return memFn();
  }
  try {
    return await dbFn();
  } catch (err: any) {
    if (err instanceof StorageRuleError || err?.name === 'StorageRuleError') {
      throw err;
    }
    if (err instanceof Error && /^INVALID_[A-Z_]+:/.test(err.message)) {
      throw err;
    }
    markDbDisconnected(err);
    console.warn('[AmarDokan] Database operation failed, falling back to disk-persisted store:', err.message);
    return memFn();
  }
}

export function getDatabaseStatus() {
  return getDbStatus();
}

export const Storage = {
  // ---------------- Users (Owners/Admin) ----------------
  async getUserById(id: string) {
    return op(
      async () => {
        const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
        return u || null;
      },
      () => MemStorage.getUserById(id),
    );
  },
  async getUserByUsername(username: string) {
    return op(
      async () => {
        const [u] = await db.select().from(schema.users).where(eq(schema.users.username, username));
        return u || null;
      },
      () => MemStorage.getUserByUsername(username),
    );
  },
  async getAllUsers() {
    return op(
      async () => db.select().from(schema.users),
      () => MemStorage.getAllUsers(),
    );
  },
  async createUser(data: typeof schema.users.$inferInsert) {
    return op(
      async () => {
        const [u] = await db.insert(schema.users).values(data).returning();
        return u;
      },
      () => MemStorage.createUser(data),
    );
  },
  async updateUser(id: string, data: Partial<typeof schema.users.$inferInsert>) {
    return op(
      async () => {
        const [u] = await db.update(schema.users).set(data).where(eq(schema.users.id, id)).returning();
        return u;
      },
      () => MemStorage.updateUser(id, data),
    );
  },
  async deleteUser(id: string) {
    return op(
      async () => {
        await db.delete(schema.users).where(eq(schema.users.id, id));
      },
      () => MemStorage.deleteUser(id),
    );
  },
  async ensureFreshPlan(user: schema.User) {
    if (user.plan === 'premium' && user.subscriptionExpiry) {
      const expiry = new Date(user.subscriptionExpiry);
      if (new Date() > expiry) {
        return this.updateUser(user.id, { plan: 'free', subscriptionStatus: 'expired' });
      }
    }
    return user;
  },

  // ---------------- Staff ----------------
  async getStaffByOwner(ownerId: string) {
    return op(
      async () => db.select().from(schema.staff).where(eq(schema.staff.ownerId, ownerId)),
      () => MemStorage.getStaffByOwner(ownerId),
    );
  },
  async getStaffByUsername(username: string) {
    return op(
      async () => {
        const [s] = await db.select().from(schema.staff).where(eq(schema.staff.username, username));
        return s || null;
      },
      () => MemStorage.getStaffByUsername(username),
    );
  },
  // Phase 4: every staff row sharing a username (fallback store never
  // enforced uniqueness; PG enforces a unique column, so this is a
  // one-row list there). Login verifies the PIN against each candidate.
  async getStaffByUsernameAll(username: string) {
    return op(
      async () => {
        const rows = await db
          .select()
          .from(schema.staff)
          .where(sql`lower(${schema.staff.username}) = lower(${username})`);
        return rows;
      },
      () => MemStorage.getStaffByUsernameAll(username),
    );
  },
  async getStaffById(id: string) {
    return op(
      async () => {
        const [s] = await db.select().from(schema.staff).where(eq(schema.staff.id, id));
        return s || null;
      },
      () => MemStorage.getStaffById(id),
    );
  },
  async createStaff(data: typeof schema.staff.$inferInsert) {
    return op(
      async () => {
        const [s] = await db.insert(schema.staff).values(data).returning();
        return s;
      },
      () => MemStorage.createStaff(data),
    );
  },
  async updateStaff(id: string, data: Partial<typeof schema.staff.$inferInsert>) {
    return op(
      async () => {
        const [s] = await db.update(schema.staff).set(data).where(eq(schema.staff.id, id)).returning();
        return s;
      },
      () => MemStorage.updateStaff(id, data),
    );
  },
  async updateStaffForOwner(id: string, ownerId: string, data: Partial<typeof schema.staff.$inferInsert>) {
    return op(
      async () => {
        const [s] = await db
          .update(schema.staff)
          .set(data)
          .where(and(eq(schema.staff.id, id), eq(schema.staff.ownerId, ownerId)))
          .returning();
        return s || null;
      },
      () => MemStorage.updateStaffForOwner(id, ownerId, data),
    );
  },
  async deleteStaff(id: string) {
    return op(
      async () => {
        await db.delete(schema.staff).where(eq(schema.staff.id, id));
      },
      () => MemStorage.deleteStaff(id),
    );
  },
  async deleteStaffForOwner(id: string, ownerId: string) {
    return op(
      async () => {
        const [deleted] = await db
          .delete(schema.staff)
          .where(and(eq(schema.staff.id, id), eq(schema.staff.ownerId, ownerId)))
          .returning({ id: schema.staff.id });
        return Boolean(deleted);
      },
      () => MemStorage.deleteStaffForOwner(id, ownerId),
    );
  },

  // ---------------- Customers ----------------
  async getCustomerByPhone(phone: string) {
    return op(
      async () => {
        const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone));
        return c || null;
      },
      () => MemStorage.getCustomerByPhone(phone),
    );
  },
  async getCustomerById(id: string) {
    return op(
      async () => {
        const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, id));
        return c || null;
      },
      () => MemStorage.getCustomerById(id),
    );
  },
  async createCustomer(data: typeof schema.customers.$inferInsert) {
    return op(
      async () => {
        const [c] = await db.insert(schema.customers).values(data).returning();
        return c;
      },
      () => MemStorage.createCustomer(data),
    );
  },
  async updateCustomer(id: string, data: Partial<typeof schema.customers.$inferInsert>) {
    return op(
      async () => {
        const [c] = await db.update(schema.customers).set(data).where(eq(schema.customers.id, id)).returning();
        return c;
      },
      () => MemStorage.updateCustomer(id, data),
    );
  },

  // ---------------- Products ----------------
  async getProductsByStore(storeId: string) {
    return op(
      async () => db.select().from(schema.products).where(eq(schema.products.storeId, storeId)),
      () => MemStorage.getProductsByStore(storeId),
    );
  },
  async getProductById(id: string) {
    return op(
      async () => {
        const [p] = await db.select().from(schema.products).where(eq(schema.products.id, id));
        return p || null;
      },
      () => MemStorage.getProductById(id),
    );
  },
  async countProductsByStore(storeId: string) {
    return op(
      async () => {
        const rows = await db.select().from(schema.products).where(eq(schema.products.storeId, storeId));
        return rows.length;
      },
      () => MemStorage.countProductsByStore(storeId),
    );
  },
  async upsertProduct(data: typeof schema.products.$inferInsert, storeId: string, actorId?: string) {
    return op(
      async () => {
        return db.transaction(async (tx: any) => {
          const [existing] = await tx
            .select()
            .from(schema.products)
            .where(eq(schema.products.id, data.id))
            .for('update');
          if (existing && existing.storeId !== storeId) {
            throw new StorageRuleError('PRODUCT_NOT_FOUND', 'Product not found in this store.', 404);
          }

          // Phase 6: createdAt is server-managed (defaultNow) and must
          // never be written from client-echoed data — a JSON string
          // here makes Drizzle's timestamp serializer throw
          // (value.toISOString is not a function) and the op() fallback
          // then silently diverges PG from the fallback store.
          const { createdAt: _createdAt, ...productDataRest } = data as any;
          const productData = { ...productDataRest, storeId };
          const [product] = existing
            ? await tx
                .update(schema.products)
                .set(productData)
                .where(and(eq(schema.products.id, data.id), eq(schema.products.storeId, storeId)))
                .returning()
            : await tx.insert(schema.products).values(productData).returning();

          if (existing && product.stock !== existing.stock) {
            const diff = Number((product.stock - existing.stock).toFixed(6));
            await tx.insert(schema.inventoryLogs).values({
              id: genId(),
              storeId,
              productId: product.id,
              productName: product.name,
              type: diff > 0 ? 'adjustment' : 'out',
              quantity: Math.abs(diff),
              reason: 'Manual Adjustment',
              actorId: actorId || null,
            });
          } else if (!existing && product.stock > 0) {
            await tx.insert(schema.inventoryLogs).values({
              id: genId(),
              storeId,
              productId: product.id,
              productName: product.name,
              type: 'in',
              quantity: product.stock,
              reason: 'Initial Stock',
              actorId: actorId || null,
            });
          }

          return { product, wasCreated: !existing, previous: existing || null };
        });
      },
      () => MemStorage.upsertProduct(data, storeId, actorId),
    );
  },
  async deleteProduct(id: string, storeId: string) {
    return op(
      async () => {
        const [deleted] = await db
          .delete(schema.products)
          .where(and(eq(schema.products.id, id), eq(schema.products.storeId, storeId)))
          .returning({ id: schema.products.id });
        return Boolean(deleted);
      },
      () => MemStorage.deleteProduct(id, storeId),
    );
  },
  async updateProductStock(id: string, newStock: number) {
    return op(
      async () => {
        const [p] = await db
          .update(schema.products)
          .set({ stock: newStock })
          .where(eq(schema.products.id, id))
          .returning();
        return p;
      },
      () => MemStorage.updateProductStock(id, newStock),
    );
  },
  async searchAllProducts(query?: string, category?: string) {
    return op(
      async () => {
        const conditions = [eq(schema.products.isOnlineVisible, true)];
        if (category) conditions.push(eq(schema.products.category, category));
        let rows = await db
          .select()
          .from(schema.products)
          .where(and(...conditions));
        if (query) {
          const q = query.toLowerCase();
          rows = rows.filter(
            (p: any) => p.name.toLowerCase().includes(q) || (p.nameBn || '').toLowerCase().includes(q),
          );
        }
        return rows;
      },
      () => MemStorage.searchAllProducts(query, category),
    );
  },

  // ---------------- Sales (POS) ----------------
  async getSalesByStore(storeId: string) {
    return op(
      async () =>
        db.select().from(schema.sales).where(eq(schema.sales.storeId, storeId)).orderBy(desc(schema.sales.date)),
      () => MemStorage.getSalesByStore(storeId),
    );
  },
  async getAllSales() {
    return op(
      async () => db.select().from(schema.sales).orderBy(desc(schema.sales.date)),
      () => MemStorage.getAllSales(),
    );
  },
  async countTodaySalesByStore(storeId: string) {
    return op(
      async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const rows = await db
          .select()
          .from(schema.sales)
          .where(and(eq(schema.sales.storeId, storeId), gte(schema.sales.date, today)));
        return rows.length;
      },
      () => MemStorage.countTodaySalesByStore(storeId),
    );
  },
  async createSale(input: {
    sale: RequestedSale;
    storeId: string;
    storeName?: string;
    vatRate: number;
    maxDiscountPercent?: number;
    servedBy?: string;
    actorId?: string;
  }) {
    return op(
      async () => {
        const { sale, storeId } = input;
        if (!sale.id || typeof sale.id !== 'string' || sale.id.length > 128) {
          throw new StorageRuleError('INVALID_SALE_ID', 'A valid transaction ID is required.');
        }
        if (!Array.isArray(sale.items) || sale.items.length === 0) {
          throw new StorageRuleError('INVALID_ITEMS', 'At least one sale item is required.');
        }
        const seenProductIds = new Set<string>();
        for (const item of sale.items) {
          if (!item || typeof item.id !== 'string' || !item.id.trim()) {
            throw new StorageRuleError('INVALID_PRODUCT_ID', 'Every sale item must reference a product.');
          }
          if (seenProductIds.has(item.id)) {
            throw new StorageRuleError('DUPLICATE_PRODUCT_LINE', 'Duplicate product lines are not allowed.');
          }
          seenProductIds.add(item.id);
          quantityToUnits(item.quantity);
          if (item.price !== undefined) moneyToMinor(item.price, 'price');
        }

        return db.transaction(async (tx: any) => {
          const [prior] = await tx.select().from(schema.sales).where(eq(schema.sales.id, sale.id));
          if (prior) {
            if (prior.storeId !== storeId) {
              throw new StorageRuleError('SALE_ID_CONFLICT', 'Transaction ID has already been used.', 409);
            }
            if (!isIdempotentSaleReplay(prior, sale)) {
              throw new StorageRuleError(
                'SALE_ID_CONFLICT',
                'Transaction ID was reused with different sale details.',
                409,
              );
            }
            return prior;
          }

          const products = new Map<string, schema.Product>();
          for (const productId of [...seenProductIds].sort()) {
            const [product] = await tx
              .select()
              .from(schema.products)
              .where(eq(schema.products.id, productId))
              .for('update');
            if (!product || product.storeId !== storeId) {
              throw new StorageRuleError('PRODUCT_NOT_FOUND', 'A selected product is unavailable in this store.', 409);
            }
            products.set(productId, product);
          }

          const [concurrentPrior] = await tx.select().from(schema.sales).where(eq(schema.sales.id, sale.id));
          if (concurrentPrior) {
            if (concurrentPrior.storeId !== storeId || !isIdempotentSaleReplay(concurrentPrior, sale)) {
              throw new StorageRuleError(
                'SALE_ID_CONFLICT',
                'Transaction ID was reused with different sale details.',
                409,
              );
            }
            return concurrentPrior;
          }

          const saleItems = sale.items.map((requested) => {
            const product = products.get(requested.id)!;
            if (
              requested.price !== undefined &&
              moneyToMinor(requested.price, 'price') !== moneyToMinor(product.price, 'price')
            ) {
              throw new StorageRuleError(
                'PRICE_CHANGED',
                `The selling price for ${product.name} changed. Refresh the product before checkout.`,
                409,
              );
            }
            return {
              ...product,
              price: product.price,
              cost: product.cost,
              quantity: requested.quantity,
              ...(requested.note ? { note: requested.note } : {}),
            };
          });
          const baseTotals = calculateSaleTotals(saleItems, 0, 0, 0, sale.paymentMethod);
          const discountLimit = input.maxDiscountPercent ?? 100;
          if (!Number.isFinite(discountLimit) || discountLimit < 0 || discountLimit > 100) {
            throw new StorageRuleError('INVALID_DISCOUNT_POLICY', 'The configured discount limit is invalid.', 500);
          }
          const maxDiscountMinor = Math.floor((moneyToMinor(baseTotals.subTotal) * discountLimit) / 100);
          if (moneyToMinor(sale.discount ?? 0, 'discount') > maxDiscountMinor) {
            throw new StorageRuleError('DISCOUNT_LIMIT', 'This discount exceeds the authorized limit.', 403);
          }
          // Phase 4 — branch/counter/coupon/loyalty, ported from the
          // fallback sale path. Previously the PG sale ignored these
          // fields entirely (hence the route-level PHASE3_PG_PENDING
          // refusal, now removed). All validation happens BEFORE any
          // mutation, inside the same transaction.
          let branch: any = null;
          let counter: any = null;
          if ((sale as any).branchId) {
            [branch] = await tx
              .select()
              .from(schema.branches)
              .where(and(eq(schema.branches.id, (sale as any).branchId), eq(schema.branches.storeId, storeId)));
            if (!branch) {
              throw new StorageRuleError('BRANCH_NOT_FOUND', 'The selected branch does not belong to this store.', 404);
            }
          }
          if ((sale as any).counterId) {
            [counter] = await tx
              .select()
              .from(schema.counters)
              .where(and(eq(schema.counters.id, (sale as any).counterId), eq(schema.counters.storeId, storeId)));
            if (!counter || (branch && counter.branchId !== branch.id)) {
              throw new StorageRuleError(
                'COUNTER_NOT_FOUND',
                'The selected counter does not belong to this branch.',
                404,
              );
            }
          }
          let coupon: any = null;
          let couponDiscount = 0;
          if ((sale as any).couponCode) {
            const code = (sale as any).couponCode.trim().toUpperCase();
            [coupon] = await tx
              .select()
              .from(schema.coupons)
              .where(and(eq(schema.coupons.storeId, storeId), sql`upper(${schema.coupons.code}) = ${code}`))
              .for('update');
            const check = validateCoupon(coupon as Phase3Coupon | null, baseTotals.subTotal);
            if (!check.valid) {
              throw new StorageRuleError(`COUPON_${check.reason}`, `Coupon rejected: ${check.reason}.`, 400);
            }
            couponDiscount = check.discount;
          }
          let loyaltyDiscount = 0;
          let loyaltyRedeemed = 0;
          let loyaltyAccount: any = null;
          const redeemRequested = Math.floor((sale as any).loyaltyPointsRedeem || 0);
          if (redeemRequested > 0) {
            if (!(sale as any).customerPhone) {
              throw new StorageRuleError(
                'LOYALTY_PHONE_REQUIRED',
                'A customer phone number is required to redeem points.',
                400,
              );
            }
            [loyaltyAccount] = await tx
              .select()
              .from(schema.loyaltyAccounts)
              .where(
                and(
                  eq(schema.loyaltyAccounts.storeId, storeId),
                  eq(schema.loyaltyAccounts.phone, (sale as any).customerPhone),
                ),
              )
              .for('update');
            if (redeemRequested > (loyaltyAccount?.points || 0)) {
              throw new StorageRuleError('LOYALTY_INSUFFICIENT', 'Not enough loyalty points for this redemption.', 400);
            }
            const redeem = loyaltyRedeemable(
              redeemRequested,
              loyaltyAccount?.points || 0,
              baseTotals.subTotal - (sale.discount ?? 0) - couponDiscount,
            );
            if (redeem.points <= 0) {
              throw new StorageRuleError('LOYALTY_INSUFFICIENT', 'Not enough loyalty points for this redemption.', 400);
            }
            loyaltyRedeemed = redeem.points;
            loyaltyDiscount = redeem.discount;
          }
          const promoDiscount = Math.round((couponDiscount + loyaltyDiscount) * 100) / 100;
          const totalDiscount = Math.round(((sale.discount ?? 0) + promoDiscount) * 100) / 100;
          const totals = calculateSaleTotals(
            saleItems,
            totalDiscount,
            input.vatRate ?? 0,
            requestedSaleReceivedAmount(sale),
            sale.paymentMethod,
          );

          for (const requested of sale.items) {
            const product = products.get(requested.id)!;
            if (!Number.isFinite(product.stock) || product.stock < requested.quantity) {
              throw new StorageRuleError(
                'INSUFFICIENT_STOCK',
                `Insufficient stock for ${product.name}. Available: ${product.stock}.`,
                409,
              );
            }
          }

          // Promo mutations happen only after every validation above passed.
          const earned = loyaltyEarned(totals.totalAmount);
          if (coupon) {
            await tx
              .update(schema.coupons)
              .set({ usedCount: coupon.usedCount + 1 })
              .where(eq(schema.coupons.id, coupon.id));
          }
          if ((sale as any).customerPhone) {
            const prevPoints = loyaltyAccount?.points || 0;
            const points = Math.max(0, prevPoints - loyaltyRedeemed + earned);
            if (loyaltyAccount) {
              await tx
                .update(schema.loyaltyAccounts)
                .set({
                  points,
                  name: (sale as any).customerName || loyaltyAccount.name || null,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(schema.loyaltyAccounts.storeId, storeId),
                    eq(schema.loyaltyAccounts.phone, (sale as any).customerPhone),
                  ),
                );
            } else {
              await tx.insert(schema.loyaltyAccounts).values({
                phone: (sale as any).customerPhone,
                storeId,
                name: (sale as any).customerName || null,
                points,
              });
            }
          }

          const [created] = await tx
            .insert(schema.sales)
            .values({
              id: sale.id,
              storeId,
              date: new Date(),
              items: saleItems,
              subTotal: totals.subTotal,
              discount: totals.discount,
              vat: totals.vat,
              totalAmount: totals.totalAmount,
              totalProfit: totals.totalProfit,
              paymentMethod: sale.paymentMethod,
              customerName: sale.customerName || null,
              customerPhone: sale.customerPhone || null,
              paidAmount: totals.paidAmount,
              cashReceived: totals.cashReceived,
              changeAmount: totals.changeAmount,
              dueAmount: totals.dueAmount,
              storeName: input.storeName || null,
              servedBy: input.servedBy || null,
              branchId: branch?.id || null,
              counterId: counter?.id || null,
              couponCode: coupon ? coupon.code : null,
              loyaltyRedeemed,
              loyaltyEarned: earned,
            })
            .returning();

          for (const requested of sale.items) {
            const product = products.get(requested.id)!;
            const newStock = Number((product.stock - requested.quantity).toFixed(6));
            const [updated] = await tx
              .update(schema.products)
              .set({ stock: newStock })
              .where(and(eq(schema.products.id, requested.id), eq(schema.products.storeId, storeId)))
              .returning({ id: schema.products.id });
            if (!updated) {
              throw new StorageRuleError('STOCK_UPDATE_FAILED', 'Stock changed while processing the sale.', 409);
            }
            await tx.insert(schema.inventoryLogs).values({
              id: genId(),
              storeId,
              productId: product.id,
              productName: product.name,
              type: 'sale',
              quantity: requested.quantity,
              reason: `Sale #${created.id.slice(-6)}`,
              actorId: input.actorId || null,
            });
          }

          return created;
        });
      },
      () => MemStorage.createSale(input),
    );
  },

  // ---------------- Expenses ----------------
  async getExpensesByStore(storeId: string) {
    return op(
      async () => db.select().from(schema.expenses).where(eq(schema.expenses.storeId, storeId)),
      () => MemStorage.getExpensesByStore(storeId),
    );
  },
  async createExpense(data: typeof schema.expenses.$inferInsert) {
    return op(
      async () => {
        const [e] = await db.insert(schema.expenses).values(data).returning();
        return e;
      },
      () => MemStorage.createExpense(data),
    );
  },
  async deleteExpense(id: string, storeId: string) {
    return op(
      async () => {
        const [deleted] = await db
          .delete(schema.expenses)
          .where(and(eq(schema.expenses.id, id), eq(schema.expenses.storeId, storeId)))
          .returning({ id: schema.expenses.id });
        return Boolean(deleted);
      },
      () => MemStorage.deleteExpense(id, storeId),
    );
  },

  // ---------------- Inventory Logs ----------------
  async logInventoryMovement(entry: typeof schema.inventoryLogs.$inferInsert) {
    return op(
      async () => {
        await db.insert(schema.inventoryLogs).values(entry);
      },
      () => MemStorage.logInventoryMovement(entry),
    );
  },
  async getInventoryLogsByStore(storeId: string) {
    return op(
      async () =>
        db
          .select()
          .from(schema.inventoryLogs)
          .where(eq(schema.inventoryLogs.storeId, storeId))
          .orderBy(desc(schema.inventoryLogs.date)),
      () => MemStorage.getInventoryLogsByStore(storeId),
    );
  },

  // ---------------- Subscription Requests ----------------
  async createSubscriptionRequest(data: typeof schema.subscriptionRequests.$inferInsert) {
    return op(
      async () => {
        const [r] = await db.insert(schema.subscriptionRequests).values(data).returning();
        return r;
      },
      () => MemStorage.createSubscriptionRequest(data),
    );
  },
  async getAllSubscriptionRequests() {
    return op(
      async () => db.select().from(schema.subscriptionRequests).orderBy(desc(schema.subscriptionRequests.date)),
      () => MemStorage.getAllSubscriptionRequests(),
    );
  },
  async getSubscriptionRequestById(id: string) {
    return op(
      async () => {
        const [r] = await db.select().from(schema.subscriptionRequests).where(eq(schema.subscriptionRequests.id, id));
        return r || null;
      },
      () => MemStorage.getSubscriptionRequestById(id),
    );
  },
  async updateSubscriptionRequest(id: string, data: Partial<typeof schema.subscriptionRequests.$inferInsert>) {
    return op(
      async () => {
        const [r] = await db
          .update(schema.subscriptionRequests)
          .set(data)
          .where(eq(schema.subscriptionRequests.id, id))
          .returning();
        return r;
      },
      () => MemStorage.updateSubscriptionRequest(id, data),
    );
  },

  // ---------------- Settings ----------------
  async getSetting(key: string) {
    return op(
      async () => {
        const [s] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
        return s?.value ?? null;
      },
      () => MemStorage.getSetting(key),
    );
  },
  async setSetting(key: string, value: any) {
    return op(
      async () => {
        const existing = await this.getSetting(key);
        if (existing !== null) {
          await db.update(schema.settings).set({ value }).where(eq(schema.settings.key, key));
        } else {
          await db.insert(schema.settings).values({ key, value });
        }
      },
      () => MemStorage.setSetting(key, value),
    );
  },

  // ---------------- Restaurant ----------------
  async getTablesByStore(storeId: string) {
    return op(
      async () => db.select().from(schema.restaurantTables).where(eq(schema.restaurantTables.storeId, storeId)),
      () => MemStorage.getTablesByStore(storeId),
    );
  },
  async createTable(data: typeof schema.restaurantTables.$inferInsert) {
    return op(
      async () => {
        const [t] = await db.insert(schema.restaurantTables).values(data).returning();
        return t;
      },
      () => MemStorage.createTable(data),
    );
  },
  async deleteTable(id: string, storeId: string) {
    return op(
      async () => {
        const [deleted] = await db
          .delete(schema.restaurantTables)
          .where(and(eq(schema.restaurantTables.id, id), eq(schema.restaurantTables.storeId, storeId)))
          .returning({ id: schema.restaurantTables.id });
        return Boolean(deleted);
      },
      () => MemStorage.deleteTable(id, storeId),
    );
  },
  async getTableById(id: string) {
    return op(
      async () => {
        const [t] = await db.select().from(schema.restaurantTables).where(eq(schema.restaurantTables.id, id));
        return t || null;
      },
      () => MemStorage.getTableById(id),
    );
  },
  async getGuestOrdersByStore(storeId: string) {
    return op(
      async () =>
        db
          .select()
          .from(schema.guestOrders)
          .where(eq(schema.guestOrders.storeId, storeId))
          .orderBy(desc(schema.guestOrders.createdAt)),
      () => MemStorage.getGuestOrdersByStore(storeId),
    );
  },
  async createGuestOrder(data: {
    idempotencyKey: string;
    tableId: string;
    items: Array<{ id: string; quantity: number; note?: string }>;
    note?: string;
  }) {
    return op(
      async () => {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.idempotencyKey)) {
          throw new StorageRuleError('INVALID_IDEMPOTENCY_KEY', 'A valid request id is required.');
        }
        if (!data.tableId || !Array.isArray(data.items) || data.items.length === 0) {
          throw new StorageRuleError('INVALID_ORDER', 'A table and at least one order item are required.');
        }
        const ids = data.items.map((item) => item?.id);
        if (ids.some((id) => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
          throw new StorageRuleError('INVALID_ORDER_ITEMS', 'Order items must reference unique products.');
        }
        data.items.forEach((item) => quantityToUnits(item.quantity));

        return db.transaction(async (tx: any) => {
          const [table] = await tx
            .select()
            .from(schema.restaurantTables)
            .where(and(eq(schema.restaurantTables.id, data.tableId), eq(schema.restaurantTables.isActive, true)))
            .for('update');
          if (!table) throw new StorageRuleError('TABLE_NOT_FOUND', 'This restaurant table is unavailable.', 404);

          const [existing] = await tx
            .select()
            .from(schema.guestOrders)
            .where(eq(schema.guestOrders.id, data.idempotencyKey));
          if (existing) {
            const existingItems = Array.isArray(existing.items)
              ? (existing.items as Array<{ id: string; quantity: number; note?: string }>)
                  .map(({ id, quantity, note }) => ({ id, quantity, note: note || '' }))
                  .sort((a, b) => a.id.localeCompare(b.id))
              : [];
            const requestedItems = data.items
              .map(({ id, quantity, note }) => ({ id, quantity, note: note || '' }))
              .sort((a, b) => a.id.localeCompare(b.id));
            if (
              existing.tableId !== table.id ||
              existing.storeId !== table.storeId ||
              (existing.note || '') !== (data.note || '') ||
              JSON.stringify(existingItems) !== JSON.stringify(requestedItems)
            ) {
              throw new StorageRuleError(
                'IDEMPOTENCY_KEY_REUSED',
                'This request id was already used for a different order.',
                409,
              );
            }
            return existing;
          }

          const products = new Map<string, schema.Product>();
          for (const id of [...new Set(ids)].sort()) {
            const [product] = await tx
              .select()
              .from(schema.products)
              .where(and(eq(schema.products.id, id), eq(schema.products.storeId, table.storeId)))
              .for('update');
            if (!product || product.isOnlineVisible === false) {
              throw new StorageRuleError('MENU_ITEM_UNAVAILABLE', 'A selected menu item is no longer available.', 409);
            }
            products.set(id, product);
          }

          const items = data.items.map((requested) => {
            const product = products.get(requested.id)!;
            return {
              ...product,
              quantity: requested.quantity,
              ...(requested.note ? { note: requested.note } : {}),
            };
          });
          const totals = calculateSaleTotals(items, 0, 0, 0, 'cash');
          const [order] = await tx
            .insert(schema.guestOrders)
            .values({
              id: data.idempotencyKey,
              storeId: table.storeId,
              tableId: table.id,
              items,
              note: data.note || null,
              status: 'pending',
              totalAmount: totals.subTotal,
            })
            .returning();
          return order;
        });
      },
      () => MemStorage.createGuestOrder(data),
    );
  },
  async getGuestOrderById(id: string) {
    return op(
      async () => {
        const [o] = await db.select().from(schema.guestOrders).where(eq(schema.guestOrders.id, id));
        return o || null;
      },
      () => MemStorage.getGuestOrderById(id),
    );
  },
  async updateGuestOrder(id: string, storeId: string, nextStatus: string) {
    return op(
      async () => {
        const allowedTransitions: Record<string, string[]> = {
          pending: ['accepted', 'cancelled'],
          accepted: ['preparing', 'cancelled'],
          preparing: ['ready', 'cancelled'],
          ready: ['served', 'cancelled'],
          served: [],
          cancelled: [],
        };
        if (!Object.prototype.hasOwnProperty.call(allowedTransitions, nextStatus)) {
          throw new StorageRuleError('INVALID_ORDER_STATUS', 'Order status is not supported.');
        }

        return db.transaction(async (tx: any) => {
          const [existing] = await tx
            .select()
            .from(schema.guestOrders)
            .where(and(eq(schema.guestOrders.id, id), eq(schema.guestOrders.storeId, storeId)))
            .for('update');
          if (!existing) throw new StorageRuleError('ORDER_NOT_FOUND', 'Order not found in this store.', 404);
          if (existing.status === nextStatus) return existing;
          if (!allowedTransitions[existing.status]?.includes(nextStatus)) {
            throw new StorageRuleError('INVALID_ORDER_TRANSITION', 'This order cannot move to that status.', 409);
          }
          const [updated] = await tx
            .update(schema.guestOrders)
            .set({ status: nextStatus })
            .where(
              and(
                eq(schema.guestOrders.id, id),
                eq(schema.guestOrders.storeId, storeId),
                eq(schema.guestOrders.status, existing.status),
              ),
            )
            .returning();
          return updated;
        });
      },
      () => MemStorage.updateGuestOrder(id, storeId, nextStatus),
    );
  },

  // ---------------- Announcements ----------------
  async getAllAnnouncements() {
    return op(
      async () => db.select().from(schema.announcements).orderBy(desc(schema.announcements.createdAt)),
      () => MemStorage.getAllAnnouncements(),
    );
  },
  async createAnnouncement(data: typeof schema.announcements.$inferInsert) {
    return op(
      async () => {
        const [a] = await db.insert(schema.announcements).values(data).returning();
        return a;
      },
      () => MemStorage.createAnnouncement(data),
    );
  },
  async deleteAnnouncement(id: string) {
    return op(
      async () => {
        await db.delete(schema.announcements).where(eq(schema.announcements.id, id));
      },
      () => MemStorage.deleteAnnouncement(id),
    );
  },

  // ---------------- Online Marketplace Orders ----------------
  async createOnlineOrder(data: typeof schema.onlineOrders.$inferInsert) {
    return op(
      async () => {
        const [o] = await db.insert(schema.onlineOrders).values(data).returning();
        return o;
      },
      () => MemStorage.createOnlineOrder(data),
    );
  },
  async createMarketplaceOrder(data: {
    id: string;
    customerId: string;
    storeId: string;
    storeName: string;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    paymentMethod: 'cod';
    note?: string;
    items: Array<{ id: string; quantity: number; note?: string }>;
  }) {
    return op(
      async () => {
        if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 100) {
          throw new StorageRuleError('INVALID_ITEMS', 'An order must contain between 1 and 100 items.');
        }
        const seenIds = new Set<string>();
        for (const item of data.items) {
          if (typeof item.id !== 'string' || !item.id.trim() || seenIds.has(item.id)) {
            throw new StorageRuleError('INVALID_ITEMS', 'Order items must be unique and valid.');
          }
          seenIds.add(item.id);
          quantityToUnits(item.quantity, 'quantity');
        }
        const requestedItemsKey = JSON.stringify(
          data.items.map(({ id, quantity }) => ({ id, quantity })).sort((a, b) => a.id.localeCompare(b.id)),
        );
        const matchesRequest = (items: unknown) => {
          if (!Array.isArray(items)) return false;
          const existingItems = JSON.stringify(
            (items as Array<{ id: string; quantity: number }>)
              .map(({ id, quantity }) => ({ id, quantity }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          );
          return existingItems === requestedItemsKey;
        };

        return db.transaction(async (tx: any) => {
          const [existing] = await tx
            .select()
            .from(schema.onlineOrders)
            .where(eq(schema.onlineOrders.id, data.id))
            .for('update');
          if (existing) {
            if (
              existing.customerId !== data.customerId ||
              existing.storeId !== data.storeId ||
              !matchesRequest(existing.items)
            ) {
              throw new StorageRuleError(
                'IDEMPOTENCY_KEY_REUSED',
                'This order request key was already used for a different order.',
                409,
              );
            }
            return existing;
          }

          const products = new Map<string, typeof schema.products.$inferSelect>();
          for (const productId of [...seenIds].sort()) {
            const [product] = await tx
              .select()
              .from(schema.products)
              .where(and(eq(schema.products.id, productId), eq(schema.products.storeId, data.storeId)))
              .for('update');
            if (!product || product.isOnlineVisible === false) {
              throw new StorageRuleError('PRODUCT_UNAVAILABLE', 'An item is no longer available.', 404);
            }
            products.set(productId, product);
          }

          const financialItems = data.items.map((item) => {
            const product = products.get(item.id)!;
            return { id: item.id, price: product.price, cost: product.cost, quantity: item.quantity };
          });
          const totals = calculateSaleTotals(financialItems, 0, 0, 0, 'cash');
          const deliveryFee = totals.subTotal > 500 ? 0 : 50;
          const totalAmount = Number((totals.totalAmount + deliveryFee).toFixed(2));
          const orderItems = data.items.map((item) => {
            const product = products.get(item.id)!;
            return {
              id: product.id,
              storeId: data.storeId,
              name: product.name,
              category: product.category,
              unit: product.unit,
              price: product.price,
              quantity: item.quantity,
              image: product.image,
              note: item.note,
            };
          });
          const [order] = await tx
            .insert(schema.onlineOrders)
            .values({
              id: data.id,
              customerId: data.customerId,
              storeId: data.storeId,
              storeName: data.storeName,
              customerName: data.customerName,
              customerPhone: data.customerPhone,
              deliveryAddress: data.deliveryAddress,
              items: orderItems,
              subTotal: totals.subTotal,
              deliveryFee,
              totalAmount,
              paymentMethod: data.paymentMethod,
              status: 'placed',
              note: data.note,
            })
            .returning();

          for (const item of data.items) {
            const product = products.get(item.id)!;
            if (product.stock < item.quantity) {
              throw new StorageRuleError('INSUFFICIENT_STOCK', `${product.name} does not have enough stock.`, 409);
            }
            const nextStock = Number((product.stock - item.quantity).toFixed(6));
            await tx.update(schema.products).set({ stock: nextStock }).where(eq(schema.products.id, product.id));
            await tx.insert(schema.inventoryLogs).values({
              id: genId(),
              storeId: data.storeId,
              productId: product.id,
              productName: product.name,
              type: 'sale',
              quantity: item.quantity,
              reason: `Online order #${order.id.slice(-6)}`,
              actorId: data.customerId,
            });
          }
          return order;
        });
      },
      () => MemStorage.createMarketplaceOrder(data),
    );
  },
  async getOnlineOrderById(id: string) {
    return op(
      async () => {
        const [o] = await db.select().from(schema.onlineOrders).where(eq(schema.onlineOrders.id, id));
        return o || null;
      },
      () => MemStorage.getOnlineOrderById(id),
    );
  },
  async getOnlineOrdersByCustomer(customerId: string) {
    return op(
      async () =>
        db
          .select()
          .from(schema.onlineOrders)
          .where(eq(schema.onlineOrders.customerId, customerId))
          .orderBy(desc(schema.onlineOrders.createdAt)),
      () => MemStorage.getOnlineOrdersByCustomer(customerId),
    );
  },
  async getOnlineOrdersByStore(storeId: string) {
    return op(
      async () =>
        db
          .select()
          .from(schema.onlineOrders)
          .where(eq(schema.onlineOrders.storeId, storeId))
          .orderBy(desc(schema.onlineOrders.createdAt)),
      () => MemStorage.getOnlineOrdersByStore(storeId),
    );
  },
  async updateOnlineOrderStatus(id: string, status: string) {
    return op(
      async () => {
        const [o] = await db
          .update(schema.onlineOrders)
          .set({ status, updatedAt: new Date() })
          .where(eq(schema.onlineOrders.id, id))
          .returning();
        return o;
      },
      () => MemStorage.updateOnlineOrderStatus(id, status),
    );
  },
  async updateOnlineOrderStatusForStore(id: string, storeId: string, status: string, actorId: string) {
    return op(
      async () => {
        const allowedTransitions: Record<string, string[]> = {
          placed: ['confirmed', 'cancelled'],
          confirmed: ['out_for_delivery', 'cancelled'],
          out_for_delivery: ['delivered', 'cancelled'],
          delivered: [],
          cancelled: [],
        };
        if (!Object.hasOwn(allowedTransitions, status)) {
          throw new StorageRuleError('INVALID_ORDER_STATUS', 'Order status is not supported.');
        }
        return db.transaction(async (tx: any) => {
          const [order] = await tx
            .select()
            .from(schema.onlineOrders)
            .where(and(eq(schema.onlineOrders.id, id), eq(schema.onlineOrders.storeId, storeId)))
            .for('update');
          if (!order) return null;
          if (order.status === status) return order;
          if (!allowedTransitions[order.status]?.includes(status)) {
            throw new StorageRuleError('INVALID_STATUS_TRANSITION', 'This order status change is not allowed.', 409);
          }

          if (status === 'cancelled') {
            const items = (order.items || []) as Array<{ id: string; name?: string; quantity: number }>;
            const productIds = [...new Set(items.map((item) => item.id))].sort();
            const products = new Map<string, typeof schema.products.$inferSelect>();
            for (const productId of productIds) {
              const [product] = await tx
                .select()
                .from(schema.products)
                .where(and(eq(schema.products.id, productId), eq(schema.products.storeId, storeId)))
                .for('update');
              if (product) products.set(productId, product);
            }
            for (const item of items) {
              const quantity = Number(item.quantity);
              const product = products.get(item.id);
              if (!product || !Number.isFinite(quantity) || quantity <= 0) {
                throw new StorageRuleError(
                  'ORDER_STOCK_RESTORE_FAILED',
                  'The order contains unavailable stock data.',
                  409,
                );
              }
              const nextStock = Number((product.stock + quantity).toFixed(6));
              await tx.update(schema.products).set({ stock: nextStock }).where(eq(schema.products.id, item.id));
              await tx.insert(schema.inventoryLogs).values({
                id: genId(),
                storeId,
                productId: item.id,
                productName: product.name,
                type: 'in',
                quantity,
                reason: `Online order cancelled #${order.id.slice(-6)}`,
                actorId,
              });
              products.set(item.id, { ...product, stock: nextStock });
            }
          }

          const [updated] = await tx
            .update(schema.onlineOrders)
            .set({ status, updatedAt: new Date() })
            .where(eq(schema.onlineOrders.id, order.id))
            .returning();
          return updated;
        });
      },
      () => MemStorage.updateOnlineOrderStatusForStore(id, storeId, status, actorId),
    );
  },

  // ---------------- Marketplace: Stores directory ----------------
  async getStoresDirectory() {
    return op(
      async () => {
        const owners = await db.select().from(schema.users);
        const stores = owners.filter((u: any) => !isPlatformAdminId(u.id));
        const withCounts = await Promise.all(
          stores.map(async (s: any) => {
            const productCount = await this.countProductsByStore(s.id);
            return {
              id: s.id,
              storeName: s.storeName,
              storeCategory: s.storeCategory,
              address: s.address,
              phone: s.phone,
              zila: s.zila,
              upozila: s.upozila,
              thana: s.thana,
              profilePicture: s.profilePicture,
              productCount,
            };
          }),
        );
        return withCounts.filter((s) => s.productCount > 0);
      },
      () => MemStorage.getStoresDirectory(),
    );
  },

  // ---------------- Payment Intents (AmarPay Ledger) ----------------
  async createPaymentIntent(data: typeof schema.paymentIntents.$inferInsert) {
    return op(
      async () => {
        const [p] = await db.insert(schema.paymentIntents).values(data).returning();
        return p;
      },
      () => MemStorage.createPaymentIntent(data),
    );
  },
  async getPaymentIntentsByStore(storeId: string) {
    return op(
      async () => db.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.storeId, storeId)),
      () => MemStorage.getPaymentIntentsByStore(storeId),
    );
  },
  async getPaymentIntentById(id: string) {
    return op(
      async () => {
        const [p] = await db.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.id, id));
        return p || null;
      },
      () => MemStorage.getPaymentIntentById(id),
    );
  },
  async updatePaymentIntent(id: string, data: Partial<typeof schema.paymentIntents.$inferInsert>) {
    return op(
      async () => {
        const [p] = await db
          .update(schema.paymentIntents)
          .set(data)
          .where(eq(schema.paymentIntents.id, id))
          .returning();
        return p;
      },
      () => MemStorage.updatePaymentIntent(id, data),
    );
  },

  // ---------------- Restaurant Settlement & Voiding ----------------
  // Phase 4: these were fallback-only delegates, so on a PostgreSQL
  // deployment restaurant settlement/voiding silently operated on the
  // (empty) fallback store while the order lived in PostgreSQL — the
  // KDS settle click did nothing and the order stayed 'ready'. Both
  // now have a PostgreSQL branch mirroring the fallback math exactly
  // (same sale id format, same totals, same payment-intent shape, no
  // stock deduction — settlement never deducted stock in either path,
  // see the Phase 4 report's deferred findings).
  async settleGuestOrder(input: Parameters<typeof MemStorage.settleGuestOrder>[0]) {
    // Shared validation (both branches; MemStorage re-checks harmlessly).
    if (!['cash', 'bkash', 'nagad', 'card', 'split'].includes(input.paymentMethod as string)) {
      throw new StorageRuleError('INVALID_PAYMENT_METHOD', 'Payment method is not supported.', 400);
    }
    if (input.discount !== undefined && (!Number.isFinite(input.discount) || input.discount < 0)) {
      throw new StorageRuleError('INVALID_DISCOUNT', 'Discount must be a non-negative number.', 400);
    }
    if (input.vatRate !== undefined && (!Number.isFinite(input.vatRate) || input.vatRate < 0 || input.vatRate > 100)) {
      throw new StorageRuleError('INVALID_VAT_RATE', 'VAT rate must be between 0 and 100.', 400);
    }
    if (input.paidAmount !== undefined && (!Number.isFinite(input.paidAmount) || input.paidAmount < 0)) {
      throw new StorageRuleError('INVALID_PAID_AMOUNT', 'Paid amount must be a non-negative number.', 400);
    }
    if (input.cashReceived !== undefined && (!Number.isFinite(input.cashReceived) || input.cashReceived < 0)) {
      throw new StorageRuleError('INVALID_CASH_RECEIVED', 'Cash received must be a non-negative number.', 400);
    }
    return op(
      async () => {
        const result = await db.transaction(async (tx: any) => {
          const [order] = await tx
            .select()
            .from(schema.guestOrders)
            .where(and(eq(schema.guestOrders.id, input.orderId), eq(schema.guestOrders.storeId, input.storeId)))
            .for('update');
          if (!order) throw new StorageRuleError('ORDER_NOT_FOUND', 'Dining order not found in this restaurant.', 404);
          if (order.status === 'served' || order.status === 'cancelled') {
            throw new StorageRuleError('ORDER_ALREADY_CLOSED', 'This order is already settled or cancelled.', 409);
          }
          const items = (order.items || []) as any[];
          const subTotal =
            order.totalAmount || items.reduce((acc: number, i: any) => acc + (i.price || 0) * (i.quantity || 1), 0);
          const discount = input.discount || 0;
          const vatRate = input.vatRate || 0;
          const discountedTotal = Math.max(0, subTotal - discount);
          const vat = Math.round(discountedTotal * (vatRate / 100));
          const totalAmount = discountedTotal + vat;
          const paidAmount = input.paidAmount ?? totalAmount;
          const cashReceived = input.paymentMethod === 'cash' ? (input.cashReceived ?? paidAmount) : null;
          const changeAmount = cashReceived ? Math.max(0, cashReceived - paidAmount) : 0;
          const dueAmount = Math.max(0, totalAmount - paidAmount);
          const saleId = `sale-${input.orderId.slice(-8)}`;
          const sale = {
            id: saleId,
            storeId: input.storeId,
            date: new Date(),
            items,
            subTotal,
            discount,
            vat,
            totalAmount,
            totalProfit: items.reduce(
              (acc: number, i: any) => acc + ((i.price || 0) - (i.cost || 0)) * (i.quantity || 1),
              0,
            ),
            paymentMethod: input.paymentMethod === 'split' ? 'cash' : input.paymentMethod,
            customerName: `Table Guest (${order.tableId})`,
            customerPhone: null,
            paidAmount,
            cashReceived,
            changeAmount,
            dueAmount,
            storeName: 'Restaurant Dining',
            servedBy: input.servedBy || 'Cashier',
            branchId: null,
            counterId: null,
            couponCode: null,
            loyaltyRedeemed: 0,
            loyaltyEarned: 0,
          };
          await tx
            .insert(schema.sales)
            .values(sale)
            .onConflictDoUpdate({ target: schema.sales.id, set: { ...sale, id: saleId } });
          const paymentIntent = {
            id: genId(),
            storeId: input.storeId,
            orderType: 'restaurant',
            orderId: order.id,
            method: input.paymentMethod,
            amount: totalAmount,
            paidAmount,
            changeAmount,
            status: 'captured',
            gatewayTrxId: input.gatewayTrxId || null,
            voidReason: null,
            details: { tableId: order.tableId, splitDetails: input.splitDetails || null, saleId: sale.id },
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          await tx.insert(schema.paymentIntents).values(paymentIntent);
          const [updatedOrder] = await tx
            .update(schema.guestOrders)
            .set({ status: 'served' })
            .where(eq(schema.guestOrders.id, order.id))
            .returning();
          return { order: updatedOrder, sale, paymentIntent };
        });
        broadcastToStore(input.storeId, { type: 'ORDER_STATUS_CHANGED', payload: result.order });
        broadcastToStore(input.storeId, { type: 'SALE_COMPLETED', payload: result.sale });
        return result;
      },
      () => MemStorage.settleGuestOrder(input),
    );
  },
  async voidGuestOrder(id: string, storeId: string, reason: string) {
    return op(
      async () => {
        const result = await db.transaction(async (tx: any) => {
          const [order] = await tx
            .select()
            .from(schema.guestOrders)
            .where(and(eq(schema.guestOrders.id, id), eq(schema.guestOrders.storeId, storeId)))
            .for('update');
          if (!order) throw new StorageRuleError('ORDER_NOT_FOUND', 'Dining order not found.', 404);
          if (order.status === 'served' || order.status === 'cancelled') {
            throw new StorageRuleError('ORDER_ALREADY_CLOSED', 'This order is already served or cancelled.', 409);
          }
          if (!reason || !reason.trim()) {
            throw new StorageRuleError('VOID_REASON_REQUIRED', 'A reason is required to void this order.');
          }
          const [updatedOrder] = await tx
            .update(schema.guestOrders)
            .set({ status: 'cancelled' })
            .where(eq(schema.guestOrders.id, order.id))
            .returning();
          await tx.insert(schema.paymentIntents).values({
            id: genId(),
            storeId,
            orderType: 'restaurant',
            orderId: order.id,
            method: 'cash',
            amount: order.totalAmount,
            paidAmount: 0,
            changeAmount: 0,
            status: 'voided',
            gatewayTrxId: null,
            voidReason: reason.trim(),
            details: { tableId: order.tableId },
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          return updatedOrder;
        });
        broadcastToStore(storeId, { type: 'ORDER_STATUS_CHANGED', payload: result });
        return result;
      },
      () => MemStorage.voidGuestOrder(id, storeId, reason),
    );
  },

  // ---------------- Cashier Shifts & Z-Report ----------------
  // Phase 4: shifts are wired to PostgreSQL (op() falls back to the
  // durable fallback store only on a real DB error, same as every other
  // entity). This also fixes a pre-existing PG-deployment bug: shift
  // close used to compute from fallback-store sales even when live
  // sales were in PostgreSQL, so Z-reports on PG were wrong.
  async getCurrentShift(storeId: string, cashierId: string, counterId?: string) {
    return op(
      async () => {
        const rows = await db
          .select()
          .from(schema.shifts)
          .where(
            and(
              eq(schema.shifts.storeId, storeId),
              eq(schema.shifts.cashierId, cashierId),
              eq(schema.shifts.status, 'open'),
            ),
          );
        for (const shift of rows) {
          if (counterId !== undefined && (shift.counterId ?? null) !== (counterId || null)) continue;
          return shift;
        }
        return null;
      },
      () => MemStorage.getCurrentShift(storeId, cashierId, counterId),
    );
  },
  async getShiftById(id: string) {
    return op(
      async () => {
        const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, id));
        return shift || null;
      },
      () => MemStorage.getShiftById(id),
    );
  },
  async openShift(data: Parameters<typeof MemStorage.openShift>[0]) {
    return op(
      async () => {
        return db.transaction(async (tx: any) => {
          if (data.branchId) {
            const [branch] = await tx
              .select()
              .from(schema.branches)
              .where(and(eq(schema.branches.id, data.branchId), eq(schema.branches.storeId, data.storeId)));
            if (!branch)
              throw new StorageRuleError('BRANCH_NOT_FOUND', 'The selected branch does not belong to this store.', 404);
          }
          if (data.counterId) {
            const [counter] = await tx
              .select()
              .from(schema.counters)
              .where(and(eq(schema.counters.id, data.counterId), eq(schema.counters.storeId, data.storeId)));
            if (!counter || (data.branchId && counter.branchId !== data.branchId)) {
              throw new StorageRuleError(
                'COUNTER_NOT_FOUND',
                'The selected counter does not belong to this branch.',
                404,
              );
            }
          }
          const existing = await this.getCurrentShift(data.storeId, data.cashierId, data.counterId);
          if (existing) return existing;
          const openingCash = Math.max(0, data.openingCash || 0);
          const [shift] = await tx
            .insert(schema.shifts)
            .values({
              id: genId(),
              storeId: data.storeId,
              branchId: data.branchId || null,
              counterId: data.counterId || null,
              cashierId: data.cashierId,
              cashierName: data.cashierName,
              openingCash,
              totalCashSales: 0,
              totalDigitalSales: 0,
              totalExpenses: 0,
              expectedCash: openingCash,
              actualCash: null,
              discrepancy: 0,
              status: 'open',
              notes: data.notes || null,
            })
            .returning();
          return shift;
        });
      },
      () => MemStorage.openShift(data),
    );
  },
  async closeShift(id: string, storeId: string, actualCash: number, notes?: string) {
    return op(
      async () => {
        return db.transaction(async (tx: any) => {
          const [shift] = await tx
            .select()
            .from(schema.shifts)
            .where(and(eq(schema.shifts.id, id), eq(schema.shifts.storeId, storeId)))
            .for('update');
          if (!shift) throw new StorageRuleError('SHIFT_NOT_FOUND', 'Shift not found.', 404);
          if (shift.status === 'closed') return shift;
          const shiftSales = await tx
            .select()
            .from(schema.sales)
            .where(
              and(
                eq(schema.sales.storeId, storeId),
                gte(schema.sales.date, new Date(shift.openedAt)),
                shift.counterId ? eq(schema.sales.counterId, shift.counterId) : undefined,
                shift.branchId ? eq(schema.sales.branchId, shift.branchId) : undefined,
              ),
            );
          let totalCashSales = 0;
          let totalDigitalSales = 0;
          for (const sale of shiftSales) {
            if (sale.paymentMethod === 'cash') totalCashSales += sale.paidAmount;
            else totalDigitalSales += sale.paidAmount;
          }
          let totalExpenses = 0;
          if (!shift.counterId) {
            const shiftExpenses = await tx
              .select()
              .from(schema.expenses)
              .where(and(eq(schema.expenses.storeId, storeId), gte(schema.expenses.date, new Date(shift.openedAt))));
            totalExpenses = shiftExpenses.reduce((acc: number, e: any) => acc + (e.amount || 0), 0);
          }
          const expectedCash = shift.openingCash + totalCashSales - totalExpenses;
          const discrepancy = actualCash - expectedCash;
          const [updated] = await tx
            .update(schema.shifts)
            .set({
              closedAt: new Date(),
              totalCashSales,
              totalDigitalSales,
              totalExpenses,
              expectedCash,
              actualCash,
              discrepancy,
              status: 'closed',
              notes: notes || shift.notes,
            })
            .where(eq(schema.shifts.id, id))
            .returning();
          return updated;
        });
      },
      () => MemStorage.closeShift(id, storeId, actualCash, notes),
    );
  },
  async getShiftsByStore(storeId: string) {
    return op(
      async () =>
        db.select().from(schema.shifts).where(eq(schema.shifts.storeId, storeId)).orderBy(desc(schema.shifts.openedAt)),
      () => MemStorage.getShiftsByStore(storeId),
    );
  },

  // ---------------- Phase 3 (Depth) ----------------
  // Phase 4: wired to PostgreSQL. Every method below mirrors the
  // fallback-store semantics (same errors, same rounding, same
  // default-branch rule) against the tables in
  // migrations/0002_phase3_depth.sql (+ 0003 loyalty composite PK).
  // op() still falls back to the durable fallback store on a real DB
  // error, exactly like the core entities.
  async getBranchesByStore(storeId: string) {
    return op(
      async () => db.select().from(schema.branches).where(eq(schema.branches.storeId, storeId)),
      () => MemStorage.getBranchesByStore(storeId),
    );
  },
  async createBranch(data: Parameters<typeof MemStorage.createBranch>[0]) {
    return op(
      async () => {
        return db.transaction(async (tx: any) => {
          if (!data.name || !data.name.trim()) {
            throw new StorageRuleError('INVALID_BRANCH', 'A branch name is required.', 400);
          }
          const existing = await tx.select().from(schema.branches).where(eq(schema.branches.storeId, data.storeId));
          const isDefault = data.isDefault === true || existing.length === 0;
          if (isDefault) {
            for (const b of existing) {
              if (b.isDefault) {
                await tx.update(schema.branches).set({ isDefault: false }).where(eq(schema.branches.id, b.id));
              }
            }
          }
          const [branch] = await tx
            .insert(schema.branches)
            .values({
              id: genId(),
              storeId: data.storeId,
              name: data.name.trim(),
              address: data.address?.trim() || null,
              isDefault,
            })
            .returning();
          return branch;
        });
      },
      () => MemStorage.createBranch(data),
    );
  },
  async getCountersByBranch(storeId: string, branchId: string) {
    return op(
      async () => {
        const [branch] = await db
          .select()
          .from(schema.branches)
          .where(and(eq(schema.branches.id, branchId), eq(schema.branches.storeId, storeId)));
        if (!branch) throw new StorageRuleError('BRANCH_NOT_FOUND', 'Branch not found in this store.', 404);
        return db.select().from(schema.counters).where(eq(schema.counters.branchId, branchId));
      },
      () => MemStorage.getCountersByBranch(storeId, branchId),
    );
  },
  async createCounter(data: Parameters<typeof MemStorage.createCounter>[0]) {
    return op(
      async () => {
        const [branch] = await db
          .select()
          .from(schema.branches)
          .where(and(eq(schema.branches.id, data.branchId), eq(schema.branches.storeId, data.storeId)));
        if (!branch) throw new StorageRuleError('BRANCH_NOT_FOUND', 'Branch not found in this store.', 404);
        if (!data.name || !data.name.trim()) {
          throw new StorageRuleError('INVALID_COUNTER', 'A counter name is required.', 400);
        }
        const [counter] = await db
          .insert(schema.counters)
          .values({ id: genId(), storeId: data.storeId, branchId: data.branchId, name: data.name.trim() })
          .returning();
        return counter;
      },
      () => MemStorage.createCounter(data),
    );
  },
  async getProductsByBranch(storeId: string, branchId: string) {
    return op(
      async () => {
        const [branch] = await db
          .select()
          .from(schema.branches)
          .where(and(eq(schema.branches.id, branchId), eq(schema.branches.storeId, storeId)));
        if (!branch) throw new StorageRuleError('BRANCH_NOT_FOUND', 'Branch not found in this store.', 404);
        const rows = await db.select().from(schema.products).where(eq(schema.products.storeId, storeId));
        return rows.filter((p: any) => {
          if (p.branchId) return p.branchId === branchId;
          return branch.isDefault === true;
        });
      },
      () => MemStorage.getProductsByBranch(storeId, branchId),
    );
  },
  async getSalesByBranch(storeId: string, branchId: string) {
    return op(
      async () => {
        const [branch] = await db
          .select()
          .from(schema.branches)
          .where(and(eq(schema.branches.id, branchId), eq(schema.branches.storeId, storeId)));
        if (!branch) throw new StorageRuleError('BRANCH_NOT_FOUND', 'Branch not found in this store.', 404);
        return db
          .select()
          .from(schema.sales)
          .where(and(eq(schema.sales.storeId, storeId), eq(schema.sales.branchId, branchId)))
          .orderBy(desc(schema.sales.date));
      },
      () => MemStorage.getSalesByBranch(storeId, branchId),
    );
  },
  async getZReportsByCounter(storeId: string) {
    return op(
      async () => {
        const closed = await db
          .select()
          .from(schema.shifts)
          .where(and(eq(schema.shifts.storeId, storeId), eq(schema.shifts.status, 'closed')));
        const counters = await db.select().from(schema.counters).where(eq(schema.counters.storeId, storeId));
        const counterNames = new Map(counters.map((c: any) => [c.id, c.name]));
        const groups = new Map<string, any>();
        for (const s of closed as any[]) {
          const counterId = s.counterId || null;
          const key = counterId || '__store__';
          const cur = groups.get(key) || {
            counterId,
            counterName: counterId ? counterNames.get(counterId) || 'Counter' : 'Store (no counter)',
            branchId: s.branchId || null,
            shifts: 0,
            expectedCash: 0,
            actualCash: 0,
            discrepancy: 0,
          };
          cur.shifts += 1;
          cur.expectedCash = Math.round((cur.expectedCash + (s.expectedCash || 0)) * 100) / 100;
          cur.actualCash = Math.round((cur.actualCash + (s.actualCash || 0)) * 100) / 100;
          cur.discrepancy = Math.round((cur.discrepancy + (s.discrepancy || 0)) * 100) / 100;
          groups.set(key, cur);
        }
        return [...groups.values()].sort((a: any, b: any) => a.counterName.localeCompare(b.counterName));
      },
      () => MemStorage.getZReportsByCounter(storeId),
    );
  },
  async getSuppliersByStore(storeId: string) {
    return op(
      async () => db.select().from(schema.suppliers).where(eq(schema.suppliers.storeId, storeId)),
      () => MemStorage.getSuppliersByStore(storeId),
    );
  },
  async createSupplier(data: Parameters<typeof MemStorage.createSupplier>[0]) {
    return op(
      async () => {
        if (!data.name || !data.name.trim()) {
          throw new StorageRuleError('INVALID_SUPPLIER', 'A supplier name is required.', 400);
        }
        const [supplier] = await db
          .insert(schema.suppliers)
          .values({
            id: genId(),
            storeId: data.storeId,
            name: data.name.trim(),
            phone: data.phone?.trim() || null,
            address: data.address?.trim() || null,
            notes: data.notes?.trim() || null,
            totalDue: 0,
          })
          .returning();
        return supplier;
      },
      () => MemStorage.createSupplier(data),
    );
  },
  async updateSupplier(id: string, storeId: string, updates: Partial<schema.Supplier>) {
    return op(
      async () => {
        const [existing] = await db
          .select()
          .from(schema.suppliers)
          .where(and(eq(schema.suppliers.id, id), eq(schema.suppliers.storeId, storeId)));
        if (!existing) return null;
        const allowed: Record<string, unknown> = {};
        for (const field of ['name', 'phone', 'address', 'notes'] as const) {
          if ((updates as any)[field] !== undefined) allowed[field] = (updates as any)[field];
        }
        const [updated] = await db
          .update(schema.suppliers)
          .set(allowed)
          .where(and(eq(schema.suppliers.id, id), eq(schema.suppliers.storeId, storeId)))
          .returning();
        return updated;
      },
      () => MemStorage.updateSupplier(id, storeId, updates),
    );
  },
  async deleteSupplier(id: string, storeId: string) {
    return op(
      async () => {
        const [deleted] = await db
          .delete(schema.suppliers)
          .where(and(eq(schema.suppliers.id, id), eq(schema.suppliers.storeId, storeId)))
          .returning({ id: schema.suppliers.id });
        return Boolean(deleted);
      },
      () => MemStorage.deleteSupplier(id, storeId),
    );
  },
  async getSupplierDuesTotal(storeId: string) {
    return op(
      async () => {
        const rows = await db.select().from(schema.suppliers).where(eq(schema.suppliers.storeId, storeId));
        return Math.round(rows.reduce((sum: number, s: any) => sum + (s.totalDue || 0), 0) * 100) / 100;
      },
      () => MemStorage.getSupplierDuesTotal(storeId),
    );
  },
  async paySupplier(id: string, storeId: string, amount: number, actorId?: string) {
    return op(
      async () => {
        return db.transaction(async (tx: any) => {
          const [supplier] = await tx
            .select()
            .from(schema.suppliers)
            .where(and(eq(schema.suppliers.id, id), eq(schema.suppliers.storeId, storeId)))
            .for('update');
          if (!supplier) throw new StorageRuleError('SUPPLIER_NOT_FOUND', 'Supplier not found in this store.', 404);
          if (!Number.isFinite(amount) || amount <= 0) {
            throw new StorageRuleError('INVALID_PAYMENT', 'Payment amount must be positive.', 400);
          }
          const paid = Math.min(amount, supplier.totalDue);
          const [updated] = await tx
            .update(schema.suppliers)
            .set({ totalDue: Math.round((supplier.totalDue - paid) * 100) / 100 })
            .where(eq(schema.suppliers.id, id))
            .returning();
          if (paid > 0) {
            await tx.insert(schema.expenses).values({
              id: genId(),
              storeId,
              description: `Supplier payment: ${supplier.name}`,
              amount: paid,
              category: 'supplier_payment',
              date: new Date(),
            });
          }
          return updated;
        });
      },
      () => MemStorage.paySupplier(id, storeId, amount, actorId),
    );
  },
  async getPurchaseOrdersByStore(storeId: string) {
    return op(
      async () =>
        db
          .select()
          .from(schema.purchaseOrders)
          .where(eq(schema.purchaseOrders.storeId, storeId))
          .orderBy(desc(schema.purchaseOrders.createdAt)),
      () => MemStorage.getPurchaseOrdersByStore(storeId),
    );
  },
  async createPurchaseOrder(data: Parameters<typeof MemStorage.createPurchaseOrder>[0]) {
    return op(
      async () => {
        const [supplier] = await db
          .select()
          .from(schema.suppliers)
          .where(and(eq(schema.suppliers.id, data.supplierId), eq(schema.suppliers.storeId, data.storeId)));
        if (!supplier) throw new StorageRuleError('SUPPLIER_NOT_FOUND', 'Supplier not found in this store.', 404);
        if (!Array.isArray(data.items) || data.items.length === 0) {
          throw new StorageRuleError('INVALID_PO_ITEMS', 'A purchase order needs at least one item.', 400);
        }
        const items = [];
        for (const item of data.items) {
          const [product] = await db
            .select()
            .from(schema.products)
            .where(and(eq(schema.products.id, item.productId), eq(schema.products.storeId, data.storeId)));
          if (!product) {
            throw new StorageRuleError(
              'PRODUCT_NOT_FOUND',
              'A purchase-order product is unavailable in this store.',
              404,
            );
          }
          if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.cost) || item.cost < 0) {
            throw new StorageRuleError('INVALID_PO_ITEM', 'Quantity must be positive and cost non-negative.', 400);
          }
          items.push({
            productId: item.productId,
            productName: product.name,
            quantity: item.quantity,
            cost: item.cost,
            receivedQty: 0,
          });
        }
        const totalCost = Math.round(items.reduce((sum: number, i: any) => sum + i.quantity * i.cost, 0) * 100) / 100;
        const [po] = await db
          .insert(schema.purchaseOrders)
          .values({
            id: genId(),
            storeId: data.storeId,
            supplierId: data.supplierId,
            branchId: data.branchId || null,
            status: 'draft',
            items,
            totalCost,
            receivedAt: null,
          })
          .returning();
        return po;
      },
      () => MemStorage.createPurchaseOrder(data),
    );
  },
  async receivePurchaseOrder(
    id: string,
    storeId: string,
    received: Array<{ productId: string; quantity: number }>,
    actorId?: string,
  ) {
    return op(
      async () => {
        return db.transaction(async (tx: any) => {
          const [po] = await tx
            .select()
            .from(schema.purchaseOrders)
            .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.storeId, storeId)))
            .for('update');
          if (!po) throw new StorageRuleError('PO_NOT_FOUND', 'Purchase order not found in this store.', 404);
          if (po.status === 'received' || po.status === 'cancelled') {
            throw new StorageRuleError('PO_CLOSED', `Purchase order is already ${po.status}.`, 400);
          }
          const byProduct = new Map(received.map((r) => [r.productId, r.quantity]));
          let dueIncrease = 0;
          const items = (po.items as any[]).map((item: any) => {
            const qty = byProduct.get(item.productId);
            if (qty === undefined || qty <= 0) return item;
            const remaining = item.quantity - (item.receivedQty || 0);
            const accepted = Math.min(qty, remaining);
            if (accepted <= 0) return item;
            dueIncrease = Math.round((dueIncrease + accepted * item.cost) * 100) / 100;
            return { ...item, receivedQty: (item.receivedQty || 0) + accepted };
          });
          const newlyReceived = items.some(
            (i: any, idx: number) => i.receivedQty !== (po.items as any)[idx].receivedQty,
          );
          if (!newlyReceived) {
            throw new StorageRuleError('PO_NOTHING_RECEIVED', 'No new quantity was received for this order.', 400);
          }
          const fullyReceived = items.every((i: any) => (i.receivedQty || 0) >= i.quantity);
          const [updated] = await tx
            .update(schema.purchaseOrders)
            .set({
              items,
              status: fullyReceived ? 'received' : 'partial',
              receivedAt: fullyReceived ? new Date() : po.receivedAt,
            })
            .where(eq(schema.purchaseOrders.id, id))
            .returning();
          for (const item of items as any[]) {
            const before = (po.items as any[]).find((i: any) => i.productId === item.productId);
            const delta = item.receivedQty - (before?.receivedQty || 0);
            if (delta > 0) {
              const [product] = await tx
                .select()
                .from(schema.products)
                .where(and(eq(schema.products.id, item.productId), eq(schema.products.storeId, storeId)))
                .for('update');
              if (!product) {
                throw new StorageRuleError(
                  'PRODUCT_NOT_FOUND',
                  'A purchase-order product is unavailable in this store.',
                  404,
                );
              }
              const newStock = Number((product.stock + delta).toFixed(6));
              await tx.update(schema.products).set({ stock: newStock }).where(eq(schema.products.id, item.productId));
              await tx.insert(schema.inventoryLogs).values({
                id: genId(),
                storeId,
                productId: item.productId,
                productName: item.productName || item.productId,
                type: 'in',
                quantity: delta,
                reason: `Purchase Order #${po.id.slice(-6)} received`,
                actorId: actorId || null,
                date: new Date(),
              });
            }
          }
          if (dueIncrease > 0) {
            const [supplier] = await tx
              .select()
              .from(schema.suppliers)
              .where(eq(schema.suppliers.id, po.supplierId))
              .for('update');
            if (supplier) {
              await tx
                .update(schema.suppliers)
                .set({ totalDue: Math.round((supplier.totalDue + dueIncrease) * 100) / 100 })
                .where(eq(schema.suppliers.id, supplier.id));
            }
          }
          return updated;
        });
      },
      () => MemStorage.receivePurchaseOrder(id, storeId, received, actorId),
    );
  },
  async cancelPurchaseOrder(id: string, storeId: string) {
    return op(
      async () => {
        const [po] = await db
          .select()
          .from(schema.purchaseOrders)
          .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.storeId, storeId)));
        if (!po) throw new StorageRuleError('PO_NOT_FOUND', 'Purchase order not found in this store.', 404);
        if (po.status !== 'draft') {
          throw new StorageRuleError('PO_NOT_DRAFT', 'Only a draft purchase order can be cancelled.', 400);
        }
        const [updated] = await db
          .update(schema.purchaseOrders)
          .set({ status: 'cancelled' })
          .where(eq(schema.purchaseOrders.id, id))
          .returning();
        return updated;
      },
      () => MemStorage.cancelPurchaseOrder(id, storeId),
    );
  },
  async getCouponsByStore(storeId: string) {
    return op(
      async () => db.select().from(schema.coupons).where(eq(schema.coupons.storeId, storeId)),
      () => MemStorage.getCouponsByStore(storeId),
    );
  },
  async createCoupon(data: Parameters<typeof MemStorage.createCoupon>[0]) {
    return op(
      async () => {
        const code = (data.code || '').trim().toUpperCase();
        if (!code) throw new StorageRuleError('INVALID_COUPON', 'A coupon code is required.', 400);
        if (data.type !== 'percent' && data.type !== 'fixed') {
          throw new StorageRuleError('INVALID_COUPON', 'Coupon type must be percent or fixed.', 400);
        }
        if (!Number.isFinite(data.value) || data.value < 0 || (data.type === 'percent' && data.value > 100)) {
          throw new StorageRuleError('INVALID_COUPON', 'Coupon value is out of range.', 400);
        }
        const clash = await db
          .select()
          .from(schema.coupons)
          .where(and(eq(schema.coupons.storeId, data.storeId), sql`upper(${schema.coupons.code}) = ${code}`));
        if (clash.length > 0)
          throw new StorageRuleError('COUPON_EXISTS', 'A coupon with this code already exists.', 409);
        const [coupon] = await db
          .insert(schema.coupons)
          .values({
            id: genId(),
            storeId: data.storeId,
            code,
            type: data.type,
            value: data.value,
            minPurchase: data.minPurchase || 0,
            maxUses: data.maxUses || 0,
            usedCount: 0,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
            active: data.active !== false,
          })
          .returning();
        return coupon;
      },
      () => MemStorage.createCoupon(data),
    );
  },
  async deleteCoupon(id: string, storeId: string) {
    return op(
      async () => {
        const [deleted] = await db
          .delete(schema.coupons)
          .where(and(eq(schema.coupons.id, id), eq(schema.coupons.storeId, storeId)))
          .returning({ id: schema.coupons.id });
        return Boolean(deleted);
      },
      () => MemStorage.deleteCoupon(id, storeId),
    );
  },
  async getLoyaltyAccount(storeId: string, phone: string) {
    return op(
      async () => {
        const [account] = await db
          .select()
          .from(schema.loyaltyAccounts)
          .where(and(eq(schema.loyaltyAccounts.storeId, storeId), eq(schema.loyaltyAccounts.phone, phone)));
        return account || null;
      },
      () => MemStorage.getLoyaltyAccount(storeId, phone),
    );
  },
  async getLoyaltyAccountsByStore(storeId: string) {
    return op(
      async () =>
        db
          .select()
          .from(schema.loyaltyAccounts)
          .where(eq(schema.loyaltyAccounts.storeId, storeId))
          .orderBy(desc(schema.loyaltyAccounts.points)),
      () => MemStorage.getLoyaltyAccountsByStore(storeId),
    );
  },
  async getForecast(storeId: string, windowDays: number, leadTimeDays: number) {
    return op(
      async () => {
        const products = await db.select().from(schema.products).where(eq(schema.products.storeId, storeId));
        const sales = await db.select().from(schema.sales).where(eq(schema.sales.storeId, storeId));
        const qtyByProduct = new Map<string, Array<{ date: string; quantity: number }>>();
        for (const sale of sales) {
          for (const item of sale.items as Array<{ id: string; quantity: number }>) {
            const list = qtyByProduct.get(item.id) || [];
            list.push({ date: new Date(sale.date).toISOString(), quantity: item.quantity });
            qtyByProduct.set(item.id, list);
          }
        }
        return products
          .map((p: any) =>
            forecastDemand({
              productId: p.id,
              productName: p.name,
              currentStock: p.stock,
              history: qtyByProduct.get(p.id) || [],
              windowDays,
              leadTimeDays,
            }),
          )
          .sort((a: { suggestedQty: number }, b: { suggestedQty: number }) => b.suggestedQty - a.suggestedQty);
      },
      () => MemStorage.getForecast(storeId, windowDays, leadTimeDays),
    );
  },
  async getExpiryAlerts(storeId: string) {
    return op(
      async () => {
        const products = await db.select().from(schema.products).where(eq(schema.products.storeId, storeId));
        return expiryAlerts(products.map((p: any) => ({ id: p.id, name: p.name, expiryDate: p.expiryDate || null })));
      },
      () => MemStorage.getExpiryAlerts(storeId),
    );
  },
  async getDeadStock(storeId: string, windowDays = 90) {
    return op(
      async () => {
        const products = await db.select().from(schema.products).where(eq(schema.products.storeId, storeId));
        const sales = await db.select().from(schema.sales).where(eq(schema.sales.storeId, storeId));
        const lastSale = new Map<string, string>();
        for (const sale of sales) {
          for (const item of sale.items as Array<{ id: string }>) {
            const prev = lastSale.get(item.id);
            const d = new Date(sale.date).toISOString();
            if (!prev || d > prev) lastSale.set(item.id, d);
          }
        }
        return deadStock(
          products.map((p: any) => ({ id: p.id, name: p.name, stock: p.stock })),
          lastSale,
          windowDays,
        );
      },
      () => MemStorage.getDeadStock(storeId, windowDays),
    );
  },

  // ---------------- Automated Backup & Export ----------------
  async exportDatabaseBackup() {
    return MemStorage.exportDatabaseBackup();
  },
};
