import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
  Cloud,
  Loader2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getAdminSystemMetrics } from '@/server/functions/admin-monitoring'
import { formatDate, formatNumberID } from '@/lib/utils' // JUR-137

export const Route = createFileRoute('/admin/monitoring')({
  component: AdminMonitoring,
})

function AdminMonitoring() {
  const { t } = useTranslation()
  const [autoRefresh, setAutoRefresh] = React.useState(false)
  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['admin-system-metrics'],
    queryFn: () => getAdminSystemMetrics(),
    // 10s staleTime gives a sensible default cadence when the user
    // clicks refresh repeatedly. Auto-refresh below is a separate knob.
    staleTime: 10 * 1000,
    refetchInterval: autoRefresh ? 30_000 : false,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  // Hook is always called — handle the "not yet fetched" case inside.
  const updatedRel = useFormatRelative(
    dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : null,
  )

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t('admin.monitoring.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('admin.monitoring.subtitleTpl', { relative: updatedRel })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            {t('admin.monitoring.autoRefresh')}
          </label>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            {t('admin.monitoring.refresh')}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <p className="font-semibold">{t('admin.monitoring.loadError')}</p>
          <p className="mt-1 break-words">
            {error instanceof Error ? error.message : String(error)}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {t('admin.monitoring.retry')}
          </button>
        </div>
      ) : isLoading || !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* RAM */}
          <MetricCard
            icon={MemoryStick}
            label={t('admin.monitoring.card.ram')}
            value={`${formatBytes(data.ram.usedBytes)} / ${formatBytes(data.ram.totalBytes)}`}
            subValue={t('admin.monitoring.card.ramSubTpl', {
              cache: formatBytes(data.ram.cachedBytes),
              available: formatBytes(data.ram.availableBytes),
            })}
            pct={data.ram.pct}
          />

          {/* CPU load */}
          <MetricCard
            icon={Cpu}
            label={t('admin.monitoring.card.cpu')}
            value={`${data.cpu.load1.toFixed(2)} · ${data.cpu.load5.toFixed(2)} · ${data.cpu.load15.toFixed(2)}`}
            subValue={t('admin.monitoring.card.cpuSubTpl', { cores: data.cpu.cpus })}
            // Load avg > number of cores = sustained backlog. 100% threshold.
            pct={Math.min(1, data.cpu.load1 / Math.max(1, data.cpu.cpus))}
          />

          {/* Disk: root */}
          {data.diskRoot ? (
            <MetricCard
              icon={HardDrive}
              label={t('admin.monitoring.card.diskRoot')}
              value={`${formatBytes(data.diskRoot.usedBytes)} / ${formatBytes(data.diskRoot.totalBytes)}`}
              subValue={t('admin.monitoring.card.diskRootSubTpl', {
                available: formatBytes(data.diskRoot.availableBytes),
              })}
              pct={data.diskRoot.pct}
            />
          ) : (
            <UnavailableCard icon={HardDrive} label={t('admin.monitoring.card.diskRoot')} />
          )}

          {/* Disk: api data dir */}
          {data.diskApiData ? (
            <MetricCard
              icon={Database}
              label={t('admin.monitoring.card.apiData')}
              value={formatBytes(data.diskApiData.bytes)}
              subValue={t('admin.monitoring.card.apiDataSub')}
            />
          ) : (
            <UnavailableCard icon={Database} label={t('admin.monitoring.card.apiData')} />
          )}

          {/* S3 bucket — wider card with the per-kind breakdown */}
          <S3Card s3={data.s3} />

          {/* Uptime */}
          <MetricCard
            icon={Server}
            label={t('admin.monitoring.card.uptime')}
            value={t('admin.monitoring.card.uptimeValueTpl', {
              web: formatDuration(data.uptime.webSeconds),
              api: formatDuration(data.uptime.api.seconds),
            })}
            subValue={
              data.uptime.api.version
                ? t('admin.monitoring.card.uptimeBuildTpl', { version: data.uptime.api.version })
                : t('admin.monitoring.card.uptimeNoHealthz')
            }
          />
        </div>
      )}
    </div>
  )
}

// ── Cards ─────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon,
  label,
  value,
  subValue,
  pct,
}: {
  icon: LucideIcon
  label: string
  value: string
  subValue?: string
  /** 0..1; renders a coloured bar when provided. */
  pct?: number
}) {
  const barColor =
    pct === undefined
      ? ''
      : pct > 0.85
        ? 'bg-red-500'
        : pct > 0.7
          ? 'bg-warning-500'
          : 'bg-success-500'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <Icon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </p>
      {subValue && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {subValue}
        </p>
      )}
      {pct !== undefined && (
        <div className="mt-3 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-700">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }}
            role="progressbar"
            aria-valuenow={Math.round(pct * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
    </div>
  )
}

function UnavailableCard({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <Icon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">
        {t('admin.monitoring.card.unavailable')}
      </p>
    </div>
  )
}

function S3Card({
  s3,
}: {
  s3: {
    totalBytes: number
    objectCount: number
    truncated: boolean
    byKind: Record<string, { bytes: number; objectCount: number }>
    scannedAt: string
  }
}) {
  const { t } = useTranslation()
  const scannedRel = useFormatRelative(s3.scannedAt)
  const kinds = Object.entries(s3.byKind)
    .filter(([, v]) => v.objectCount > 0)
    .sort(([, a], [, b]) => b.bytes - a.bytes)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('admin.monitoring.s3.title')}
        </p>
        <Cloud className="h-4 w-4 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
        {formatBytes(s3.totalBytes)}
        <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
          {t('admin.monitoring.s3.totalSuffixTpl', { count: formatNumberID(s3.objectCount) })}
        </span>
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {t('admin.monitoring.s3.scannedTpl', { relative: scannedRel })}
        {s3.truncated && t('admin.monitoring.s3.truncatedSuffix')}
      </p>

      {kinds.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">
          {t('admin.monitoring.s3.empty')}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm">
          {kinds.map(([kind, v]) => {
            const pct = s3.totalBytes > 0 ? v.bytes / s3.totalBytes : 0
            const label = t(`admin.monitoring.s3.kind.${kind}`, { defaultValue: kind })
            return (
              <li key={kind} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-gray-600 dark:text-gray-400">{label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                  <div
                    className="h-full rounded-full bg-brand-500 dark:bg-brand-400"
                    style={{ width: `${Math.max(2, pct * 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-gray-700 tabular-nums dark:text-gray-300">
                  {formatBytes(v.bytes)}
                </span>
                <span className="w-12 shrink-0 text-right text-xs text-gray-400 tabular-nums">
                  {formatNumberID(v.objectCount)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Formatting helpers ────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  const min = Math.floor(seconds / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  const day = Math.floor(hr / 24)
  return `${day}d ${hr % 24}h`
}

function useFormatRelative(iso: string | null): string {
  const { t } = useTranslation()
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const sec = Math.floor(diffMs / 1000)
  if (sec < 5) return t('admin.monitoring.relJustNow')
  if (sec < 60) return t('admin.monitoring.relSecTpl', { sec })
  const min = Math.floor(sec / 60)
  if (min < 60) return t('admin.monitoring.relMinTpl', { min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('admin.monitoring.relHourTpl', { hr })
  return formatDate(iso, 'dd MMM, HH:mm')
}
