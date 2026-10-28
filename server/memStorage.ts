import * as schema from '../shared/schema';
import crypto from 'node:crypto';
import { calculateSaleTotals, moneyToMinor, PaymentMethod, quantityToUnits } from '../shared/finance';
import { hashPin } from './credentials';
import { broadcastToStore } from './live';
import { loadSnapshot, saveSnapshot, appendOutbox, reviveDates, type Snapshot } from './durableStore';

export const genId = () => crypto.randomUUID();

import { StorageRuleError } from './errors';
import {
  forecastDemand,
  expiryAlerts,
  deadStock,
  validateCoupon,
  loyaltyEarned,
  loyaltyRedeemable,
  type Coupon as Phase3Coupon,
} from '../shared/phase3';

export type RequestedSale = {
  id: string;
  items: Array<{ id: string; quantity: number; price?: number; note?: string }>;
  discount?: number;
  paymentMethod: PaymentMethod;
  paidAmount?: number;
  cashReceived?: number;
  customerName?: string;
  customerPhone?: string;
  // Phase 3 — validated server-side in createSale; never trusted as totals.
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
  // Phase 3: the stored discount includes any server-validated promo
  // discount, so a replay must compare manual discount + the promo that
  // was applied at sale time — not the manual discount alone.
  const storedPromo = (existing as any).promoDiscount ?? 0;
  if (
    existing.paymentMethod !== incoming.paymentMethod ||
    moneyToMinor(existing.discount, 'discount') !== moneyToMinor((incoming.discount ?? 0) + storedPromo, 'discount') ||
    existing.customerName !== (incoming.customerName || null) ||
    existing.customerPhone !== (incoming.customerPhone || null) ||
    (existing as any).couponCode !== (incoming.couponCode || null) ||
    (existing as any).loyaltyRedeemed !== (incoming.loyaltyPointsRedeem || 0) ||
    (existing as any).branchId !== (incoming.branchId || null) ||
    (existing as any).counterId !== (incoming.counterId || null)
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

// In-Memory Data Store — now DURABLE (Phase 1 fix P0-2).
// Every mutation goes through DurableMap, which synchronously persists a
// full snapshot to disk (AMAR_DATA_DIR/fallback-store.json) and appends the
// record to the replay outbox, before the calling API method returns. The
// maps are still the in-process store; the disk files are what survives a
// restart when PostgreSQL is not configured.
class DurableMap<K, V> extends Map<K, V> {
  kind = '';
  set(key: K, value: V): this {
    super.set(key, value);
    onFallbackMutation(this.kind, key, value, 'upsert');
    return this;
  }
  delete(key: K): boolean {
    const existed = super.delete(key);
    if (existed) onFallbackMutation(this.kind, key, null, 'delete');
    return existed;
  }
  clear(): void {
    super.clear();
    persistFallbackSnapshot();
  }
}
function durableMap<K, V>(kind: string): DurableMap<K, V> {
  const map = new DurableMap<K, V>();
  map.kind = kind;
  return map;
}
const users = durableMap<string, schema.User>('users');
const staff = durableMap<string, schema.Staff>('staff');
const customers = durableMap<string, schema.Customer>('customers');
const products = durableMap<string, schema.Product>('products');
const sales = durableMap<string, schema.Sale>('sales');
const expenses = durableMap<string, schema.Expense>('expenses');
const inventoryLogs = durableMap<string, schema.InventoryLog>('inventoryLogs');
const subscriptionRequests = durableMap<string, schema.SubscriptionRequest>('subscriptionRequests');
const settings = durableMap<string, any>('settings');
const restaurantTables = durableMap<string, schema.RestaurantTable>('restaurantTables');
const guestOrders = durableMap<string, schema.GuestOrder>('guestOrders');
const announcements = durableMap<string, schema.Announcement>('announcements');
const onlineOrders = durableMap<string, schema.OnlineOrder>('onlineOrders');
const paymentIntents = durableMap<string, schema.PaymentIntent>('paymentIntents');
const shifts = durableMap<string, schema.Shift>('shifts');
// Phase 3 entities — durable maps, same disk-persisted fallback as shifts.
const branches = durableMap<string, schema.Branch>('branches');
const counters = durableMap<string, schema.Counter>('counters');
const suppliers = durableMap<string, schema.Supplier>('suppliers');
const purchaseOrders = durableMap<string, schema.PurchaseOrder>('purchaseOrders');
const coupons = durableMap<string, schema.Coupon>('coupons');
// Key: `${storeId}:${phone}` — loyalty is per store, per phone number.
const loyaltyAccounts = durableMap<string, schema.LoyaltyAccount>('loyaltyAccounts');
const ALL_MAPS: Array<[string, DurableMap<string, any>]> = [
  ['users', users],
  ['staff', staff],
  ['customers', customers],
  ['products', products],
  ['sales', sales],
  ['expenses', expenses],
  ['inventoryLogs', inventoryLogs],
  ['subscriptionRequests', subscriptionRequests],
  ['settings', settings],
  ['restaurantTables', restaurantTables],
  ['guestOrders', guestOrders],
  ['announcements', announcements],
  ['onlineOrders', onlineOrders],
  ['paymentIntents', paymentIntents],
  ['shifts', shifts],
  ['branches', branches],
  ['counters', counters],
  ['suppliers', suppliers],
  ['purchaseOrders', purchaseOrders],
  ['coupons', coupons],
  ['loyaltyAccounts', loyaltyAccounts],
];
let suppressFallbackWrites = false;
function persistFallbackSnapshot() {
  if (suppressFallbackWrites) return;
  try {
    const collections: Snapshot['collections'] = {};
    for (const [name, map] of ALL_MAPS) collections[name] = Array.from(map.entries());
    saveSnapshot({ version: 1, savedAt: new Date().toISOString(), collections });
  } catch (err: any) {
    console.warn('[AmarDokan] Fallback snapshot persist failed:', err?.message || String(err));
  }
}
function onFallbackMutation(kind: string, key: unknown, value: unknown, op: 'upsert' | 'delete') {
  if (suppressFallbackWrites) return;
  persistFallbackSnapshot();
  // Outbox is skipped during demo seeding (seed data is not user money data
  // and must never replay into a real database); it is enabled for all
  // real mutations once seeding is done.
  if (!suppressOutbox) appendOutbox(kind, String(key), op, value);
}
let suppressOutbox = false;
let snapshotRestored = false;
let snapshotHadData = false;
function restoreSnapshotOnce() {
  if (snapshotRestored) return;
  snapshotRestored = true;
  const snapshot = loadSnapshot();
  if (!snapshot) return;
  suppressFallbackWrites = true;
  try {
    for (const [name, entries] of Object.entries(snapshot.collections)) {
      const map = ALL_MAPS.find(([n]) => n === name)?.[1];
      if (!map) continue;
      for (const [key, value] of entries) {
        map.set(key, name === 'settings' ? value : reviveDates(value));
      }
      if (entries.length > 0) snapshotHadData = true;
    }
  } finally {
    suppressFallbackWrites = false;
  }
}

export const DEMO_OWNER_ID = 'demo-owner-id';
export const DEMO_RESTAURANT_ID = 'demo-restaurant-id';

// Demo seed data — Phase 1 fix (P1-1): GATED, default OFF.
// Seeding runs only when AMAR_DEMO_SEED=true is set explicitly. Without the
// flag, no demo owner ('admin'/'1234') and no demo products exist, so a
// demo-credential login must fail. A restored disk snapshot also suppresses
// seeding: data already on disk is real stored data, not a fresh seed, and
// must never be overwritten by demo defaults. In production the flag must
// still be set explicitly to seed at all (see the warning below).
let seeded = false;
export async function seedInMemoryStore() {
  restoreSnapshotOnce();
  if (seeded) return;
  seeded = true;
  if (snapshotHadData) return;
  if (process.env.AMAR_DEMO_SEED !== 'true') return;
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[AmarDokan] WARNING: demo seed explicitly enabled in production (AMAR_DEMO_SEED=true). Remove the flag before real use.',
    );
  }
  suppressOutbox = true;
  try {
    await seedDemoData();
  } finally {
    suppressOutbox = false;
    persistFallbackSnapshot();
  }
}

