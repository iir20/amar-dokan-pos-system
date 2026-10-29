export type StoreCategory = 'grocery' | 'medicine' | 'clothing' | 'electronics' | 'restaurant' | 'other';

export interface Product {
  id: string;
  storeId?: string; // New: Links product to specific store owner
  name: string;
  nameBn: string; // Bangla Name
  price: number;
  cost: number; // For profit calculation
  category: string;
  stock: number;
  unit: string; // e.g., 'kg', 'pcs', 'L'
  image?: string;
  barcode?: string;
  supplier?: string;

  // Smart Inventory Fields (Conditional based on Category)

  // Medicine Specific
  expiryDate?: string;
  batchNumber?: string;
  genericName?: string; // New: For medicines (e.g., Paracetamol)

  // Clothing Specific
  color?: string;
  size?: string;
  style?: string;
  brand?: string; // New: For clothing/electronics

  // Electronics Specific
  warranty?: string;
  serialNumber?: string; // New: IMEI or Serial

  // Restaurant Specific
  dietaryType?: 'veg' | 'non-veg';
  preparationTime?: number; // in minutes
}

export interface CartItem extends Product {
  quantity: number;
  note?: string; // Special instructions
}

export interface Sale {
  id: string;
  storeId?: string; // New
  date: string; // ISO string
  items: CartItem[];
  subTotal: number; // Price before discount
  discount: number; // Deduction
  vat: number; // Tax Amount
  totalAmount: number; // Final amount after discount + tax
  totalProfit: number;
  paymentMethod: 'cash' | 'bkash' | 'nagad' | 'card';
  customerName?: string;
  customerPhone?: string;
  paidAmount: number;
  /** Amount applied to the invoice; never includes cash returned as change. */
  cashReceived?: number | null;
  changeAmount?: number | null;
  dueAmount: number;
  storeName?: string;
  servedBy?: string; // Name of staff who processed
  branchId?: string | null;
  counterId?: string | null;
  couponCode?: string | null;
  loyaltyRedeemed?: number;
  loyaltyEarned?: number;
  /** Phase 3 request field: points the customer asks to redeem. The
   * server validates the balance and caps the discount; the client
   * never supplies a discount amount for loyalty. */
  loyaltyPointsRedeem?: number;
}

// Restaurant System Types
export type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'served' | 'cancelled';

export interface RestaurantTable {
  id: string;
  storeId: string; // New: Links table to specific store
  name: string; // Table 1, Table 2
  isActive: boolean;
}

export interface GuestOrder {
  id: string;
  storeId?: string;
  /** Null for a store-QR pickup order (no restaurant table). */
  tableId: string | null;
  items: CartItem[];
  note?: string;
  status: OrderStatus;
  createdAt: string; // ISO String
  totalAmount: number;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  category: string;
}

export type PlanType = 'free' | 'premium';
export type SubscriptionPackage = 'monthly' | 'yearly' | '2yearly';

export interface PricingDetail {
  price: number;
  label: string;
  labelBn: string;
  durationDays: number;
}

export interface CategoryPricing {
  monthly: PricingDetail;
  yearly: PricingDetail;
  '2yearly': PricingDetail;
}

// Map each store category to its own pricing structure
export type GlobalPricingConfig = Record<StoreCategory, CategoryPricing>;

export interface SubscriptionRequest {
  id: string;
  userId: string;
  username: string;
  storeName: string;
  storeCategory: StoreCategory;
  ownerName: string;
  package: SubscriptionPackage;
  amount: number;
  paymentNumber: string;
  trxId: string;
  status: 'pending' | 'approved' | 'rejected';
  date: string;
}

export interface User {
  id: string;
  /** Per-store Smart QR handle (random code, not the internal id). Absent for legacy stores until backfilled. */
  storeCode?: string | null;
  storeName: string;
  storeCategory: StoreCategory;
  username: string;
  pin: string;
  address?: string;
  phone?: string;
  // Location Fields
  zila?: string;
  upozila?: string;
  thana?: string;

