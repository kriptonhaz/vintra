import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { getDashboardStats } from '@/server/functions/dashboard'
import { formatRupiah } from '@/lib/currency'
import { useCurrentUser } from '@/hooks/use-permissions'
import {
  Calculator,
  Package,
  ShoppingCart,
  Clock,
  BarChart3,
  ArrowRight,
  HelpCircle,
  MessageCircle,
} from 'lucide-react'
import {
  OnboardingTour,
  useOnboardingTour,
} from '@/components/onboarding/onboarding-tour'

export const Route = createFileRoute('/_authed/dashboard')({
  beforeLoad: ({ context }) => {
    // Role-restricted users don't have hpp.read → the HPP-centric
    // dashboard is useless to them. Redirect to whichever workflow
    // matches their permissions:
    //   pos.transact (cashier) → /pos/cashier
    //   attendance.read (staff) → /attendance (which itself redirects
    //                            to /attendance/check-in)
    //   none of the above       → /settings/account as a safe landing
    //
    // JUR-133: previously this unconditionally redirected to /attendance,
    // which sent cashiers to a clock-in page they have no permission to
    // use ("Akun Anda belum terdaftar sebagai staf di tenant ini").
    const user = (context as { user?: { permissions?: string[] } }).user
    const perms = user?.permissions ?? []
    if (perms.includes('hpp.read')) return
    if (perms.includes('pos.transact')) {
      throw redirect({ to: '/pos/cashier' })
    }
    if (perms.includes('attendance.read')) {
      throw redirect({ to: '/attendance' })
    }
    throw redirect({ to: '/settings/account' })
  },
  loader: () => getDashboardStats(),
  component: DashboardPage,
})