async function seedDemoData() {
  const demoPinHash = await hashPin('1234');

  // Demo Grocery Store Owner & Admin
  const demoOwner: schema.User = {
    id: DEMO_OWNER_ID,
    storeName: 'Amar Dokan Super Store',
    storeCategory: 'grocery',
    username: 'admin',
    pin: demoPinHash,
    address: 'Mirpur-10, Dhaka',
    phone: '01711223344',
    zila: 'Dhaka',
    upozila: 'Mirpur',
    thana: 'Mirpur',
    plan: 'premium',
    defaultVatRate: 5,
    subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    subscriptionStatus: 'active',
    profilePicture: null,
    failedLoginAttempts: 0,
    isLocked: false,
    lockedUntil: null,
    createdAt: new Date(),
  };
  users.set(demoOwner.id, demoOwner);

  // Demo Restaurant Store Owner
  const demoRestaurant: schema.User = {
    id: DEMO_RESTAURANT_ID,
    storeName: 'Dhaka Biryani & Cafe',
    storeCategory: 'restaurant',
    username: 'dhakacafe',
    pin: demoPinHash,
    address: 'Dhanmondi 27, Dhaka',
    phone: '01811223344',
    zila: 'Dhaka',
    upozila: 'Dhanmondi',
    thana: 'Dhanmondi',
    plan: 'premium',
    defaultVatRate: 7.5,
    subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    subscriptionStatus: 'active',
    profilePicture: null,
    failedLoginAttempts: 0,
    isLocked: false,
    lockedUntil: null,
    createdAt: new Date(),
  };
  users.set(demoRestaurant.id, demoRestaurant);

  // Grocery Products
  const sampleGroceryProducts: schema.Product[] = [
    {
      id: 'prod-g-1',
      storeId: DEMO_OWNER_ID,
      name: 'Miniket Rice 5kg',
      nameBn: 'মিনিকেট চাল ৫ কেজি',
      price: 380,
      cost: 340,
      category: 'grocery',
      stock: 50,
      unit: 'bag',
      image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=300&q=80',
      barcode: '8901001',
      supplier: 'Fresh Foods',
      branchId: null,
      expiryDate: '2027-12-31',
      batchNumber: 'B-01',
      genericName: null,
      color: null,
      size: null,
      style: null,
      brand: 'Fresh',
      warranty: null,
      serialNumber: null,
      dietaryType: null,
      preparationTime: null,
      isOnlineVisible: true,
      createdAt: new Date(),
    },
    {
      id: 'prod-g-2',
      storeId: DEMO_OWNER_ID,
      name: 'Rupchanda Soybean Oil 2L',
      nameBn: 'রূপচাঁদা সয়াবিন তেল ২ লিটার',
      price: 360,
      cost: 320,
      category: 'grocery',
      stock: 40,
      unit: 'bottle',
      image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=300&q=80',
      barcode: '8901002',
      supplier: 'Rupchanda',
      branchId: null,
      expiryDate: '2027-06-30',
      batchNumber: 'B-02',
      genericName: null,
      color: null,
      size: null,
      style: null,
      brand: 'Rupchanda',
      warranty: null,
      serialNumber: null,
      dietaryType: null,
      preparationTime: null,
      isOnlineVisible: true,
      createdAt: new Date(),
    },
    {
      id: 'prod-g-3',
      storeId: DEMO_OWNER_ID,
      name: 'Fresh White Sugar 1kg',
      nameBn: 'ফ্রেশ চিনি ১ কেজি',
      price: 135,
      cost: 120,
      category: 'grocery',
      stock: 80,
      unit: 'kg',
      image: null,
      barcode: '8901003',
      supplier: 'Fresh Foods',
      branchId: null,
      expiryDate: '2028-01-01',
      batchNumber: 'B-03',
      genericName: null,
      color: null,
      size: null,
      style: null,
      brand: 'Fresh',
      warranty: null,
      serialNumber: null,
      dietaryType: null,
      preparationTime: null,
      isOnlineVisible: true,
      createdAt: new Date(),
    },
    {
      id: 'prod-g-4',
      storeId: DEMO_OWNER_ID,
      name: 'Masoor Dal 1kg',
      nameBn: 'মসুর ডাল ১ কেজি',
      price: 140,
      cost: 125,
      category: 'grocery',
      stock: 60,
      unit: 'kg',
      image: null,
      barcode: '8901004',
      supplier: 'Deshi Agro',
      branchId: null,
      expiryDate: '2027-09-30',
      batchNumber: 'B-04',
      genericName: null,
      color: null,
      size: null,
      style: null,
      brand: 'Deshi',
      warranty: null,
      serialNumber: null,
      dietaryType: null,
      preparationTime: null,
      isOnlineVisible: true,
      createdAt: new Date(),
    },
    {
      id: 'prod-g-5',
      storeId: DEMO_OWNER_ID,
      name: 'Ispahani Mirzapore Tea 400g',
      nameBn: 'ইস্পাহানি মির্জাপুর চা ৪০০ গ্রাম',
      price: 240,
      cost: 205,
      category: 'grocery',
      stock: 35,
      unit: 'pcs',
      image: null,
      barcode: '8901005',
      supplier: 'Ispahani',
      branchId: null,
      expiryDate: '2027-11-30',
      batchNumber: 'B-05',
      genericName: null,
      color: null,
      size: null,
      style: null,
      brand: 'Ispahani',
      warranty: null,
      serialNumber: null,
      dietaryType: null,
      preparationTime: null,
      isOnlineVisible: true,
      createdAt: new Date(),
    },
  ];

  for (const p of sampleGroceryProducts) {
    products.set(p.id, p);
  }

  // Restaurant Menu Items
  const sampleRestaurantProducts: schema.Product[] = [
    {
      id: 'prod-r-1',
      storeId: DEMO_RESTAURANT_ID,
      name: 'Chicken Dum Biryani',
      nameBn: 'চিকেন দম বিরিয়ানি',
      price: 240,
      cost: 160,
      category: 'restaurant',
      stock: 60,
      unit: 'plate',
      image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=300&q=80',
      barcode: 'RES001',
      supplier: null,
      branchId: null,
      expiryDate: null,
      batchNumber: null,
      genericName: null,
      color: null,
      size: null,
      style: null,
      brand: null,
      warranty: null,
      serialNumber: null,
      dietaryType: 'halal',
      preparationTime: 15,
      isOnlineVisible: true,
      createdAt: new Date(),
    },
    {
      id: 'prod-r-2',
      storeId: DEMO_RESTAURANT_ID,
      name: 'Old Dhaka Beef Tehari',
      nameBn: 'পুরান ঢাকার বিফ তেহারী',
      price: 260,
      cost: 180,
      category: 'restaurant',
      stock: 50,
      unit: 'plate',
      image: null,
      barcode: 'RES002',
      supplier: null,
      branchId: null,
      expiryDate: null,
      batchNumber: null,
      genericName: null,
      color: null,
      size: null,
      style: null,
      brand: null,
      warranty: null,
      serialNumber: null,
      dietaryType: 'halal',
      preparationTime: 12,
      isOnlineVisible: true,
      createdAt: new Date(),
    },
    {
      id: 'prod-r-3',
      storeId: DEMO_RESTAURANT_ID,
      name: 'Special Borhani (250ml)',
      nameBn: 'স্পেশাল বোরহানি (২৫০ মি.লি.)',
      price: 60,
      cost: 35,
      category: 'restaurant',
      stock: 100,
      unit: 'bottle',
      image: null,
      barcode: 'RES003',
      supplier: null,
      branchId: null,
      expiryDate: null,
      batchNumber: null,
      genericName: null,
      color: null,
      size: null,
      style: null,
      brand: null,
      warranty: null,
      serialNumber: null,
      dietaryType: 'halal',
      preparationTime: 2,
      isOnlineVisible: true,
      createdAt: new Date(),
    },
    {
      id: 'prod-r-4',
      storeId: DEMO_RESTAURANT_ID,
      name: 'Zafrani Shahi Firni',
      nameBn: 'জাফরানী শাহী ফিরনি',
      price: 80,
      cost: 45,
      category: 'restaurant',
      stock: 40,
      unit: 'cup',
      image: null,
      barcode: 'RES004',
      supplier: null,
      branchId: null,
      expiryDate: null,
      batchNumber: null,
      genericName: null,
      color: null,
      size: null,
      style: null,
      brand: null,
      warranty: null,
      serialNumber: null,
      dietaryType: 'halal',
      preparationTime: 5,
      isOnlineVisible: true,
      createdAt: new Date(),
    },
  ];

  for (const p of sampleRestaurantProducts) {
    products.set(p.id, p);
  }

  // Restaurant Tables
  const tables: schema.RestaurantTable[] = [
    { id: 'tbl-1', storeId: DEMO_RESTAURANT_ID, name: 'Table 1 (Family)', isActive: true },
    { id: 'tbl-2', storeId: DEMO_RESTAURANT_ID, name: 'Table 2', isActive: true },
    { id: 'tbl-3', storeId: DEMO_RESTAURANT_ID, name: 'Table 3', isActive: true },
    { id: 'tbl-4', storeId: DEMO_RESTAURANT_ID, name: 'Table 4 (VIP Corner)', isActive: true },
  ];
  for (const t of tables) {
    restaurantTables.set(t.id, t);
  }

  // Announcement
  const ann: schema.Announcement = {
    id: 'ann-1',
    title: 'Welcome to Amar Dokan POS',
    message: 'Bilingual offline-first Store and Restaurant management system for Bangladeshi small businesses.',
    target: 'all',
    startDate: new Date(),
    endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    isActive: true,
    createdAt: new Date(),
  };
  announcements.set(ann.id, ann);
}

// Ensure seeded on module load
seedInMemoryStore().catch((err) => console.error('Seed error:', err));

