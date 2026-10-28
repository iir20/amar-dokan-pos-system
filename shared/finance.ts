export type PaymentMethod = 'cash' | 'bkash' | 'nagad' | 'card';

export interface FinancialLineInput {
  id: string;
  price: number;
  cost: number;
  quantity: number;
}

export interface SaleTotals {
  subTotal: number;
  discount: number;
  taxableAmount: number;
  vat: number;
  totalAmount: number;
  totalProfit: number;
  amountReceived: number;
  paidAmount: number;
  cashReceived: number;
  dueAmount: number;
  changeAmount: number;
}

const MONEY_SCALE = 100;
const QUANTITY_SCALE = 1_000_000;
const MAX_AMOUNT_MINOR = 100_000_000_000; // ৳1,000,000,000
const MAX_QUANTITY_UNITS = 1_000_000_000_000; // 1,000,000 units at six decimal places

function fail(field: string, reason: string): never {
  throw new Error(`INVALID_${field.toUpperCase()}:${reason}`);
}

export function moneyToMinor(value: number, field = 'amount'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fail(field, 'must be a finite, non-negative amount');
  }

  const minor = Math.round((value + Number.EPSILON) * MONEY_SCALE);
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) {
    return fail(field, 'is outside the supported range');
  }
  return minor;
}

export function parseMoneyInput(value: string, field = 'amount'): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return fail(field, 'must be a non-negative amount with at most two decimal places');
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return fail(field, 'must be finite');
  return amount;
}

export function quantityToUnits(value: number, field = 'quantity'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fail(field, 'must be finite and greater than zero');
  }
  const units = Math.round(value * QUANTITY_SCALE);
  if (
    !Number.isSafeInteger(units) ||
    units > MAX_QUANTITY_UNITS ||
    Math.abs(value - units / QUANTITY_SCALE) > 1e-9
  ) {
    return fail(field, 'is outside the supported range or precision');
  }
  return units;
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function minorToMoney(value: number): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_AMOUNT_MINOR) {
    return fail('total', 'is outside the supported range');
  }
  return value / MONEY_SCALE;
}

export function calculateSaleTotals(
  items: FinancialLineInput[],
  discountValue: number,
  vatRateValue: number,
  amountReceivedValue: number | null | undefined,
  paymentMethod: PaymentMethod,
): SaleTotals {
  if (!Array.isArray(items) || items.length === 0) {
    return fail('items', 'at least one sale item is required');
  }
  if (!['cash', 'bkash', 'nagad', 'card'].includes(paymentMethod)) {
    return fail('payment_method', 'is not supported');
  }

  const discountMinor = moneyToMinor(discountValue, 'discount');
  const vatRateMinorPercent = moneyToMinor(vatRateValue, 'vat_rate');
  if (vatRateMinorPercent > 10_000) {
    return fail('vat_rate', 'cannot exceed 100 percent');
  }

  const seenIds = new Set<string>();
  let subtotalMinor = 0n;
  let costMinor = 0n;

  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) {
      return fail('product_id', 'is required');
    }
    if (seenIds.has(item.id)) {
      return fail('items', 'duplicate product lines are not allowed');
    }
    seenIds.add(item.id);

    const priceMinor = moneyToMinor(item.price, 'price');
    const cost = moneyToMinor(item.cost, 'cost');
    const quantityUnits = quantityToUnits(item.quantity);
    const divisor = BigInt(QUANTITY_SCALE);
    subtotalMinor += roundRatio(BigInt(priceMinor) * BigInt(quantityUnits), divisor);
    costMinor += roundRatio(BigInt(cost) * BigInt(quantityUnits), divisor);
  }

  if (subtotalMinor > BigInt(MAX_AMOUNT_MINOR) || costMinor > BigInt(MAX_AMOUNT_MINOR)) {
    return fail('total', 'is outside the supported range');
  }
  const subtotal = Number(subtotalMinor);
  if (discountMinor > subtotal) {
    return fail('discount', 'cannot exceed the subtotal');
  }

  const taxableMinor = subtotal - discountMinor;
  // VAT is rounded half-up to the nearest paisa. Rate is expressed in 1/100
  // percentage points: 15.00% becomes 1500 and is divided by 100 * 100.
  const vatMinor = Number(roundRatio(
    BigInt(taxableMinor) * BigInt(vatRateMinorPercent),
    10_000n,
  ));
  const totalMinor = taxableMinor + vatMinor;
  if (totalMinor > MAX_AMOUNT_MINOR) return fail('total', 'is outside the supported range');

  const receivedMinor = amountReceivedValue == null
    ? totalMinor
    : moneyToMinor(amountReceivedValue, 'payment');
  if (paymentMethod !== 'cash' && receivedMinor > totalMinor) {
    return fail('payment', 'non-cash payments cannot exceed the invoice total');
  }

  const appliedMinor = Math.min(receivedMinor, totalMinor);
  const changeMinor = paymentMethod === 'cash' ? receivedMinor - appliedMinor : 0;
  const profitMinor = subtotal - discountMinor - Number(costMinor);

  return {
    subTotal: minorToMoney(subtotal),
    discount: minorToMoney(discountMinor),
    taxableAmount: minorToMoney(taxableMinor),
    vat: minorToMoney(vatMinor),
    totalAmount: minorToMoney(totalMinor),
    totalProfit: minorToMoney(profitMinor),
    amountReceived: minorToMoney(receivedMinor),
    paidAmount: minorToMoney(appliedMinor),
    cashReceived: paymentMethod === 'cash' ? minorToMoney(receivedMinor) : 0,
    dueAmount: minorToMoney(totalMinor - appliedMinor),
    changeAmount: minorToMoney(changeMinor),
  };
}
