/**
 * Token storage using localStorage.
 *
 * NOTE: Production should use httpOnly cookies via a backend session endpoint
 * to prevent XSS token theft. localStorage is used here for development simplicity.
 */

const KEY = 'auth_tokens';

/** @returns {{ access_token: string, refresh_token: string } | null} */
export function getTokens() {
  try {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** @param {{ access_token: string, refresh_token: string }} tokens */
export function setTokens(tokens) {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(tokens));
  } catch {}
}

export function clearTokens() {
  try {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(KEY);
  } catch {}
}
