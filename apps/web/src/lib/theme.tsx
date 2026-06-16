import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useLocation } from '@tanstack/react-router'
import { safeLocalStorage } from '@/lib/safe-storage'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  /** The effective theme currently applied. */
  theme: Theme
  /** True when the user has never made an explicit choice — the
   *  current theme is following the OS preference. */
  isFollowingSystem: boolean
  /** Flip to the opposite theme. Writes to localStorage, so the new
   *  value persists and stops following the system. */
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// localStorage key. Stored values are ONLY 'light' or 'dark' — the
// absence of a value means "follow system". We never write 'system'
// so we can distinguish "user picked dark and the system later
// switched" from "user never picked".
const STORAGE_KEY = 'jq-theme'

function isLightOnlyPath(path: string) {
  return path === '/'
}

/**
 * Read the stored explicit preference, if any. Returns null when the
 * user hasn't made a choice — caller should fall back to the OS.
 */
function readStored(): Theme | null {
  // safeLocalStorage swallows the SecurityError iOS Safari throws on
  // localStorage access under "Block All Cookies" / private mode. This
  // runs during ThemeProvider's render (useState initializer), so an
  // unguarded throw here blanks the entire app on those iPhones.
  const v = safeLocalStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : null
}

/**
 * Current OS preference via `prefers-color-scheme`. Returns 'light'
 * on the server (SSR) where matchMedia doesn't exist — the inline
 * pre-hydration script handles the real value on the client before
 * React mounts so there's no FOUC.
 */
function readSystem(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()

  // Initial effective theme: explicit choice wins, else OS preference.
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? readSystem())

  // Track whether we're implicitly following the system. Flips to
  // false on the first toggle (when we write an explicit value to
  // localStorage).
  const [isFollowingSystem, setIsFollowingSystem] = useState<boolean>(
    () => readStored() === null,
  )

  // Apply the `dark` class on <html> (except on light-only routes like
  // the public landing page).
  useEffect(() => {
    const root = document.documentElement
    if (isLightOnlyPath(pathname)) {
      root.classList.remove('dark')
      return
    }
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme, pathname])

  // Listen for OS-preference changes while we're implicitly following
  // the system. Once the user makes an explicit choice, we stop
  // tracking changes — their pick is persistent.
  useEffect(() => {
    if (!isFollowingSystem) return
    if (typeof window === 'undefined' || !window.matchMedia) return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light')
    }
    // addEventListener is the modern API; `addListener` is the old
    // one still shipping in some Safari versions. Prefer modern.
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [isFollowingSystem])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      // Persist — any explicit toggle locks in the user's choice and
      // stops system-following.
      safeLocalStorage.setItem(STORAGE_KEY, next)
      setIsFollowingSystem(false)
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, isFollowingSystem, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
