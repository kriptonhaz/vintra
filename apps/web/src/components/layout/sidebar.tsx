import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { X, LogOut, Shield, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DASHBOARD_NAV,
  MODULE_NAV,
  MASTER_DATA_NAV,
  SETTINGS_NAV,
  HELP_NAV,
  requiredPermissionForNav,
  type NavItem,
  type ChildNavItem,
} from "@/lib/constants";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { usePermissions, useCurrentUser } from "@/hooks/use-permissions";
import logo from "@/assets/images/logo.png";

/** Modules that are available for free (no subscription required) */
const FREE_MODULES = new Set(["hpp", "booking", "konten"]);

/** Map nav label keys to i18n keys */
const NAV_I18N_MAP: Record<string, string> = {
  Dashboard: "nav.dashboard",
  "HPP Calculator": "nav.hppCalculator",
  "POS Kasir": "nav.pos",
  Produk: "nav.produk",
  Inventaris: "nav.inventaris",
  Absensi: "nav.attendance",
  "Supplier & Bahan Baku": "nav.suppliers",
  Kategori: "nav.categories",
  Pelanggan: "nav.customers",
  Referral: "nav.referral",
  "Anggota Tim": "nav.members",
  "Peran & Akses": "nav.roles",
  "Akun Saya": "nav.account",
  "Kirim Feedback": "nav.feedback",
  "Hubungi WhatsApp": "nav.contactWa",
  Booking: "nav.booking",
  Situs: "nav.site",
};

interface SidebarUser {
  name: string;
  businessName: string;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  user?: SidebarUser;
  /** Compact mode: desktop fixed aside is suppressed; sidebar only
   *  appears as a slide-in overlay (mobile pattern) regardless of
   *  viewport size. Used on routes like the cashier flow that need
   *  the full screen width. */
  compact?: boolean;
}

/**
 * Stable identity for a child nav link: its href plus any pinned
 * search params. Three children can share an href — Katalog Produk
 * (?view=sellable), Bahan Baku (?view=ingredients), and Daftar Stok
 * (no ?view=) all point at /inventory/items — so the search params
 * are part of the identity.
 */
function childKey(child: ChildNavItem): string {
  return (
    child.href +
    (child.search
      ? '?' + new URLSearchParams(child.search).toString()
      : '')
  )
}

/**
 * Resolve the single active child for the current URL across the
 * WHOLE nav tree (not per-parent — Bahan Baku lives under Produk
 * while Daftar Stok lives under Inventaris, yet both point at
 * /inventory/items). The most specific match wins: a child is scored
 * by how many search keys it pins, and a no-search child (score 0)
 * only wins when no search-pinned child matches the same pathname.
 * That stops Daftar Stok lighting up alongside Bahan Baku when the
 * URL is /inventory/items?view=ingredients.
 *
 * Returns the winning child's `childKey`, or null when nothing matches.
 */
function resolveActiveChildKey(
  items: NavItem[],
  pathname: string,
  search: Record<string, unknown>,
): string | null {
  // Holder object dodges TS narrowing `best` to `null` across the
  // recursive `walk` closure — the closure mutates `holder.current`,
  // not a bare `let`, so the type stays Best | null.
  type Best = { key: string; score: number }
  const holder: { current: Best | null } = { current: null }
  // Walk children recursively so grandchildren (e.g. Laporan POS →
  // Kategori) also compete for the active highlight. The most specific
  // search-match still wins (see resolveActiveChildKey doc above).
  function walk(children: readonly ChildNavItem[]) {
    for (const child of children) {
      if (child.href === pathname) {
        let score = 0
        let matched = true
        if (child.search) {
          for (const [k, v] of Object.entries(child.search)) {
            if (search[k] !== v) {
              matched = false
              break
            }
            score++
          }
        }
        if (matched && (!holder.current || score > holder.current.score)) {
          holder.current = { key: childKey(child), score }
        }
      }
      if (child.children) walk(child.children)
    }
  }
  for (const item of items) walk(item.children ?? [])
  return holder.current ? holder.current.key : null
}

/** True if `key` matches a child (or grandchild) anywhere in `children`. */
function containsActiveChild(
  children: readonly ChildNavItem[] | undefined,
  key: string,
): boolean {
  if (!children) return false
  return children.some(
    (c) => childKey(c) === key || containsActiveChild(c.children, key),
  )
}