function DashboardPage() {
  const { t } = useTranslation()
  const stats = Route.useLoaderData()
  const { data: user } = useCurrentUser()
  const activeModules: string[] = user?.tenant?.activeModules ?? []
  const attendanceSub = user?.moduleSubscriptions?.attendance
  const inventorySub = user?.moduleSubscriptions?.inventory
  const posSub = user?.moduleSubscriptions?.pos
  // Consistent with the attendance route guard: listed in activeModules
  // AND (paid subscription valid OR trial is running). Otherwise the
  // card shows "Pro" / CTA rather than pretending the module works.
  const paidOk =
    (attendanceSub?.active ?? false) && !(attendanceSub?.isExpired ?? true)
  const trialOk = attendanceSub?.trialActive ?? false
  const isAttendanceActive =
    activeModules.includes('attendance') && (paidOk || trialOk)

  // POS + Inventory have permanent Free tiers — every tenant can use
  // them. The card always links to the module; the badge just signals
  // the tier the tenant is on so they know whether they're paying.
  // Earlier this was hardcoded "Segera Hadir" for both, which lied to
  // tenants on Toko/Komplit who CAN see the modules in the sidebar.
  function moduleBadge(
    sub: { tier: string; active: boolean; isExpired: boolean; trialActive: boolean } | undefined,
  ): { label: string; color: string } {
    const paid = sub && sub.tier !== 'free' && sub.active && !sub.isExpired
    if (paid) {
      return {
        label: t('dashboard.active'),
        color:
          'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
      }
    }
    if (sub?.trialActive) {
      return {
        label: 'Trial',
        color:
          'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400',
      }
    }
    return {
      label: t('dashboard.free'),
      color:
        'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400',
    }
  }
  const posBadge = moduleBadge(posSub)
  const inventoryBadge = moduleBadge(inventorySub)

  // WhatsApp AI is an add-on with a simpler subscription shape (no
  // trial / free tier). Badge is "Aktif" when paid, "Add-on" otherwise.
  const whatsappSub = user?.moduleSubscriptions?.whatsapp
  const isWhatsappActive = !!whatsappSub?.active

  // JUR-13: Onboarding tour. Auto-opens on first visit per (browser,
  // tenant); the "?" icon next to the page title re-launches it
  // anytime so the owner can refresh on the flow later.
  const tour = useOnboardingTour(user?.tenant?.id)

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('dashboard.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={tour.startTour}
          aria-label="Mulai tour"
          title="Pelajari fitur Vintra"
          className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-brand-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-brand-400"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
      </div>

      <OnboardingTour open={tour.open} onClose={tour.dismissForever} />

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('dashboard.totalProducts')}
          value={stats.products.count.toString()}
          icon={<Package className="h-5 w-5 text-primary-600 dark:text-primary-400" />}
        />
        <StatCard
          label={t('dashboard.totalMaterials')}
          value={stats.materials.count.toString()}
          icon={<Calculator className="h-5 w-5 text-accent-600 dark:text-accent-400" />}
        />
        <StatCard
          label={t('dashboard.avgMargin')}
          value={
            stats.products.avgMargin !== null
              ? `${stats.products.avgMargin.toFixed(1)}%`
              : '-'
          }
          icon={<BarChart3 className="h-5 w-5 text-success-600 dark:text-success-400" />}
        />
        <StatCard
          label={t('dashboard.monthlyOverhead')}
          value={formatRupiah(stats.overheads.totalMonthly)}
          icon={<ShoppingCart className="h-5 w-5 text-red-500 dark:text-red-400" />}
        />
      </div>

      {/* Module Cards */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.modules')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ModuleCard
            title={t('dashboard.hppCalc')}
            description={t('dashboard.hppCalcDesc')}
            href="/hpp"
            icon={<Calculator className="h-6 w-6" />}
            badge={t('dashboard.free')}
            badgeColor="bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
          />
          <ModuleCard
            title={t('dashboard.pos')}
            description={t('dashboard.posDesc')}
            href="/pos"
            icon={<ShoppingCart className="h-6 w-6" />}
            badge={posBadge.label}
            badgeColor={posBadge.color}
          />
          <ModuleCard
            title={t('dashboard.inventory')}
            description={t('dashboard.inventoryDesc')}
            href="/inventory"
            icon={<Package className="h-6 w-6" />}
            badge={inventoryBadge.label}
            badgeColor={inventoryBadge.color}
          />
          <ModuleCard
            title={t('dashboard.attendance')}
            description={t('dashboard.attendanceDesc')}
            href="/attendance"
            icon={<Clock className="h-6 w-6" />}
            badge={
              isAttendanceActive
                ? t('dashboard.active')
                : t('common.pro')
            }
            badgeColor={
              isAttendanceActive
                ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                : 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400'
            }
          />
          <ModuleCard
            title={t('dashboard.whatsapp')}
            description={t('dashboard.whatsappDesc')}
            href="/whatsapp/dashboard"
            icon={<MessageCircle className="h-6 w-6" />}
            badge={isWhatsappActive ? t('dashboard.active') : 'Add-on'}
            badgeColor={
              isWhatsappActive
                ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                : 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400'
            }
          />
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</span>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  )
}

function ModuleCard({
  title,
  description,
  href,
  icon,
  badge,
  badgeColor,
  locked,
}: {
  title: string
  description: string
  href: string
  icon: React.ReactNode
  badge: string
  badgeColor: string
  locked?: boolean
}) {
  const { t } = useTranslation()

  const content = (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:shadow-gray-900/50">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
          {icon}
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeColor}`}
        >
          {badge}
        </span>
      </div>
      <h3 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="mb-4 flex-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>
      <div className="flex items-center text-sm font-medium text-primary-600 dark:text-primary-400">
        {locked ? t('dashboard.comingSoonAction') : t('dashboard.openModule')}
        <ArrowRight className="ml-1 h-4 w-4" />
      </div>
    </div>
  )

  if (locked) {
    return <div className="cursor-not-allowed opacity-60">{content}</div>
  }

  return <Link to={href}>{content}</Link>
}
