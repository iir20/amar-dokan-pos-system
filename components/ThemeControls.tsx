// Phase 5 — theme + font-scale controls. Persisted via services/theme;
// the toggle lives in the App top bar so it works on EVERY authenticated
// screen, not only on POS.
import React, { useState } from 'react';
import { getTheme, setTheme, getFontScale, setFontScale, nextFontScale, type FontScaleName } from '../services/theme';
import type { ThemeName } from '../design/tokens';
import type { Language } from '../types';

const ThemeControls: React.FC<{ lang: Language }> = ({ lang }) => {
  const [theme, setThemeState] = useState<ThemeName>(() => getTheme());
  const [scale, setScaleState] = useState<FontScaleName>(() => getFontScale());

  const cycleTheme = () => {
    const order: ThemeName[] = ['light', 'dark', 'high-contrast'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    setThemeState(next);
  };

  const bumpScale = () => {
    const next = nextFontScale(scale);
    setFontScale(next);
    setScaleState(next);
  };

  const themeLabel = theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '◐';
  return (
    <div className="flex items-center gap-1">
      <button
        data-testid="theme-toggle"
        onClick={cycleTheme}
        aria-label={
          lang === 'bn'
            ? `থিম বদলান, বর্তমান: ${theme === 'light' ? 'আলো' : theme === 'dark' ? 'অন্ধকার' : 'হাই কনট্রাস্ট'}`
            : `Change theme, current: ${theme}`
        }
        title={lang === 'bn' ? 'থিম: আলো / অন্ধকার / হাই কনট্রাস্ট' : 'Theme: light / dark / high-contrast'}
        className="ad-tap flex items-center justify-center px-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-bold"
      >
        {themeLabel}
      </button>
      <button
        data-testid="font-scale-toggle"
        onClick={bumpScale}
        aria-label={lang === 'bn' ? `লেখার সাইজ বদলান, বর্তমান: ${scale}` : `Change text size, current: ${scale}`}
        title={lang === 'bn' ? 'লেখার সাইজ' : 'Text size'}
        className="ad-tap flex items-center justify-center px-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-bold"
      >
        A{scale === 'xlarge' ? '++' : scale === 'large' ? '+' : scale === 'small' ? '−' : ''}
      </button>
    </div>
  );
};

export default ThemeControls;
