import { useEffect } from 'react';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Turns the setting ('system' | 'light' | 'dark') into the theme to show ('light' | 'dark'). */
export function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Puts the theme on <html data-theme="...">, which switches the CSS variables in styles.css.
 * With 'system', also follows the device if it changes while the page is open
 * (e.g. a phone switching to dark mode at sunset).
 *
 * index.html runs the same logic in a tiny script before React loads, so the first paint
 * already has the right colors; this hook keeps it up to date afterwards.
 */
export function useApplyTheme(theme) {
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme);
    };
    apply();
    if (theme !== 'system') return undefined;
    const media = window.matchMedia(DARK_QUERY);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
