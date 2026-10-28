// Phase 5 — theme + font-scale state. Persisted in localStorage, applied
// as data attributes on <html> so index.css variables follow. The POS
// legacy keys (pos_high_contrast / pos_large_font) are honoured once and
// migrated, so existing shopkeepers keep their settings.

import type { ThemeName } from '../design/tokens';

export type FontScaleName = 'small' | 'normal' | 'large' | 'xlarge';

export const FONT_SCALES: Record<FontScaleName, number> = {
  small: 14,
  normal: 16,
  large: 18,
  xlarge: 20,
};

const THEME_KEY = 'amar-theme';
const FONT_KEY = 'amar-font-scale';

export function getTheme(): ThemeName {
  if (typeof window === 'undefined') return 'light';
  const raw = window.localStorage.getItem(THEME_KEY);
  if (raw === 'dark' || raw === 'high-contrast' || raw === 'light') return raw;
  // One-time migration of the old POS-only high-contrast toggle.
  if (window.localStorage.getItem('pos_high_contrast') === 'true') return 'high-contrast';
  return 'light';
}

export function getFontScale(): FontScaleName {
  if (typeof window === 'undefined') return 'normal';
  const raw = window.localStorage.getItem(FONT_KEY);
  if (raw === 'small' || raw === 'normal' || raw === 'large' || raw === 'xlarge') return raw;
  if (window.localStorage.getItem('pos_large_font') === 'true') return 'large';
  return 'normal';
}

export function applyTheme(theme: ThemeName, scale: FontScaleName): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.fontScale = scale;
  document.documentElement.style.fontSize = `${FONT_SCALES[scale]}px`;
}

export function setTheme(theme: ThemeName): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme, getFontScale());
}

export function setFontScale(scale: FontScaleName): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(FONT_KEY, scale);
  applyTheme(getTheme(), scale);
}

/** Cycle normal -> large -> xlarge -> small -> normal (A+ button). */
export function nextFontScale(current: FontScaleName): FontScaleName {
  const order: FontScaleName[] = ['normal', 'large', 'xlarge', 'small'];
  return order[(order.indexOf(current) + 1) % order.length];
}