function NavLink({
  item,
  isActive,
  onNavigate,
  visibleChildren,
  activeChildKey,
  expanded,
  onToggleExpand,
  expandedChildren,
  onToggleChildExpand,
}: {
  item: NavItem;
  isActive: boolean;
  /** Called after a click — used by the mobile sidebar to auto-close
   *  on navigation. No-op on desktop (the desktop aside doesn't read
   *  isOpen), so it's safe to wire unconditionally. */
  onNavigate?: () => void;
  /** Pre-filtered child rows (parent does perm/feature/role filtering)
   *  so this component just renders. Empty / undefined → flat row. */
  visibleChildren?: ChildNavItem[];
  /** `childKey` of the single active child across the whole nav tree,
   *  or null. Resolved once by the parent so this component just
   *  compares — no per-child URL matching here. */
  activeChildKey: string | null;
  /** Whether the children list should render. Parent owns this state
   *  so the chevron can preview a sibling module without navigating. */
  expanded: boolean;
  /** Called when the user taps the chevron — toggles manual expand
   *  state in the parent. */
  onToggleExpand?: () => void;
  /** Hrefs of nested child groups (grandchildren parents) the user
   *  has expanded. Empty when none of this NavLink's children have
   *  their own children. */
  expandedChildren?: Set<string>;
  onToggleChildExpand?: (href: string) => void;
}) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const i18nKey = NAV_I18N_MAP[item.label];
  const label = i18nKey ? t(i18nKey) : item.label;

  const hasChildren = (visibleChildren?.length ?? 0) > 0;

  return (
    <div>
      {/*
        Two-target row: the Link covers icon + label + badges and
        navigates as before; the chevron is its own button so the
        cashier can preview a module's children without leaving the
        current page. Mobile especially benefits — without this they
        had to nav into the module just to see what's inside.
      */}
      <div
        className={cn(
          "group flex items-stretch rounded-lg text-sm font-medium transition-colors",
          isActive
            ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100",
        )}
      >
        {item.external ? (
          // External rows (e.g. a wa.me deep link) can't use TanStack's
          // <Link> — render a plain anchor that opens in a new tab.
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onNavigate}
            className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5"
          >
            <Icon className="h-5 w-5 shrink-0 text-gray-400 transition-colors group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-300" />
            <span className="flex-1 truncate">{label}</span>
          </a>
        ) : (
          <Link
            to={item.href}
            // Search params split out from href because TanStack's <Link>
            // expects them as a separate prop, not as a "?…" suffix on `to`.
            // `as never` because NavItem.search is a generic
            // Record<string,string> while Link's `search` is route-typed.
            {...(item.search ? { search: item.search as never } : {})}
            onClick={onNavigate}
            className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5"
          >
            <Icon
              className={cn(
                "h-5 w-5 shrink-0 transition-colors",
                isActive
                  ? "text-brand-600 dark:text-brand-400"
                  : "text-gray-400 group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-300",
              )}
            />
            <span className="flex-1 truncate">{label}</span>
          </Link>
        )}
        {hasChildren && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={expanded ? "Tutup sub menu" : "Buka sub menu"}
            aria-expanded={expanded}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-r-lg px-2.5",
              "hover:bg-gray-100/60 dark:hover:bg-gray-700/60",
            )}
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-gray-400 transition-transform dark:text-gray-500",
                expanded ? "rotate-0" : "-rotate-90",
              )}
            />
          </button>
        )}
      </div>

      {expanded && hasChildren && (
        <ul className="mt-0.5 ml-5 space-y-0.5 border-l border-gray-200 pl-3 dark:border-gray-700">
          {visibleChildren!.map((child) => (
            <ChildNavLink
              key={childKey(child)}
              child={child}
              activeChildKey={activeChildKey}
              onNavigate={onNavigate}
              expandedChildren={expandedChildren}
              onToggleChildExpand={onToggleChildExpand}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One row inside a NavLink's child list. Renders either a flat link or
 * — when the child has its own `children` (a nested group like Laporan
 * POS) — a link + chevron with an expandable grandchild list. Active
 * highlight is resolved by composite key (href + search), so two
 * children sharing a pathname stay distinguishable.
 */
function ChildNavLink({
  child,
  activeChildKey,
  onNavigate,
  expandedChildren,
  onToggleChildExpand,
}: {
  child: ChildNavItem
  activeChildKey: string | null
  onNavigate?: () => void
  /** Hrefs the user has manually expanded plus any auto-expanded by
   *  the URL containing an active grandchild. Optional — flat lists
   *  (no grandchildren anywhere) never need to read it. */
  expandedChildren?: Set<string>
  onToggleChildExpand?: (href: string) => void
}) {
  const { t } = useTranslation()
  const key = childKey(child)
  const childActive = key === activeChildKey
  const grandchildren = child.children ?? []
  const hasGrandchildren = grandchildren.length > 0
  const expanded =
    hasGrandchildren && (expandedChildren?.has(child.href) ?? false)

  return (
    <li>
      <div className="flex items-stretch rounded-md">
        <Link
          to={child.href}
          {...(child.search ? { search: child.search as never } : {})}
          onClick={onNavigate}
          className={cn(
            "block flex-1 rounded-md px-3 py-1.5 text-[13px] transition-colors",
            childActive
              ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
              : "text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100",
          )}
        >
          {t(child.labelKey)}
        </Link>
        {hasGrandchildren && (
          <button
            type="button"
            onClick={() => onToggleChildExpand?.(child.href)}
            aria-label={expanded ? "Tutup sub menu" : "Buka sub menu"}
            aria-expanded={expanded}
            className="flex shrink-0 items-center justify-center rounded-r-md px-2 text-gray-400 hover:bg-gray-100/60 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700/60"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expanded ? "rotate-0" : "-rotate-90",
              )}
            />
          </button>
        )}
      </div>
      {expanded && (
        <ul className="mt-0.5 ml-3 space-y-0.5 border-l border-gray-200 pl-3 dark:border-gray-700">
          {grandchildren.map((grand) => {
            const gKey = childKey(grand)
            const gActive = gKey === activeChildKey
            return (
              <li key={gKey}>
                <Link
                  to={grand.href}
                  {...(grand.search ? { search: grand.search as never } : {})}
                  onClick={onNavigate}
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-[12px] transition-colors",
                    gActive
                      ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100",
                  )}
                >
                  {t(grand.labelKey)}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

export function Sidebar({ isOpen, onClose, onLogout, user, compact }: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const pathname = location.pathname;
  // Snapshot of the current search params, surfaced to NavLink so it
  // can distinguish children that share a pathname (e.g. Katalog
  // Produk vs Bahan Baku, both at /inventory/items). location.search
  // already gives us the parsed Record<string, unknown> shape.
  const currentSearch = (location.search ?? {}) as Record<string, unknown>;
  // Single source of truth for which child row is highlighted. Resolved
  // across every nav section at once so a no-search child (Daftar Stok)
  // never lights up next to a search-pinned cousin (Bahan Baku).
  const activeChildKey = resolveActiveChildKey(
    [...MODULE_NAV, ...MASTER_DATA_NAV, ...SETTINGS_NAV],
    pathname,
    currentSearch,
  );
  const { data: adminStatus } = usePlatformAdmin();
  const isPlatformAdmin = adminStatus?.isPlatformAdmin ?? false;
  const { has: hasPerm } = usePermissions();
  const { data: currentUser } = useCurrentUser();
  const waSub = currentUser?.moduleSubscriptions?.whatsapp;

  // Dashboard is owner/admin oriented — hide for role-restricted users like staff.
  const showDashboard = hasPerm("hpp.read");

  // Feature flags from the POS subscription drive both MODULE_NAV
  // and MASTER_DATA_NAV filtering. Computed once and reused below.
  const posFeatures = new Set(currentUser?.moduleSubscriptions?.pos?.features ?? []);
  // Add wa_active feature when the tenant has an active WA subscription
  if (waSub?.active) posFeatures.add('wa_active');

  const visibleModules = MODULE_NAV.filter((item) => {
    const perm = requiredPermissionForNav(item);
    if (perm && !hasPerm(perm)) return false;
    // Top-level feature filter — kept for future entries that should
    // hide entirely (vs. show with a Pro lock badge). Situs no longer
    // uses this; it shows with a lock instead per the Aktif/Pro UX.
    if (item.feature && !posFeatures.has(item.feature)) return false;
    return true;
  });

  // Master Data items can also be feature-gated. The Pelanggan link
  // requires the `customer_db` POS feature, which is bundled into Toko
  // and Komplit subscriptions. Free tenants see everything else under
  // Master Data but not Pelanggan.
  const visibleMasterData = MASTER_DATA_NAV.filter((item) => {
    if (item.permission && !hasPerm(item.permission)) return false;
    if (item.feature && !posFeatures.has(item.feature)) return false;
    return true;
  });

  const visibleSettings = SETTINGS_NAV.filter((item) => {
    if (item.permission && !hasPerm(item.permission)) return false;
    // `feature: 'referral'` gates the Referral entry on the per-tenant
    // allowlist — off-list tenants see no entry at all.
    if (item.feature === "referral" && currentUser?.referralAccess !== true)
      return false;
    return true;
  });

  // Pick the single best-matching MODULE_NAV entry for the current
  // URL — needed because Produk (/inventory/items) and Inventaris
  // (/inventory) overlap on prefix. Score = pathname-match length
  // bonus (longer href wins over shorter when both match) + a big
  // bonus for matching every required search param. Only the winner
  // gets the active highlight + auto-expand; siblings stay quiet.
  function moduleScore(m: NavItem): number {
    if (m.href === "/dashboard") {
      return pathname === "/dashboard" ? 1 : -1;
    }
    if (pathname !== m.href && !pathname.startsWith(m.href + "/")) return -1;
    let score = m.href.length;
    if (m.search) {
      for (const [k, v] of Object.entries(m.search)) {
        if ((location.search as Record<string, unknown>)?.[k] !== v) return -1;
        score += 1000; // search-match dominates plain prefix length
      }
    }
    return score;
  }
  // Cache the winning href once per render so isActive can answer
  // O(1) for every NavLink call.
  //
  // The module that OWNS the resolved active child wins outright. This
  // beats the prefix-based moduleScore so /inventory/items?view=
  // ingredients activates Produk (owner of Bahan Baku) — not
  // Inventaris, whose href "/inventory" is just a loose prefix of the
  // same path, and whose moduleScore would otherwise win because the
  // Produk parent's own ?view=sellable default doesn't match.
  let winningModuleHref: string | null = null;
  if (activeChildKey) {
    for (const m of MODULE_NAV) {
      if (containsActiveChild(m.children, activeChildKey)) {
        winningModuleHref = m.href;
        break;
      }
    }
  }
  // Fallback: prefix/search scoring for URLs that don't land on a
  // declared child (e.g. the /inventory/items/:id detail page).
  if (!winningModuleHref) {
    let winningScore = -1;
    for (const m of MODULE_NAV) {
      const s = moduleScore(m);
      if (s > winningScore) {
        winningScore = s;
        winningModuleHref = m.href;
      }
    }
  }
  function isActive(href: string) {
    // Master Data + Settings rows are flat — they don't compete with
    // MODULE_NAV winners; treat them with the legacy startsWith check.
    if (href === "/dashboard") return pathname === "/dashboard";
    if (MODULE_NAV.some((m) => m.href === href)) {
      return href === winningModuleHref;
    }
    return pathname === href || pathname.startsWith(href + "/");
  }

  // Manual expand state — populated when the user taps a chevron to
  // peek inside a module without navigating to it. The active module
  // (URL-derived) is always considered expanded too, so a fresh page
  // load still auto-opens whatever the cashier is browsing. Set
  // persists across navigations within a session because the Sidebar
  // component lives in the layout (no remount on route change).
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(
    () => new Set(),
  );
  function toggleExpand(href: string) {
    setManuallyExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }
  function isExpanded(item: NavItem): boolean {
    if (!item.children?.length) return false;
    if (isActive(item.href)) return true;
    return manuallyExpanded.has(item.href);
  }

  // Nested-child expand state — parallels `manuallyExpanded` but for
  // ChildNavItems that themselves have children (e.g. Laporan POS →
  // Kategori/Produk/...). Auto-expands when the active grandchild
  // lives inside the group, the same way `isExpanded` does for
  // top-level NavItems.
  const [manuallyExpandedChildren, setManuallyExpandedChildren] = useState<
    Set<string>
  >(() => new Set());
  function toggleChildExpand(href: string) {
    setManuallyExpandedChildren((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }
  // Returns the effective expanded set for a NavItem's nested groups:
  // any child whose `children` contain the active grandchild is forced
  // open, on top of whatever the user has manually toggled.
  function effectiveExpandedChildren(item: NavItem): Set<string> {
    const set = new Set(manuallyExpandedChildren);
    if (!activeChildKey || !item.children) return set;
    for (const c of item.children) {
      if (c.children && containsActiveChild(c.children, activeChildKey)) {
        set.add(c.href);
      }
    }
    return set;
  }

  // Per-module child filtering: each row (Dashboard, Settings, etc.)
  // can have its own permission / feature / hideForRoles gate. Child
  // visibility is computed at the parent and passed down so NavLink
  // stays a pure presentational component.
  const userRoleKey = currentUser?.roleKey ?? null;
  function filterChildren(children: readonly ChildNavItem[]): ChildNavItem[] {
    return children
      .filter((c) => {
        if (c.permission) {
          const keys = Array.isArray(c.permission)
            ? c.permission
            : [c.permission];
          if (!keys.some((k) => hasPerm(k))) return false;
        }
        if (c.feature && !posFeatures.has(c.feature)) return false;
        if (
          c.hideForRoles &&
          userRoleKey &&
          c.hideForRoles.includes(userRoleKey)
        )
          return false;
        return true;
      })
      .map((c) =>
        c.children ? { ...c, children: filterChildren(c.children) } : c,
      );
  }
  function visibleChildrenFor(item: NavItem): ChildNavItem[] {
    if (!item.children) return [];
    return filterChildren(item.children);
  }

  const displayName = user?.name ?? "Pengguna";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-700">
        <img src={logo} alt="Vintra" className="h-8 w-8" />
        <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
          Vintra
        </span>
        {/* Close button — mobile only */}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300 lg:hidden"
          aria-label={t("layout.closeMenu")}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="scrollbar-none flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {/* Dashboard — owner/admin only */}
        {showDashboard && (
          <NavLink
            item={DASHBOARD_NAV}
            isActive={isActive(DASHBOARD_NAV.href)}
            onNavigate={onClose}
            activeChildKey={activeChildKey}
            expanded={false}
            expandedChildren={effectiveExpandedChildren(DASHBOARD_NAV)}
            onToggleChildExpand={toggleChildExpand}
          />
        )}

        {/* Module section */}
        {visibleModules.length > 0 && (
          <div className={showDashboard ? "pt-4" : ""}>
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {t("nav.sectionModules")}
            </p>
            <div className="space-y-1">
              {visibleModules.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  isActive={isActive(item.href)}
                        onNavigate={onClose}
                  visibleChildren={visibleChildrenFor(item)}
                  activeChildKey={activeChildKey}
                  expanded={isExpanded(item)}
                  onToggleExpand={() => toggleExpand(item.href)}
                  expandedChildren={effectiveExpandedChildren(item)}
                  onToggleChildExpand={toggleChildExpand}
                />
              ))}
            </div>
          </div>
        )}

        {/* Master Data section */}
        {visibleMasterData.length > 0 && (
          <div className="pt-4">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {t("nav.sectionMasterData")}
            </p>
            <div className="space-y-1">
              {visibleMasterData.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  isActive={isActive(item.href)}
                        onNavigate={onClose}
                  activeChildKey={activeChildKey}
                  expanded={false}
                />
              ))}
            </div>
          </div>
        )}

        {visibleSettings.length > 0 && (
          <div className="pt-4">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {t("nav.sectionSettings")}
            </p>
            <div className="space-y-1">
              {visibleSettings.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  isActive={isActive(item.href)}
                        onNavigate={onClose}
                  activeChildKey={activeChildKey}
                  expanded={false}
                />
              ))}
            </div>
          </div>
        )}

        {/* Bantuan section */}
        <div className="pt-4">
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t("nav.sectionHelp")}
          </p>
          <div className="space-y-1">
            {HELP_NAV.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                isActive={isActive(item.href)}
                    onNavigate={onClose}
                activeChildKey={activeChildKey}
                expanded={false}
              />
            ))}
          </div>
        </div>
      </nav>
      {/* Admin access — only visible to platform admins */}
      {isPlatformAdmin && (
        <div className="border-t border-gray-200 px-3 py-3 dark:border-gray-700">
          <Link
            to="/admin"
            onClick={onClose}
            className="flex items-center gap-3 rounded-lg bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-900/20 dark:text-brand-400 dark:hover:bg-brand-900/40"
          >
            <Shield className="h-5 w-5 shrink-0" />
            <span className="flex-1">{t("nav.panelAdmin")}</span>
          </Link>
        </div>
      )}

      {/* User Profile Footer */}
      <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <Link
            to="/settings/account"
            onClick={onClose}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 -m-1 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
              {initials}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {displayName}
              </p>
              {user?.businessName && (
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {user.businessName}
                </p>
              )}
            </div>
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label={t("layout.logout")}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Slide-in overlay backdrop. In compact mode the overlay is
          available at every viewport (desktop sidebar is suppressed);
          otherwise it's mobile-only. */}
      {isOpen && (
        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/50 transition-opacity",
            !compact && "lg:hidden",
          )}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — slide-in overlay. In compact mode this is the
          only sidebar instance (no `lg:hidden` clamp); in normal
          mode it's mobile-only and the desktop fixed aside below
          handles ≥lg. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform bg-white shadow-xl transition-transform duration-300 ease-in-out dark:bg-gray-800 dark:shadow-gray-900/50",
          !compact && "lg:hidden",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent}
      </aside>

      {/* Sidebar — desktop (always visible). Suppressed in compact
          mode so the cashier flow can use the full screen width. */}
      {!compact && (
        <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-gray-200 lg:bg-white dark:lg:border-gray-700 dark:lg:bg-gray-800">
          {sidebarContent}
        </aside>
      )}
    </>
  );
}
