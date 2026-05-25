import { useEffect, useState } from 'react';

/**
 * Theme for the end-user capture app + public signing page.
 *
 * - Auto-detects from `prefers-color-scheme` on first load.
 * - User override is persisted to localStorage and re-applied on subsequent
 *   visits (sticky across tabs / sessions).
 * - The actual value is set on <html data-theme="…"> (also done by an inline
 *   bootstrap script in index.html, to avoid a flash of the wrong theme
 *   before React mounts).
 */

const KEY = 'evidence_theme';
export type Theme = 'light' | 'dark';

export function readStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function useTheme(): { theme: Theme; toggle: () => void; set: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? systemTheme());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  return {
    theme,
    toggle: () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')),
    set: setThemeState,
  };
}