export const MemStorage = {
  // ---------------- Users ----------------
  async getUserById(id: string): Promise<schema.User | null> {
    await seedInMemoryStore();
    return users.get(id) || null;
  },
  async getUserByUsername(username: string): Promise<schema.User | null> {
    await seedInMemoryStore();
    const normalized = username.trim().toLowerCase();
    for (const u of users.values()) {
      if (u.username.trim().toLowerCase() === normalized) {
        return u;
      }
    }
    return null;
  },
  async getAllUsers(): Promise<schema.User[]> {
    await seedInMemoryStore();
    return Array.from(users.values());
  },
  async createUser(data: typeof schema.users.$inferInsert): Promise<schema.User> {
    await seedInMemoryStore();
    const id = data.id || genId();
    const user: schema.User = {
      id,
      storeName: data.storeName,
      storeCategory: data.storeCategory,
      username: data.username,
      pin: data.pin,
      address: data.address || null,
      phone: data.phone || null,
      zila: data.zila || null,
      upozila: data.upozila || null,
      thana: data.thana || null,
      plan: data.plan || 'free',
      defaultVatRate: data.defaultVatRate ?? null,
      subscriptionExpiry: data.subscriptionExpiry ? new Date(data.subscriptionExpiry) : null,
      subscriptionStatus: data.subscriptionStatus || 'active',
      profilePicture: data.profilePicture || null,
      failedLoginAttempts: data.failedLoginAttempts ?? 0,
      isLocked: data.isLocked ?? false,
      lockedUntil: data.lockedUntil ? new Date(data.lockedUntil) : null,
      createdAt: new Date(),
    };
    users.set(id, user);
    return user;
  },
  async updateUser(id: string, data: Partial<typeof schema.users.$inferInsert>): Promise<schema.User> {
    await seedInMemoryStore();
    const existing = users.get(id);
    if (!existing) throw new Error('User not found');
    const updated: schema.User = {
      ...existing,
      ...data,
      subscriptionExpiry: data.subscriptionExpiry ? new Date(data.subscriptionExpiry) : existing.subscriptionExpiry,
      lockedUntil: data.lockedUntil ? new Date(data.lockedUntil) : existing.lockedUntil,
    };
    users.set(id, updated);
    return updated;
  },
  async deleteUser(id: string): Promise<void> {
    users.delete(id);
  },
  async ensureFreshPlan(user: schema.User): Promise<schema.User> {
    if (user.plan === 'premium' && user.subscriptionExpiry) {
      const expiry = new Date(user.subscriptionExpiry);
      if (new Date() > expiry) {
        return this.updateUser(user.id, { plan: 'free', subscriptionStatus: 'expired' });
      }
    }
    return user;
  },

  // ---------------- Staff ----------------
  async getStaffByOwner(ownerId: string): Promise<schema.Staff[]> {
    return Array.from(staff.values()).filter((s) => s.ownerId === ownerId);
  },
  async getStaffByUsername(username: string): Promise<schema.Staff | null> {
    const normalized = username.trim().toLowerCase();
    for (const s of staff.values()) {
      if (s.username.trim().toLowerCase() === normalized) return s;
    }
    return null;
  },
  // Phase 4: all staff sharing a username (possible in the fallback
  // store, which never enforced uniqueness). Login tries each candidate
  // PIN instead of only the first match — otherwise one owner's staff
  // could log into another owner's store, or be locked out entirely.
  async getStaffByUsernameAll(username: string): Promise<schema.Staff[]> {
    const normalized = username.trim().toLowerCase();
    return Array.from(staff.values()).filter((s) => s.username.trim().toLowerCase() === normalized);
  },
  async getStaffById(id: string): Promise<schema.Staff | null> {
    return staff.get(id) || null;
  },
  async createStaff(data: typeof schema.staff.$inferInsert): Promise<schema.Staff> {
    const id = data.id || genId();
    const s: schema.Staff = {
      id,
      ownerId: data.ownerId,
      name: data.name,
      username: data.username,
      pin: data.pin,
      permissions: (data.permissions as string[]) || [],
    };
    staff.set(id, s);
    return s;
  },
  async updateStaff(id: string, data: Partial<typeof schema.staff.$inferInsert>): Promise<schema.Staff> {
    const existing = staff.get(id);
    if (!existing) throw new Error('Staff not found');
    const updated: schema.Staff = {
      ...existing,
      ...data,
      permissions: (data.permissions as string[]) ?? existing.permissions,
    };
    staff.set(id, updated);
    return updated;
  },
  async updateStaffForOwner(
    id: string,
    ownerId: string,
    data: Partial<typeof schema.staff.$inferInsert>,
  ): Promise<schema.Staff | null> {
    const existing = staff.get(id);
    if (!existing || existing.ownerId !== ownerId) return null;
    return this.updateStaff(id, data);
  },
  async deleteStaff(id: string): Promise<void> {
    staff.delete(id);
  },
  async deleteStaffForOwner(id: string, ownerId: string): Promise<boolean> {
    const existing = staff.get(id);
    if (!existing || existing.ownerId !== ownerId) return false;
    staff.delete(id);
    return true;
  },

  // ---------------- Customers ----------------
  async getCustomerByPhone(phone: string): Promise<schema.Customer | null> {
    for (const c of customers.values()) {
      if (c.phone === phone) return c;
    }
    return null;
  },
  async getCustomerById(id: string): Promise<schema.Customer | null> {
    return customers.get(id) || null;
  },
  async createCustomer(data: typeof schema.customers.$inferInsert): Promise<schema.Customer> {
    const id = data.id || genId();
    const c: schema.Customer = {
      id,
      name: data.name,
      phone: data.phone,
      pin: data.pin,
      address: data.address || null,
      createdAt: new Date(),
    };
    customers.set(id, c);
    return c;
  },
  async updateCustomer(id: string, data: Partial<typeof schema.customers.$inferInsert>): Promise<schema.Customer> {
    const existing = customers.get(id);
    if (!existing) throw new Error('Customer not found');
    const updated: schema.Customer = { ...existing, ...data };
    customers.set(id, updated);
    return updated;
  },

  // ---------------- Products ----------------
  async getProductsByStore(storeId: string): Promise<schema.Product[]> {
    await seedInMemoryStore();
    return Array.from(products.values()).filter((p) => p.storeId === storeId);
  },
  async getProductById(id: string): Promise<schema.Product | null> {
    await seedInMemoryStore();
    return products.get(id) || null;
  },
  async countProductsByStore(storeId: string): Promise<number> {
    await seedInMemoryStore();
    return Array.from(products.values()).filter((p) => p.storeId === storeId).length;
  },
  async upsertProduct(data: typeof schema.products.$inferInsert, storeId: string, actorId?: string) {
    await seedInMemoryStore();
    const existing = products.get(data.id);
    if (existing && existing.storeId !== storeId) {
      throw new StorageRuleError('PRODUCT_NOT_FOUND', 'Product not found in this store.', 404);
    }

    const product: schema.Product = {
      id: data.id,
      storeId,
      name: data.name,
      nameBn: data.nameBn ?? '',
      price: data.price,
      cost: data.cost ?? 0,
      category: data.category,
      stock: data.stock ?? 0,
      unit: data.unit ?? 'pcs',
      branchId: (data as any).branchId || existing?.branchId || null,
      image: data.image || null,
      barcode: data.barcode || null,
      supplier: data.supplier || null,
      expiryDate: data.expiryDate || null,
      batchNumber: data.batchNumber || null,
      genericName: data.genericName || null,
      color: data.color || null,
      size: data.size || null,
      style: data.style || null,
      brand: data.brand || null,
      warranty: data.warranty || null,
      serialNumber: data.serialNumber || null,
      dietaryType: data.dietaryType || null,
      preparationTime: data.preparationTime ?? null,
      isOnlineVisible: data.isOnlineVisible ?? true,
      createdAt: existing?.createdAt || new Date(),
    };

    products.set(product.id, product);

    if (existing && product.stock !== existing.stock) {
      const diff = Number((product.stock - existing.stock).toFixed(6));
      await this.logInventoryMovement({
        id: genId(),
        storeId,
        productId: product.id,
        productName: product.name,
        type: diff > 0 ? 'adjustment' : 'out',
        quantity: Math.abs(diff),
        reason: 'Manual Adjustment',
        actorId: actorId || null,
        date: new Date(),
      });
    } else if (!existing && product.stock > 0) {
      await this.logInventoryMovement({
        id: genId(),
        storeId,
        productId: product.id,
        productName: product.name,
        type: 'in',
        quantity: product.stock,
        reason: 'Initial Stock',
        actorId: actorId || null,
        date: new Date(),
      });
    }

    return { product, wasCreated: !existing, previous: existing || null };
  },
  async deleteProduct(id: string, storeId: string): Promise<boolean> {
    const existing = products.get(id);
    if (!existing || existing.storeId !== storeId) return false;
    products.delete(id);
    return true;
  },
  async updateProductStock(id: string, newStock: number): Promise<schema.Product> {
    const existing = products.get(id);
    if (!existing) throw new Error('Product not found');
    const updated = { ...existing, stock: newStock };
    products.set(id, updated);
    return updated;
  },
  async searchAllProducts(query?: string, category?: string): Promise<schema.Product[]> {
    await seedInMemoryStore();
    let list = Array.from(products.values()).filter((p) => p.isOnlineVisible !== false);
    if (category) {
      list = list.filter((p) => p.category === category);
    }
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.nameBn || '').toLowerCase().includes(q));
    }
    return list;
  },

  // ---------------- Sales (POS) ----------------
  async getSalesByStore(storeId: string): Promise<schema.Sale[]> {
    return Array.from(sales.values())
      .filter((s) => s.storeId === storeId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },
  async getAllSales(): Promise<schema.Sale[]> {
    return Array.from(sales.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },
  async countTodaySalesByStore(storeId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from(sales.values()).filter((s) => s.storeId === storeId && new Date(s.date) >= today).length;
  },
  async createSale(input: {
    sale: RequestedSale;
    storeId: string;
    storeName?: string;
    vatRate: number;
    maxDiscountPercent?: number;
    servedBy?: string;
    actorId?: string;
  }): Promise<schema.Sale> {
    const { sale, storeId } = input;
    if (!sale.id || typeof sale.id !== 'string' || sale.id.length > 128) {
      throw new StorageRuleError('INVALID_SALE_ID', 'A valid transaction ID is required.');
    }
    if (!Array.isArray(sale.items) || sale.items.length === 0) {
      throw new StorageRuleError('INVALID_ITEMS', 'At least one sale item is required.');
    }

    const prior = sales.get(sale.id);
    if (prior) {
      if (prior.storeId !== storeId) {
        throw new StorageRuleError('SALE_ID_CONFLICT', 'Transaction ID has already been used.', 409);
      }
      if (!isIdempotentSaleReplay(prior, sale)) {
        throw new StorageRuleError('SALE_ID_CONFLICT', 'Transaction ID was reused with different sale details.', 409);
      }
      return prior;
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

    const saleItems = sale.items.map((requested) => {
      const product = products.get(requested.id);
      if (!product || product.storeId !== storeId) {
        throw new StorageRuleError('PRODUCT_NOT_FOUND', 'A selected product is unavailable in this store.', 409);
      }
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

    // Phase 3 — branch/counter scoping: a named branch/counter must belong
    // to this store (and the counter to that branch when both are given).
    let branch: schema.Branch | null = null;
    let counter: schema.Counter | null = null;
    if (sale.branchId) {
      branch = branches.get(sale.branchId) || null;
      if (!branch || branch.storeId !== storeId) {
        throw new StorageRuleError('BRANCH_NOT_FOUND', 'The selected branch does not belong to this store.', 404);
      }
    }
    if (sale.counterId) {
      counter = counters.get(sale.counterId) || null;
      if (!counter || counter.storeId !== storeId || (branch && counter.branchId !== branch.id)) {
        throw new StorageRuleError('COUNTER_NOT_FOUND', 'The selected counter does not belong to this branch.', 404);
      }
    }

    // Phase 3 — server-side promo validation. Client-supplied totals are
    // never trusted: the coupon is re-validated here against the
    // server's own subtotal, and loyalty redemption is capped by the
    // server's own balance. An invalid/expired/over-limit coupon is
    // rejected even if the client claimed a discount for it.
    let couponDiscount = 0;
    let coupon: schema.Coupon | null = null;
    if (sale.couponCode) {
      const code = sale.couponCode.trim().toUpperCase();
      coupon = Array.from(coupons.values()).find((c) => c.storeId === storeId && c.code.toUpperCase() === code) || null;
      const check = validateCoupon(coupon as Phase3Coupon | null, baseTotals.subTotal);
      if (!check.valid) {
        throw new StorageRuleError(`COUPON_${check.reason}`, `Coupon rejected: ${check.reason}.`, 400);
      }
      couponDiscount = check.discount;
    }
    let loyaltyDiscount = 0;
    let loyaltyRedeemed = 0;
    const redeemRequested = Math.floor(sale.loyaltyPointsRedeem || 0);
    if (redeemRequested > 0) {
      if (!sale.customerPhone) {
        throw new StorageRuleError(
          'LOYALTY_PHONE_REQUIRED',
          'A customer phone number is required to redeem points.',
          400,
        );
      }
      const loyaltyAccount = loyaltyAccounts.get(`${storeId}:${sale.customerPhone}`) || null;
      // Requesting more points than the balance is rejected outright —
      // silently redeeming a smaller amount would surprise the customer.
      // The bill cap (discount never exceeds the remaining bill) still
      // applies inside loyaltyRedeemable.
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
      coupons.set(coupon.id, { ...coupon, usedCount: coupon.usedCount + 1 });
    }
    if (sale.customerPhone) {
      const key = `${storeId}:${sale.customerPhone}`;
      const prev = loyaltyAccounts.get(key);
      const points = Math.max(0, (prev?.points || 0) - loyaltyRedeemed + earned);
      loyaltyAccounts.set(key, {
        phone: sale.customerPhone,
        storeId,
        name: sale.customerName || prev?.name || null,
        points,
        updatedAt: new Date(),
      });
    }

    const created: schema.Sale = {
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
    } as schema.Sale;
    // Breakdown fields the replay check needs; not part of the drizzle
    // sale row, but persisted in the durable snapshot alongside the sale.
    (created as any).promoDiscount = promoDiscount;
    (created as any).couponDiscount = couponDiscount;
    (created as any).loyaltyDiscount = loyaltyDiscount;
    sales.set(created.id, created);

    for (const requested of sale.items) {
      const product = products.get(requested.id)!;
      const newStock = Number((product.stock - requested.quantity).toFixed(6));
      products.set(product.id, { ...product, stock: newStock });
      await this.logInventoryMovement({
        id: genId(),
        storeId,
        productId: product.id,
        productName: product.name,
        type: 'sale',
        quantity: requested.quantity,
        reason: `Sale #${created.id.slice(-6)}`,
        actorId: input.actorId || null,
        date: new Date(),
      });
    }

    return created;
  },

  // ---------------- Expenses ----------------
  async getExpensesByStore(storeId: string): Promise<schema.Expense[]> {
    return Array.from(expenses.values())
      .filter((e) => e.storeId === storeId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },
  async createExpense(data: typeof schema.expenses.$inferInsert): Promise<schema.Expense> {
    const id = data.id || genId();
    const e: schema.Expense = {
      id,
      storeId: data.storeId,
      description: data.description,
      amount: data.amount,
      category: data.category,
      date: data.date ? new Date(data.date) : new Date(),
    };
    expenses.set(id, e);
    return e;
  },
  async deleteExpense(id: string, storeId: string): Promise<boolean> {
    const existing = expenses.get(id);
    if (!existing || existing.storeId !== storeId) return false;
    expenses.delete(id);
    return true;
  },

  // ---------------- Inventory Logs ----------------
  async logInventoryMovement(entry: typeof schema.inventoryLogs.$inferInsert): Promise<void> {
    const id = entry.id || genId();
    const log: schema.InventoryLog = {
      id,
      storeId: entry.storeId,
      productId: entry.productId,
      productName: entry.productName,
      type: entry.type,
      quantity: entry.quantity,
      reason: entry.reason,
      actorId: entry.actorId || null,
      date: entry.date ? new Date(entry.date) : new Date(),
    };
    inventoryLogs.set(id, log);
  },
  async getInventoryLogsByStore(storeId: string): Promise<schema.InventoryLog[]> {
    return Array.from(inventoryLogs.values())
      .filter((l) => l.storeId === storeId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },

  // ---------------- Subscription Requests ----------------
  async createSubscriptionRequest(
    data: typeof schema.subscriptionRequests.$inferInsert,
  ): Promise<schema.SubscriptionRequest> {
    const id = data.id || genId();
    const r: schema.SubscriptionRequest = {
      id,
      userId: data.userId,
      username: data.username,
      storeName: data.storeName,
      storeCategory: data.storeCategory,
      ownerName: data.ownerName || null,
      package: data.package,
      amount: data.amount,
      paymentNumber: data.paymentNumber,
      trxId: data.trxId,
      status: data.status || 'pending',
      date: new Date(),
    };
    subscriptionRequests.set(id, r);
    return r;
  },
  async getAllSubscriptionRequests(): Promise<schema.SubscriptionRequest[]> {
    return Array.from(subscriptionRequests.values()).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  },
  async getSubscriptionRequestById(id: string): Promise<schema.SubscriptionRequest | null> {
    return subscriptionRequests.get(id) || null;
  },
  async updateSubscriptionRequest(
    id: string,
    data: Partial<typeof schema.subscriptionRequests.$inferInsert>,
  ): Promise<schema.SubscriptionRequest> {
    const existing = subscriptionRequests.get(id);
    if (!existing) throw new Error('Subscription request not found');
    const updated = { ...existing, ...data };
    subscriptionRequests.set(id, updated);
    return updated;
  },

  // ---------------- Settings ----------------
  async getSetting(key: string): Promise<any> {
    return settings.get(key) ?? null;
  },
  async setSetting(key: string, value: any): Promise<void> {
    settings.set(key, value);
  },

  // ---------------- Restaurant ----------------
  async getTablesByStore(storeId: string): Promise<schema.RestaurantTable[]> {
    await seedInMemoryStore();
    return Array.from(restaurantTables.values()).filter((t) => t.storeId === storeId);
  },
  async createTable(data: typeof schema.restaurantTables.$inferInsert): Promise<schema.RestaurantTable> {
    const id = data.id || genId();
    const t: schema.RestaurantTable = {
      id,
      storeId: data.storeId,
      name: data.name,
      isActive: data.isActive ?? true,
    };
    restaurantTables.set(id, t);
    return t;
  },
  async deleteTable(id: string, storeId: string): Promise<boolean> {
    const existing = restaurantTables.get(id);
    if (!existing || existing.storeId !== storeId) return false;
    restaurantTables.delete(id);
    return true;
  },
  async getTableById(id: string): Promise<schema.RestaurantTable | null> {
    await seedInMemoryStore();
    return restaurantTables.get(id) || null;
  },
  async getGuestOrdersByStore(storeId: string): Promise<schema.GuestOrder[]> {
    return Array.from(guestOrders.values())
      .filter((o) => o.storeId === storeId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
  async createGuestOrder(data: {
    idempotencyKey: string;
    tableId: string;
    items: Array<{ id: string; quantity: number; note?: string }>;
    note?: string;
  }): Promise<schema.GuestOrder> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.idempotencyKey)) {
      throw new StorageRuleError('INVALID_IDEMPOTENCY_KEY', 'A valid request id is required.');
    }
    if (!data.tableId || !Array.isArray(data.items) || data.items.length === 0 || data.items.length > 100) {
      throw new StorageRuleError('INVALID_ORDER', 'A table and between 1 and 100 order items are required.');
    }
    // Phase 4 fix: quantity and duplicates were never validated here, so
    // a negative quantity could shrink the total (and, at settlement,
    // the bill), and an item from ANOTHER store could be ordered through
    // this store's table. The PostgreSQL branch already checked both;
    // the fallback branch did not. Also, a replayed idempotency key used
    // to return the old order regardless of what was requested.
    const seenGuestIds = new Set<string>();
    for (const requested of data.items) {
      if (!requested || typeof requested.id !== 'string' || !requested.id.trim() || seenGuestIds.has(requested.id)) {
        throw new StorageRuleError('INVALID_ORDER_ITEMS', 'Order items must reference unique products.');
      }
      seenGuestIds.add(requested.id);
      try {
        quantityToUnits(requested.quantity);
      } catch {
        throw new StorageRuleError('INVALID_QUANTITY', 'Every order quantity must be a positive number.');
      }
    }
    const table = restaurantTables.get(data.tableId);
    if (!table || !table.isActive) {
      throw new StorageRuleError('TABLE_NOT_FOUND', 'This restaurant table is unavailable.', 404);
    }

    const existing = guestOrders.get(data.idempotencyKey);
    if (existing) {
      const existingItems = ((existing.items as any[]) || [])
        .map(({ id, quantity, note }: any) => ({ id, quantity, note: note || '' }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const requestedItems = data.items
        .map(({ id, quantity, note }: any) => ({ id, quantity, note: note || '' }))
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

    const items = data.items.map((requested) => {
      const product = products.get(requested.id);
      if (!product || product.storeId !== table.storeId || product.isOnlineVisible === false) {
        throw new StorageRuleError('MENU_ITEM_UNAVAILABLE', 'A selected menu item is no longer available.', 409);
      }
      return {
        ...product,
        quantity: requested.quantity,
        ...(requested.note ? { note: requested.note } : {}),
      };
    });

    const totals = calculateSaleTotals(items, 0, 0, 0, 'cash');
    const order: schema.GuestOrder = {
      id: data.idempotencyKey,
      storeId: table.storeId,
      tableId: table.id,
      items,
      note: data.note || null,
      status: 'pending',
      totalAmount: totals.subTotal,
      createdAt: new Date(),
    };
    guestOrders.set(order.id, order);
    return order;
  },
  async getGuestOrderById(id: string): Promise<schema.GuestOrder | null> {
    return guestOrders.get(id) || null;
  },
  async updateGuestOrder(id: string, storeId: string, nextStatus: string): Promise<schema.GuestOrder> {
    const existing = guestOrders.get(id);
    if (!existing || existing.storeId !== storeId) {
      throw new StorageRuleError('ORDER_NOT_FOUND', 'Order not found in this store.', 404);
    }
    // Phase 4 fix: any string was accepted as a status (including
    // garbage, and re-opening a served/cancelled order). Only the KDS
    // lifecycle is allowed, enforced as the same transition map the
    // PostgreSQL branch uses (pending -> accepted -> preparing ->
    // ready -> served, with cancel from any open state); served and
    // cancelled are terminal. Same-status updates are no-ops.
    const allowedGuestTransitions: Record<string, string[]> = {
      pending: ['accepted', 'cancelled'],
      accepted: ['preparing', 'cancelled'],
      preparing: ['ready', 'cancelled'],
      ready: ['served', 'cancelled'],
      served: [],
      cancelled: [],
    };
    if (!Object.prototype.hasOwnProperty.call(allowedGuestTransitions, nextStatus)) {
      throw new StorageRuleError('INVALID_ORDER_STATUS', 'Order status is not supported.', 400);
    }
    if (existing.status === nextStatus) return existing;
    if (!allowedGuestTransitions[existing.status]?.includes(nextStatus)) {
      throw new StorageRuleError(
        'INVALID_STATUS_TRANSITION',
        `Guest order cannot move from ${existing.status} to ${nextStatus}.`,
        409,
      );
    }
    const updated = { ...existing, status: nextStatus };
    guestOrders.set(id, updated);
    return updated;
  },

  // ---------------- Announcements ----------------
  async getAllAnnouncements(): Promise<schema.Announcement[]> {
    await seedInMemoryStore();
    return Array.from(announcements.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  },
  async createAnnouncement(data: typeof schema.announcements.$inferInsert): Promise<schema.Announcement> {
    const id = data.id || genId();
    const a: schema.Announcement = {
      id,
      title: data.title,
      message: data.message,
      target: data.target || 'all',
      startDate: data.startDate ? new Date(data.startDate) : new Date(),
      endDate: data.endDate ? new Date(data.endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isActive: data.isActive ?? true,
      createdAt: new Date(),
    };
    announcements.set(id, a);
    return a;
  },
  async deleteAnnouncement(id: string): Promise<void> {
    announcements.delete(id);
  },

  // ---------------- Online Marketplace Orders ----------------
  async createOnlineOrder(data: typeof schema.onlineOrders.$inferInsert): Promise<schema.OnlineOrder> {
    const id = data.id || genId();
    const o: schema.OnlineOrder = {
      id,
      customerId: data.customerId,
      storeId: data.storeId,
      storeName: data.storeName || null,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      deliveryAddress: data.deliveryAddress,
      items: data.items,
      subTotal: data.subTotal,
      deliveryFee: data.deliveryFee ?? 0,
      totalAmount: data.totalAmount,
      paymentMethod: data.paymentMethod ?? 'cod',
      status: data.status ?? 'placed',
      note: data.note || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    onlineOrders.set(id, o);
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
  }): Promise<schema.OnlineOrder> {
    if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 100) {
      throw new StorageRuleError('INVALID_ITEMS', 'An order must contain between 1 and 100 items.');
    }
    // Phase 4 fix (mirrors the PostgreSQL branch): quantities were never
    // validated, so a negative quantity INCREASED stock on deduct and
    // shrank the bill; items from another store were accepted; and a
    // replayed idempotency key returned another customer's order.
    const seenMarketplaceIds = new Set<string>();
    for (const item of data.items) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || seenMarketplaceIds.has(item.id)) {
        throw new StorageRuleError('INVALID_ITEMS', 'Order items must be unique and valid.');
      }
      seenMarketplaceIds.add(item.id);
      try {
        quantityToUnits(item.quantity);
      } catch {
        throw new StorageRuleError('INVALID_QUANTITY', 'Every order quantity must be a positive number.');
      }
    }
    const existing = onlineOrders.get(data.id);
    if (existing) {
      const existingItems = ((existing.items as any[]) || [])
        .map(({ id, quantity }: any) => ({ id, quantity }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const requestedItems = data.items
        .map(({ id, quantity }: any) => ({ id, quantity }))
        .sort((a, b) => a.id.localeCompare(b.id));
      if (
        existing.customerId !== data.customerId ||
        existing.storeId !== data.storeId ||
        JSON.stringify(existingItems) !== JSON.stringify(requestedItems)
      ) {
        throw new StorageRuleError(
          'IDEMPOTENCY_KEY_REUSED',
          'This order request key was already used for a different order.',
          409,
        );
      }
      return existing;
    }

    const financialItems = data.items.map((item) => {
      const product = products.get(item.id);
      if (!product || product.storeId !== data.storeId || product.isOnlineVisible === false) {
        throw new StorageRuleError('PRODUCT_UNAVAILABLE', 'An item is no longer available.', 404);
      }
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

    const order: schema.OnlineOrder = {
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
      note: data.note || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    onlineOrders.set(order.id, order);

    for (const item of data.items) {
      const product = products.get(item.id)!;
      if (product.stock >= item.quantity) {
        const nextStock = Number((product.stock - item.quantity).toFixed(6));
        products.set(product.id, { ...product, stock: nextStock });
        await this.logInventoryMovement({
          id: genId(),
          storeId: data.storeId,
          productId: product.id,
          productName: product.name,
          type: 'sale',
          quantity: item.quantity,
          reason: `Online order #${order.id.slice(-6)}`,
          actorId: data.customerId,
          date: new Date(),
        });
      }
    }

    return order;
  },
  async getOnlineOrderById(id: string): Promise<schema.OnlineOrder | null> {
    return onlineOrders.get(id) || null;
  },
  async getOnlineOrdersByCustomer(customerId: string): Promise<schema.OnlineOrder[]> {
    return Array.from(onlineOrders.values())
      .filter((o) => o.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
  async getOnlineOrdersByStore(storeId: string): Promise<schema.OnlineOrder[]> {
    return Array.from(onlineOrders.values())
      .filter((o) => o.storeId === storeId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
  async updateOnlineOrderStatus(id: string, status: string): Promise<schema.OnlineOrder> {
    const existing = onlineOrders.get(id);
    if (!existing) throw new Error('Order not found');
    const updated = { ...existing, status, updatedAt: new Date() };
    onlineOrders.set(id, updated);
    return updated;
  },
  async updateOnlineOrderStatusForStore(
    id: string,
    storeId: string,
    status: string,
    actorId: string,
  ): Promise<schema.OnlineOrder | null> {
    const existing = onlineOrders.get(id);
    if (!existing || existing.storeId !== storeId) return null;
    if (existing.status === status) return existing;
    // Phase 4 fix (mirrors the PostgreSQL branch): any status string
    // was accepted, so a delivered order could be moved back to
    // 'cancelled' and restocked a second time. Only the declared
    // lifecycle transitions are allowed now.
    const allowedTransitions: Record<string, string[]> = {
      placed: ['confirmed', 'cancelled'],
      confirmed: ['out_for_delivery', 'cancelled'],
      out_for_delivery: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: [],
    };
    if (!Object.hasOwn(allowedTransitions, existing.status) || !allowedTransitions[existing.status].includes(status)) {
      throw new StorageRuleError('INVALID_STATUS_TRANSITION', 'This order status change is not allowed.', 409);
    }

    if (status === 'cancelled') {
      const items = (existing.items || []) as Array<{ id: string; name?: string; quantity: number }>;
      for (const item of items) {
        const product = products.get(item.id);
        if (product) {
          const nextStock = Number((product.stock + item.quantity).toFixed(6));
          products.set(product.id, { ...product, stock: nextStock });
          await this.logInventoryMovement({
            id: genId(),
            storeId,
            productId: item.id,
            productName: product.name,
            type: 'in',
            quantity: item.quantity,
            reason: `Online order cancelled #${existing.id.slice(-6)}`,
            actorId,
            date: new Date(),
          });
        }
      }
    }

    const updated = { ...existing, status, updatedAt: new Date() };
    onlineOrders.set(id, updated);
    return updated;
  },

  // ---------------- Marketplace Stores Directory ----------------
  async getStoresDirectory() {
    await seedInMemoryStore();
    const owners = Array.from(users.values());
    const stores = owners.filter((u) => u.id !== 'admin-id');
    const withCounts = await Promise.all(
      stores.map(async (s) => {
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

  // ---------------- Payment Intents (AmarPay Ledger) ----------------
  async createPaymentIntent(data: typeof schema.paymentIntents.$inferInsert): Promise<schema.PaymentIntent> {
    const id = data.id || genId();
    const intent: schema.PaymentIntent = {
      id,
      storeId: data.storeId,
      orderType: data.orderType,
      orderId: data.orderId,
      method: data.method,
      amount: data.amount,
      paidAmount: data.paidAmount ?? 0,
      changeAmount: data.changeAmount ?? 0,
      status: data.status || 'pending',
      gatewayTrxId: data.gatewayTrxId || null,
      voidReason: data.voidReason || null,
      details: data.details || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    paymentIntents.set(id, intent);
    return intent;
  },
  async getPaymentIntentsByStore(storeId: string): Promise<schema.PaymentIntent[]> {
    return Array.from(paymentIntents.values())
      .filter((p) => p.storeId === storeId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
  async getPaymentIntentById(id: string): Promise<schema.PaymentIntent | null> {
    return paymentIntents.get(id) || null;
  },
  async updatePaymentIntent(
    id: string,
    data: Partial<typeof schema.paymentIntents.$inferInsert>,
  ): Promise<schema.PaymentIntent> {
    const existing = paymentIntents.get(id);
    if (!existing) throw new Error('Payment intent not found');
    const updated = { ...existing, ...data, updatedAt: new Date() };
    paymentIntents.set(id, updated);
    return updated;
  },

  // ---------------- Restaurant Settlement & Voiding (AmarPay) ----------------
  async settleGuestOrder(input: {
    orderId: string;
    storeId: string;
    paymentMethod: 'cash' | 'bkash' | 'nagad' | 'card' | 'split';
    paidAmount?: number;
    cashReceived?: number;
    discount?: number;
    vatRate?: number;
    servedBy?: string;
    gatewayTrxId?: string;
    splitDetails?: any;
  }) {
    const order = guestOrders.get(input.orderId);
    if (!order || order.storeId !== input.storeId) {
      throw new StorageRuleError('ORDER_NOT_FOUND', 'Dining order not found in this restaurant.', 404);
    }
    if (order.status === 'served' || order.status === 'cancelled') {
      throw new StorageRuleError('ORDER_ALREADY_CLOSED', 'This order is already settled or cancelled.', 409);
    }
    // Phase 4 fix: settlement inputs were never validated — a negative
    // vatRate shrank the bill, a negative paidAmount was stored, and
    // any paymentMethod string was recorded. Money inputs are now
    // range-checked before any sale is created.
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

    const items = (order.items || []) as any[];
    const subTotal = order.totalAmount || items.reduce((acc, i) => acc + (i.price || 0) * (i.quantity || 1), 0);
    const discount = input.discount || 0;
    const vatRate = input.vatRate || 0;
    const discountedTotal = Math.max(0, subTotal - discount);
    const vat = Math.round(discountedTotal * (vatRate / 100));
    const totalAmount = discountedTotal + vat;
    const paidAmount = input.paidAmount ?? totalAmount;
    const cashReceived = input.paymentMethod === 'cash' ? (input.cashReceived ?? paidAmount) : null;
    const changeAmount = cashReceived ? Math.max(0, cashReceived - paidAmount) : 0;
    const dueAmount = Math.max(0, totalAmount - paidAmount);

    // 1. Create Sale Record
    const saleId = `sale-${input.orderId.slice(-8)}`;
    const sale: schema.Sale = {
      id: saleId,
      storeId: input.storeId,
      date: new Date(),
      items,
      subTotal,
      discount,
      vat,
      totalAmount,
      totalProfit: items.reduce((acc, i) => acc + ((i.price || 0) - (i.cost || 0)) * (i.quantity || 1), 0),
      paymentMethod: input.paymentMethod === 'split' ? 'cash' : (input.paymentMethod as any),
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
    sales.set(sale.id, sale);

    // 2. Create Payment Intent
    const paymentIntent: schema.PaymentIntent = {
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
      details: {
        tableId: order.tableId,
        splitDetails: input.splitDetails || null,
        saleId: sale.id,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    paymentIntents.set(paymentIntent.id, paymentIntent);

    // 3. Mark guest order as served
    const updatedOrder: schema.GuestOrder = {
      ...order,
      status: 'served',
    };
    guestOrders.set(order.id, updatedOrder);

    // Broadcast realtime event
    broadcastToStore(input.storeId, {
      type: 'ORDER_STATUS_CHANGED',
      payload: updatedOrder,
    });
    broadcastToStore(input.storeId, {
      type: 'SALE_COMPLETED',
      payload: sale,
    });

    return { order: updatedOrder, sale, paymentIntent };
  },

  async voidGuestOrder(id: string, storeId: string, reason: string) {
    const order = guestOrders.get(id);
    if (!order || order.storeId !== storeId) {
      throw new StorageRuleError('ORDER_NOT_FOUND', 'Dining order not found.', 404);
    }
    // Phase 4 fix: voiding a served order used to flip it to cancelled
    // while its sale stayed on the books, and voiding twice stacked void
    // intents. Served/cancelled orders are terminal now.
    if (order.status === 'served' || order.status === 'cancelled') {
      throw new StorageRuleError('ORDER_ALREADY_CLOSED', 'This order is already served or cancelled.', 409);
    }
    if (!reason || !reason.trim()) {
      throw new StorageRuleError('VOID_REASON_REQUIRED', 'A reason is required to void this order.');
    }

    const updatedOrder: schema.GuestOrder = { ...order, status: 'cancelled' };
    guestOrders.set(id, updatedOrder);

    const paymentIntent: schema.PaymentIntent = {
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
    };
    paymentIntents.set(paymentIntent.id, paymentIntent);

    broadcastToStore(storeId, {
      type: 'ORDER_STATUS_CHANGED',
      payload: updatedOrder,
    });

    return updatedOrder;
  },

  // ---------------- Cashier Shifts & Z-Report ----------------
  // Phase 4: shift lookup for the close-ownership check in routes.ts.
  async getShiftById(id: string): Promise<schema.Shift | null> {
    return shifts.get(id) || null;
  },
  async getCurrentShift(storeId: string, cashierId: string, counterId?: string): Promise<schema.Shift | null> {
    for (const s of shifts.values()) {
      if (s.storeId === storeId && s.cashierId === cashierId && s.status === 'open') {
        if (counterId !== undefined && (s as any).counterId !== (counterId || null)) continue;
        return s;
      }
    }
    return null;
  },
  async openShift(data: {
    storeId: string;
    cashierId: string;
    cashierName: string;
    openingCash: number;
    notes?: string;
    branchId?: string;
    counterId?: string;
  }): Promise<schema.Shift> {
    // Phase 3: one open shift per cashier PER COUNTER — two counters never
    // share a Z-report.
    if (data.branchId) {
      const branch = branches.get(data.branchId);
      if (!branch || branch.storeId !== data.storeId) {
        throw new StorageRuleError('BRANCH_NOT_FOUND', 'The selected branch does not belong to this store.', 404);
      }
    }
    if (data.counterId) {
      const counter = counters.get(data.counterId);
      if (!counter || counter.storeId !== data.storeId || (data.branchId && counter.branchId !== data.branchId)) {
        throw new StorageRuleError('COUNTER_NOT_FOUND', 'The selected counter does not belong to this branch.', 404);
      }
    }
    const existing = await this.getCurrentShift(data.storeId, data.cashierId, data.counterId);
    if (existing) return existing;

    const id = genId();
    const shift: schema.Shift = {
      id,
      storeId: data.storeId,
      branchId: data.branchId || null,
      counterId: data.counterId || null,
      cashierId: data.cashierId,
      cashierName: data.cashierName,
      openedAt: new Date(),
      closedAt: null,
      openingCash: Math.max(0, data.openingCash || 0),
      totalCashSales: 0,
      totalDigitalSales: 0,
      totalExpenses: 0,
      expectedCash: Math.max(0, data.openingCash || 0),
      actualCash: null,
      discrepancy: 0,
      status: 'open',
      notes: data.notes || null,
    };
    shifts.set(id, shift);
    return shift;
  },
  async closeShift(id: string, storeId: string, actualCash: number, notes?: string): Promise<schema.Shift> {
    const shift = shifts.get(id);
    if (!shift || shift.storeId !== storeId) {
      throw new StorageRuleError('SHIFT_NOT_FOUND', 'Shift not found.', 404);
    }
    if (shift.status === 'closed') return shift;

    // Calculate shift sales from openedAt to now. Phase 3: when the shift
    // belongs to a counter, ONLY that counter's sales count toward its
    // Z-report — never the whole store's sales.
    const shiftSales = Array.from(sales.values()).filter(
      (s) =>
        s.storeId === storeId &&
        new Date(s.date) >= new Date(shift.openedAt) &&
        ((shift as any).counterId ? (s as any).counterId === (shift as any).counterId : true) &&
        ((shift as any).branchId ? (s as any).branchId === (shift as any).branchId : true),
    );
    let totalCashSales = 0;
    let totalDigitalSales = 0;
    for (const sale of shiftSales) {
      if (sale.paymentMethod === 'cash') {
        totalCashSales += sale.paidAmount;
      } else {
        totalDigitalSales += sale.paidAmount;
      }
    }

    // Expenses carry no counter, so they belong to a store-level shift
    // only; attributing them to one counter would corrupt its Z-report.
    const shiftExpenses = (shift as any).counterId
      ? []
      : Array.from(expenses.values()).filter(
          (e) => e.storeId === storeId && new Date(e.date) >= new Date(shift.openedAt),
        );
    const totalExpenses = shiftExpenses.reduce((acc, e) => acc + (e.amount || 0), 0);

    const expectedCash = shift.openingCash + totalCashSales - totalExpenses;
    const discrepancy = actualCash - expectedCash;

    const updated: schema.Shift = {
      ...shift,
      closedAt: new Date(),
      totalCashSales,
      totalDigitalSales,
      totalExpenses,
      expectedCash,
      actualCash,
      discrepancy,
      status: 'closed',
      notes: notes || shift.notes,
    };
    shifts.set(id, updated);
    return updated;
  },
  async getShiftsByStore(storeId: string): Promise<schema.Shift[]> {
    return Array.from(shifts.values())
      .filter((s) => s.storeId === storeId)
      .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
  },

  // ---------------- Phase 3: Branches & Counters ----------------
  async getBranchesByStore(storeId: string): Promise<schema.Branch[]> {
    await seedInMemoryStore();
    return Array.from(branches.values())
      .filter((b) => b.storeId === storeId)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },
  async createBranch(data: {
    storeId: string;
    name: string;
    address?: string;
    isDefault?: boolean;
  }): Promise<schema.Branch> {
    await seedInMemoryStore();
    if (!data.name || !data.name.trim()) {
      throw new StorageRuleError('INVALID_BRANCH', 'A branch name is required.', 400);
    }
    const existing = Array.from(branches.values()).filter((b) => b.storeId === data.storeId);
    const isDefault = data.isDefault === true || existing.length === 0;
    if (isDefault) {
      for (const b of existing) {
        if (b.isDefault) branches.set(b.id, { ...b, isDefault: false });
      }
    }
    const branch: schema.Branch = {
      id: genId(),
      storeId: data.storeId,
      name: data.name.trim(),
      address: data.address?.trim() || null,
      isDefault,
      createdAt: new Date(),
    };
    branches.set(branch.id, branch);
    return branch;
  },
  async getCountersByBranch(storeId: string, branchId: string): Promise<schema.Counter[]> {
    await seedInMemoryStore();
    const branch = branches.get(branchId);
    if (!branch || branch.storeId !== storeId) {
      throw new StorageRuleError('BRANCH_NOT_FOUND', 'Branch not found in this store.', 404);
    }
    return Array.from(counters.values())
      .filter((c) => c.branchId === branchId)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },
  async createCounter(data: { storeId: string; branchId: string; name: string }): Promise<schema.Counter> {
    await seedInMemoryStore();
    const branch = branches.get(data.branchId);
    if (!branch || branch.storeId !== data.storeId) {
      throw new StorageRuleError('BRANCH_NOT_FOUND', 'Branch not found in this store.', 404);
    }
    if (!data.name || !data.name.trim()) {
      throw new StorageRuleError('INVALID_COUNTER', 'A counter name is required.', 400);
    }
    const counter: schema.Counter = {
      id: genId(),
      storeId: data.storeId,
      branchId: data.branchId,
      name: data.name.trim(),
      createdAt: new Date(),
    };
    counters.set(counter.id, counter);
    return counter;
  },
  async getProductsByBranch(storeId: string, branchId: string): Promise<schema.Product[]> {
    await seedInMemoryStore();
    const branch = branches.get(branchId);
    if (!branch || branch.storeId !== storeId) {
      throw new StorageRuleError('BRANCH_NOT_FOUND', 'Branch not found in this store.', 404);
    }
    // A product with no branchId belongs to the main store and is visible
    // in every branch read only when the branch is the default one; named
    // branches see exactly their own products. This keeps legacy stock
    // (created before branches existed) from leaking into a new branch.
    return Array.from(products.values()).filter((p) => {
      if (p.storeId !== storeId) return false;
      if ((p as any).branchId) return (p as any).branchId === branchId;
      return branch.isDefault === true;
    });
  },
  async getSalesByBranch(storeId: string, branchId: string): Promise<schema.Sale[]> {
    await seedInMemoryStore();
    const branch = branches.get(branchId);
    if (!branch || branch.storeId !== storeId) {
      throw new StorageRuleError('BRANCH_NOT_FOUND', 'Branch not found in this store.', 404);
    }
    return Array.from(sales.values())
      .filter((s) => s.storeId === storeId && (s as any).branchId === branchId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },
  /** Z-report totals grouped per counter (closed shifts only). */
  async getZReportsByCounter(storeId: string): Promise<
    Array<{
      counterId: string | null;
      counterName: string;
      branchId: string | null;
      shifts: number;
      expectedCash: number;
      actualCash: number;
      discrepancy: number;
    }>
  > {
    const closed = Array.from(shifts.values()).filter((s) => s.storeId === storeId && s.status === 'closed');
    const groups = new Map<
      string,
      {
        counterId: string | null;
        counterName: string;
        branchId: string | null;
        shifts: number;
        expectedCash: number;
        actualCash: number;
        discrepancy: number;
      }
    >();
    for (const s of closed) {
      const counterId = (s as any).counterId || null;
      const key = counterId || '__store__';
      const cur = groups.get(key) || {
        counterId,
        counterName: counterId ? counters.get(counterId)?.name || 'Counter' : 'Store (no counter)',
        branchId: (s as any).branchId || null,
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
    return [...groups.values()].sort((a, b) => a.counterName.localeCompare(b.counterName));
  },

  // ---------------- Phase 3: Suppliers & Purchase Orders ----------------
  async getSuppliersByStore(storeId: string): Promise<schema.Supplier[]> {
    await seedInMemoryStore();
    return Array.from(suppliers.values())
      .filter((s) => s.storeId === storeId)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },
  async createSupplier(data: {
    storeId: string;
    name: string;
    phone?: string;
    address?: string;
    notes?: string;
  }): Promise<schema.Supplier> {
    await seedInMemoryStore();
    if (!data.name || !data.name.trim()) {
      throw new StorageRuleError('INVALID_SUPPLIER', 'A supplier name is required.', 400);
    }
    const supplier: schema.Supplier = {
      id: genId(),
      storeId: data.storeId,
      name: data.name.trim(),
      phone: data.phone?.trim() || null,
      address: data.address?.trim() || null,
      notes: data.notes?.trim() || null,
      totalDue: 0,
      createdAt: new Date(),
    };
    suppliers.set(supplier.id, supplier);
    return supplier;
  },
  async updateSupplier(
    id: string,
    storeId: string,
    updates: Partial<schema.Supplier>,
  ): Promise<schema.Supplier | null> {
    const existing = suppliers.get(id);
    if (!existing || existing.storeId !== storeId) return null;
    const updated = { ...existing, ...updates, id, storeId, totalDue: existing.totalDue };
    suppliers.set(id, updated);
    return updated;
  },
  async deleteSupplier(id: string, storeId: string): Promise<boolean> {
    const existing = suppliers.get(id);
    if (!existing || existing.storeId !== storeId) return false;
    suppliers.delete(id);
    return true;
  },
  async getSupplierDuesTotal(storeId: string): Promise<number> {
    await seedInMemoryStore();
    return (
      Math.round(
        Array.from(suppliers.values())
          .filter((s) => s.storeId === storeId)
          .reduce((sum, s) => sum + (s.totalDue || 0), 0) * 100,
      ) / 100
    );
  },
  /** Pay a supplier down: reduces the due AND records a cash-out expense
   * (category 'supplier_payment') so the payment shows in expenses. */
  async paySupplier(id: string, storeId: string, amount: number, actorId?: string): Promise<schema.Supplier> {
    const supplier = suppliers.get(id);
    if (!supplier || supplier.storeId !== storeId) {
      throw new StorageRuleError('SUPPLIER_NOT_FOUND', 'Supplier not found in this store.', 404);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new StorageRuleError('INVALID_PAYMENT', 'Payment amount must be positive.', 400);
    }
    const paid = Math.min(amount, supplier.totalDue);
    const updated = { ...supplier, totalDue: Math.round((supplier.totalDue - paid) * 100) / 100 };
    suppliers.set(id, updated);
    if (paid > 0) {
      await this.createExpense({
        id: genId(),
        storeId,
        description: `Supplier payment: ${supplier.name}`,
        amount: paid,
        category: 'supplier_payment',
        date: new Date(),
      });
    }
    void actorId;
    return updated;
  },
  async getPurchaseOrdersByStore(storeId: string): Promise<schema.PurchaseOrder[]> {
    await seedInMemoryStore();
    return Array.from(purchaseOrders.values())
      .filter((po) => po.storeId === storeId)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  },
  async createPurchaseOrder(data: {
    storeId: string;
    supplierId: string;
    branchId?: string;
    items: Array<{ productId: string; quantity: number; cost: number }>;
  }): Promise<schema.PurchaseOrder> {
    await seedInMemoryStore();
    const supplier = suppliers.get(data.supplierId);
    if (!supplier || supplier.storeId !== data.storeId) {
      throw new StorageRuleError('SUPPLIER_NOT_FOUND', 'Supplier not found in this store.', 404);
    }
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new StorageRuleError('INVALID_PO_ITEMS', 'A purchase order needs at least one item.', 400);
    }
    const items = data.items.map((item) => {
      const product = products.get(item.productId);
      if (!product || product.storeId !== data.storeId) {
        throw new StorageRuleError('PRODUCT_NOT_FOUND', 'A purchase-order product is unavailable in this store.', 404);
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.cost) || item.cost < 0) {
        throw new StorageRuleError('INVALID_PO_ITEM', 'Quantity must be positive and cost non-negative.', 400);
      }
      return {
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        cost: item.cost,
        receivedQty: 0,
      };
    });
    const totalCost = Math.round(items.reduce((sum, i) => sum + i.quantity * i.cost, 0) * 100) / 100;
    const po: schema.PurchaseOrder = {
      id: genId(),
      storeId: data.storeId,
      supplierId: data.supplierId,
      branchId: data.branchId || null,
      status: 'draft',
      items,
      totalCost,
      createdAt: new Date(),
      receivedAt: null,
    };
    purchaseOrders.set(po.id, po);
    return po;
  },
  /** Goods-received flow: updates stock AND writes inventory-log entries,
   * and raises the supplier due by the received value. Draft POs are only
   * reviewed, never ordered — receiving is the step that moves stock/money. */
  async receivePurchaseOrder(
    id: string,
    storeId: string,
    received: Array<{ productId: string; quantity: number }>,
    actorId?: string,
  ): Promise<schema.PurchaseOrder> {
    const po = purchaseOrders.get(id);
    if (!po || po.storeId !== storeId) {
      throw new StorageRuleError('PO_NOT_FOUND', 'Purchase order not found in this store.', 404);
    }
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
      const product = products.get(item.productId)!;
      const newStock = Number((product.stock + accepted).toFixed(6));
      products.set(product.id, { ...product, stock: newStock });
      dueIncrease = Math.round((dueIncrease + accepted * item.cost) * 100) / 100;
      return { ...item, receivedQty: (item.receivedQty || 0) + accepted };
    });
    const newlyReceived = items.some((i: any, idx: number) => i.receivedQty !== (po.items as any)[idx].receivedQty);
    if (!newlyReceived) {
      throw new StorageRuleError('PO_NOTHING_RECEIVED', 'No new quantity was received for this order.', 400);
    }
    const fullyReceived = items.every((i: any) => (i.receivedQty || 0) >= i.quantity);
    const updated: schema.PurchaseOrder = {
      ...po,
      items,
      status: fullyReceived ? 'received' : 'partial',
      receivedAt: fullyReceived ? new Date() : po.receivedAt,
    };
    purchaseOrders.set(id, updated);
    // Inventory logs + supplier due, after the PO record itself is saved.
    for (const item of items as any[]) {
      const before = (po.items as any[]).find((i) => i.productId === item.productId);
      const delta = item.receivedQty - (before?.receivedQty || 0);
      if (delta > 0) {
        await this.logInventoryMovement({
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
      const supplier = suppliers.get(po.supplierId)!;
      suppliers.set(supplier.id, { ...supplier, totalDue: Math.round((supplier.totalDue + dueIncrease) * 100) / 100 });
    }
    return updated;
  },
  async cancelPurchaseOrder(id: string, storeId: string): Promise<schema.PurchaseOrder> {
    const po = purchaseOrders.get(id);
    if (!po || po.storeId !== storeId) {
      throw new StorageRuleError('PO_NOT_FOUND', 'Purchase order not found in this store.', 404);
    }
    if (po.status !== 'draft') {
      throw new StorageRuleError('PO_NOT_DRAFT', 'Only a draft purchase order can be cancelled.', 400);
    }
    const updated = { ...po, status: 'cancelled' as const };
    purchaseOrders.set(id, updated);
    return updated;
  },

  // ---------------- Phase 3: Coupons & Loyalty ----------------
  async getCouponsByStore(storeId: string): Promise<schema.Coupon[]> {
    await seedInMemoryStore();
    return Array.from(coupons.values())
      .filter((c) => c.storeId === storeId)
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  },
  async createCoupon(data: {
    storeId: string;
    code: string;
    type: 'percent' | 'fixed';
    value: number;
    minPurchase?: number;
    maxUses?: number;
    expiresAt?: string | null;
    active?: boolean;
  }): Promise<schema.Coupon> {
    await seedInMemoryStore();
    const code = (data.code || '').trim().toUpperCase();
    if (!code) throw new StorageRuleError('INVALID_COUPON', 'A coupon code is required.', 400);
    if (data.type !== 'percent' && data.type !== 'fixed') {
      throw new StorageRuleError('INVALID_COUPON', 'Coupon type must be percent or fixed.', 400);
    }
    if (!Number.isFinite(data.value) || data.value < 0 || (data.type === 'percent' && data.value > 100)) {
      throw new StorageRuleError('INVALID_COUPON', 'Coupon value is out of range.', 400);
    }
    const clash = Array.from(coupons.values()).find((c) => c.storeId === data.storeId && c.code.toUpperCase() === code);
    if (clash) throw new StorageRuleError('COUPON_EXISTS', 'A coupon with this code already exists.', 409);
    const coupon: schema.Coupon = {
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
      createdAt: new Date(),
    };
    coupons.set(coupon.id, coupon);
    return coupon;
  },
  async deleteCoupon(id: string, storeId: string): Promise<boolean> {
    const existing = coupons.get(id);
    if (!existing || existing.storeId !== storeId) return false;
    coupons.delete(id);
    return true;
  },
  async getLoyaltyAccount(storeId: string, phone: string): Promise<schema.LoyaltyAccount | null> {
    await seedInMemoryStore();
    return loyaltyAccounts.get(`${storeId}:${phone}`) || null;
  },
  async getLoyaltyAccountsByStore(storeId: string): Promise<schema.LoyaltyAccount[]> {
    await seedInMemoryStore();
    return Array.from(loyaltyAccounts.values())
      .filter((a) => a.storeId === storeId)
      .sort((a, b) => b.points - a.points);
  },

  // ---------------- Phase 3: Insights (forecast / expiry / dead) ----------------
  async getForecast(
    storeId: string,
    windowDays: number,
    leadTimeDays: number,
  ): Promise<ReturnType<typeof forecastDemand>[]> {
    await seedInMemoryStore();
    const windowStart = Date.now() - Math.max(1, windowDays) * 24 * 60 * 60 * 1000;
    const qtyByProduct = new Map<string, Array<{ date: string; quantity: number }>>();
    for (const sale of sales.values()) {
      if (sale.storeId !== storeId) continue;
      for (const item of sale.items as Array<{ id: string; quantity: number }>) {
        const list = qtyByProduct.get(item.id) || [];
        list.push({ date: new Date(sale.date).toISOString(), quantity: item.quantity });
        qtyByProduct.set(item.id, list);
      }
    }
    void windowStart;
    return Array.from(products.values())
      .filter((p) => p.storeId === storeId)
      .map((p) =>
        forecastDemand({
          productId: p.id,
          productName: p.name,
          currentStock: p.stock,
          history: qtyByProduct.get(p.id) || [],
          windowDays,
          leadTimeDays,
        }),
      )
      .sort((a, b) => b.suggestedQty - a.suggestedQty);
  },
  async getExpiryAlerts(storeId: string): Promise<ReturnType<typeof expiryAlerts>> {
    await seedInMemoryStore();
    return expiryAlerts(
      Array.from(products.values())
        .filter((p) => p.storeId === storeId)
        .map((p) => ({ id: p.id, name: p.name, expiryDate: p.expiryDate || null })),
    );
  },
  async getDeadStock(storeId: string, windowDays = 90): Promise<ReturnType<typeof deadStock>> {
    await seedInMemoryStore();
    const lastSale = new Map<string, string>();
    for (const sale of sales.values()) {
      if (sale.storeId !== storeId) continue;
      for (const item of sale.items as Array<{ id: string }>) {
        const prev = lastSale.get(item.id);
        const d = new Date(sale.date).toISOString();
        if (!prev || d > prev) lastSale.set(item.id, d);
      }
    }
    return deadStock(
      Array.from(products.values())
        .filter((p) => p.storeId === storeId)
        .map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
      lastSale,
      windowDays,
    );
  },

  // ---------------- Automated Backup & Export ----------------
  async exportDatabaseBackup() {
    await seedInMemoryStore();
    return {
      version: '2.0.0-os',
      exportedAt: new Date().toISOString(),
      counts: {
        users: users.size,
        products: products.size,
        sales: sales.size,
        expenses: expenses.size,
        restaurantTables: restaurantTables.size,
        guestOrders: guestOrders.size,
        onlineOrders: onlineOrders.size,
        paymentIntents: paymentIntents.size,
        shifts: shifts.size,
        branches: branches.size,
        counters: counters.size,
        suppliers: suppliers.size,
        purchaseOrders: purchaseOrders.size,
        coupons: coupons.size,
        loyaltyAccounts: loyaltyAccounts.size,
      },
      // Phase 1 fix (P1-3): PIN verifiers are NEVER exported. A backup file
      // must never contain credential material — see docs/backup-handling.md
      // for how exports must be stored and transferred.
      redactedFields: ['users[].pin', 'staff[].pin', 'customers[].pin'],
      securityNotice:
        'This export contains no PIN verifiers or other credentials. Store and transfer it as sensitive business data (encrypted, access-controlled); see docs/backup-handling.md.',
      data: {
        users: Array.from(users.values()).map(({ pin: _pin, ...safeUser }: any) => safeUser),
        products: Array.from(products.values()),
        sales: Array.from(sales.values()),
        expenses: Array.from(expenses.values()),
        inventoryLogs: Array.from(inventoryLogs.values()),
        restaurantTables: Array.from(restaurantTables.values()),
        guestOrders: Array.from(guestOrders.values()),
        onlineOrders: Array.from(onlineOrders.values()),
        paymentIntents: Array.from(paymentIntents.values()),
        shifts: Array.from(shifts.values()),
        announcements: Array.from(announcements.values()),
        branches: Array.from(branches.values()),
        counters: Array.from(counters.values()),
        suppliers: Array.from(suppliers.values()),
        purchaseOrders: Array.from(purchaseOrders.values()),
        coupons: Array.from(coupons.values()),
        loyaltyAccounts: Array.from(loyaltyAccounts.values()),
      },
    };
  },
};
