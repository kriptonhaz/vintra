import * as React from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  X,
  Shield,
  Building2,
  UserCog,
  KeyRound,
  ListChecks,
  History,
  ArrowLeftCircle,
  LogOut,
  DollarSign,
  Megaphone,
  Bot,
  MessageSquare,
  Sparkles,
  Gift,
  LayoutDashboard,
  ChevronDown,
  Activity,
  Newspaper,
  Coins,
  Palette,
  Image as ImageIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AdminNavItem {
  labelKey: string
  href: string
  icon: LucideIcon
}

interface AdminNavSection {
  id: string
  labelKey: string
  items: AdminNavItem[]
}

// Grouped admin nav. Order within each section + order of sections is
// the order they render top-to-bottom. When adding a page, drop it into
// the section whose theme it matches — don't add new top-level sections
// without a real "this doesn't fit any" reason; > 5 sections turns the
// sidebar into a wall of headers.
const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    id: 'overview',
    labelKey: 'admin.section.overview',
    items: [
      { labelKey: 'admin.navDashboard', href: '/admin', icon: LayoutDashboard },
      { labelKey: 'admin.navAuditLog', href: '/admin/audit-log', icon: History },
    ],
  },
  {
    id: 'tenants',
    labelKey: 'admin.section.tenants',
    items: [
      { labelKey: 'admin.navTenants', href: '/admin/tenants', icon: Building2 },
      { labelKey: 'admin.navFinance', href: '/admin/finance', icon: DollarSign },
    ],
  },
  {
    id: 'access',
    labelKey: 'admin.section.access',
    items: [
      { labelKey: 'admin.navPlatformAdmins', href: '/admin/platform-admins', icon: UserCog },
      { labelKey: 'admin.navRoles', href: '/admin/roles', icon: KeyRound },
      { labelKey: 'admin.navPermissions', href: '/admin/permissions', icon: ListChecks },
    ],
  },
  {
    id: 'modules',
    labelKey: 'admin.section.modules',
    items: [
      { labelKey: 'admin.navAiProviders', href: '/admin/ai-providers', icon: Bot },
      { labelKey: 'admin.navKonten', href: '/admin/konten', icon: Sparkles },
      { labelKey: 'admin.navLogo', href: '/admin/logo', icon: Palette },
      { labelKey: 'admin.navSpanduk', href: '/admin/spanduk', icon: ImageIcon },
      { labelKey: 'admin.navKontenCredits', href: '/admin/konten-credits', icon: Coins },
      { labelKey: 'admin.navWaPlans', href: '/admin/wa-plans', icon: MessageSquare },
      { labelKey: 'admin.navRagTools', href: '/admin/rag-tools', icon: Sparkles },
      { labelKey: 'admin.navFeedback', href: '/admin/feedback', icon: MessageSquare },
    ],
  },
  {
    // Referral has three admin surfaces (access allowlist, claim queue,
    // global settings) — enough to warrant its own section over burying
    // them in `modules`.
    id: 'referral',
    labelKey: 'admin.section.referral',
    items: [
      { labelKey: 'admin.navReferralAccess', href: '/admin/referrals/access', icon: Gift },
      { labelKey: 'admin.navReferralClaims', href: '/admin/referrals/claims', icon: Gift },
      { labelKey: 'admin.navReferralConfig', href: '/admin/referrals/config', icon: Gift },
    ],
  },
  {
    id: 'system',
    labelKey: 'admin.section.system',
    items: [
      // Monitoring absorbed the per-tag S3 breakdown that used to live
      // on /admin/storage; no separate Storage entry anymore.
      { labelKey: 'admin.navMonitoring', href: '/admin/monitoring', icon: Activity },
      { labelKey: 'admin.navNotifications', href: '/admin/notifications', icon: Megaphone },
      { labelKey: 'admin.navArticles', href: '/admin/articles', icon: Newspaper },
    ],
  },
]

interface SidebarUser {
  name: string
  email?: string
}

interface AdminSidebarProps {
  isOpen: boolean
  onClose: () => void
  onLogout: () => void
  user?: SidebarUser
}

// Persistence key for per-section open/closed state. Bumped only if the
// shape ever needs to change incompatibly — don't rev it for adding new
// sections; the merge logic below handles unknown ids gracefully.
const SIDEBAR_LS_KEY = 'vintra.admin-sidebar.sections.v1'

function loadOpenSections(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(SIDEBAR_LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, boolean>
    return {}
  } catch {
    return {}
  }
}

function saveOpenSections(state: Record<string, boolean>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SIDEBAR_LS_KEY, JSON.stringify(state))
  } catch {
    // localStorage full / disabled / Safari private mode — silently ignore.
  }
}

function NavLink({
  item,
  isActive,
  onNavigate,
}: {
  item: AdminNavItem
  isActive: boolean
  /** Called after click — used by the mobile sidebar to auto-close. */
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const Icon = item.icon
  return (
    <Link
      to={item.href}
      onClick={onNavigate}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100',
      )}
    >
      <Icon
        className={cn(
          'h-5 w-5 shrink-0 transition-colors',
          isActive
            ? 'text-brand-600 dark:text-brand-400'
            : 'text-gray-400 group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-300',
        )}
      />
      <span className="flex-1 truncate">{t(item.labelKey)}</span>
    </Link>
  )
}

