import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSaleTotals, parseMoneyInput } from '../shared/finance';

const line = (price: number, cost: number, quantity = 1) => [
  { id: 'product-1', price, cost, quantity },
];

test('calculates integer-paisa totals and rounds fractional quantities consistently', () => {
  const totals = calculateSaleTotals(line(10.1, 4.05, 0.3333), 0, 0, null, 'cash');
  assert.equal(totals.subTotal, 3.37);
  assert.equal(totals.totalAmount, 3.37);
  assert.equal(totals.totalProfit, 2.02);
});

test('applies invoice discount before VAT and computes profit after discount', () => {
  const totals = calculateSaleTotals(line(100, 60, 2), 10, 15, 100, 'cash');
  assert.equal(totals.subTotal, 200);
  assert.equal(totals.taxableAmount, 190);
  assert.equal(totals.vat, 28.5);
  assert.equal(totals.totalAmount, 218.5);
  assert.equal(totals.totalProfit, 70);
  assert.equal(totals.dueAmount, 118.5);
});

test('allows a zero-value invoice without creating negative balances', () => {
  const totals = calculateSaleTotals(line(0, 0), 0, 0, 0, 'cash');
  assert.equal(totals.totalAmount, 0);
  assert.equal(totals.paidAmount, 0);
  assert.equal(totals.dueAmount, 0);
  assert.equal(totals.changeAmount, 0);
});

test('cash overpayment is recorded as received funds, applied amount, and change', () => {
  const totals = calculateSaleTotals(line(50, 20), 0, 0, 60, 'cash');
  assert.equal(totals.cashReceived, 60);
  assert.equal(totals.paidAmount, 50);
  assert.equal(totals.changeAmount, 10);
  assert.equal(totals.dueAmount, 0);
});

test('rejects overpayment for non-cash methods', () => {
  assert.throws(
    () => calculateSaleTotals(line(50, 20), 0, 0, 60, 'bkash'),
    /INVALID_PAYMENT:/,
  );
});

test('rejects non-finite, negative, excessive, or malformed monetary inputs', () => {
  assert.throws(() => calculateSaleTotals(line(10, 2), -1, 0, 10, 'cash'), /INVALID_DISCOUNT:/);
  assert.throws(() => calculateSaleTotals(line(Number.NaN, 2), 0, 0, 10, 'cash'), /INVALID_PRICE:/);
  assert.throws(() => calculateSaleTotals(line(10, 2), 0, 0, Number.POSITIVE_INFINITY, 'cash'), /INVALID_PAYMENT:/);
  assert.throws(() => parseMoneyInput('1.234'), /INVALID_AMOUNT:/);
  assert.throws(() => parseMoneyInput('Infinity'), /INVALID_AMOUNT:/);
});

test('rejects invalid quantities, duplicate lines, excessive discounts, and VAT above 100%', () => {
  assert.throws(() => calculateSaleTotals(line(10, 2, 0), 0, 0, 10, 'cash'), /INVALID_QUANTITY:/);
  assert.throws(
    () => calculateSaleTotals([...line(10, 2), ...line(10, 2)], 0, 0, 20, 'cash'),
    /INVALID_ITEMS:/,
  );
  assert.throws(() => calculateSaleTotals(line(10, 2), 11, 0, 0, 'cash'), /INVALID_DISCOUNT:/);
  assert.throws(() => calculateSaleTotals(line(10, 2), 0, 101, 0, 'cash'), /INVALID_VAT_RATE:/);
});

test('uses half-up rounding for VAT and prevents due/change from becoming negative', () => {
  const totals = calculateSaleTotals(line(0.03, 0), 0, 50, 0.01, 'cash');
  assert.equal(totals.vat, 0.02);
  assert.equal(totals.dueAmount, 0.04);
  assert.equal(totals.changeAmount, 0);
});
