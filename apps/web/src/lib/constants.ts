import {
  Calculator,
  ShoppingCart,
  Package,
  Clock,
  LayoutDashboard,
  Truck,
  Tag,
  Users,
  UserCircle,
  Building2,
  MessageCircle,
  Warehouse,
  Gift,
  MessageSquare,
  Calendar,
  Globe,
  Wallet,
  Sparkles,
  ShieldCheck,
  Megaphone,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  module?: string
  /**
   * Optional query-string params for the parent row's href. TanStack
   * Router's `<Link>` takes `search` as a separate prop — it doesn't
   * parse `?…` out of the `to` string — so we keep them split.
   */
  search?: Record<string, string>
  /**
   * Optional POS-feature flag the tenant must have for the entire
   * top-level entry to render. Used by Komplit-only modules (Situs,
   * JUR-176) so free/Toko tenants don't see them in the sidebar.
   * Children carry their own `feature` filter separately.
   */
  feature?: string
  /**
   * Sub-pages that nest under this nav row in the sidebar tree. When
   * present, the row gets a chevron and auto-expands while the URL
   * matches its href prefix. Each child carries its own permission /
   * feature / role filters so the rendered list adapts per cashier.
   */
  children?: ChildNavItem[]
  /**
   * When true, this row links to an external URL (e.g. a wa.me deep
   * link) and renders as a plain `<a target="_blank">` instead of a
   * TanStack `<Link>`. `href` holds the absolute URL.
   */
  external?: boolean
}

/**
 * One sub-page under a module. Source of truth for both the sidebar
 * tree and the in-page breadcrumb — every page nested under a module
 * looks itself up here to render "Module → Page" instead of the older
 * tab strip.
 */
export interface ChildNavItem {
  /** Translation key the sidebar + breadcrumb both render through i18n. */
  labelKey: string
  href: string
  /**
   * Required search params for this child's link. When present, the
   * child is treated as a distinct nav target even if multiple rows
   * share `href` (e.g. /inventory/items?view=sellable vs
   * ?view=ingredients). Active-state matching takes both into account.
   */
  search?: Record<string, string>
  /**
   * Required permission to see this row at all. Pass an array to allow
   * "any of" — e.g. `['attendance.manage', 'attendance.report']` so a
   * read-only role can see the row without the full manage power.
   */
  permission?: string | readonly string[]
  /**
   * Tier feature flag (POS today). When set, the row is hidden until
   * the tenant's tier includes the flag.
   */
  feature?: string
  /** roleKeys to hide this row from (e.g. owner/admin shouldn't see Clock-in). */
  hideForRoles?: string[]
  /**
   * Optional grandchildren — a child can itself group sub-rows (e.g.
   * "Laporan POS" expanding into Kategori / Produk / Pelanggan /
   * Diskon / Prep & Waste). Filtering, active-state resolution and
   * expand state all recurse through this field. Keep nesting to one
   * level deep; deeper trees become unreadable in the sidebar.
   */
  children?: ChildNavItem[]
}

export const DASHBOARD_NAV: NavItem = {
  label: 'Dashboard',
  href: '/dashboard',
  icon: LayoutDashboard,
}

/**
 * Permission required to see a module in the sidebar. Owner/admin have all
 * of these; role-restricted staff only see modules their role grants.
 */
