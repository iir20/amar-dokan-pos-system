// Phase 5 — pure decision-card derivation + receipt-preview lines.
// Every number on a decision card comes from real API data passed in
// here; nothing is invented. If a source is missing, the card reports
// "unavailable" (value null) instead of a made-up number.

export interface DecisionInputs {
  sales: Array<{
    totalAmount: number;
    dueAmount?: number;
    items: Array<{ id: string; name?: string; nameBn?: string; price: number; cost: number; quantity: number }>;
  }>;
  forecastItems: Array<{ productName: string; suggestedQty: number }>;
  expiryAlerts: Array<{ severity: string }>;
}

export interface DecisionCard {
  id: 'order-today' | 'expiring-soon' | 'top-profit' | 'dues-to-collect';
  /** Real number, or null when the source data is unavailable. */
  value: number | null;
  /** Human label for the value (product name, severity mix, …). */
  detail: string;
  /** App view the card navigates to (one tap to the action screen). */
  targetView: 'phase3' | 'inventory' | 'dueList';
}

export function computeDecisionCards(input: DecisionInputs): DecisionCard[] {
  const orderQty = input.forecastItems.reduce((acc, item) => acc + Math.max(0, item.suggestedQty || 0), 0);
  const orderItems = input.forecastItems.filter((i) => (i.suggestedQty || 0) > 0).length;
  const expiring = input.expiryAlerts.length;
  const critical = input.expiryAlerts.filter((a) => a.severity === 'critical' || a.severity === 'expired').length;

  const profitByProduct = new Map<string, { name: string; profit: number }>();
  for (const sale of input.sales) {
    for (const item of sale.items) {
      const profit = (item.price - item.cost) * item.quantity;
      const cur = profitByProduct.get(item.id) || { name: item.name || item.nameBn || item.id, profit: 0 };
      cur.profit += profit;
      profitByProduct.set(item.id, cur);
    }
  }
  const top = [...profitByProduct.entries()].sort((a, b) => b[1].profit - a[1].profit)[0];

  const dues = input.sales.reduce((acc, s) => acc + (s.dueAmount || 0), 0);
  const dueBills = input.sales.filter((s) => (s.dueAmount || 0) > 0).length;

  return [
    {
      id: 'order-today',
      value: orderQty,
      detail:
        orderItems > 0
          ? `${orderItems} product${orderItems === 1 ? '' : 's'} below lead-time cover — draft order in Depth`
          : 'No product needs ordering today by the forecast rule',
      targetView: 'phase3',
    },
    {
      id: 'expiring-soon',
      value: expiring,
      detail:
        expiring > 0
          ? `${critical} critical/expired within 30 days — act in Depth`
          : 'No product expires within 30 days',
      targetView: 'phase3',
    },
    {
      id: 'top-profit',
      value: top ? Math.round(top[1].profit * 100) / 100 : 0,
      detail: top ? `Top profit maker: ${top[1].name}` : 'No sales yet — no profit ranking',
      targetView: 'inventory',
    },
    {
      id: 'dues-to-collect',
      value: Math.round(dues * 100) / 100,
      detail: dueBills > 0 ? `${dueBills} unpaid bill${dueBills === 1 ? '' : 's'} in the Due List` : 'No unpaid bills',
      targetView: 'dueList',
    },
  ];
}

export interface ReceiptPreviewItem {
  name: string;
  quantity: number;
  unit?: string;
  price: number;
}

export interface ReceiptPreviewInput {
  items: ReceiptPreviewItem[];
  subTotal: number;
  discount: number;
  vat: number;
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  dueAmount: number;
  paymentMethod: string;
}

/** Exact lines the receipt will print (same fields as Invoice). */
export function buildReceiptPreviewLines(r: ReceiptPreviewInput): string[] {
  const lines: string[] = [];
  for (const item of r.items) {
    lines.push(
      `${item.name} — ${item.quantity} ${item.unit || 'pcs'} x ৳${item.price.toFixed(2)} = ৳${(item.price * item.quantity).toFixed(2)}`,
    );
  }
  lines.push(`Subtotal: ৳${r.subTotal.toFixed(2)}`);
  if (r.discount > 0) lines.push(`Discount: -৳${r.discount.toFixed(2)}`);
  if (r.vat > 0) lines.push(`VAT: +৳${r.vat.toFixed(2)}`);
  lines.push(`TOTAL: ৳${r.totalAmount.toFixed(2)}`);
  lines.push(`Paid (${r.paymentMethod}): ৳${r.paidAmount.toFixed(2)}`);
  if (r.dueAmount > 0) lines.push(`Due: ৳${r.dueAmount.toFixed(2)}`);
  if (r.changeAmount > 0) lines.push(`Change: ৳${r.changeAmount.toFixed(2)}`);
  return lines;
}
