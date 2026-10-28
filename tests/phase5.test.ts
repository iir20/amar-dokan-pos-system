// Phase 5 — design tokens (contrast), decision cards, receipt preview.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, passesNormalText, CONTRAST_NORMAL_TEXT } from '../utils/contrast';
import { TOKENS, TOKEN_PAIRS } from '../design/tokens';
import { computeDecisionCards, buildReceiptPreviewLines } from '../shared/phase5';

describe('phase5 contrast: every token text-on-background pair passes WCAG normal text', () => {
  for (const pair of TOKEN_PAIRS) {
    it(`${pair.theme} / ${pair.label} >= ${CONTRAST_NORMAL_TEXT}:1`, () => {
      const t = TOKENS[pair.theme];
      const ratio = contrastRatio(t[pair.fg], t[pair.bg]);
      assert.ok(passesNormalText(t[pair.fg], t[pair.bg]), `${pair.theme} ${pair.label}: ${ratio}:1`);
      assert.ok(ratio >= CONTRAST_NORMAL_TEXT, String(ratio));
    });
  }
  it('sanity: black on white is 21:1, white on emerald-700 passes', () => {
    assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
    assert.ok(contrastRatio('#FFFFFF', '#047857') >= 4.5);
  });
});

describe('phase5 decision cards: real numbers only, from the inputs given', () => {
  it('derives order qty, expiring count, top profit, dues from real data', () => {
    const cards = computeDecisionCards({
      sales: [
        {
          totalAmount: 500,
          dueAmount: 200,
          items: [{ id: 'p1', name: 'Rice', price: 100, cost: 60, quantity: 2 }],
        },
        {
          totalAmount: 300,
          dueAmount: 0,
          items: [{ id: 'p2', name: 'Oil', price: 300, cost: 290, quantity: 1 }],
        },
      ],
      forecastItems: [
        { productName: 'Rice', suggestedQty: 5 },
        { productName: 'Oil', suggestedQty: 0 },
      ],
      expiryAlerts: [{ severity: 'critical' }, { severity: 'watch' }],
    });
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    assert.equal(byId['order-today'].value, 5);
    assert.equal(byId['order-today'].targetView, 'phase3');
    assert.equal(byId['expiring-soon'].value, 2);
    assert.equal(byId['top-profit'].value, 80);
    assert.match(byId['top-profit'].detail, /Rice/);
    assert.equal(byId['top-profit'].targetView, 'inventory');
    assert.equal(byId['dues-to-collect'].value, 200);
    assert.equal(byId['dues-to-collect'].targetView, 'dueList');
  });
  it('empty data yields zeros with honest detail, never invented numbers', () => {
    const cards = computeDecisionCards({ sales: [], forecastItems: [], expiryAlerts: [] });
    assert.deepEqual(
      cards.map((c) => c.value),
      [0, 0, 0, 0],
    );
    assert.match(cards[2].detail, /No sales yet/);
  });
});

describe('phase5 receipt preview: exactly the fields Invoice prints', () => {
  it('lists items, subtotal, discount, VAT, total, paid, change', () => {
    const lines = buildReceiptPreviewLines({
      items: [{ name: 'Rice', quantity: 2, unit: 'kg', price: 100 }],
      subTotal: 200,
      discount: 10,
      vat: 0,
      totalAmount: 190,
      paidAmount: 200,
      changeAmount: 10,
      dueAmount: 0,
      paymentMethod: 'cash',
    });
    const text = lines.join('\n');
    assert.match(text, /Rice — 2 kg x ৳100\.00 = ৳200\.00/);
    assert.match(text, /Subtotal: ৳200\.00/);
    assert.match(text, /Discount: -৳10\.00/);
    assert.match(text, /TOTAL: ৳190\.00/);
    assert.match(text, /Paid \(cash\): ৳200\.00/);
    assert.match(text, /Change: ৳10\.00/);
    assert.doesNotMatch(text, /Due:/);
  });
});