const MODULE_READ_PERMISSION: Record<string, string> = {
  hpp: 'hpp.read',
  // JUR-133: cashier has pos.transact but NOT pos.read — they need to
  // see the POS Kasir entry to do their job. pos.transact is the
  // broadest pos.* permission; everyone with read (owner/admin/
  // supervisor) also has it, so widening the gate doesn't grant
  // any extra access — it just stops hiding POS from the cashier.
  pos: 'pos.transact',
  inventory: 'inventory.read',
  attendance: 'attendance.read',
  whatsapp: 'whatsapp.read',
  booking: 'booking.read',
  // Situs editor + analytics both gate on `booking.write` (slug claim
  // ownership + tenant-site authoring share the same role gate). Without
  // this entry, staff/cashier saw Situs in the sidebar and got bounced
  // to /dashboard on click — misleading. Hiding it matches route auth.
  site: 'booking.write',
  // JUR-155: Cashflow is a financial surface — gate on pos.read so a
  // cashier (pos.transact only) never sees it. requireCashflowAccess()
  // enforces the same permission server-side.
  cashflow: 'pos.read',
  // Konten & Branding (combined photo enhancement + logo generation)
  // is an owner/admin marketing tool — gate on pos.read so a cashier
  // never sees it. Access itself is gated by the Konten credit balance.
  konten: 'pos.read',
}

export function requiredPermissionForNav(item: NavItem): string | null {
  if (!item.module) return null
  return MODULE_READ_PERMISSION[item.module] ?? null
}