// Collapsible section header + body. Pure presentational — open/close
// state lives one level up so all sections can be coordinated.
function NavSection({
  section,
  isOpen,
  onToggle,
  isActive,
  onNavigate,
}: {
  section: AdminNavSection
  isOpen: boolean
  onToggle: () => void
  isActive: (href: string) => boolean
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700/40 dark:hover:text-gray-300"
        aria-expanded={isOpen}
        aria-controls={`admin-section-${section.id}`}
      >
        <span className="flex-1 text-left">{t(section.labelKey)}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 transition-transform duration-150',
            isOpen ? 'rotate-0' : '-rotate-90',
          )}
        />
      </button>
      {/* Body — `grid` trick gives us animatable height without measuring
          the children. Open state expands to 1fr; closed state collapses
          to 0fr and `overflow-hidden` clips the children visually. */}
      <div
        id={`admin-section-${section.id}`}
        className={cn(
          'grid transition-[grid-template-rows] duration-150 ease-out',
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-1 space-y-1 pl-1">
            {section.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                isActive={isActive(item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AdminSidebar({
  isOpen,
  onClose,
  onLogout,
  user,
}: AdminSidebarProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const pathname = location.pathname

  const isActive = React.useCallback(
    (href: string) => {
      if (href === '/admin') return pathname === '/admin'
      return pathname === href || pathname.startsWith(href + '/')
    },
    [pathname],
  )

  // Section open/closed state. Default ALL open so SSR and the client
  // first paint produce IDENTICAL markup — reading localStorage here
  // diverges between server (no storage = all open) and client (might
  // have collapsed sections), which trips React's hydration check and
  // crashes the whole page with error #418.
  //
  // We sync from localStorage in a useEffect below, AFTER hydration.
  // The cost is a one-frame flash when the user previously collapsed
  // sections: they render open, then snap closed once the effect runs.
  // Acceptable — collapsed sections are minority state and the flash
  // is under 16ms.
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>(
    () => {
      const merged: Record<string, boolean> = {}
      for (const section of ADMIN_NAV_SECTIONS) {
        merged[section.id] = true
      }
      return merged
    },
  )

  // Hydrate persisted state once on mount. The empty dep array means
  // this runs exactly once on the client; the server never executes it.
  React.useEffect(() => {
    const stored = loadOpenSections()
    if (Object.keys(stored).length === 0) return
    setOpenSections((prev) => {
      const merged: Record<string, boolean> = { ...prev }
      for (const section of ADMIN_NAV_SECTIONS) {
        if (section.id in stored) merged[section.id] = stored[section.id]!
      }
      return merged
    })
  }, [])

  // Force-open the section containing the current path on every route
  // change. This is intentionally one-way — collapsing a section while
  // its child is active is allowed (user clicked the header on purpose),
  // but landing on the page from outside expands it.
  React.useEffect(() => {
    const activeSection = ADMIN_NAV_SECTIONS.find((s) =>
      s.items.some((i) => isActive(i.href)),
    )
    if (activeSection && openSections[activeSection.id] === false) {
      setOpenSections((prev) => {
        const next = { ...prev, [activeSection.id]: true }
        saveOpenSections(next)
        return next
      })
    }
    // openSections intentionally excluded — including it would loop after
    // the toggle write. Re-run only when the route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isActive])

  const toggleSection = React.useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      saveOpenSections(next)
      return next
    })
  }, [])

  const displayName = user?.name ?? t('admin.brandTitle')
  const initials = displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const content = (
    <div className="flex h-full flex-col">
      {/* Logo / admin badge */}
      <div className="flex h-16 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-700">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white">
          <Shield className="h-5 w-5" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {t('admin.brandTitle')}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('admin.brandSubtitle')}
          </span>
        </div>
        {/* Close button — mobile only */}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300 lg:hidden"
          aria-label={t('layout.closeMenu')}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation — collapsible sections. Each section persists its
          open/closed state in localStorage; the section containing the
          active route auto-opens. */}
      <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {ADMIN_NAV_SECTIONS.map((section) => (
          <NavSection
            key={section.id}
            section={section}
            isOpen={openSections[section.id] ?? true}
            onToggle={() => toggleSection(section.id)}
            isActive={isActive}
            onNavigate={onClose}
          />
        ))}
      </nav>

      {/* Back-to-dashboard + profile footer */}
      <div className="space-y-2 border-t border-gray-200 px-3 py-3 dark:border-gray-700">
        <Link
          to="/dashboard"
          onClick={onClose}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
        >
          <ArrowLeftCircle className="h-5 w-5 shrink-0 text-gray-400" />
          <span className="flex-1">{t('admin.backToDashboard')}</span>
        </Link>

        <div className="mt-2 flex items-center gap-3 border-t border-gray-200 px-1 pt-3 dark:border-gray-700">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {displayName}
            </p>
            {user?.email && (
              <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                {user.email}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label={t('layout.logout')}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Mobile (slide-in) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 transform bg-white shadow-xl transition-transform duration-300 ease-in-out dark:bg-gray-800 dark:shadow-gray-900/50 lg:hidden',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {content}
      </aside>

      {/* Desktop */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-gray-200 lg:bg-white dark:lg:border-gray-700 dark:lg:bg-gray-800">
        {content}
      </aside>
    </>
  )
}
