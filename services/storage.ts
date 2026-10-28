import {
  Product,
  Sale,
  CartItem,
  User,
  Expense,
  SubscriptionRequest,
  PaymentSettings,
  GlobalPricingConfig,
  Staff,
  InventoryLog,
  RestaurantTable,
  GuestOrder,
  Announcement,
  GlobalConfig,
  Customer,
  OnlineOrder,
  StoreDirectoryEntry,
  PaymentIntent,
  Shift,
} from '../types';
import { api } from './api';

let cachedRole: 'owner' | 'staff' | 'customer' | null = null;
let cachedUser: User | null = null;
let cachedStaff: Staff | null = null;
let cachedCustomer: Customer | null = null;

export const StorageService = {
  // --- Session bootstrap (call once at app start) ---
  bootstrap: async (): Promise<{ role: string | null; user?: User; staff?: Staff }> => {
    const res = await api.get('/auth/me');
    cachedRole = res.role;
    cachedUser = res.user || null;
    cachedStaff = res.staff || null;
    if (res.role) {
      localStorage.setItem('pos_session_type', res.role);
    } else {
      localStorage.removeItem('pos_session_type');
    }
    return res;
  },

  isLoggedIn: (): boolean => {
    const type = localStorage.getItem('pos_session_type');
    return type === 'owner' || type === 'staff';
  },

  getCurrentUser: async (): Promise<User | null> => {
    const res = await api.get('/auth/me');
    cachedUser = res.user || null;
    cachedStaff = res.staff || null;
    return cachedUser;
  },

  getCurrentStaff: async (): Promise<Staff | null> => {
    if (cachedStaff) return cachedStaff;
    const res = await api.get('/auth/me');
    cachedStaff = res.staff || null;
    return cachedStaff;
  },

  registerUser: async (userData: any): Promise<User> => {
    const res = await api.post('/auth/register', userData);
    localStorage.setItem('pos_session_type', 'owner');
    cachedUser = res.user;
    return res.user;
  },

  loginUser: async (username: string, pin: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await api.post('/auth/login', { username, pin });
      localStorage.setItem('pos_session_type', res.type);
      return { success: true };
    } catch (e: any) {
      return {
        success: false,
        error: e.body?.error || e.message || 'AUTHENTICATION_FAILED',
      };
    }
  },

  updateUser: async (userData: Partial<User>): Promise<User | null> => {
    const updated = await api.put('/profile', userData);
    cachedUser = updated;
    return updated;
  },

  logout: async () => {
    await api.post('/auth/logout');
    localStorage.removeItem('pos_session_type');
    cachedRole = null;
    cachedUser = null;
    cachedStaff = null;
  },

  // --- Products ---
  getProducts: async (): Promise<Product[]> => api.get('/products'),

  // Phase 6 — server-side barcode lookup (own store only, server-scoped).
  getProductByBarcode: async (barcode: string): Promise<Product> =>
    api.get(`/products/barcode/${encodeURIComponent(barcode)}`),

  bulkProducts: async (body: {
    ids: string[];
    action: 'adjust-stock' | 'set-price' | 'delete';
    delta?: number;
    price?: number;
    confirmed?: boolean;
  }): Promise<{ updated: number; deleted: number; skipped: Array<{ id: string; reason: string }> }> =>
    api.post('/products/bulk', body),

  saveProduct: async (product: Product) => api.post('/products', product),

  deleteProduct: async (id: string) => api.del(`/products/${id}`),

  // --- Sales ---
  getSales: async (): Promise<Sale[]> => api.get('/sales'),

  addSale: async (sale: Sale) => api.post('/sales', sale),
  createSale: async (sale: Sale) => api.post('/sales', sale),

  // --- Expenses ---
  getExpenses: async (): Promise<Expense[]> => api.get('/expenses'),

  addExpense: async (expense: Expense) => api.post('/expenses', expense),

  deleteExpense: async (id: string) => api.del(`/expenses/${id}`),

  // --- Inventory Logs ---
  getInventoryLogs: async (): Promise<InventoryLog[]> => api.get('/inventory-logs'),

  // --- Staff ---
  getStaff: async (): Promise<Staff[]> => api.get('/staff'),

  addStaff: async (staffData: Omit<Staff, 'id' | 'ownerId'>) => api.post('/staff', staffData),

  updateStaff: async (id: string, staffData: Partial<Staff>) => api.put(`/staff/${id}`, staffData),

  deleteStaff: async (id: string) => api.del(`/staff/${id}`),

  // --- Admin ---
  isAdmin: async (): Promise<boolean> => {
    const user = await StorageService.getCurrentUser();
    return user?.isPlatformAdmin === true;
  },

  adminUnlockUser: async (userId: string, newPin: string) => api.post(`/admin/users/${userId}/unlock`, { newPin }),

  getAllUsers: async (): Promise<User[]> => api.get('/admin/users'),

  deleteUserAdmin: async (id: string) => api.del(`/admin/users/${id}`),

  getAllSales: async (): Promise<Sale[]> => api.get('/admin/sales'),
  // Phase 2 — admin system-status (live DB ping, outbox depth, last backup).
  getSystemStatus: async (): Promise<any> => api.get('/admin/system-status'),

  // --- Subscription ---
  createSubscriptionRequest: async (req: SubscriptionRequest) => api.post('/subscription-requests', req),

  getSubscriptionRequests: async (): Promise<SubscriptionRequest[]> => api.get('/admin/subscription-requests'),

  approveSubscription: async (requestId: string) => api.post(`/admin/subscription-requests/${requestId}/approve`),

  rejectSubscription: async (requestId: string) => api.post(`/admin/subscription-requests/${requestId}/reject`),

  getPaymentSettings: async (): Promise<PaymentSettings> => {
    const s = await api.get('/payment-settings');
    return { key: 'payment_info', ...s };
  },

  updatePaymentSettings: async (bkash: string, nagad: string) => api.put('/admin/payment-settings', { bkash, nagad }),

  getPricingConfig: async (): Promise<GlobalPricingConfig> => api.get('/pricing-config'),

  updatePricingConfig: async (config: GlobalPricingConfig) => api.put('/admin/pricing-config', config),

  getGlobalConfig: async (): Promise<GlobalConfig> => api.get('/global-config'),

  updateGlobalConfig: async (config: GlobalConfig) => api.put('/admin/global-config', config),

  // --- Announcements ---
  getAnnouncements: async (): Promise<Announcement[]> => api.get('/announcements'),

  createAnnouncement: async (ann: Omit<Announcement, 'createdAt'>) => api.post('/admin/announcements', ann),

  deleteAnnouncement: async (id: string) => api.del(`/admin/announcements/${id}`),

  // --- Restaurant ---
  getTables: async (): Promise<RestaurantTable[]> => api.get('/restaurant/tables'),

  addTable: async (name: string) => api.post('/restaurant/tables', { name }),

  deleteTable: async (id: string) => api.del(`/restaurant/tables/${id}`),

  getGuestOrders: async (): Promise<GuestOrder[]> => api.get('/restaurant/guest-orders'),

  updateGuestOrderStatus: async (id: string, status: string) => api.put(`/restaurant/guest-orders/${id}`, { status }),

  // Public (guest-facing, no auth)
  getPublicMenu: async (storeId: string): Promise<Product[]> => api.get(`/public/store/${storeId}/menu`),

  getPublicTable: async (tableId: string): Promise<RestaurantTable> => api.get(`/public/table/${tableId}`),

  createGuestOrder: async (order: Omit<GuestOrder, 'id'> & { idempotencyKey: string }) =>
    api.post('/public/guest-orders', order),

  getGuestOrder: async (id: string): Promise<GuestOrder> => api.get(`/public/guest-orders/${id}`),

  // --- Marketplace: Customer Auth ---
  registerCustomer: async (data: { name: string; phone: string; pin: string; address?: string }): Promise<Customer> => {
    const res = await api.post('/customer/register', data);
    localStorage.setItem('pos_session_type', 'customer');
    cachedCustomer = res.customer;
    return res.customer;
  },

  loginCustomer: async (phone: string, pin: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await api.post('/customer/login', { phone, pin });
      localStorage.setItem('pos_session_type', 'customer');
      cachedCustomer = res.customer;
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.body?.error || 'INVALID' };
    }
  },

  getCurrentCustomer: async (): Promise<Customer | null> => {
    const res = await api.get('/auth/me');
    cachedCustomer = res.customer || null;
    return cachedCustomer;
  },

  // --- Marketplace: Browse & Search ---
  getMarketplaceStores: async (): Promise<StoreDirectoryEntry[]> => api.get('/marketplace/stores'),

  getMarketplaceStoreProducts: async (storeId: string): Promise<Product[]> =>
    api.get(`/marketplace/stores/${storeId}/products`),

  searchMarketplaceProducts: async (q?: string, category?: string): Promise<Product[]> => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    const qs = params.toString();
    return api.get(`/marketplace/products${qs ? `?${qs}` : ''}`);
  },

  // --- Marketplace: Orders (customer side) ---
  createMarketplaceOrder: async (order: {
    idempotencyKey: string;
    storeId: string;
    items: CartItem[];
    deliveryAddress?: string;
    paymentMethod?: string;
    note?: string;
  }): Promise<OnlineOrder> => api.post('/marketplace/orders', order),

  getMyMarketplaceOrders: async (): Promise<OnlineOrder[]> => api.get('/marketplace/orders/mine'),

  getMarketplaceOrder: async (id: string): Promise<OnlineOrder> => api.get(`/marketplace/orders/${id}`),

  // --- Online Orders (store owner side) ---
  getStoreOnlineOrders: async (): Promise<OnlineOrder[]> => api.get('/orders/store'),

  updateOnlineOrderStatus: async (id: string, status: string): Promise<OnlineOrder> =>
    api.put(`/orders/${id}/status`, { status }),

  updateProductOnlineVisibility: async (id: string, isOnlineVisible: boolean): Promise<Product> =>
    api.put(`/products/${id}/online-visibility`, { isOnlineVisible }),

  // --- Restaurant Settlement & Void (AmarPay) ---
  settleGuestOrder: async (
    orderId: string,
    data: {
      paymentMethod: 'cash' | 'bkash' | 'nagad' | 'card' | 'split';
      paidAmount?: number;
      cashReceived?: number;
      discount?: number;
      vatRate?: number;
      splitDetails?: any;
      gatewayTrxId?: string;
    },
  ): Promise<{ order: GuestOrder; sale: Sale; paymentIntent: PaymentIntent }> =>
    api.post(`/restaurant/guest-orders/${orderId}/settle`, data),

  voidGuestOrder: async (orderId: string, reason: string): Promise<GuestOrder> =>
    api.post(`/restaurant/guest-orders/${orderId}/void`, { reason }),

  // --- Cashier Shifts & Z-Report ---
  getCurrentShift: async (): Promise<Shift | null> => api.get('/shifts/current'),
  openShift: async (data: {
    openingCash: number;
    notes?: string;
    branchId?: string;
    counterId?: string;
  }): Promise<Shift> => api.post('/shifts/open', data),
  closeShift: async (id: string, data: { actualCash: number; notes?: string }): Promise<Shift> =>
    api.post(`/shifts/${id}/close`, data),
  getShifts: async (): Promise<Shift[]> => api.get('/shifts'),

  // --- Payment Gateway Verification ---
  // Phase 1 fix (P1-2): this is a FORMAT CHECK ONLY. The server never
  // contacts a gateway; `gatewayVerified` is always false. Callers must not
  // treat a response here as proof of payment, and no capture path uses it.
  verifyGatewayPayment: async (data: {
    gateway?: string;
    trxId: string;
    amount?: number;
    phone?: string;
  }): Promise<{
    formatValid: boolean;
    gatewayVerified: boolean;
    verified: boolean;
    valid: boolean;
    verificationMethod: string;
    trxId: string;
    gateway: string;
    amount: number;
    phone?: string | null;
    checkedAt: string;
    message: string;
  }> => api.post('/payments/verify-gateway', data),

  // --- Backup Export ---
  exportBackup: async (): Promise<any> => api.get('/admin/backups/export'),

  // --- Phase 3 (Depth) ---
  getForecast: async (windowDays = 30, leadTimeDays = 7): Promise<any> =>
    api.get(`/insights/forecast?windowDays=${windowDays}&leadTimeDays=${leadTimeDays}`),
  getExpiryAlerts: async (): Promise<any> => api.get('/insights/expiry'),
  getDeadStock: async (windowDays = 90): Promise<any> => api.get(`/insights/dead-stock?windowDays=${windowDays}`),
  getBranches: async (): Promise<import('../types').Branch[]> => api.get('/branches'),
  createBranch: async (data: { name: string; address?: string; isDefault?: boolean }) => api.post('/branches', data),
  getBranchProducts: async (branchId: string) => api.get(`/branches/${branchId}/products`),
  getBranchSales: async (branchId: string) => api.get(`/branches/${branchId}/sales`),
  getCounters: async (branchId: string) => api.get(`/branches/${branchId}/counters`),
  createCounter: async (data: { branchId: string; name: string }) => api.post('/counters', data),
  getZReport: async (): Promise<any> => api.get('/shifts/z-report'),
  getSuppliers: async (): Promise<import('../types').Supplier[]> => api.get('/suppliers'),
  createSupplier: async (data: { name: string; phone?: string; address?: string; notes?: string }) =>
    api.post('/suppliers', data),
  deleteSupplier: async (id: string) => api.del(`/suppliers/${id}`),
  getSupplierDuesTotal: async (): Promise<{ totalDue: number }> => api.get('/suppliers/dues-total'),
  paySupplier: async (id: string, amount: number) => api.post(`/suppliers/${id}/pay`, { amount }),
  getPurchaseOrders: async (): Promise<import('../types').PurchaseOrder[]> => api.get('/purchase-orders'),
  createPurchaseOrder: async (data: {
    supplierId: string;
    branchId?: string;
    items: Array<{ productId: string; quantity: number; cost: number }>;
  }) => api.post('/purchase-orders', data),
  receivePurchaseOrder: async (id: string, received: Array<{ productId: string; quantity: number }>) =>
    api.post(`/purchase-orders/${id}/receive`, { received }),
  cancelPurchaseOrder: async (id: string) => api.post(`/purchase-orders/${id}/cancel`),
  getCoupons: async (): Promise<import('../types').Coupon[]> => api.get('/coupons'),
  createCoupon: async (data: {
    code: string;
    type: 'percent' | 'fixed';
    value: number;
    minPurchase?: number;
    maxUses?: number;
    expiresAt?: string | null;
  }) => api.post('/coupons', data),
  deleteCoupon: async (id: string) => api.del(`/coupons/${id}`),
  getLoyaltyAccounts: async (): Promise<import('../types').LoyaltyAccount[]> => api.get('/loyalty'),
  getLoyaltyAccount: async (phone: string): Promise<import('../types').LoyaltyAccount> =>
    api.get(`/loyalty/${encodeURIComponent(phone)}`),
  downloadReportCsv: async (kind: 'vat' | 'profit-by-category' | 'staff-performance' | 'excel'): Promise<string> => {
    const res = await fetch(`/api/reports/${kind === 'excel' ? 'excel' : kind}.csv`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.text();
  },
  getFullExport: async (): Promise<any> => api.get('/reports/full-export'),
  importFullData: async (payload: any): Promise<any> => api.post('/reports/import', payload),
};
