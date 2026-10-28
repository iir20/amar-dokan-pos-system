// Phase 5 — WCAG contrast math (pure, unit-tested).
// No claim of "accessible" is made without a number: every token pair
// below is checked in tests/phase5.test.ts against the 4.5:1 bar for
// normal text (3:1 for large text / UI accents).

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio, rounded to 2 decimals. */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export const CONTRAST_NORMAL_TEXT = 4.5;
export const CONTRAST_LARGE_TEXT = 3;

export function passesNormalText(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= CONTRAST_NORMAL_TEXT;
}
