// Phase 5 — Design tokens: the single source of truth for color.
// CSS variables in index.css carry the same values into the stylesheet;
// this file is what tests measure (see tests/phase5.test.ts) and what
// components import when they need a token value in code.
//
// Every text-on-background pair listed in TOKEN_PAIRS must pass WCAG
// normal-text contrast (>= 4.5:1). If you change a token, the unit test
// fails until the pair passes again — fix the token, never the test.

export type ThemeName = 'light' | 'dark' | 'high-contrast';

export interface ThemeTokens {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  primaryBg: string;
  primaryText: string;
  dangerBg: string;
  dangerText: string;
  successBg: string;
  successText: string;
  warningBg: string;
  warningText: string;
}

export const TOKENS: Record<ThemeName, ThemeTokens> = {
  light: {
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceAlt: '#F1F5F9',
    text: '#111827',
    textMuted: '#4B5563',
    border: '#E5E7EB',
    primaryBg: '#047857',
    primaryText: '#FFFFFF',
    dangerBg: '#B91C1C',
    dangerText: '#FFFFFF',
    successBg: '#047857',
    successText: '#FFFFFF',
    warningBg: '#92400E',
    warningText: '#FFFFFF',
  },
  dark: {
    bg: '#0F172A',
    surface: '#1E293B',
    surfaceAlt: '#334155',
    text: '#F8FAFC',
    textMuted: '#CBD5E1',
    border: '#334155',
    primaryBg: '#34D399',
    primaryText: '#052E16',
    dangerBg: '#FCA5A5',
    dangerText: '#450A0A',
    successBg: '#34D399',
    successText: '#052E16',
    warningBg: '#FCD34D',
    warningText: '#451A03',
  },
  'high-contrast': {
    bg: '#000000',
    surface: '#000000',
    surfaceAlt: '#111111',
    text: '#FFFFFF',
    textMuted: '#FFFF00',
    border: '#FFFFFF',
    primaryBg: '#FFFF00',
    primaryText: '#000000',
    dangerBg: '#B91C1C',
    dangerText: '#FFFFFF',
    successBg: '#00FF00',
    successText: '#000000',
    warningBg: '#FFFF00',
    warningText: '#000000',
  },
};

/** Text-on-background pairs that must all pass normal-text contrast. */
export const TOKEN_PAIRS: Array<{ theme: ThemeName; label: string; fg: keyof ThemeTokens; bg: keyof ThemeTokens }> = (
  ['light', 'dark', 'high-contrast'] as ThemeName[]
).flatMap((theme) => [
  { theme, label: 'body text on bg', fg: 'text' as const, bg: 'bg' as const },
  { theme, label: 'body text on surface', fg: 'text' as const, bg: 'surface' as const },
  { theme, label: 'muted text on surface', fg: 'textMuted' as const, bg: 'surface' as const },
  { theme, label: 'muted text on bg', fg: 'textMuted' as const, bg: 'bg' as const },
  { theme, label: 'primary button text', fg: 'primaryText' as const, bg: 'primaryBg' as const },
  { theme, label: 'danger button text', fg: 'dangerText' as const, bg: 'dangerBg' as const },
  { theme, label: 'success button text', fg: 'successText' as const, bg: 'successBg' as const },
  { theme, label: 'warning button text', fg: 'warningText' as const, bg: 'warningBg' as const },
]);

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const RADII = { sm: 8, md: 12, lg: 16, full: 9999 } as const;
/** Primary actions must be at least this tall (tap-target rule). */
export const MIN_TAP_PX = 48;
