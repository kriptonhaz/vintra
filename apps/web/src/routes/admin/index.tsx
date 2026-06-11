import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { formatDate } from '@/lib/utils' // JUR-137
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Building2,
  Users,
  Boxes,
  DollarSign,
  MessageSquare,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { getAdminDashboardStats, formatMrrLabel } from '@/server/functions/admin-dashboard'

export const Route = createFileRoute('/admin/')({
  component: AdminDashboard,
})

function AdminDashboard() {
  const { t } = useTranslation()
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-dashboard-stats'],
    queryFn: () => getAdminDashboardStats(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t('admin.dashboard.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('admin.dashboard.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          {t('admin.dashboard.refresh')}
        </button>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <p className="font-semibold">{t('admin.dashboard.loadError')}</p>
          <p className="mt-1 break-words">
            {error instanceof Error ? error.message : String(error)}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {t('admin.dashboard.retry')}
          </button>
        </div>
      ) : isLoading || !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              icon={Building2}
              label={t('admin.dashboard.statNewTenants')}
              primary={t('admin.dashboard.tplDays7', { count: data.newTenants.last7 })}
              secondary={t('admin.dashboard.tplDays30', { count: data.newTenants.last30 })}
              spark={data.newTenants.spark}
            />
            <StatCard
              icon={Users}
              label={t('admin.dashboard.statNewMembers')}
              primary={t('admin.dashboard.tplDays7', { count: data.newMembers.last7 })}
              secondary={t('admin.dashboard.tplDays30', { count: data.newMembers.last30 })}
              spark={data.newMembers.spark}
            />
            <StatCard
              icon={Boxes}
              label={t('admin.dashboard.statActiveModules')}
              primary={`${data.modulesActive.total}`}
              secondary={t('admin.dashboard.modulesBreakdownTpl', {
                pos: data.modulesActive.pos,
                inventory: data.modulesActive.inventory,
                attendance: data.modulesActive.attendance,
                whatsapp: data.modulesActive.whatsapp,
              })}
            />
            <StatCard
              icon={DollarSign}
              label={t('admin.dashboard.statMrr')}
              primary={formatMrrLabel(data.mrrIdr.total)}
              secondary={t('admin.dashboard.mrrBreakdownTpl', {
                pos: formatMrrLabel(data.mrrIdr.breakdown.pos),
                inventory: formatMrrLabel(data.mrrIdr.breakdown.inventory),
                attendance: formatMrrLabel(data.mrrIdr.breakdown.attendance),
                whatsapp: formatMrrLabel(data.mrrIdr.breakdown.whatsapp),
              })}
              note={t('admin.dashboard.mrrNote')}
            />
            <StatCard
              icon={MessageSquare}
              label={t('admin.dashboard.statActiveWaInstances')}
              primary={`${data.activeWhatsappInstances}`}
              secondary={t('admin.dashboard.connected')}
            />
          </div>

          <RecentActivity rows={data.recentActivity} />
        </>
      )}
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  primary,
  secondary,
  note,
  spark,
}: {
  icon: React.ElementType
  label: string
  primary: string
  secondary?: string
  note?: string
  spark?: number[]
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <Icon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
        {primary}
      </p>
      {secondary && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {secondary}
        </p>
      )}
      {spark && spark.length > 0 && <Sparkline data={spark} />}
      {note && (
        <p className="mt-2 text-[11px] italic text-gray-400 dark:text-gray-500">
          {note}
        </p>
      )}
    </div>
  )
}

// Inline SVG sparkline. No charting lib dependency — 7 daily counts as a
// polyline, scaled to fit the card.
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data)
  const w = 100
  const h = 24
  const stepX = data.length > 1 ? w / (data.length - 1) : 0
  const points = data
    .map((v, i) => {
      const x = i * stepX
      const y = h - (v / max) * h
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg
      className="mt-2 h-6 w-full text-brand-500 dark:text-brand-400"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  )
}

function RecentActivity({
  rows,
}: {
  rows: Array<{
    id: string
    action: string
    adminUserId: string
    targetTenantId: string | null
    createdAt: string
    metadata: Record<string, {} | null> | null
  }>
}) {
  const { t } = useTranslation()
  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('admin.dashboard.recentTitle')}
        </h2>
        <Link
          to="/admin/audit-log"
          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t('admin.dashboard.recentSeeAll')}
        </Link>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('admin.dashboard.recentEmpty')}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                  {row.action}
                </p>
                {row.targetTenantId && (
                  <Link
                    to="/admin/tenants/$tenantId"
                    params={{ tenantId: row.targetTenantId }}
                    className="text-xs text-brand-600 hover:underline dark:text-brand-400"
                  >
                    {t('admin.dashboard.tenantPrefix', { id: row.targetTenantId.slice(0, 8) })}
                  </Link>
                )}
              </div>
              <time
                className="shrink-0 text-xs text-gray-400 dark:text-gray-500"
                dateTime={row.createdAt}
              >
                <RelativeTime iso={row.createdAt} />
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RelativeTime({ iso }: { iso: string }) {
  const { t } = useTranslation()
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return <>{t('admin.dashboard.relJustNow')}</>
  if (min < 60) return <>{t('admin.dashboard.relMinTpl', { min })}</>
  const hr = Math.floor(min / 60)
  if (hr < 24) return <>{t('admin.dashboard.relHourTpl', { hr })}</>
  const day = Math.floor(hr / 24)
  if (day < 7) return <>{t('admin.dashboard.relDayTpl', { day })}</>
  return <>{formatDate(iso, 'dd MMM')}</>
}

function DashboardSkeleton() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  )
}
