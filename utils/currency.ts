
/**
 * Utility for safe financial calculations.
 * JavaScript numbers are floating point and prone to precision errors (0.1 + 0.2 !== 0.3).
 * We solve this by converting everything to integers (paisa/cents) for calculation, 
 * and converting back to float only for display.
 */

// Convert 10.50 -> 1050
export const toCents = (amount: number): number => {
  return Math.round(amount * 100);
};

// Convert 1050 -> 10.50
export const fromCents = (cents: number): number => {
  return cents / 100;
};

// Safe Addition
export const addMoney = (a: number, b: number): number => {
  return fromCents(toCents(a) + toCents(b));
};

// Safe Subtraction
export const subMoney = (a: number, b: number): number => {
  return fromCents(toCents(a) - toCents(b));
};

// Safe Multiplication (Price * Qty)
export const mulMoney = (amount: number, multiplier: number): number => {
  return fromCents(Math.round(toCents(amount) * multiplier));
};

// Safe Division
export const divMoney = (amount: number, divisor: number): number => {
  if (divisor === 0) return 0;
  return fromCents(Math.round(toCents(amount) / divisor));
};

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-BD', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};
