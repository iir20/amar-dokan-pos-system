import { db } from './db';
import * as schema from '../shared/schema';
import { eq, desc, gte, and, or, ilike } from 'drizzle-orm';
import crypto from 'node:crypto';
import { calculateSaleTotals, moneyToMinor, PaymentMethod, quantityToUnits } from '../shared/finance';

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

export class StorageRuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'StorageRuleError';
  }
}

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
  ) return false;

  const savedItems = existing.items as Array<{ id: string; quantity: number; price: number; note?: string }>;
  if (savedItems.length !== incoming.items.length) return false;
  for (let index = 0; index < savedItems.length; index += 1) {
    const saved = savedItems[index];
    const requested = incoming.items[index];
    if (
      saved.id !== requested.id ||
      saved.quantity !== requested.quantity ||
      (requested.price !== undefined && moneyToMinor(saved.price, 'price') !== moneyToMinor(requested.price, 'price')) ||
      (saved.note || '') !== (requested.note || '')
    ) return false;
  }

  const requestedReceived = requestedSaleReceivedAmount(incoming);
  if (requestedReceived === null) return existing.paidAmount === existing.totalAmount;
  const expectedReceived = incoming.paymentMethod === 'cash'
    ? existing.cashReceived ?? existing.paidAmount
    : existing.paidAmount;
  return moneyToMinor(expectedReceived, 'payment') === moneyToMinor(requestedReceived, 'payment');
}

