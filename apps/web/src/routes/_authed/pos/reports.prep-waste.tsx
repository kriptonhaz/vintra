/**
 * JUR-15 step 7: prep waste / leftover report.
 *
 * Answers the owner's "am I over-prepping?" question. Groups
 * inventory_item_prep_batches by (day × item × branch) and shows
 * prepared / consumed / leftover with a soft over-prep warning when
 * leftover / prepared exceeds 20%.
 *
 * Same tier gate as the P&L report (`pl_report`).
 */
import * as React from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, ChefHat } from 'lucide-react'
import {
  getPrepWasteReport,
  type PrepWasteRow,
} from '@/server/functions/pos-prep'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Select } from '@/components/ui/select'
import { formatDate, formatNumberID } from '@/lib/utils' // JUR-137
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/_authed/pos/reports/prep-waste')({
  // JUR-207: prep-waste is part of Laporan — gate matches /pos/reports.
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('pos.report.view')) {
      throw redirect({ to: '/pos' })
    }
  },
  component: PrepWasteReportPage,
})

type Preset = 'today' | 'last7' | 'last30' | 'thisMonth'

const PRESET_LABEL: Record<Preset, string> = {
  today: 'Hari ini',
  last7: '7 hari',
  last30: '30 hari',
  thisMonth: 'Bulan ini',
}

function presetRange(preset: Preset): { from: string; to: string } {
  // Jakarta wall clock — same idiom as the P&L report. The server
  // expects YYYY-MM-DD and treats both ends inclusive.
  const now = new Date()
  const jakartaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const ymd = (d: Date) => d.toISOString().slice(0, 10)

  switch (preset) {
    case 'today':
      return { from: ymd(jakartaNow), to: ymd(jakartaNow) }
    case 'last7': {
      const start = new Date(jakartaNow)
      start.setUTCDate(start.getUTCDate() - 6)
      return { from: ymd(start), to: ymd(jakartaNow) }
    }
    case 'last30': {
      const start = new Date(jakartaNow)
      start.setUTCDate(start.getUTCDate() - 29)
      return { from: ymd(start), to: ymd(jakartaNow) }
    }
    case 'thisMonth': {
      const start = new Date(jakartaNow)
      start.setUTCDate(1)
      return { from: ymd(start), to: ymd(jakartaNow) }
    }
  }
}

const OVER_PREP_THRESHOLD = 0.2 // 20% leftover = "wasted"

