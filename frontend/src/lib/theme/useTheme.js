import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'empowerz:theme:v1';

function readStoredTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' ? 'light' : null;
  } catch {
    return null;
  }
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/**
 * Local, persisted light/dark theme toggle.
 *
 * Defaults to the app's existing dark theme — no stored preference means no
 * `data-theme` attribute, which falls through to the unconditional :root
 * values in index.css, so nothing changes for anyone who's never touched
 * this toggle. Light mode is the only opt-in state.
 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => readStoredTheme() || 'dark');

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try {
      if (next === 'light') {
        localStorage.setItem(STORAGE_KEY, 'light');
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  }, []);

  return { theme, setTheme };
}
