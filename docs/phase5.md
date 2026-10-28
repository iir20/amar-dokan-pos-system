# Phase 5 — Futuristic Design (delivered 2026-10-29)

## Design system

- Single source of truth: `design/tokens.ts` (colors) + CSS variables in
  `index.css` (same values). Shared components in `components/ui.tsx`
  (`AdCard`, `AdButton`, `AdInput`) are built on the tokens; POS, the
  dashboard KPI cards, and the new Phase 5 UI use them.
- Contrast is proven, not claimed: `utils/contrast.ts` computes WCAG
  ratios and `tests/phase5.test.ts` asserts all 24 token text-on-background
  pairs (light / dark / high-contrast) pass ≥ 4.5:1. Lowest measured pair:
  light primary button text, white on #047857 = 5.48:1. One token was
  fixed by the test (high-contrast danger white on pure red failed at
  ~4.0:1; it is now white on #B91C1C = 6.47:1).

## Themes + font scaling

- Themes: light / dark / high-contrast, cycled from the top-bar toggle
  (`ThemeControls`, `data-testid="theme-toggle"`), persisted in
  `localStorage` (`amar-theme`) and applied on boot. The POS contrast
  button now drives the same global theme (old `pos_high_contrast` key
  is migrated once).
- Font scale: small / normal / large / xlarge (root 14/16/18/20 px),
  persisted (`amar-font-scale`), toggled from the top bar and the POS
  A+ button. Tailwind rem utilities scale with the root size.
- Dark / high-contrast follow-through: `index.css` maps the app's common
  hardcoded utilities (`bg-white`, `bg-slate-50`, `text-gray-800`, …)
  under `data-theme` so themed screens stay readable. Print media forces
  receipts back to black-on-white.

## POS redesign for speed

- One-thumb phone layout: mobile tab switcher, favorites row, recent
  items row (last 8 added products, `amar-recent-items`), and a
  persistent totals bar on the products tab showing the total in big
  Bangla numerals (e.g. `৳১২০.০০`) with a Checkout button.
- Two-tap checkout: tap 1 (`pos-checkout`) opens the receipt-preview
  sheet (`CheckoutSheet`, `receipt-preview`); tap 2
  (`pos-confirm-checkout`) completes the sale. Sale math is unchanged —
  the server still recalculates every sale.
- Desktop cashier flow kept: F2 focuses search, F4 clears the cart,
  F8 opens the preview on first press and confirms on second (verified
  live in the sandbox, see the Phase 5 report).

## Decision cards (Dashboard)

`components/DecisionCards.tsx` + pure derivation in
`shared/phase5.ts`. Each card shows a real number from a real API and
navigates one tap to its action screen:

- Order this today → total suggested qty from the Phase 3 forecast → Depth
- Expiring soon → expiry-alert count → Depth
- Top profit makers → highest-profit product from sales → Inventory
- Dues to collect → sum of sale due amounts → Due List

Empty data shows 0 with an honest "no sales yet" style detail — never an
invented number.

## Delight + trust details

- Animated sync pill: the dot spins while syncing (`ad-sync-dot--syncing`),
  pulses while items are pending, and is solid when synced; the pill
  text is unchanged and remains the text fallback.
- Voice confirmations reuse the Phase 3 voice system (`speakBangla`):
  sale completed and sync completed speak Bangla and always show the
  same text on screen (sale notice banner, aria-live sync announcement).
- Receipt preview BEFORE printing: the checkout sheet shows exactly
  what will print (same fields as `Invoice`); the Invoice modal itself
  carries a preview note and only then offers Print / Bluetooth / PDF.
- Intentional offline mode: `OfflineState` replaces the old banner —
  "Offline mode — the shop keeps running", what still works, and the
  pending-sync count with a Review Outbox action.

## Accessibility + low-end Android pass

- Bangla-first toggle: the top-bar language toggle (`lang-toggle`) is
  global, so it works on every authenticated screen; the sidebar toggle
  is kept. Marketplace has its own toggle. Gap: the QR guest menu
  (`GuestMenu`) receives no `setLang` prop, so it has no toggle — noted
  in the Phase 5 report, not silently fixed by re-plumbing props.
- Screen-reader labels: POS search, product tiles (role=button + label
  with name/price/stock), cart quantity ± / remove, payment methods
  (`aria-pressed`), checkout, mobile tabs, theme/font/language toggles.
- Low-end pass (browser automation, not a real phone): load, tap-target,
  and overflow measurements are in the Phase 5 report. On-device checks
  (real low-end phone, Bangla voice accuracy) remain owner checklist
  items — never faked as device proof.