function PrepWasteReportPage() {
  // Default to last 7 days — typical "how was this week" owner question.
  const [preset, setPreset] = React.useState<Preset>('last7')
  const range = presetRange(preset)

  const report = useQuery({
    queryKey: ['prep-waste', range.from, range.to],
    queryFn: () =>
      getPrepWasteReport({
        data: { dateFrom: range.from, dateTo: range.to },
      }),
    staleTime: 60 * 1000,
  })

  const rows = report.data ?? []

  // Top-line stats for the header cards.
  const totals = React.useMemo(() => {
    let prepared = 0
    let consumed = 0
    let leftover = 0
    for (const r of rows) {
      prepared += r.qtyPrepared
      consumed += r.qtyConsumed
      leftover += r.qtyLeftover
    }
    const wastePct = prepared > 0 ? leftover / prepared : 0
    return { prepared, consumed, leftover, wastePct }
  }, [rows])

  // Group rows by day for cleaner table rendering.
  const byDay = React.useMemo(() => {
    const m = new Map<string, PrepWasteRow[]>()
    for (const r of rows) {
      const arr = m.get(r.day) ?? []
      arr.push(r)
      m.set(r.day, arr)
    }
    return Array.from(m.entries())
  }, [rows])

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/pos/reports"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            <ArrowLeft className="h-3 w-3" /> Kembali ke Laporan POS
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            Laporan Prep &amp; Sisa
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Berapa banyak yang kamu siapkan, terjual, dan tersisa per hari.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Periode
            </label>
            <Select
              value={preset}
              onChange={(e) => setPreset(e.target.value as Preset)}
              options={(Object.keys(PRESET_LABEL) as Preset[]).map((p) => ({
                value: p,
                label: PRESET_LABEL[p],
              }))}
            />
          </div>
        </div>
      </div>

      {/* Header cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total disiapkan" value={totals.prepared} />
        <StatCard label="Total terjual" value={totals.consumed} />
        <StatCard
          label="Sisa (belum terjual)"
          value={totals.leftover}
          tone={totals.leftover > 0 ? 'warn' : 'ok'}
        />
        <StatCard
          label="Persentase sisa"
          value={`${(totals.wastePct * 100).toFixed(1)}%`}
          tone={
            totals.wastePct >= OVER_PREP_THRESHOLD ? 'warn' : 'ok'
          }
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {report.isLoading ? (
          <div className="p-12 text-center text-sm text-gray-500">Memuat…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <ChefHat className="h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Belum ada prep batch di periode ini.
            </p>
            <p className="text-xs text-gray-500">
              Aktifkan &quot;Mode prep batch&quot; di item inventaris dulu,
              lalu catat prep tiap pagi.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left">Tanggal</th>
                  <th className="px-4 py-2 text-left">Item</th>
                  <th className="px-4 py-2 text-left">Cabang</th>
                  <th className="px-4 py-2 text-right">Disiapkan</th>
                  <th className="px-4 py-2 text-right">Terjual</th>
                  <th className="px-4 py-2 text-right">Sisa</th>
                  <th className="px-4 py-2 text-right">% Sisa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {byDay.map(([day, dayRows]) =>
                  dayRows.map((r, i) => {
                    const pct =
                      r.qtyPrepared > 0 ? r.qtyLeftover / r.qtyPrepared : 0
                    const isOverPrep = pct >= OVER_PREP_THRESHOLD
                    return (
                      <tr
                        key={`${r.day}-${r.itemId}-${r.branchId}`}
                        className="hover:bg-gray-50 dark:hover:bg-gray-900/20"
                      >
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                          {i === 0 ? formatDay(day) : ''}
                        </td>
                        <td className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100">
                          {r.itemName}
                        </td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                          {r.branchName}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatNumberID(r.qtyPrepared)}{' '}
                          <span className="text-xs text-gray-500">
                            {r.baseUnitLabel}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatNumberID(r.qtyConsumed)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatNumberID(r.qtyLeftover)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {isOverPrep ? (
                            <Badge variant="warning">
                              <AlertTriangle className="mr-0.5 inline h-3 w-3" />
                              {(pct * 100).toFixed(0)}%
                            </Badge>
                          ) : (
                            <span className="text-xs text-gray-500">
                              {(pct * 100).toFixed(0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totals.wastePct >= OVER_PREP_THRESHOLD && rows.length > 0 && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-900 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-200">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          Rata-rata sisa {(totals.wastePct * 100).toFixed(0)}% — coba turunkan
          jumlah prep harian agar bahan tidak terbuang.
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone?: 'ok' | 'warn'
}) {
  const display =
    typeof value === 'number' ? formatNumberID(value) : value
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
        {label}
      </p>
      <p
        className={
          'mt-1 text-xl font-bold ' +
          (tone === 'warn'
            ? 'text-warning-700 dark:text-warning-400'
            : 'text-gray-900 dark:text-gray-100')
        }
      >
        {display}
      </p>
    </div>
  )
}

function formatDay(day: string): string {
  // day is already YYYY-MM-DD in Jakarta wall clock. Render a friendly
  // Indonesian short date.
  try {
    const parts = day.split('-').map(Number)
    if (parts.length !== 3) return day
    const [y, m, d] = parts as [number, number, number]
    const date = new Date(Date.UTC(y, m - 1, d))
    return formatDate(date, 'dd MMM yyyy')
  } catch {
    return day
  }
}
