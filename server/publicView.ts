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