export const MODULE_NAV: NavItem[] = [
  {
    label: 'HPP Calculator',
    href: '/hpp',
    icon: Calculator,
    module: 'hpp',
    children: [
      { labelKey: 'hpp.summary', href: '/hpp' },
      { labelKey: 'hpp.calculateHpp', href: '/hpp/calculate' },
      // /hpp/products retired (redirect → /hpp). Product list lives
      // on the dashboard; per-product actions in the detail modal.
    ],
  },
  // Produk — Qasir-style split. Both children point to the same
  // /inventory/items page filtered by `?view`. Separating them in the
  // sidebar keeps the cashier's mental model clean: "what I sell" vs
  // "raw bahan I track for HPP". Item rows still live in one DB table
  // (inventory_items) — only the presentation differs.
  {
    label: 'Produk',
    href: '/inventory/items',
    search: { view: 'sellable' },
    icon: Package,
    // Same module gate as inventory — Produk surfaces inventory items
    // through different filters; permission to see this section
    // collapses to inventory.read.
    module: 'inventory',
    children: [
      {
        labelKey: 'inventory.navKatalogProduk',
        href: '/inventory/items',
        search: { view: 'sellable' },
      },
      {
        labelKey: 'inventory.navBahanBaku',
        href: '/inventory/items',
        search: { view: 'ingredients' },
      },
    ],
  },
  {
    label: 'Inventaris',
    href: '/inventory',
    icon: Warehouse,
    module: 'inventory',
    children: [
      { labelKey: 'inventory.navRingkasan', href: '/inventory' },
      { labelKey: 'inventory.navItems', href: '/inventory/items' },
      { labelKey: 'inventory.navPembelian', href: '/inventory/po' },
      { labelKey: 'inventory.navRequisitions', href: '/inventory/requisitions' },
      { labelKey: 'inventory.navPenyesuaianStok', href: '/inventory/movements' },
      { labelKey: 'inventory.navBilling', href: '/inventory/billing' },
    ],
  },
  {
    label: 'Absensi',
    href: '/attendance',
    icon: Clock,
    module: 'attendance',
    children: [
      { labelKey: 'attendance.navDashboard', href: '/attendance' },
      {
        labelKey: 'attendance.navCheckIn',
        href: '/attendance/check-in',
        // Owners + admins don't clock in themselves; mirrors the old
        // AttendanceSubnav rule so the sidebar stays consistent.
        hideForRoles: ['owner', 'admin'],
      },
      {
        labelKey: 'attendance.navRecords',
        href: '/attendance/records',
        permission: ['attendance.manage', 'attendance.report'],
      },
      {
        labelKey: 'attendance.navQrHost',
        href: '/attendance/qr-host',
        permission: 'attendance.manage',
      },
      {
        labelKey: 'attendance.navShifts',
        href: '/attendance/shifts',
        permission: 'attendance.manage',
      },
      {
        labelKey: 'attendance.navBilling',
        href: '/attendance/billing',
        permission: 'attendance.manage',
      },
      {
        labelKey: 'attendance.navSettings',
        href: '/attendance/settings',
        permission: 'attendance.manage',
      },
    ],
  },
  {
    label: 'POS Kasir',
    href: '/pos',
    icon: ShoppingCart,
    module: 'pos',
    children: [
      { labelKey: 'pos.navDashboard', href: '/pos' },
      { labelKey: 'pos.navCashier', href: '/pos/cashier', permission: 'pos.transact' },
      { labelKey: 'pos.navSales', href: '/pos/sales', permission: 'pos.read' },
      {
        // Laporan POS — clickable parent that lands on the Ringkasan
        // (existing P&L overview). Chevron expands into the per-cut
        // reports: Kategori / Produk / Pelanggan / Diskon plus the
        // legacy Prep & Waste page. JUR-207: split from pos.read so
        // Kasir (who needs pos.read for /pos/sales history) doesn't
        // also see Laporan.
        labelKey: 'pos.navReports',
        href: '/pos/reports',
        permission: 'pos.report.view',
        feature: 'pl_report',
        children: [
          {
            labelKey: 'pos.navReportKategori',
            href: '/pos/reports/kategori',
            permission: 'pos.report.view',
            feature: 'pl_report',
          },
          {
            labelKey: 'pos.navReportProduk',
            href: '/pos/reports/produk',
            permission: 'pos.report.view',
            feature: 'pl_report',
          },
          {
            labelKey: 'pos.navReportPelanggan',
            href: '/pos/reports/pelanggan',
            permission: 'pos.report.view',
            feature: 'pl_report',
          },
          {
            labelKey: 'pos.navReportDiskon',
            href: '/pos/reports/diskon',
            permission: 'pos.report.view',
            feature: 'pl_report',
          },
          {
            labelKey: 'pos.navPrepWaste',
            href: '/pos/reports/prep-waste',
            permission: 'pos.report.view',
            feature: 'pl_report',
          },
        ],
      },
      {
        // JUR-141 Peti Kas — visible to everyone with pos.read. The
        // server fn filters down to "your own sessions only" for
        // cashiers (those without pos.manage) so cashiers reaching
        // this page just see their own daily history; supervisors +
        // owners see the full tenant view.
        labelKey: 'pos.navCash',
        href: '/pos/cash-sessions',
        permission: 'pos.read',
      },
      {
        labelKey: 'pos.navPromos',
        href: '/pos/promos',
        permission: 'pos.manage',
        feature: 'promo_codes',
      },
      {
        labelKey: 'pos.navLoyalty',
        href: '/pos/loyalty',
        permission: 'pos.manage',
        feature: 'loyalty_points',
      },
      { labelKey: 'pos.navSettings', href: '/pos/settings', permission: 'pos.manage' },
      { labelKey: 'pos.navBilling', href: '/pos/billing' },
    ],
  },
  // JUR-155: Cashflow Monitoring. Always visible — like Situs, it shows
  // a "Pro" lock badge for non-Komplit tenants and the route renders an
  // upgrade gate on click. `moduleStatusFor('cashflow')` decides the badge.
  {
    label: 'Cashflow',
    href: '/cashflow',
    icon: Wallet,
    module: 'cashflow',
    children: [
      { labelKey: 'cashflow.navLedger', href: '/cashflow' },
      { labelKey: 'cashflow.navDashboard', href: '/cashflow/dashboard' },
      { labelKey: 'cashflow.navBon', href: '/cashflow/bon' },
      { labelKey: 'cashflow.navCicilan', href: '/cashflow/cicilan' },
      { labelKey: 'cashflow.navAccounts', href: '/cashflow/akun' },
      { labelKey: 'cashflow.navCategories', href: '/cashflow/kategori' },
    ],
  },
  {
    label: 'WhatsApp',
    href: '/whatsapp/dashboard',
    icon: MessageCircle,
    module: 'whatsapp',
    children: [
      { labelKey: 'whatsapp.navDashboard', href: '/whatsapp/dashboard' },
      { labelKey: 'whatsapp.navInstances', href: '/whatsapp', feature: 'wa_active' },
      { labelKey: 'whatsapp.navBilling', href: '/whatsapp/billing', feature: 'wa_active' },
    ],
  },
  {
    label: 'Booking',
    href: '/booking',
    icon: Calendar,
    module: 'booking',
    children: [
      { labelKey: 'booking.navCalendar', href: '/booking' },
      { labelKey: 'booking.navSettings', href: '/booking/settings' },
    ],
  },
  // JUR-176: standalone Situs nav. Always visible — free/Toko
  // tenants see it with a "Pro" lock badge (same convention as the
  // other paid modules), Komplit tenants see it with "Aktif". Click
  // for non-Komplit lands on /site/locked which is the upsell page.
  // Sidebar's `moduleStatusFor('site')` decides the badge.
  {
    label: 'Situs',
    href: '/site/edit',
    icon: Globe,
    module: 'site',
    children: [
      { labelKey: 'site.navEditor', href: '/site/edit' },
      { labelKey: 'site.navStore', href: '/site/store' },
      { labelKey: 'site.navOrders', href: '/site/orders' },
      { labelKey: 'site.navReviews', href: '/site/reviews' },
      { labelKey: 'site.navAnalytics', href: '/site/analytics' },
    ],
  },
  // Konten & Branding — AI image generation. Combines Konten Promosi
  // (photo enhancement) and Logo AI under one parent, with a shared
  // gallery at /studio. Add-on gated by the Konten credit balance.
  {
    label: 'Konten & Branding',
    href: '/studio',
    icon: Sparkles,
    module: 'konten',
    children: [
      { labelKey: 'studio.navGallery', href: '/studio' },
      { labelKey: 'studio.navKonten', href: '/konten/generate' },
      { labelKey: 'studio.navLogo', href: '/logo/generate' },
      { labelKey: 'studio.navSpanduk', href: '/spanduk/generate' },
      { labelKey: 'studio.navBilling', href: '/studio/billing' },
    ],
  },
]

