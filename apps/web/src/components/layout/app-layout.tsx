import {
  useState,
  useCallback,
  createContext,
  useContext,
  useEffect,
} from 'react'
import { useLocation } from '@tanstack/react-router'
import { Sidebar } from './sidebar'
import { Header } from './header'

/**
 * Routes that need every available pixel — the desktop sidebar is
 * collapsed (slide-in only) and the main content stretches edge-to-
 * edge. The cashier flow lives here because the product grid + cart
 * panel benefit from the extra width on tablet/laptop screens (the
 * Restro POS reference the user shared sits in this same pattern).
 *
 * Users can still re-open the sidebar via the hamburger in the
 * header — which we keep visible on desktop in compact mode.
 */
const COMPACT_ROUTES = ['/pos/cashier']

function isCompactRoute(pathname: string): boolean {
  return COMPACT_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + '/'),
  )
}

// ─── Header Actions Context ──────────────────────────

interface HeaderActionsContextValue {
  setActions: (node: React.ReactNode) => void
}

const HeaderActionsContext = createContext<HeaderActionsContextValue>({
  setActions: () => {},
})

/**
 * Call from a child page to inject a CTA into the header.
 * Pass `null` to clear.
 */
export function useHeaderActions(node: React.ReactNode) {
  const { setActions } = useContext(HeaderActionsContext)
  useEffect(() => {
    setActions(node)
    return () => setActions(null)
  }, [node, setActions])
}

// ─── Layout ──────────────────────────────────────────

interface AppLayoutProps {
  children: React.ReactNode
  title?: string
  user?: { name: string; businessName: string }
  onLogout: () => void
}

export function AppLayout({ children, title, user, onLogout }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null)
  const location = useLocation()
  const compact = isCompactRoute(location.pathname)

  // Auto-collapse on entering a compact route. Users can still pop
  // the sidebar open via the hamburger; we only force it shut on the
  // route transition itself so the cashier doesn't inherit an
  // already-open sidebar from the previous page.
  useEffect(() => {
    if (compact) setSidebarOpen(false)
  }, [compact])

  const handleMenuToggle = useCallback(() => {
    setSidebarOpen((prev) => !prev)
  }, [])

  const handleSidebarClose = useCallback(() => {
    setSidebarOpen(false)
  }, [])

  const handleSetActions = useCallback((node: React.ReactNode) => {
    setHeaderActions(node)
  }, [])

  return (
    <HeaderActionsContext.Provider value={{ setActions: handleSetActions }}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {/* Sidebar — in compact mode the desktop fixed aside is
            suppressed; only the slide-in overlay is available. */}
        <Sidebar
          isOpen={sidebarOpen}
          onClose={handleSidebarClose}
          onLogout={onLogout}
          user={user}
          compact={compact}
        />

        {/* Main area — offset by sidebar width on desktop, except in
            compact mode where the sidebar is hidden. */}
        <div
          className={
            compact ? 'overflow-x-hidden' : 'overflow-x-hidden lg:pl-64'
          }
        >
          {/* Header */}
          <Header
            onMenuToggle={handleMenuToggle}
            title={title}
            actions={headerActions}
            compact={compact}
          />

          {/* Main content — pt-22 offsets the fixed header */}
          <main className="px-4 pt-22 pb-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </HeaderActionsContext.Provider>
  )
}