  plan: PlanType;
  defaultVatRate?: number;
  subscriptionExpiry?: string;
  subscriptionStatus?: 'active' | 'expired' | 'pending_approval';
  profilePicture?: string; // Base64
  // Security Fields
  failedLoginAttempts?: number;
  isLocked?: boolean;
  lockedUntil?: string | Date | null;
  isPlatformAdmin?: boolean;
}

// --- RBAC & Inventory History Types ---

export type Permission =
  | 'manage_inventory'
  | 'view_reports'
  | 'manage_settings'
  | 'manage_staff'
  | 'process_sale'
  | 'manage_expenses'
  | 'manage_restaurant';

export interface Staff {
  id: string;
  ownerId: string;
  name: string;
  username: string;
  pin: string;
  permissions: Permission[];
}

export interface InventoryLog {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  type: 'in' | 'out' | 'adjustment' | 'sale';
  quantity: number;
  reason: string;
  actorId?: string;
  date: string;
}

export interface PaymentSettings {
  key: string;
  bkash: string;
  nagad: string;
}

export interface PricingSetting {
  key: string;
  value: GlobalPricingConfig;
}

// New: Global Config for Logo/Chat
export interface GlobalConfig {
  logo?: string; // Base64
  whatsappNumber?: string;
}

export interface GlobalConfigSetting {
  key: string;
  value: GlobalConfig;
}

export type SystemSetting = PaymentSettings | PricingSetting | GlobalConfigSetting;

// New: Announcement System
export interface Announcement {
  id: string;
  title: string;
  message: string;
  target: 'all' | string[]; // 'all' or array of store IDs
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt: string;
}

// --- Marketplace: Customer & Online Delivery Orders ---

export interface Customer {
  id: string;
  name: string;
  phone: string;
  pin: string;
  address?: string;
  createdAt?: string;
}

export type DeliveryStatus = 'placed' | 'confirmed' | 'out_for_delivery' | 'delivered' | 'cancelled';