export const MASTER_DATA_NAV: Array<NavItem & { permission?: string; feature?: string }> = [
  { label: 'Cabang', href: '/master/branches', icon: Building2, permission: 'attendance.manage' },
  { label: 'Supplier & Bahan Baku', href: '/master/suppliers', icon: Truck, permission: 'hpp.read' },
  { label: 'Kategori', href: '/master/categories', icon: Tag, permission: 'hpp.read' },
  // Customer DB lives here (not under POS) because loyalty/promo will
  // attach to it from any module. Tier-gated by `customer_db` feature
  // flag — Free tenants don't see this row in the sidebar.
  {
    label: 'Pelanggan',
    href: '/master/customers',
    icon: Users,
    permission: 'pos.read',
    feature: 'customer_db',
  },
]

export const SETTINGS_NAV: Array<NavItem & { permission?: string }> = [
  // Referral lives in the Settings section for v1 — it's tenant-scoped,
  // account-adjacent, and there's only one referral page so far.
  // Promote to its own section when JUR-89 adds the commission dashboard.
  // JUR-134: gate on members.read to match Anggota Tim — staff + cashier
  // shouldn't be sharing referral codes; that's an owner/admin/supervisor
  // activity. Until referrals get their own permission, members.read is
  // the closest match (same set of roles).
  // `feature: 'referral'` gates this entry on the per-tenant referral
  // allowlist (tenant_referral_settings). The sidebar resolves it from
  // `currentUser.referralAccess`, not the POS feature set.
  {
    label: 'Referral',
    href: '/referrals',
    icon: Gift,
    permission: 'members.read',
    feature: 'referral',
  },
  { label: 'Anggota Tim', href: '/settings/members', icon: Users, permission: 'members.read' },
  { label: 'Peran & Akses', href: '/settings/roles', icon: ShieldCheck, permission: 'settings.manage' },
  { label: 'Pengumuman', href: '/settings/announcements', icon: Megaphone, permission: 'announcements.manage' },
  { label: 'Akun Saya', href: '/settings/account', icon: UserCircle },
]

