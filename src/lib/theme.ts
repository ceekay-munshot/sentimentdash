import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';

/** The theme to start with: a saved choice, else the device preference. */
export function getTheme(): Theme {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Applies a theme: toggles the `light` class on <html> and remembers it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light', theme === 'light');
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* storage unavailable — the in-memory toggle still works */
  }
}

/** React state for the theme. The pre-paint script in index.html has already
 *  applied the initial theme, so this only needs to mirror and toggle it. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(getTheme);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);
  return { theme, toggle };
}
