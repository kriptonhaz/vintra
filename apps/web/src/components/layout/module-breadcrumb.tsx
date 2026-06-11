/**
 * Module breadcrumb. Replaces the per-module tab strips
 * (POSSubnav, AttendanceSubnav, InventorySubnav, HppNav) — those
 * tabs moved into the sidebar tree, but pages still benefit from a
 * "you are here" line at the top.
 *
 * The breadcrumb derives the current page from the URL by matching
 * against MODULE_NAV's children list, which is the same source of
 * truth the sidebar consumes. That means no per-page wiring: drop
 * `<ModuleBreadcrumb />` at the top of any nested module page and it
 * resolves itself.
 *
 * Pathname + search-param matching: some children share a pathname
 * but distinguish themselves by `?view=` (Katalog Produk vs Bahan
 * Baku). The match logic checks both: a child only "wins" when the
 * pathname matches AND every key in `child.search` matches the
 * current location's search.
 */
import { Link, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { MODULE_NAV, type NavItem, type ChildNavItem } from '@/lib/constants'

const NAV_I18N_MAP: Record<string, string> = {
  'HPP Calculator': 'nav.hppCalculator',
  'POS Kasir': 'nav.pos',
  Produk: 'nav.produk',
  Inventaris: 'nav.inventaris',
  'Stok Barang': 'nav.inventory',
  Absensi: 'nav.attendance',
  Booking: 'nav.booking',
}

function pathMatches(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

function searchMatches(
  required: Record<string, string> | undefined,
  current: Record<string, unknown>,
): boolean {
  if (!required) return true
  for (const [k, v] of Object.entries(required)) {
    if (current[k] !== v) return false
  }
  return true
}

function moduleScore(m: NavItem, pathname: string, search: Record<string, unknown>): number {
  if (!pathMatches(m.href, pathname)) return -1
  // Tie-break by required search keys matched: a Produk entry that
  // requires ?view=sellable AND ?view matches scores higher than a
  // bare Inventaris entry.
  if (!m.search) return m.href.length
  for (const [k, v] of Object.entries(m.search)) {
    if (search[k] !== v) return -1
  }
  return m.href.length + Object.keys(m.search).length * 1000
}

function childScore(c: ChildNavItem, pathname: string, search: Record<string, unknown>): number {
  if (!pathMatches(c.href, pathname)) return -1
  if (!searchMatches(c.search, search)) return -1
  return c.href.length + (c.search ? Object.keys(c.search).length * 1000 : 0)
}

export function ModuleBreadcrumb() {
  const { t } = useTranslation()
  const location = useLocation()
  const pathname = location.pathname
  const search = (location.search ?? {}) as Record<string, unknown>

  // Pick the highest-scoring module — required search params (Produk)
  // beat a bare module (Inventaris) on the same pathname.
  let module: NavItem | null = null
  let best = -1
  for (const m of MODULE_NAV) {
    const s = moduleScore(m, pathname, search)
    if (s > best) {
      best = s
      module = m
    }
  }
  if (!module) return null

  const moduleLabel = NAV_I18N_MAP[module.label]
    ? t(NAV_I18N_MAP[module.label]!)
    : module.label

  // Walk children AND grandchildren — a nested group (e.g. Laporan POS
  // → Kategori) needs both the parent breadcrumb segment and the leaf.
  // Best-scoring leaf wins; its `parent` field, when set, fills the
  // middle segment "POS Kasir → Laporan POS → Kategori".
  type Match = { leaf: ChildNavItem; parent: ChildNavItem | null; score: number }
  const matchHolder: { current: Match | null } = { current: null }
  function walk(children: readonly ChildNavItem[] | undefined, parent: ChildNavItem | null) {
    if (!children) return
    for (const c of children) {
      const s = childScore(c, pathname, search)
      if (
        s >= 0 &&
        (!matchHolder.current || s > matchHolder.current.score)
      ) {
        matchHolder.current = { leaf: c, parent, score: s }
      }
      if (c.children) walk(c.children, c)
    }
  }
  walk(module.children, null)
  const child = matchHolder.current?.leaf ?? null
  const parent = matchHolder.current?.parent ?? null

  // Module index page: just show the module name without a chevron —
  // a single-segment breadcrumb feels redundant.
  if (!child || (child.href === module.href && !child.search && !module.search)) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
        <Link
          to={module.href}
          {...(module.search ? { search: module.search as never } : {})}
          className="font-medium text-gray-900 dark:text-gray-100"
        >
          {moduleLabel}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
      <Link
        to={module.href}
        {...(module.search ? { search: module.search as never } : {})}
        className="hover:text-gray-700 dark:hover:text-gray-200"
      >
        {moduleLabel}
      </Link>
      {parent && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
          <Link
            to={parent.href}
            {...(parent.search ? { search: parent.search as never } : {})}
            className="hover:text-gray-700 dark:hover:text-gray-200"
          >
            {t(parent.labelKey)}
          </Link>
        </>
      )}
      <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
      <span className="font-medium text-gray-900 dark:text-gray-100">
        {t(child.labelKey)}
      </span>
    </div>
  )
}
