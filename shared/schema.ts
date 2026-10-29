import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  serial,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// ------------------------------------------------------------------
// Store Owners / Admin
// ------------------------------------------------------------------
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  // Per-store Smart QR handle (migration 0004). A short random code,
  // NOT the sequential-looking internal id: the public storefront URL
  // is /s/<storeCode>, and one store's code must never resolve to
  // another store. Null only for legacy rows until backfilled.
  storeCode: text('store_code'),
  storeName: text('store_name').notNull(),
  storeCategory: text('store_category').notNull(),
  username: text('username').notNull().unique(),
  pin: text('pin').notNull(),
  address: text('address'),
  phone: text('phone'),
  zila: text('zila'),
  upozila: text('upozila'),
  thana: text('thana'),
  plan: text('plan').notNull().default('free'),
  defaultVatRate: real('default_vat_rate'),
  subscriptionExpiry: timestamp('subscription_expiry'),
  subscriptionStatus: text('subscription_status'),
  profilePicture: text('profile_picture'),
  failedLoginAttempts: integer('failed_login_attempts').default(0),
  isLocked: boolean('is_locked').default(false),
  lockedUntil: timestamp('locked_until'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ------------------------------------------------------------------
// Staff (owned by a store owner)
// ------------------------------------------------------------------
export const staff = pgTable('staff', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  pin: text('pin').notNull(),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
});

// ------------------------------------------------------------------
// Customers (marketplace / delivery buyers)
// ------------------------------------------------------------------
export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull().unique(),
  pin: text('pin').notNull(),
  address: text('address'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ------------------------------------------------------------------
// Products
// ------------------------------------------------------------------
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').notNull(),
    name: text('name').notNull(),
    nameBn: text('name_bn').default(''),
    price: real('price').notNull(),
    cost: real('cost').notNull().default(0),
    category: text('category').notNull(),
    stock: real('stock').notNull().default(0),
    unit: text('unit').notNull().default('pcs'),
    image: text('image'),
    barcode: text('barcode'),
    supplier: text('supplier'),
    branchId: text('branch_id'),
    expiryDate: text('expiry_date'),
    batchNumber: text('batch_number'),
    genericName: text('generic_name'),
    color: text('color'),
    size: text('size'),
    style: text('style'),
    brand: text('brand'),
    warranty: text('warranty'),
    serialNumber: text('serial_number'),
    dietaryType: text('dietary_type'),
    preparationTime: integer('preparation_time'),
    isOnlineVisible: boolean('is_online_visible').default(true),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [index('products_store_id_idx').on(table.storeId)],
);

// ------------------------------------------------------------------
// Sales (in-store POS transactions)
// ------------------------------------------------------------------
export const sales = pgTable(
  'sales',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').notNull(),
    date: timestamp('date').notNull().defaultNow(),
    items: jsonb('items').notNull(),
    subTotal: real('sub_total').notNull(),
    discount: real('discount').notNull().default(0),
    vat: real('vat').notNull().default(0),
    totalAmount: real('total_amount').notNull(),
    totalProfit: real('total_profit').notNull().default(0),
    paymentMethod: text('payment_method').notNull(),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    paidAmount: real('paid_amount').notNull().default(0),
    cashReceived: real('cash_received'),
    changeAmount: real('change_amount'),
    dueAmount: real('due_amount').notNull().default(0),
    storeName: text('store_name'),
    servedBy: text('served_by'),
    branchId: text('branch_id'),
    counterId: text('counter_id'),
    couponCode: text('coupon_code'),
    loyaltyRedeemed: integer('loyalty_redeemed').default(0),
    loyaltyEarned: integer('loyalty_earned').default(0),
  },
  (table) => [index('sales_store_date_idx').on(table.storeId, table.date)],
);

// ------------------------------------------------------------------
// Expenses
// ------------------------------------------------------------------
export const expenses = pgTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').notNull(),
    description: text('description').notNull(),
    amount: real('amount').notNull(),
    date: timestamp('date').notNull().defaultNow(),
    category: text('category').notNull(),
  },
  (table) => [index('expenses_store_date_idx').on(table.storeId, table.date)],
);

// ------------------------------------------------------------------
// Inventory Logs
// ------------------------------------------------------------------
export const inventoryLogs = pgTable(
  'inventory_logs',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').notNull(),
    productId: text('product_id').notNull(),
    productName: text('product_name').notNull(),
    type: text('type').notNull(),
    quantity: real('quantity').notNull(),
    reason: text('reason').notNull(),
    actorId: text('actor_id'),
    date: timestamp('date').notNull().defaultNow(),
  },
  (table) => [
    index('inventory_logs_store_date_idx').on(table.storeId, table.date),
    index('inventory_logs_store_product_idx').on(table.storeId, table.productId),
  ],
);

