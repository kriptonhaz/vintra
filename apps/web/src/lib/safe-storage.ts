/**
 * Crash-proof wrappers around Web Storage.
 *
 * iOS Safari throws a `SecurityError` on ANY `localStorage` /
 * `sessionStorage` access — not just writes — when the user has
 * "Block All Cookies" enabled (Settings → Safari → Advanced) or is in
 * Private Browsing on older iOS. A bare `localStorage.getItem(...)` in
 * render-path code (e.g. a Provider's `useState` initializer) therefore
 * throws synchronously and blanks the whole React tree on those
 * iPhones, while Chrome/desktop are unaffected. Always go through these
 * helpers instead of touching `localStorage` / `sessionStorage`
 * directly. A `typeof localStorage === 'undefined'` guard is NOT enough
 * — the object exists, the access throws.
 */

function safeGet(storage: 'local' | 'session', key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage
    return store.getItem(key)
  } catch {
    return null
  }
}

function safeSet(storage: 'local' | 'session', key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage
    store.setItem(key, value)
  } catch {
    // Storage unavailable (Block All Cookies / private mode / quota) —
    // silently ignore; the value just won't persist.
  }
}

function safeRemove(storage: 'local' | 'session', key: string): void {
  if (typeof window === 'undefined') return
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage
    store.removeItem(key)
  } catch {
    // ignore
  }
}

export const safeLocalStorage = {
  getItem: (key: string) => safeGet('local', key),
  setItem: (key: string, value: string) => safeSet('local', key, value),
  removeItem: (key: string) => safeRemove('local', key),
}

export const safeSessionStorage = {
  getItem: (key: string) => safeGet('session', key),
  setItem: (key: string, value: string) => safeSet('session', key, value),
  removeItem: (key: string) => safeRemove('session', key),
}
