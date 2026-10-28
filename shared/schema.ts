import { pgTable, text, integer, real, boolean, timestamp, jsonb, serial, index } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// ------------------------------------------------------------------
// Store Owners / Admin
// ------------------------------------------------------------------
export const users = pgTable('users', {
  id: text('id').primaryKey(),
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
export const products = pgTable('products', {
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
}, (table) => [
  index('products_store_id_idx').on(table.storeId),
]);

// ------------------------------------------------------------------
// Sales (in-store POS transactions)
// ------------------------------------------------------------------
export const sales = pgTable('sales', {
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
}, (table) => [
  index('sales_store_date_idx').on(table.storeId, table.date),
]);

// ------------------------------------------------------------------
// Expenses
// ------------------------------------------------------------------
export const expenses = pgTable('expenses', {
  id: text('id').primaryKey(),
  storeId: text('store_id').notNull(),
  description: text('description').notNull(),
  amount: real('amount').notNull(),
  date: timestamp('date').notNull().defaultNow(),
  category: text('category').notNull(),
}, (table) => [
  index('expenses_store_date_idx').on(table.storeId, table.date),
]);

// ------------------------------------------------------------------
// Inventory Logs
// ------------------------------------------------------------------
export const inventoryLogs = pgTable('inventory_logs', {
  id: text('id').primaryKey(),
  storeId: text('store_id').notNull(),
  productId: text('product_id').notNull(),
  productName: text('product_name').notNull(),
  type: text('type').notNull(),
  quantity: real('quantity').notNull(),
  reason: text('reason').notNull(),
  actorId: text('actor_id'),
  date: timestamp('date').notNull().defaultNow(),
}, (table) => [
  index('inventory_logs_store_date_idx').on(table.storeId, table.date),
  index('inventory_logs_store_product_idx').on(table.storeId, table.productId),
]);

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

export const guestOrders = pgTable('guest_orders', {
  id: text('id').primaryKey(),
  storeId: text('store_id').notNull(),
  tableId: text('table_id').notNull(),
  items: jsonb('items').notNull(),
  note: text('note'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  totalAmount: real('total_amount').notNull(),
}, (table) => [
  index('guest_orders_store_status_idx').on(table.storeId, table.status, table.createdAt),
]);

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

export const ONLINE_ORDER_STATUSES = ['placed', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled'] as const;