export interface OnlineOrder {
  id: string;
  customerId: string;
  storeId: string;
  storeName?: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  items: CartItem[];
  subTotal: number;
  deliveryFee: number;
  totalAmount: number;
  paymentMethod: string;
  status: DeliveryStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreDirectoryEntry {
  id: string;
  storeName: string;
  storeCategory: StoreCategory;
  address?: string;
  phone?: string;
  zila?: string;
  upozila?: string;
  thana?: string;
  profilePicture?: string;
  productCount?: number;
}

export type Language = 'en' | 'bn';

export interface Translation {
  dashboard: string;
  pos: string;
  inventory: string;
  settings: string;
  expenses: string;
  totalSales: string;
  netProfit: string;
  totalOrders: string;
  totalExpenses: string;
  lowStock: string;
  addToCart: string;
  searchPlaceholder: string;
  checkout: string;
  print: string;
  close: string;
  invoiceTitle: string;
  item: string;
  qty: string;
  price: string;
  total: string;
  subTotal: string;
  discount: string;
  thankYou: string;
  stockLevel: string;
  cost: string;
  actions: string;
  addProduct: string;
  addExpense: string;
  save: string;
  cancel: string;
  confirmDelete: string;
  unit: string;
  customerName: string;
  customerPhone: string;
  paidAmount: string;
  dueAmount: string;
  changeAmount: string;
  totalDue: string;
  dueList: string;
  date: string;
  purchasedItems: string;
  noDueFound: string;
  view: string;
  login: string;
  register: string;
  storeName: string;
  username: string;
  pin: string;
  logout: string;
  downloadReport: string;
  description: string;
  amount: string;
  // Profile
  profile: string;
  storeAddress: string;
  storePhone: string;
  updateProfile: string;
  profileUpdated: string;
  download: string;
  // Subscription
  premium: string;
  freePlan: string;
  upgradeToPremium: string;
  limitReached: string;
  premiumFeature: string;
  upgradeDesc: string;
  unlimited: string;
  subscribeNow: string;
  planFeatures: string;
  submitRequest: string;
  pendingApproval: string;
  // New
  cashInHand: string;
  digitalSales: string;
  paymentMethod: string;
  // Profile Subscription
  currentPlan: string;
  expiresOn: string;
  daysLeft: string;
  renewPlan: string;
  status: string;
  active: string;
  expired: string;
  // Categories & Fields
  storeCategory: string;
  catGrocery: string;
  catMedicine: string;
  catClothing: string;
  catElectronics: string;
  catRestaurant: string;
  expiryDate: string;
  batchNo: string;
  color: string;
  size: string;
  warranty: string;
  // New
  barcode: string;
  supplier: string;
  style: string;
  vat: string;
  vatRate: string;
  genericName: string;
  brand: string;
  serialNumber: string;
  // Restaurant
  tables: string;
  kitchen: string;
  guestMenu: string;
  orderStatus: string;
  dietaryType: string;
  prepTime: string;
  veg: string;
  nonVeg: string;
  placeOrder: string;
  notes: string;
  // Daily Report
  dailyReport: string;
  cashFlow: string;
  incomeBreakdown: string;
  expenseBreakdown: string;
  netCash: string;
  totalIncome: string;
  printReport: string;
  // RBAC & Reporting
  staffManagement: string;
  addStaff: string;
  permissions: string;
  inventoryLogs: string;
  salesAnalysis: string;
  hourlySales: string;
  topProducts: string;
  // Inventory Alert / Intelligence
  inventoryAlerts: string;
  highDemand: string;
  stagnantStock: string;
  stockValue: string;
  reorderPoint: string;
  criticalStock: string;
  moneyMakers: string;
  // Advanced Reporting
  avgBasketValue: string;
  profitMargin: string;
  cogs: string;
  peakHour: string;
  largestSale: string;
  storeHealth: string;
  vsYesterday: string;
  performance: string;
  totalQuantity: string;
  // Phase 3 (Depth)
  depthPanel: string;
  forecast: string;
  forecastBasis: string;
  expiryAlerts: string;
  deadStock: string;
  suppliers: string;
  purchaseOrders: string;
  branches: string;
  counters: string;
  loyalty: string;
  coupons: string;
  voicePos: string;
  accountantExports: string;
  supplierDues: string;
  goodsReceived: string;
  zReportPerCounter: string;
  speakTotal: string;
  voiceInput: string;
  voiceUnsupported: string;
  suggestedOrder: string;
  createDraftOrder: string;
  invSearchPlaceholder: string;
  invClearSearch: string;
  invItemsShown: string;
  invLowInView: string;
  invLowStockToggle: string;
  invShowAll: string;
  invLowStockTitle: string;
  invSelectAllShown: string;
  invDeselectShown: string;
  invClearSelection: string;
  invBulkSelected: string;
  invSelectedHidden: string;
  invAdjustStock: string;
  invAdjustStockPreview: string;
  invSetPrice: string;
  invSetPricePreview: string;
  invDeleteSelected: string;
  invDeleteSelectedPreview: string;
  invBulkNeedSelection: string;
  invBulkDeltaInvalid: string;
  invBulkPriceInvalid: string;
  invBulkDeleteConfirm: string;
  invBulkFailed: string;
  invStockMinus: string;
  invStockPlus: string;
  invSaveAddAnother: string;
  invAddFromBarcode: string;
  invNoMatch: string;
  invNoLowInSearch: string;
  invNoLowStock: string;
  invNoProducts: string;
  // --- ADDITIONAL SCOPE (manual-add efficiency, voice-to-add, About) ---
  invSmartDefaultsHint: string;
  invAddSimilar: string;
  invVoiceAddOpen: string;
  invFormErrorName: string;
  invFormErrorPrice: string;
  invFormErrorCost: string;
  invFormErrorStock: string;
  invFormErrorBarcode: string;
  invFormErrorExpiry: string;
  invFormErrorSummary: string;
  voiceAddTitle: string;
  voiceAddHint: string;
  voiceAddTypedPlaceholder: string;
  voiceAddTypedSubmit: string;
  voiceAddStepName: string;
  voiceAddStepPrice: string;
  voiceAddStepStock: string;
  voiceAddStepCategory: string;
  voiceAddSpeak: string;
  voiceAddListening: string;
  voiceAddNext: string;
  voiceAddBack: string;
  voiceAddToConfirmation: string;
  voiceAddConfirmTitle: string;
  voiceAddConfirmHint: string;
  voiceAddSave: string;
  voiceAddCancel: string;
  voiceAddSaved: string;
  voiceAddUnclear: string;
  voiceAddMicFallback: string;
  voiceAddFieldName: string;
  voiceAddFieldPrice: string;
  voiceAddFieldCost: string;
  voiceAddFieldStock: string;
  voiceAddFieldUnit: string;
  voiceAddFieldCategory: string;
  voiceAddFieldBarcode: string;
  voiceAddMissing: string;
  voiceAddAddAnother: string;
  aboutTitle: string;
  aboutWhatTitle: string;
  aboutWhatBody: string;
  aboutTourTitle: string;
  aboutTourIntro: string;
  aboutTourPosTitle: string;
  aboutTourPosDesc: string;
  aboutTourInventoryTitle: string;
  aboutTourInventoryDesc: string;
  aboutTourDashboardTitle: string;
  aboutTourDashboardDesc: string;
  aboutTourOrdersTitle: string;
  aboutTourOrdersDesc: string;
  aboutTourSettingsTitle: string;
  aboutTourSettingsDesc: string;
  aboutSpecTitle: string;
  aboutFeaturesTitle: string;
  aboutFeaturesBody: string;
  aboutVersion: string;
  aboutRequirementsTitle: string;
  aboutRequirementsBody: string;
  aboutSyncTitle: string;
  aboutSyncBody: string;
  aboutSupportTitle: string;
  aboutSupportBody: string;
  settingsLanguage: string;
  settingsTheme: string;
  settingsThemeLight: string;
  settingsThemeDark: string;
  settingsThemeHighContrast: string;
  settingsFontSize: string;
  settingsFontSmall: string;
  settingsFontNormal: string;
  settingsFontLarge: string;
  settingsFontXLarge: string;
  settingsVoiceConfirm: string;
  settingsSoundConfirm: string;
  settingsSyncStatus: string;
  settingsSyncOnline: string;
  settingsSyncOffline: string;
  settingsSyncPending: string;
  settingsSyncFailed: string;
  settingsProfileCustom: string;
  settingsSaved: string;
  settingsSaveFailed: string;
  settingsProfileSaved: string;
  settingsZila: string;
  settingsUpozila: string;
  settingsThana: string;
  settingsPhoto: string;
  settingsPhotoHint: string;
  // Per-store Smart QR + storefront + native server address.
  storeQrTitle: string;
  storeQrHint: string;
  storeQrCopy: string;
  storeQrCopied: string;
  storeQrShare: string;
  storeQrPrint: string;
  storeQrScan: string;
  storeQrScanTitle: string;
  storeQrNotStore: string;
  storeQrLoadFailed: string;
  storeQrOpenStore: string;
  storefrontNotFound: string;
  storefrontOffline: string;
  storefrontEmpty: string;
  storefrontOrder: string;
  storefrontOrderPlaced: string;
  storefrontOrderFailed: string;
  storefrontCart: string;
  storefrontPickup: string;
  storefrontTotal: string;
  storefrontTryAgain: string;
  settingsServerTitle: string;
  settingsServerHint: string;
  settingsServerPlaceholder: string;
  settingsServerSave: string;
  settingsServerReset: string;
  settingsServerSaved: string;
  settingsServerCurrent: string;
  settingsServerMissing: string;
  settingsServerTest: string;
  settingsServerReachable: string;
  settingsServerUnreachable: string;
  apiBaseNotConfigured: string;
  apiBackendUnreachable: string;
  branchTitle: string;
  branchAdd: string;
  branchName: string;
  branchAddress: string;
  branchDelete: string;
  branchDeleteConfirm: string;
  branchDeleteBlocked: string;
  branchEmpty: string;
  branchDefault: string;
  branchCreated: string;
  branchDeleted: string;
  branchLoadFailed: string;
  branchDeleteFailed: string;
  dashboardTotalsUnavailable: string;
  dashboardOnlineDelivered: string;
  dashboardOnlinePending: string;
  dashboardOnlineCancelled: string;
  micRetry: string;
  micDeniedNote: string;
  // Native Android permission system (services/permissions.ts).
  // Rationale shown in-app before a first-use prompt; settings
  // guidance shown on permanent denial. Photos has a rationale but
  // no settings guidance: the system picker needs no permission.
  permRationaleCamera: string;
  permRationaleMicrophone: string;
  permRationaleBluetooth: string;
  permRationalePhotos: string;
  permSettingsCamera: string;
  permSettingsMicrophone: string;
  permSettingsBluetooth: string;
  permOpenSettings: string;
  permTitle: string;
  permGranted: string;
  permNotGranted: string;
  // DISTINCTIVE FEATURES (2026-10-29) — morning briefing, bazar list,
  // credit score, speaker mode, price stickers. Both locales below.
  briefingTitle: string;
  briefingSubtitle: string;
  briefingYesterdayProfit: string;
  briefingOrderToday: string;
  briefingExpiringSoon: string;
  briefingDuesToCollect: string;
  briefingLowStock: string;
  briefingNoDueDateNote: string;
  briefingDataUnavailable: string;
  bazarListTitle: string;
  bazarListEmpty: string;
  bazarQty: string;
  bazarEstCost: string;
  bazarPrint: string;
  bazarShare: string;
  bazarCopied: string;
  bazarShareNote: string;
  creditScoreLabel: string;
  creditScoreGood: string;
  creditScoreFair: string;
  creditScoreCaution: string;
  creditScoreNoHistory: string;
  creditScoreAgeingNote: string;
  speakTotalLabel: string;
  speakerOffNote: string;
}

export interface PaymentIntent {
  id: string;
  storeId: string;
  orderType: 'sale' | 'restaurant' | 'marketplace' | 'subscription';
  orderId: string;
  method: 'cash' | 'bkash' | 'nagad' | 'card' | 'split';
  amount: number;
  paidAmount: number;
  changeAmount: number;
  status: 'pending' | 'authorized' | 'captured' | 'refunded' | 'voided';
  gatewayTrxId?: string | null;
  voidReason?: string | null;
  details?: any;
  createdAt: string;
  updatedAt: string;
}

// --- Phase 3 (Depth) ---
export interface Branch {
  id: string;
  storeId: string;
  name: string;
  address?: string | null;
  isDefault?: boolean;
  createdAt?: string;
}

export interface Counter {
  id: string;
  storeId: string;
  branchId: string;
  name: string;
  createdAt?: string;
}

export interface Supplier {
  id: string;
  storeId: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  totalDue: number;
  createdAt?: string;
}

export interface PurchaseOrderItem {
  productId: string;
  productName?: string;
  quantity: number;
  cost: number;
  receivedQty?: number;
}

export interface PurchaseOrder {
  id: string;
  storeId: string;
  supplierId: string;
  branchId?: string | null;
  status: 'draft' | 'partial' | 'received' | 'cancelled';
  items: PurchaseOrderItem[];
  totalCost: number;
  createdAt?: string;
  receivedAt?: string | null;
}

export interface Coupon {
  id: string;
  storeId: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  minPurchase: number;
  maxUses: number;
  usedCount: number;
  expiresAt?: string | null;
  active: boolean;
}

export interface LoyaltyAccount {
  phone: string;
  storeId: string;
  name?: string | null;
  points: number;
}

export interface Shift {
  id: string;
  storeId: string;
  branchId?: string | null;
  counterId?: string | null;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  closedAt?: string | null;
  openingCash: number;
  totalCashSales: number;
  totalDigitalSales: number;
  totalExpenses: number;
  expectedCash: number;
  actualCash?: number | null;
  discrepancy: number;
  status: 'open' | 'closed';
  notes?: string | null;
}

export interface SyncItem {
  id: string;
  sale: any;
  queuedAt: string;
  status: 'pending' | 'synced' | 'failed';
  retryCount: number;
  error?: string;
}