export const Storage = {
  // ---------------- Users (Owners/Admin) ----------------
  async getUserById(id: string) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return u || null;
  },
  async getUserByUsername(username: string) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.username, username));
    return u || null;
  },
  async getAllUsers() {
    return db.select().from(schema.users);
  },
  async createUser(data: typeof schema.users.$inferInsert) {
    const [u] = await db.insert(schema.users).values(data).returning();
    return u;
  },
  async updateUser(id: string, data: Partial<typeof schema.users.$inferInsert>) {
    const [u] = await db.update(schema.users).set(data).where(eq(schema.users.id, id)).returning();
    return u;
  },
  async deleteUser(id: string) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
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
    return db.select().from(schema.staff).where(eq(schema.staff.ownerId, ownerId));
  },
  async getStaffByUsername(username: string) {
    const [s] = await db.select().from(schema.staff).where(eq(schema.staff.username, username));
    return s || null;
  },
  async getStaffById(id: string) {
    const [s] = await db.select().from(schema.staff).where(eq(schema.staff.id, id));
    return s || null;
  },
  async createStaff(data: typeof schema.staff.$inferInsert) {
    const [s] = await db.insert(schema.staff).values(data).returning();
    return s;
  },
  async updateStaff(id: string, data: Partial<typeof schema.staff.$inferInsert>) {
    const [s] = await db.update(schema.staff).set(data).where(eq(schema.staff.id, id)).returning();
    return s;
  },
  async updateStaffForOwner(id: string, ownerId: string, data: Partial<typeof schema.staff.$inferInsert>) {
    const [s] = await db.update(schema.staff).set(data)
      .where(and(eq(schema.staff.id, id), eq(schema.staff.ownerId, ownerId)))
      .returning();
    return s || null;
  },
  async deleteStaff(id: string) {
    await db.delete(schema.staff).where(eq(schema.staff.id, id));
  },
  async deleteStaffForOwner(id: string, ownerId: string) {
    const [deleted] = await db.delete(schema.staff)
      .where(and(eq(schema.staff.id, id), eq(schema.staff.ownerId, ownerId)))
      .returning({ id: schema.staff.id });
    return Boolean(deleted);
  },

  // ---------------- Customers ----------------
  async getCustomerByPhone(phone: string) {
    const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone));
    return c || null;
  },
  async getCustomerById(id: string) {
    const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, id));
    return c || null;
  },
  async createCustomer(data: typeof schema.customers.$inferInsert) {
    const [c] = await db.insert(schema.customers).values(data).returning();
    return c;
  },
  async updateCustomer(id: string, data: Partial<typeof schema.customers.$inferInsert>) {
    const [c] = await db.update(schema.customers).set(data).where(eq(schema.customers.id, id)).returning();
    return c;
  },

  // ---------------- Products ----------------
  async getProductsByStore(storeId: string) {
    return db.select().from(schema.products).where(eq(schema.products.storeId, storeId));
  },
  async getProductById(id: string) {
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, id));
    return p || null;
  },
  async countProductsByStore(storeId: string) {
    const rows = await db.select().from(schema.products).where(eq(schema.products.storeId, storeId));
    return rows.length;
  },
  async upsertProduct(data: typeof schema.products.$inferInsert, storeId: string, actorId?: string) {
    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.products)
        .where(eq(schema.products.id, data.id))
        .for('update');
      if (existing && existing.storeId !== storeId) {
        throw new StorageRuleError('PRODUCT_NOT_FOUND', 'Product not found in this store.', 404);
      }

      const productData = { ...data, storeId };
      const [product] = existing
        ? await tx.update(schema.products)
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
  async deleteProduct(id: string, storeId: string) {
    const [deleted] = await db.delete(schema.products)
      .where(and(eq(schema.products.id, id), eq(schema.products.storeId, storeId)))
      .returning({ id: schema.products.id });
    return Boolean(deleted);
  },
  async updateProductStock(id: string, newStock: number) {
    const [p] = await db.update(schema.products).set({ stock: newStock }).where(eq(schema.products.id, id)).returning();
    return p;
  },
  // Marketplace: search products across all stores that are online-visible
  async searchAllProducts(query?: string, category?: string) {
    const conditions = [eq(schema.products.isOnlineVisible, true)];
    if (category) conditions.push(eq(schema.products.category, category));
    let rows = await db.select().from(schema.products).where(and(...conditions));
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter(p => p.name.toLowerCase().includes(q) || (p.nameBn || '').toLowerCase().includes(q));
    }
    return rows;
  },

  // ---------------- Sales (POS) ----------------
  async getSalesByStore(storeId: string) {
    return db.select().from(schema.sales).where(eq(schema.sales.storeId, storeId)).orderBy(desc(schema.sales.date));
  },
  async getAllSales() {
    return db.select().from(schema.sales).orderBy(desc(schema.sales.date));
  },
  async countTodaySalesByStore(storeId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = await db.select().from(schema.sales).where(and(eq(schema.sales.storeId, storeId), gte(schema.sales.date, today)));
    return rows.length;
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

    return db.transaction(async (tx) => {
      const [prior] = await tx.select().from(schema.sales).where(eq(schema.sales.id, sale.id));
      if (prior) {
        if (prior.storeId !== storeId) {
          throw new StorageRuleError('SALE_ID_CONFLICT', 'Transaction ID has already been used.', 409);
        }
        if (!isIdempotentSaleReplay(prior, sale)) {
          throw new StorageRuleError('SALE_ID_CONFLICT', 'Transaction ID was reused with different sale details.', 409);
        }
        return prior;
      }

      const products = new Map<string, schema.Product>();
      for (const productId of [...seenProductIds].sort()) {
        const [product] = await tx.select().from(schema.products)
          .where(eq(schema.products.id, productId))
          .for('update');
        if (!product || product.storeId !== storeId) {
          throw new StorageRuleError('PRODUCT_NOT_FOUND', 'A selected product is unavailable in this store.', 409);
        }
        products.set(productId, product);
      }

      // A concurrent retry with the same sale ID waits on the product locks.
      // Re-check after acquiring them so a retry never deducts stock twice.
      const [concurrentPrior] = await tx.select().from(schema.sales).where(eq(schema.sales.id, sale.id));
      if (concurrentPrior) {
        if (concurrentPrior.storeId !== storeId || !isIdempotentSaleReplay(concurrentPrior, sale)) {
          throw new StorageRuleError('SALE_ID_CONFLICT', 'Transaction ID was reused with different sale details.', 409);
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
      const baseTotals = calculateSaleTotals(
        saleItems,
        0,
        0,
        0,
        sale.paymentMethod,
      );
      const discountLimit = input.maxDiscountPercent ?? 100;
      if (!Number.isFinite(discountLimit) || discountLimit < 0 || discountLimit > 100) {
        throw new StorageRuleError('INVALID_DISCOUNT_POLICY', 'The configured discount limit is invalid.', 500);
      }
      const maxDiscountMinor = Math.floor(moneyToMinor(baseTotals.subTotal) * discountLimit / 100);
      if (moneyToMinor(sale.discount ?? 0, 'discount') > maxDiscountMinor) {
        throw new StorageRuleError('DISCOUNT_LIMIT', 'This discount exceeds the authorized limit.', 403);
      }
      const totals = calculateSaleTotals(
        saleItems,
        sale.discount ?? 0,
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

      const [created] = await tx.insert(schema.sales).values({
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
      }).returning();

      for (const requested of sale.items) {
        const product = products.get(requested.id)!;
        const newStock = Number((product.stock - requested.quantity).toFixed(6));
        const [updated] = await tx.update(schema.products)
          .set({ stock: newStock })
          .where(and(
            eq(schema.products.id, requested.id),
            eq(schema.products.storeId, storeId),
          ))
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

  // ---------------- Expenses ----------------
  async getExpensesByStore(storeId: string) {
    return db.select().from(schema.expenses).where(eq(schema.expenses.storeId, storeId));
  },
  async createExpense(data: typeof schema.expenses.$inferInsert) {
    const [e] = await db.insert(schema.expenses).values(data).returning();
    return e;
  },
  async deleteExpense(id: string, storeId: string) {
    const [deleted] = await db.delete(schema.expenses)
      .where(and(eq(schema.expenses.id, id), eq(schema.expenses.storeId, storeId)))
      .returning({ id: schema.expenses.id });
    return Boolean(deleted);
  },

  // ---------------- Inventory Logs ----------------
  async logInventoryMovement(entry: typeof schema.inventoryLogs.$inferInsert) {
    await db.insert(schema.inventoryLogs).values(entry);
  },
  async getInventoryLogsByStore(storeId: string) {
    return db.select().from(schema.inventoryLogs).where(eq(schema.inventoryLogs.storeId, storeId)).orderBy(desc(schema.inventoryLogs.date));
  },

  // ---------------- Subscription Requests ----------------
  async createSubscriptionRequest(data: typeof schema.subscriptionRequests.$inferInsert) {
    const [r] = await db.insert(schema.subscriptionRequests).values(data).returning();
    return r;
  },
  async getAllSubscriptionRequests() {
    return db.select().from(schema.subscriptionRequests).orderBy(desc(schema.subscriptionRequests.date));
  },
  async getSubscriptionRequestById(id: string) {
    const [r] = await db.select().from(schema.subscriptionRequests).where(eq(schema.subscriptionRequests.id, id));
    return r || null;
  },
  async updateSubscriptionRequest(id: string, data: Partial<typeof schema.subscriptionRequests.$inferInsert>) {
    const [r] = await db.update(schema.subscriptionRequests).set(data).where(eq(schema.subscriptionRequests.id, id)).returning();
    return r;
  },

  // ---------------- Settings ----------------
  async getSetting(key: string) {
    const [s] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
    return s?.value ?? null;
  },
  async setSetting(key: string, value: any) {
    const existing = await this.getSetting(key);
    if (existing !== null) {
      await db.update(schema.settings).set({ value }).where(eq(schema.settings.key, key));
    } else {
      await db.insert(schema.settings).values({ key, value });
    }
  },

  // ---------------- Restaurant ----------------
  async getTablesByStore(storeId: string) {
    return db.select().from(schema.restaurantTables).where(eq(schema.restaurantTables.storeId, storeId));
  },
  async createTable(data: typeof schema.restaurantTables.$inferInsert) {
    const [t] = await db.insert(schema.restaurantTables).values(data).returning();
    return t;
  },
  async deleteTable(id: string, storeId: string) {
    const [deleted] = await db.delete(schema.restaurantTables)
      .where(and(eq(schema.restaurantTables.id, id), eq(schema.restaurantTables.storeId, storeId)))
      .returning({ id: schema.restaurantTables.id });
    return Boolean(deleted);
  },
  async getTableById(id: string) {
    const [t] = await db.select().from(schema.restaurantTables).where(eq(schema.restaurantTables.id, id));
    return t || null;
  },
  async getGuestOrdersByStore(storeId: string) {
    return db.select().from(schema.guestOrders).where(eq(schema.guestOrders.storeId, storeId)).orderBy(desc(schema.guestOrders.createdAt));
  },
  async createGuestOrder(data: {
    idempotencyKey: string;
    tableId: string;
    items: Array<{ id: string; quantity: number; note?: string }>;
    note?: string;
  }) {
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

    return db.transaction(async (tx) => {
      const [table] = await tx.select().from(schema.restaurantTables)
        .where(and(
          eq(schema.restaurantTables.id, data.tableId),
          eq(schema.restaurantTables.isActive, true),
        ))
        .for('update');
      if (!table) throw new StorageRuleError('TABLE_NOT_FOUND', 'This restaurant table is unavailable.', 404);

      const [existing] = await tx.select().from(schema.guestOrders)
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
          throw new StorageRuleError('IDEMPOTENCY_KEY_REUSED', 'This request id was already used for a different order.', 409);
        }
        return existing;
      }

      const products = new Map<string, schema.Product>();
      for (const id of [...new Set(ids)].sort()) {
        const [product] = await tx.select().from(schema.products)
          .where(and(
            eq(schema.products.id, id),
            eq(schema.products.storeId, table.storeId),
          ))
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
      const [order] = await tx.insert(schema.guestOrders).values({
        id: data.idempotencyKey,
        storeId: table.storeId,
        tableId: table.id,
        items,
        note: data.note || null,
        status: 'pending',
        totalAmount: totals.subTotal,
      }).returning();
      return order;
    });
  },
  async getGuestOrderById(id: string) {
    const [o] = await db.select().from(schema.guestOrders).where(eq(schema.guestOrders.id, id));
    return o || null;
  },
  async updateGuestOrder(id: string, storeId: string, nextStatus: string) {
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

    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.guestOrders)
        .where(and(
          eq(schema.guestOrders.id, id),
          eq(schema.guestOrders.storeId, storeId),
        ))
        .for('update');
      if (!existing) throw new StorageRuleError('ORDER_NOT_FOUND', 'Order not found in this store.', 404);
      if (existing.status === nextStatus) return existing;
      if (!allowedTransitions[existing.status]?.includes(nextStatus)) {
        throw new StorageRuleError('INVALID_ORDER_TRANSITION', 'This order cannot move to that status.', 409);
      }
      const [updated] = await tx.update(schema.guestOrders)
        .set({ status: nextStatus })
        .where(and(
          eq(schema.guestOrders.id, id),
          eq(schema.guestOrders.storeId, storeId),
          eq(schema.guestOrders.status, existing.status),
        ))
        .returning();
      return updated;
    });
  },

  // ---------------- Announcements ----------------
  async getAllAnnouncements() {
    return db.select().from(schema.announcements).orderBy(desc(schema.announcements.createdAt));
  },
  async createAnnouncement(data: typeof schema.announcements.$inferInsert) {
    const [a] = await db.insert(schema.announcements).values(data).returning();
    return a;
  },
  async deleteAnnouncement(id: string) {
    await db.delete(schema.announcements).where(eq(schema.announcements.id, id));
  },

  // ---------------- Online Marketplace Orders ----------------
  async createOnlineOrder(data: typeof schema.onlineOrders.$inferInsert) {
    const [o] = await db.insert(schema.onlineOrders).values(data).returning();
    return o;
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

    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.onlineOrders)
        .where(eq(schema.onlineOrders.id, data.id))
        .for('update');
      if (existing) {
        if (existing.customerId !== data.customerId || existing.storeId !== data.storeId || !matchesRequest(existing.items)) {
          throw new StorageRuleError('IDEMPOTENCY_KEY_REUSED', 'This order request key was already used for a different order.', 409);
        }
        return existing;
      }

      const products = new Map<string, typeof schema.products.$inferSelect>();
      for (const productId of [...seenIds].sort()) {
        const [product] = await tx.select().from(schema.products)
          .where(and(
            eq(schema.products.id, productId),
            eq(schema.products.storeId, data.storeId),
          ))
          .for('update');
        if (!product || product.isOnlineVisible === false) {
          throw new StorageRuleError('PRODUCT_UNAVAILABLE', 'An item is no longer available.', 404);
        }
        products.set(productId, product);
      }

      const [concurrentExisting] = await tx.select().from(schema.onlineOrders)
        .where(eq(schema.onlineOrders.id, data.id))
        .for('update');
      if (concurrentExisting) {
        if (
          concurrentExisting.customerId !== data.customerId ||
          concurrentExisting.storeId !== data.storeId ||
          !matchesRequest(concurrentExisting.items)
        ) {
          throw new StorageRuleError('IDEMPOTENCY_KEY_REUSED', 'This order request key was already used for a different order.', 409);
        }
        return concurrentExisting;
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
      const [order] = await tx.insert(schema.onlineOrders).values({
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
      }).returning();

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
  async getOnlineOrderById(id: string) {
    const [o] = await db.select().from(schema.onlineOrders).where(eq(schema.onlineOrders.id, id));
    return o || null;
  },
  async getOnlineOrdersByCustomer(customerId: string) {
    return db.select().from(schema.onlineOrders).where(eq(schema.onlineOrders.customerId, customerId)).orderBy(desc(schema.onlineOrders.createdAt));
  },
  async getOnlineOrdersByStore(storeId: string) {
    return db.select().from(schema.onlineOrders).where(eq(schema.onlineOrders.storeId, storeId)).orderBy(desc(schema.onlineOrders.createdAt));
  },
  async updateOnlineOrderStatus(id: string, status: string) {
    const [o] = await db.update(schema.onlineOrders).set({ status, updatedAt: new Date() }).where(eq(schema.onlineOrders.id, id)).returning();
    return o;
  },
  async updateOnlineOrderStatusForStore(id: string, storeId: string, status: string, actorId: string) {
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
    return db.transaction(async (tx) => {
      const [order] = await tx.select().from(schema.onlineOrders)
        .where(and(
          eq(schema.onlineOrders.id, id),
          eq(schema.onlineOrders.storeId, storeId),
        ))
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
          const [product] = await tx.select().from(schema.products)
            .where(and(
              eq(schema.products.id, productId),
              eq(schema.products.storeId, storeId),
            ))
            .for('update');
          if (product) products.set(productId, product);
        }
        for (const item of items) {
          const quantity = Number(item.quantity);
          const product = products.get(item.id);
          if (!product || !Number.isFinite(quantity) || quantity <= 0) {
            throw new StorageRuleError('ORDER_STOCK_RESTORE_FAILED', 'The order contains unavailable stock data.', 409);
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

      const [updated] = await tx.update(schema.onlineOrders)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.onlineOrders.id, order.id))
        .returning();
      return updated;
    });
  },

  // ---------------- Marketplace: Stores directory ----------------
  async getStoresDirectory() {
    const owners = await db.select().from(schema.users);
    const stores = owners.filter(u => !isPlatformAdminId(u.id));
    const withCounts = await Promise.all(stores.map(async (s) => {
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
    }));
    return withCounts.filter(s => s.productCount > 0);
  },
};
