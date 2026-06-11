import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Users,
  MapPin,
  Settings as SettingsIcon,
  Clock,
  ArrowRight,
  UserCheck,
  UserX,
  UserMinus,
  TrendingUp,
  Package,
} from 'lucide-react'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils' // JUR-137
import {
  getAttendanceOverview,
  getAttendanceDashboardStats,
} from '@/server/functions/attendance-settings'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'

export const Route = createFileRoute('/_authed/attendance/')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    const perms = user?.permissions ?? []
    if (
      !perms.includes('attendance.manage') &&
      !perms.includes('attendance.report')
    ) {
      throw redirect({ to: '/attendance/check-in' })
    }
  },
  loader: () => getAttendanceOverview(),
  component: AttendanceDashboard,
})

function AttendanceDashboard() {
  const overview = Route.useLoaderData()
  const { selectedBranchId } = useBranch()
  const { t } = useTranslation()

  // Today/7-day/top-late stats re-fetch on branch change; the overview
  // (settings, plan, tenant-wide counts) stays branch-agnostic.
  const { data: stats } = useQuery({
    queryKey: ['attendance', 'dashboard-stats', selectedBranchId],
    queryFn: () =>
      getAttendanceDashboardStats({
        data: { branchId: selectedBranchId ?? undefined },
      }),
  })

  const { settings, staff, branches, currentPlan } = overview
  const expiresAt = settings.subscriptionExpiresAt
    ? new Date(settings.subscriptionExpiresAt)
    : null

  const enabledModes: string[] = []
  if (settings.modeGpsEnabled) enabledModes.push(t('attendance.mode_gps_short'))
  if (settings.modePhotoEnabled) enabledModes.push(t('attendance.mode_photo_short'))
  if (settings.modeQrEnabled) enabledModes.push(t('attendance.mode_qr_short'))
  const modesLabel = enabledModes.length > 0 ? enabledModes.join(' + ') : '—'

  // Compact plan label. For paid plans: "12 Bulan · Rp 5.000/staf/bln".
  // For an active trial: "Trial · X hari lagi" so the tenant sees the
  // clock ticking without having to dig.
  let planLabel = '—'
  if (currentPlan) {
    if (currentPlan.isTrial && currentPlan.periodEndAt) {
      const daysLeft = Math.max(
        0,
        Math.ceil(
          (new Date(currentPlan.periodEndAt).getTime() - Date.now()) /
            (24 * 60 * 60 * 1000),
        ),
      )
      planLabel = `${t(currentPlan.labelKey)} · ${t('attendance.trialDaysLeft', { days: daysLeft })}`
    } else {
      planLabel = `${t(currentPlan.labelKey)} · Rp ${formatRupiah(currentPlan.pricePerStaffPerMonth)}/${t('attendance.perStaffPerMonth')}`
    }
  }

  if (!stats) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('common.loading')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('attendance.dashboardTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('attendance.dashboardSubtitle')}
        </p>
      </div>

      {/* Today's breakdown. Advanced (schedule-backed) tenants get the
          on-time/late split; simple-mode tenants get plain presence. */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('attendance.statsTodayTitle')}
        </h2>
        {stats.hasScheduledBranch ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatusCard
              label={t('attendance.statsOnTime')}
              value={stats.today.onTime}
              total={stats.today.totalActiveStaff}
              color="green"
              icon={<UserCheck className="h-5 w-5" />}
            />
            <StatusCard
              label={t('attendance.statsLate')}
              value={stats.today.late}
              total={stats.today.totalActiveStaff}
              color="amber"
              icon={<Clock className="h-5 w-5" />}
            />
            <StatusCard
              label={t('attendance.statsAbsent')}
              value={stats.today.absent}
              total={stats.today.totalActiveStaff}
              color="red"
              icon={<UserX className="h-5 w-5" />}
            />
            <StatusCard
              label={t('attendance.statsClockedOut')}
              value={stats.today.clockedOut}
              total={stats.today.totalActiveStaff}
              color="gray"
              icon={<UserMinus className="h-5 w-5" />}
            />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatusCard
              label={t('attendance.statsPresent')}
              value={stats.today.presentToday}
              total={stats.today.totalActiveStaff}
              color="green"
              icon={<UserCheck className="h-5 w-5" />}
            />
            <StatusCard
              label={t('attendance.statsAbsent')}
              value={stats.today.absent}
              total={stats.today.totalActiveStaff}
              color="red"
              icon={<UserX className="h-5 w-5" />}
            />
            <StatusCard
              label={t('attendance.statsClockedOut')}
              value={stats.today.clockedOut}
              total={stats.today.totalActiveStaff}
              color="gray"
              icon={<UserMinus className="h-5 w-5" />}
            />
          </div>
        )}
      </div>

      {/* 7-day chart — on-time/late only makes sense for scheduled branches */}
      {stats.hasScheduledBranch && (
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {t('attendance.statsSevenDayTitle')}
            </h2>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-success-500 dark:bg-success-400" />
              {t('attendance.statsOnTime')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-warning-500 dark:bg-warning-400" />
              {t('attendance.statsLate')}
            </span>
          </div>
        </div>
        <SevenDayChart data={stats.sevenDays} />
      </div>
      )}

      {/* Top late + Configuration side by side. The top-late list is
          schedule-only; in simple mode the config card stands alone. */}
      <div className={stats.hasScheduledBranch ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'}>
        {/* Top late staff */}
        {stats.hasScheduledBranch && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t('attendance.statsTopLateTitle')}
          </h2>
          {stats.topLateThisMonth.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('attendance.statsTopLateEmpty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {stats.topLateThisMonth.map((s, i) => (
                <li
                  key={s.staffId}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {s.staffName}
                    </span>
                  </div>
                  <span className="text-sm text-warning-700 dark:text-warning-400">
                    {t('attendance.statsLateCount', { count: s.lateCount })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}

        {/* Config summary */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t('attendance.statsConfigTitle')}
          </h2>
          <dl className="space-y-3 text-sm">
            <InfoLine
              icon={<Users className="h-4 w-4 text-gray-400" />}
              label={t('attendance.statActiveStaff')}
              value={`${staff.active} / ${staff.total}`}
            />
            <InfoLine
              icon={<MapPin className="h-4 w-4 text-gray-400" />}
              label={t('attendance.statBranches')}
              value={`${branches.active} / ${branches.total}`}
            />
            <InfoLine
              icon={<SettingsIcon className="h-4 w-4 text-gray-400" />}
              label={t('attendance.statActiveMode')}
              value={modesLabel}
            />
            <InfoLine
              icon={<Package className="h-4 w-4 text-gray-400" />}
              label={t('attendance.statPlan')}
              value={planLabel}
            />
            {currentPlan && (
              <InfoLine
                icon={<Users className="h-4 w-4 text-gray-400" />}
                label={t('attendance.statBilledStaff')}
                value={t('attendance.billedStaffValue', {
                  count: currentPlan.billedStaffCount ?? 0,
                })}
              />
            )}
            <InfoLine
              icon={<Clock className="h-4 w-4 text-gray-400" />}
              label={t('attendance.statSubscription')}
              value={
                expiresAt ? formatDate(expiresAt, 'dd MMM yyyy') : '—'
              }
            />
          </dl>
        </div>
      </div>

      {/* Quick nav */}
      <div className="grid gap-4 sm:grid-cols-2">
        <QuickCard
          title={t('attendance.quickStaff')}
          description={t('attendance.quickStaffDesc')}
          href="/settings/members"
          icon={<Users className="h-6 w-6" />}
        />
        <QuickCard
          title={t('attendance.quickBranches')}
          description={t('attendance.quickBranchesDesc')}
          href="/attendance/branches"
          icon={<MapPin className="h-6 w-6" />}
        />
      </div>
    </div>
  )
}

// ─── UI primitives ─────────────────────────────────

function StatusCard({
  label,
  value,
  total,
  color,
  icon,
}: {
  label: string
  value: number
  total: number
  color: 'green' | 'amber' | 'red' | 'gray'
  icon: React.ReactNode
}) {
  const iconClass: Record<typeof color, string> = {
    green: 'text-success-600 dark:text-success-400',
    amber: 'text-warning-700 dark:text-warning-400',
    red: 'text-danger-600 dark:text-danger-400',
    gray: 'text-gray-600 dark:text-gray-400',
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {label}
        </span>
        <span className={iconClass[color]}>{icon}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
        {value}
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {total > 0 ? `${Math.round((value / total) * 100)}% dari ${total}` : '—'}
      </p>
    </div>
  )
}

function SevenDayChart({
  data,
}: {
  data: Array<{ date: string; onTime: number; late: number }>
}) {
  const { t, i18n } = useTranslation()
  const [hovered, setHovered] = useState<string | null>(null)
  const max = Math.max(1, ...data.map((d) => d.onTime + d.late))
  const dateLocale = i18n.language === 'en' ? 'en-US' : 'id-ID'
  return (
    // No `items-end` here on purpose: it would prevent each column
    // from stretching to the 160px row height, and the bar container's
    // `flex-1` would collapse to 0, leaving the percentage-height
    // colored segments invisible. Default `align-items: stretch` is
    // what makes the bars actually render. Bars still anchor to the
    // bottom via `justify-end` on the bar container.
    <div className="flex h-40 gap-2 sm:gap-4">
      {data.map((d) => {
        const onTimePct = (d.onTime / max) * 100
        const latePct = (d.late / max) * 100
        const total = d.onTime + d.late
        const day = new Date(d.date)
        const label = day.toLocaleDateString(dateLocale, { weekday: 'short' })
        const fullDate = day.toLocaleDateString(dateLocale, {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
        })
        const isHovered = hovered === d.date
        return (
          <div
            key={d.date}
            className="relative flex flex-1 flex-col items-center gap-2"
            onMouseEnter={() => setHovered(d.date)}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Custom tooltip — appears above the bar on hover. Native
                `title` attribute is unreliable (slow appearance, plain
                styling, hidden on touch devices) so we render our own. */}
            {isHovered && (
              <div className="pointer-events-none absolute -top-2 left-1/2 z-10 w-max -translate-x-1/2 -translate-y-full rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-gray-700">
                <p className="font-semibold">{fullDate}</p>
                <p className="mt-1 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-success-400" />
                  {t('attendance.statsOnTime')}: {d.onTime}
                </p>
                <p className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-warning-400" />
                  {t('attendance.statsLate')}: {d.late}
                </p>
                {/* Tooltip arrow */}
                <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
              </div>
            )}
            <div className="flex w-full max-w-[48px] flex-1 cursor-default flex-col justify-end overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700">
              {latePct > 0 && (
                <div
                  className="bg-warning-500 dark:bg-warning-400"
                  style={{ height: `${latePct}%` }}
                />
              )}
              {onTimePct > 0 && (
                <div
                  className="bg-success-500 dark:bg-success-400"
                  style={{ height: `${onTimePct}%` }}
                />
              )}
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-gray-900 dark:text-gray-100">
                {total}
              </p>
              <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">
                {label}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function InfoLine({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <dt className="text-gray-600 dark:text-gray-400">{label}</dt>
      </div>
      <dd className="font-medium text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  )
}

function QuickCard({
  title,
  description,
  href,
  icon,
}: {
  title: string
  description: string
  href: string
  icon: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Link
      to={href}
      className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
        {icon}
      </div>
      <h3 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      <p className="mb-4 flex-1 text-sm text-gray-600 dark:text-gray-400">
        {description}
      </p>
      <div className="flex items-center text-sm font-medium text-brand-600 dark:text-brand-400">
        {t('common.open')}
        <ArrowRight className="ml-1 h-4 w-4" />
      </div>
    </Link>
  )
}