// ------------------------------------------------------------------
// Subscription Requests
// ------------------------------------------------------------------
export const subscriptionRequests = pgTable('subscription_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  username: text('username').notNull(),
  storeName: text('store_name').notNull(),
  storeCategory: text('store_category').notNull(),
  ownerName: text('owner_name'),
  package: text('package').notNull(),
  amount: real('amount').notNull(),
  paymentNumber: text('payment_number').notNull(),
  trxId: text('trx_id').notNull(),
  status: text('status').notNull().default('pending'),
  date: timestamp('date').notNull().defaultNow(),
});

// ------------------------------------------------------------------
// Global Settings (key/value)
// ------------------------------------------------------------------
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

// ------------------------------------------------------------------
// Restaurant Tables & Guest Orders
// ------------------------------------------------------------------
export const restaurantTables = pgTable('restaurant_tables', {
  id: text('id').primaryKey(),
  storeId: text('store_id').notNull(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const guestOrders = pgTable(
  'guest_orders',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').notNull(),
    // Null = a store-QR pickup order (migration 0005): the guest
    // ordered from the store's public storefront, not from a table.
    // Same guest_orders pipeline, lifecycle, KDS queue and settlement
    // as a table order — only the fulfilment mode differs.
    tableId: text('table_id'),
    items: jsonb('items').notNull(),
    note: text('note'),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    totalAmount: real('total_amount').notNull(),
  },
  (table) => [index('guest_orders_store_status_idx').on(table.storeId, table.status, table.createdAt)],
);

// ------------------------------------------------------------------
// Announcements
// ------------------------------------------------------------------
export const announcements = pgTable('announcements', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  target: jsonb('target').notNull().default('"all"'),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ------------------------------------------------------------------
// Online Marketplace Orders (customer -> store, with delivery)
// ------------------------------------------------------------------
export const onlineOrders = pgTable('online_orders', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull(),
  storeId: text('store_id').notNull(),
  storeName: text('store_name'),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull(),
  deliveryAddress: text('delivery_address').notNull(),
  items: jsonb('items').notNull(),
  subTotal: real('sub_total').notNull(),
  deliveryFee: real('delivery_fee').notNull().default(0),
  totalAmount: real('total_amount').notNull(),
  paymentMethod: text('payment_method').notNull().default('cod'),
  status: text('status').notNull().default('placed'),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ------------------------------------------------------------------
// Payment Intents (AmarPay Ledger)
// ------------------------------------------------------------------
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').notNull(),
    orderType: text('order_type').notNull(), // 'sale' | 'restaurant' | 'marketplace' | 'subscription'
    orderId: text('order_id').notNull(),
    method: text('method').notNull(), // 'cash' | 'bkash' | 'nagad' | 'card' | 'split'
    amount: real('amount').notNull(),
    paidAmount: real('paid_amount').notNull().default(0),
    changeAmount: real('change_amount').notNull().default(0),
    status: text('status').notNull().default('pending'), // 'pending' | 'authorized' | 'captured' | 'refunded' | 'voided'
    gatewayTrxId: text('gateway_trx_id'),
    voidReason: text('void_reason'),
    details: jsonb('details'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('payment_intents_store_idx').on(table.storeId, table.status)],
);

// ------------------------------------------------------------------
// Phase 3 — Branches, Counters, Suppliers, Purchase Orders,
// Coupons & Loyalty (drizzle tables + migration 0002; the live server
// path for these entities is the durable fallback store, same precedent
// as shifts — see server/storage.ts. Run migration 0002 in staging
// before wiring these tables into the PostgreSQL branch.)
// ------------------------------------------------------------------
export const branches = pgTable(
  'branches',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [index('branches_store_idx').on(table.storeId)],
);

export const counters = pgTable(
  'counters',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').notNull(),
    branchId: text('branch_id').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [index('counters_branch_idx').on(table.branchId)],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    address: text('address'),
    notes: text('notes'),
    totalDue: real('total_due').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [index('suppliers_store_idx').on(table.storeId)],
);

export const purchaseOrders = pgTable('purchase_orders', {
  id: text('id').primaryKey(),
  storeId: text('store_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  branchId: text('branch_id'),
  status: text('status').notNull().default('draft'), // draft | partial | received | cancelled
  items: jsonb('items').notNull(),
  totalCost: real('total_cost').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
  receivedAt: timestamp('received_at'),
});

export const coupons = pgTable(
  'coupons',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').notNull(),
    code: text('code').notNull(),
    type: text('type').notNull(), // percent | fixed
    value: real('value').notNull(),
    minPurchase: real('min_purchase').notNull().default(0),
    maxUses: integer('max_uses').notNull().default(0),
    usedCount: integer('used_count').notNull().default(0),
    expiresAt: timestamp('expires_at'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [index('coupons_store_code_idx').on(table.storeId, table.code)],
);

export const loyaltyAccounts = pgTable(
  'loyalty_accounts',
  {
    // Phase 4 fix: the primary key is (store_id, phone), not phone
    // alone — two stores must be able to hold balances for the same
    // customer phone. See migrations/0003_loyalty_store_phone_pk.sql.
    phone: text('phone').notNull(),
    storeId: text('store_id').notNull(),
    name: text('name'),
    points: integer('points').notNull().default(0),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [index('loyalty_store_idx').on(table.storeId), primaryKey({ columns: [table.storeId, table.phone] })],
);

// ------------------------------------------------------------------
// Cashier Shifts & Z-Report
// ------------------------------------------------------------------
export const shifts = pgTable('shifts', {
  id: text('id').primaryKey(),
  storeId: text('store_id').notNull(),
  branchId: text('branch_id'),
  counterId: text('counter_id'),
  cashierId: text('cashier_id').notNull(),
  cashierName: text('cashier_name').notNull(),
  openedAt: timestamp('opened_at').notNull().defaultNow(),
  closedAt: timestamp('closed_at'),
  openingCash: real('opening_cash').notNull().default(0),
  totalCashSales: real('total_cash_sales').notNull().default(0),
  totalDigitalSales: real('total_digital_sales').notNull().default(0),
  totalExpenses: real('total_expenses').notNull().default(0),
  expectedCash: real('expected_cash').notNull().default(0),
  actualCash: real('actual_cash'),
  discrepancy: real('discrepancy').notNull().default(0),
  status: text('status').notNull().default('open'), // 'open' | 'closed'
  notes: text('notes'),
});

// ------------------------------------------------------------------
// Zod insert schemas (for request validation)
// ------------------------------------------------------------------
export const insertUserSchema = createInsertSchema(users).omit({ createdAt: true });
export const insertStaffSchema = createInsertSchema(staff);
export const insertCustomerSchema = createInsertSchema(customers).omit({ createdAt: true });
export const insertProductSchema = createInsertSchema(products).omit({ createdAt: true });
export const insertSaleSchema = createInsertSchema(sales);
export const insertExpenseSchema = createInsertSchema(expenses);
export const insertInventoryLogSchema = createInsertSchema(inventoryLogs);
export const insertSubscriptionRequestSchema = createInsertSchema(subscriptionRequests).omit({ date: true });
export const insertRestaurantTableSchema = createInsertSchema(restaurantTables);
export const insertGuestOrderSchema = createInsertSchema(guestOrders).omit({ createdAt: true });
export const insertAnnouncementSchema = createInsertSchema(announcements).omit({ createdAt: true });
export const insertOnlineOrderSchema = createInsertSchema(onlineOrders).omit({ createdAt: true, updatedAt: true });
export const insertPaymentIntentSchema = createInsertSchema(paymentIntents).omit({ createdAt: true, updatedAt: true });
export const insertShiftSchema = createInsertSchema(shifts).omit({ openedAt: true });
export const insertBranchSchema = createInsertSchema(branches).omit({ createdAt: true });
export const insertCounterSchema = createInsertSchema(counters).omit({ createdAt: true });
export const insertSupplierSchema = createInsertSchema(suppliers).omit({ createdAt: true });
export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ createdAt: true });
export const insertCouponSchema = createInsertSchema(coupons).omit({ createdAt: true });
export const insertLoyaltyAccountSchema = createInsertSchema(loyaltyAccounts);

export type User = typeof users.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type InventoryLog = typeof inventoryLogs.$inferSelect;
export type SubscriptionRequest = typeof subscriptionRequests.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type RestaurantTable = typeof restaurantTables.$inferSelect;
export type GuestOrder = typeof guestOrders.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type OnlineOrder = typeof onlineOrders.$inferSelect;
export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type Counter = typeof counters.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type LoyaltyAccount = typeof loyaltyAccounts.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type InsertSale = z.infer<typeof insertSaleSchema>;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type InsertInventoryLog = z.infer<typeof insertInventoryLogSchema>;
export type InsertSubscriptionRequest = z.infer<typeof insertSubscriptionRequestSchema>;
export type InsertRestaurantTable = z.infer<typeof insertRestaurantTableSchema>;
export type InsertGuestOrder = z.infer<typeof insertGuestOrderSchema>;
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type InsertOnlineOrder = z.infer<typeof insertOnlineOrderSchema>;
export type InsertPaymentIntent = z.infer<typeof insertPaymentIntentSchema>;
export type InsertShift = z.infer<typeof insertShiftSchema>;

export const ONLINE_ORDER_STATUSES = ['placed', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled'] as const;
