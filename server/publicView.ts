// Phase 4 — public views of products and guest orders.
//
// FINDING: the public marketplace/menu endpoints and the unauthenticated
// guest-order endpoints returned the full product record, including
// `cost` (the store's purchase price — commercially sensitive). Any
// unauthenticated visitor could read every store's margins. These views
// strip cost and other internal fields at the API boundary. Internal
// owner/staff routes keep returning the full record (they need cost for
// profit math), and the stored guest-order record is unchanged (the
// settlement path needs cost for profit); only the public responses
// are stripped.
const STRIPPED_PRODUCT_FIELDS = new Set(['cost']);

export function publicProductView(product: any): any {
  if (!product || typeof product !== 'object') return product;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(product)) {
    if (!STRIPPED_PRODUCT_FIELDS.has(key)) out[key] = value;
  }
  return out;
}

export function publicProductList(products: any[]): any[] {
  return (Array.isArray(products) ? products : []).map(publicProductView);
}

export function publicGuestOrderView(order: any): any {
  if (!order || typeof order !== 'object') return order;
  const items = Array.isArray(order.items) ? order.items.map(publicProductView) : order.items;
  return { ...order, items };
}

// Per-store Smart QR storefront view. ONLY these fields may leave the
// server for an unauthenticated storefront visitor: the store's public
// name, category, contact/location display fields and photo. NEVER
// included: the internal owner id, username, PIN, plan/subscription,
// security fields (failed logins, locks), staff, dues, costs, sales
// totals, or any other store's data. The storeCode itself is included
// because it IS the public handle printed on the QR.
export function publicStoreView(user: any): any {
  if (!user || typeof user !== 'object') return null;
  return {
    storeCode: user.storeCode ?? null,
    storeName: user.storeName ?? null,
    storeCategory: user.storeCategory ?? null,
    address: user.address ?? null,
    phone: user.phone ?? null,
    zila: user.zila ?? null,
    upozila: user.upozila ?? null,
    thana: user.thana ?? null,
    profilePicture: user.profilePicture ?? null,
  };
}
