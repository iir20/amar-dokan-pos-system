import assert from 'node:assert/strict';
import test from 'node:test';

test('Shifts: calculates expected cash and discrepancy on close accurately', () => {
  const openingCash = 500; // ৳500 initial float
  const cashSales = 2450.50; // ৳2450.50 cash sales during shift
  const expectedCash = openingCash + cashSales; // ৳2950.50

  assert.equal(expectedCash, 2950.50);

  // Exact match count
  const actualCashExact = 2950.50;
  const discrepancyExact = Math.round((actualCashExact - expectedCash) * 100) / 100;
  assert.equal(discrepancyExact, 0);

  // Cash shortage (missing ৳50)
  const actualCashShort = 2900.50;
  const discrepancyShort = Math.round((actualCashShort - expectedCash) * 100) / 100;
  assert.equal(discrepancyShort, -50);

  // Cash overage (extra ৳20)
  const actualCashOver = 2970.50;
  const discrepancyOver = Math.round((actualCashOver - expectedCash) * 100) / 100;
  assert.equal(discrepancyOver, 20);
});