/** Maps route paths to i18n translation keys */
export const ROUTE_TITLE_KEYS: Record<string, string> = {
  '/dashboard': 'route.dashboard',
  '/hpp': 'route.hpp',
  '/master/branches': 'route.branches',
  '/master/suppliers': 'route.suppliers',
  '/master/categories': 'route.categories',
  '/hpp/products': 'route.hppProducts',
  '/hpp/calculate': 'route.hppCalculate',
  '/pos': 'route.pos',
  '/inventory': 'route.inventory',
  '/attendance': 'route.attendance',
  '/settings/members': 'route.settingsMembers',
  '/settings/roles': 'route.settingsRoles',
  '/settings/account': 'route.account',
  '/notifications': 'route.notifications',
  '/referrals': 'route.referrals',
  '/booking': 'route.booking',
  '/booking/settings': 'route.bookingSettings',
  '/site/edit': 'route.siteEdit',
  '/site/store': 'route.siteStore',
  '/site/orders': 'route.siteOrders',
  '/site/reviews': 'route.siteReviews',
  '/site/analytics': 'route.siteAnalytics',
  '/cashflow': 'route.cashflow',
  '/cashflow/dashboard': 'route.cashflowDashboard',
  '/cashflow/bon': 'route.cashflowBon',
  '/cashflow/cicilan': 'route.cashflowCicilan',
  '/cashflow/akun': 'route.cashflowAccounts',
  '/cashflow/kategori': 'route.cashflowCategories',
}

export const BUSINESS_CATEGORIES = [
  'Makanan & Minuman',
  'Kafe & Resto',
  'Retail & Toko',
  'Fashion & Tekstil',
  'Kerajinan & Handmade',
  'Jasa & Layanan',
  'Pertanian & Peternakan',
  'Manufaktur',
  'Kesehatan & Kecantikan',
  'Pendidikan',
  'Lainnya',
] as const

export const EMPLOYEE_RANGES = [
  'Hanya saya sendiri',
  '2-5 orang',
  '6-19 orang',
  '20-50 orang',
  '50+ orang',
] as const

// JUR-127: single source of truth for the sales WhatsApp number.
// Previously this was duplicated as a `const WA_PHONE = '...'` in ~10
// route files — easy to typo, and the original placeholder
// '628123456789' silently sent every "Hubungi Sales" / "Aktifkan" CTA
// into the void. Centralizing here so the next phone change is a
// single edit.
export const SALES_WHATSAPP_PHONE = '6285881732869'

/**
 * Build a `https://wa.me/...?text=...` URL for the sales WhatsApp
 * number. The `text` is URL-encoded automatically — pass the raw
 * Indonesian message as you want it to appear in the customer's
 * WhatsApp draft.
 *
 * Sales team is Indonesian-speaking, so message text stays in
 * Indonesian regardless of the user's UI locale.
 */
export function buildSalesWaUrl(message: string): string {
  return `https://wa.me/${SALES_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`
}

// Help section nav. Defined here (after buildSalesWaUrl) so the
// WhatsApp contact row can deep-link to the support number with a
// pre-filled Indonesian draft message.
export const HELP_NAV: NavItem[] = [
  { label: 'Kirim Feedback', href: '/help/feedback', icon: MessageSquare },
  {
    label: 'Hubungi WhatsApp',
    href: buildSalesWaUrl(
      'Halo Tim Vintra, saya ingin bertanya tentang aplikasi Vintra.',
    ),
    icon: MessageCircle,
    external: true,
  },
]
