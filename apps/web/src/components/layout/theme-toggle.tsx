import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  // Defer rendering the actual icon until after first client paint.
  // The server doesn't know the user's stored theme (localStorage
  // is client-only), so SSR always renders the light-mode Moon icon
  // while the client may need the Sun. Without this gate, React
  // logs a hydration mismatch on every page (JUR-132).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <button
        type="button"
        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
        aria-label="Toggle theme"
        suppressHydrationWarning
      >
        <span className="block h-5 w-5" aria-hidden="true" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      {theme === 'light' ? (
        <Moon className="h-5 w-5" />
      ) : (
        <Sun className="h-5 w-5" />
      )}
    </button>
  )
}
