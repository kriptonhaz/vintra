/**
 * JUR-11: P&L / monthly report.
 *
 * Owner-facing aggregations for any custom date range. Free + base tier
 * gets a "Pro" upgrade banner; Toko+ gets the full report with Ringkasan
 * (revenue / HPP / gross margin / discount / tax / refund / loyalty),
 * Top Items (by qty + by revenue), Payment Method breakdown, and
 * Cashier breakdown (when ≥2 cashiers active).
 *
 * Date-range presets cover the common owner queries (Hari ini / 7 hari
 * / 30 hari / Bulan ini / Bulan lalu); Custom unlocks the date inputs.
 *
 * Export: PDF + CSV are generated client-side from the already-loaded
 * report data — keeps the server lean (no second round-trip needed).
 */
import * as React from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { jsPDF } from 'jspdf'
import { TrendingUp, AlertCircle } from 'lucide-react'
import { getPOSReport, getPOSCashierMasters } from '@/server/functions/pos'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { ReportFilterBar } from '@/components/pos/reports/filter-bar'
import { useReportFilters } from '@/components/pos/reports/use-report-filters'
import { ExportMenu } from '@/components/pos/reports/export-menu'
import { downloadXlsx } from '@/components/pos/reports/export-helpers'
import { useToast } from '@/components/ui/toast'
import { posTierLimits, type POSPaymentMethod } from '@vintra/shared'
import { formatRupiah } from '@/lib/currency'
import { cn, formatDate, formatNumberID } from '@/lib/utils' // JUR-137
import { usePermissions } from '@/hooks/use-permissions'

export const Route = createFileRoute('/_authed/pos/reports/')({
  // JUR-204: P&L is a money surface. Cashiers (pos.read for history
  // only) can't see this page client-side OR server-side. Profit
  // cards (HPP / untung kotor / margin) require pos.report.profit
  // and are gated inside the component + the server fn.
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('pos.report.view')) {
      throw redirect({ to: '/pos' })
    }
  },
  component: ReportsPage,
})

const PAYMENT_LABEL: Record<POSPaymentMethod, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  ewallet: 'E-Wallet',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
  ovo: 'OVO',
}

function ReportsPage() {
  const { toast: _toast } = useToast()
  // pos.report.profit gates the HPP/untung kotor/margin cards + their
  // CSV/PDF export rows. Server also zeros them out as defense in depth.
  const { has } = usePermissions()
  const canSeeProfit = has('pos.report.profit')
  const mastersQuery = useQuery({
    queryKey: ['pos', 'cashier-masters'],
    queryFn: () => getPOSCashierMasters({ data: {} }),
    staleTime: 60 * 1000,
  })
  const masters = mastersQuery.data
  const limits = masters ? posTierLimits(masters.tier) : null
  const hasFeature = limits?.features.includes('pl_report') ?? false

  // Date inputs are deferred to a mount effect inside useReportFilters
  // — see that hook for the hydration #418 rationale.
  const filters = useReportFilters()
  const { from, to, branchId } = filters

  const report = useQuery({
    queryKey: ['pos', 'report', branchId, from, to],
    queryFn: () =>
      getPOSReport({
        data: {
          branchId: branchId || undefined,
          from,
          to,
        },
      }),
    enabled: hasFeature && Boolean(from) && Boolean(to),
    staleTime: 60 * 1000,
  })

  if (!hasFeature) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-warning-200 bg-warning-50 p-6 text-sm text-warning-900 dark:border-warning-700 dark:bg-warning-900/20 dark:text-warning-200">
          <h2 className="text-base font-semibold">Laporan P&L (Pro)</h2>
          <p className="mt-1">
            Lihat untung-rugi bisnismu dengan rentang tanggal kustom: ringkasan
            margin, top item, breakdown metode bayar dan kasir. Tersedia di
            paket Toko ke atas. Saat ini paket Free hanya bisa lihat Z-Report
            harian dari halaman Riwayat Transaksi.
          </p>
        </div>
      </div>
    )
  }

  const r = report.data
  const tenantName = 'Laporan' // server doesn't return tenant name in this fn

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Laporan P&L
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Ringkasan untung-rugi untuk rentang tanggal pilihan kamu.
          </p>
        </div>
        {r && (
          <ExportMenu
            onXlsx={() => downloadXLSX(r, from, to)}
            onCsv={() => downloadCSV(r, from, to)}
            onPdf={() => downloadPDF(r, from, to, tenantName)}
          />
        )}
      </div>

      <ReportFilterBar state={filters} branches={masters?.branches ?? []} />

      {report.isLoading && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
          Memuat laporan…
        </div>
      )}

      {report.isError && (
        <div className="flex items-start gap-2 rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-900 dark:border-danger-700 dark:bg-danger-900/20 dark:text-danger-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Gagal memuat laporan. Coba refresh atau pilih rentang lain.</p>
        </div>
      )}

      {r && (
        <>
          {/* Ringkasan */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-brand-600" />
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Ringkasan
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Pendapatan" value={formatRupiah(r.summary.revenue)} bold />
              {canSeeProfit && (
                <>
                  <Stat
                    label="HPP (modal)"
                    value={formatRupiah(r.summary.hppCost)}
                  />
                  <Stat
                    label="Untung kotor"
                    value={formatRupiah(r.summary.grossMargin)}
                    accent={
                      r.summary.grossMargin >= 0
                        ? 'text-success-700'
                        : 'text-danger-700'
                    }
                    bold
                  />
                  <Stat
                    label="Margin %"
                    value={`${r.summary.grossMarginPct.toFixed(1)}%`}
                  />
                </>
              )}
              <Stat
                label="Diskon (item)"
                value={formatRupiah(r.summary.lineDiscountTotal)}
              />
              <Stat
                label="Diskon (cart)"
                value={formatRupiah(r.summary.saleDiscountTotal)}
              />
              <Stat
                label="Promo"
                value={formatRupiah(r.summary.promoTotal)}
              />
              <Stat label="Pajak" value={formatRupiah(r.summary.taxTotal)} />
              <Stat
                label="Tukar poin"
                value={formatRupiah(r.summary.loyaltyRedeemTotal)}
              />
              <Stat
                label="Transaksi selesai"
                value={formatNumberID(r.summary.salesCount)}
              />
              <Stat
                label="Transaksi dibatalkan"
                value={formatNumberID(r.summary.voidedCount)}
                accent={r.summary.voidedCount > 0 ? 'text-warning-700' : ''}
              />
              <Stat
                label="Total dibatalkan"
                value={formatRupiah(r.summary.voidedTotal)}
              />
            </div>
          </div>

          {/* JUR-204: Peti Kas at-a-glance over the report's date range.
              Sits directly under Ringkasan so the owner can scan
              revenue → cash drawer health → top items in one pass.
              Hidden when no sessions were opened so non-cash tenants
              don't see a strip of zeros. */}
          {r.petiKas.sessionsOpened > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Peti Kas
                </h2>
                <Link
                  to="/pos/cash-sessions"
                  className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
                >
                  Lihat detail →
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Sesi dibuka"
                  value={formatNumberID(r.petiKas.sessionsOpened)}
                />
                <Stat
                  label="Selisih"
                  value={`${r.petiKas.varianceTotal >= 0 ? '+' : ''}${formatRupiah(r.petiKas.varianceTotal)}`}
                  accent={
                    r.petiKas.varianceTotal === 0
                      ? ''
                      : r.petiKas.varianceTotal > 0
                        ? 'text-success-700'
                        : 'text-danger-700'
                  }
                  bold
                />
                <Stat
                  label="Setor tunai"
                  value={formatRupiah(r.petiKas.dropTotal)}
                />
                <Stat
                  label="Tarik tunai"
                  value={formatRupiah(r.petiKas.payoutTotal)}
                />
              </div>
            </div>
          )}

          {/* Top items — by qty + by revenue, side-by-side on desktop */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Top 10 Item — by Qty
              </h2>
              {r.topByQty.length === 0 ? (
                <p className="text-sm text-gray-500">Tidak ada penjualan.</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {r.topByQty.map((it, i) => (
                    <li
                      key={`${it.name}-${i}`}
                      className="flex items-center gap-3 py-2 text-sm"
                    >
                      <span className="w-5 text-xs font-medium text-gray-400">
                        {i + 1}
                      </span>
                      <span className="flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
                        {it.name}
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {formatNumberID(it.qtySold)}
                      </span>
                      <span className="w-24 text-right text-xs text-gray-500">
                        {formatRupiah(it.revenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Top 10 Item — by Pendapatan
              </h2>
              {r.topByRevenue.length === 0 ? (
                <p className="text-sm text-gray-500">Tidak ada penjualan.</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {r.topByRevenue.map((it, i) => (
                    <li
                      key={`${it.name}-${i}`}
                      className="flex items-center gap-3 py-2 text-sm"
                    >
                      <span className="w-5 text-xs font-medium text-gray-400">
                        {i + 1}
                      </span>
                      <span className="flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
                        {it.name}
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {formatRupiah(it.revenue)}
                      </span>
                      <span className="w-16 text-right text-xs text-gray-500">
                        {formatNumberID(it.qtySold)}×
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Payment method + Cashier breakdowns */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Metode Pembayaran
              </h2>
              {r.byPaymentMethod.length === 0 ? (
                <p className="text-sm text-gray-500">Tidak ada penjualan.</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {r.byPaymentMethod.map((m) => {
                    const pct =
                      r.summary.revenue > 0
                        ? (m.total / r.summary.revenue) * 100
                        : 0
                    return (
                      <li
                        key={m.method}
                        className="flex items-center gap-3 py-2 text-sm"
                      >
                        <span className="flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
                          {PAYMENT_LABEL[m.method]}
                        </span>
                        <span className="w-12 text-right text-xs text-gray-500">
                          {m.count}×
                        </span>
                        <span className="w-12 text-right text-xs text-gray-500">
                          {pct.toFixed(0)}%
                        </span>
                        <span className="w-28 text-right font-semibold text-gray-900 dark:text-gray-100">
                          {formatRupiah(m.total)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {r.byCashier.length > 1 && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Per-Kasir
                </h2>
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {r.byCashier.map((c) => (
                    <li
                      key={c.userId}
                      className="flex items-center gap-3 py-2 text-sm"
                    >
                      <span className="flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
                        {c.name}
                      </span>
                      <span className="w-12 text-right text-xs text-gray-500">
                        {c.count}×
                      </span>
                      <span className="w-28 text-right font-semibold text-gray-900 dark:text-gray-100">
                        {formatRupiah(c.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* JUR-204: void-reason breakdown. Only render when there's
              at least one void in the range — most days are quiet. */}
          {r.voidsByCategory.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Alasan Pembatalan
              </h2>
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {r.voidsByCategory.map((v) => {
                  const pct =
                    r.summary.voidedCount > 0
                      ? (v.count / r.summary.voidedCount) * 100
                      : 0
                  return (
                    <li
                      key={v.label}
                      className="flex items-center gap-3 py-2 text-sm"
                    >
                      <span className="flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
                        {v.label}
                      </span>
                      <span className="w-12 text-right text-xs text-gray-500">
                        {v.count}×
                      </span>
                      <span className="w-12 text-right text-xs text-gray-500">
                        {pct.toFixed(0)}%
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  bold,
  accent,
}: {
  label: string
  value: string
  bold?: boolean
  accent?: string
}) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-base text-gray-900 dark:text-gray-100',
          bold && 'font-bold',
          accent,
        )}
      >
        {value}
      </p>
    </div>
  )
}

// ─── Export helpers (client-side, no extra round-trip) ──────────────

type ReportData = NonNullable<
  ReturnType<typeof getPOSReport> extends Promise<infer T> ? T : never
>

function downloadXLSX(r: ReportData, from: string, to: string) {
  const ringkasan: (string | number | null)[][] = [
    [`Laporan P&L ${from} → ${to}`],
    [],
    ['Pendapatan', r.summary.revenue],
  ]
  if (r.canSeeProfit) {
    ringkasan.push(['HPP', r.summary.hppCost])
    ringkasan.push(['Untung kotor', r.summary.grossMargin])
    ringkasan.push(['Margin %', Number(r.summary.grossMarginPct.toFixed(2))])
  }
  ringkasan.push(
    ['Diskon item', r.summary.lineDiscountTotal],
    ['Diskon cart', r.summary.saleDiscountTotal],
    ['Promo', r.summary.promoTotal],
    ['Pajak', r.summary.taxTotal],
    ['Tukar poin', r.summary.loyaltyRedeemTotal],
    ['Transaksi selesai', r.summary.salesCount],
    ['Transaksi dibatalkan', r.summary.voidedCount],
    ['Total dibatalkan', r.summary.voidedTotal],
  )
  const topQty: (string | number | null)[][] = [
    ['Nama', 'Qty', 'Pendapatan'],
    ...r.topByQty.map((it) => [it.name, Number(it.qtySold), it.revenue]),
  ]
  const topRev: (string | number | null)[][] = [
    ['Nama', 'Qty', 'Pendapatan'],
    ...r.topByRevenue.map((it) => [it.name, Number(it.qtySold), it.revenue]),
  ]
  const methods: (string | number | null)[][] = [
    ['Metode', 'Count', 'Total'],
    ...r.byPaymentMethod.map((m) => [m.method, m.count, m.total]),
  ]
  const sheets = [
    { name: 'Ringkasan', rows: ringkasan },
    { name: 'Top by Qty', rows: topQty },
    { name: 'Top by Pendapatan', rows: topRev },
    { name: 'Metode Bayar', rows: methods },
  ]
  if (r.byCashier.length > 0) {
    sheets.push({
      name: 'Per Kasir',
      rows: [
        ['Kasir', 'Count', 'Total'],
        ...r.byCashier.map((c) => [c.name, c.count, c.total]),
      ],
    })
  }
  downloadXlsx(sheets, `Laporan-${from}-${to}.xlsx`)
}

function downloadCSV(r: ReportData, from: string, to: string) {
  const rows: string[] = []
  rows.push(`"Laporan P&L ${from} → ${to}"`)
  rows.push('')
  rows.push('Ringkasan')
  rows.push(`Pendapatan,${r.summary.revenue}`)
  // Skip the cost-side rows for callers without pos.report.profit —
  // the server already zeroes them out, but skipping keeps the CSV
  // from carrying misleading "Rp 0 HPP" rows for a real-data report.
  if (r.canSeeProfit) {
    rows.push(`HPP,${r.summary.hppCost}`)
    rows.push(`Untung kotor,${r.summary.grossMargin}`)
    rows.push(`Margin %,${r.summary.grossMarginPct.toFixed(2)}`)
  }
  rows.push(`Diskon item,${r.summary.lineDiscountTotal}`)
  rows.push(`Diskon cart,${r.summary.saleDiscountTotal}`)
  rows.push(`Promo,${r.summary.promoTotal}`)
  rows.push(`Pajak,${r.summary.taxTotal}`)
  rows.push(`Tukar poin,${r.summary.loyaltyRedeemTotal}`)
  rows.push(`Transaksi selesai,${r.summary.salesCount}`)
  rows.push(`Transaksi dibatalkan,${r.summary.voidedCount}`)
  rows.push(`Total dibatalkan,${r.summary.voidedTotal}`)
  rows.push('')
  rows.push('Top item by qty')
  rows.push('Nama,Qty,Pendapatan')
  for (const it of r.topByQty) {
    rows.push(`"${it.name.replace(/"/g, '""')}",${it.qtySold},${it.revenue}`)
  }
  rows.push('')
  rows.push('Top item by pendapatan')
  rows.push('Nama,Qty,Pendapatan')
  for (const it of r.topByRevenue) {
    rows.push(`"${it.name.replace(/"/g, '""')}",${it.qtySold},${it.revenue}`)
  }
  rows.push('')
  rows.push('Metode pembayaran')
  rows.push('Metode,Count,Total')
  for (const m of r.byPaymentMethod) {
    rows.push(`${m.method},${m.count},${m.total}`)
  }
  if (r.byCashier.length > 0) {
    rows.push('')
    rows.push('Per kasir')
    rows.push('Kasir,Count,Total')
    for (const c of r.byCashier) {
      rows.push(`"${c.name.replace(/"/g, '""')}",${c.count},${c.total}`)
    }
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Laporan-${from}-${to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function downloadPDF(r: ReportData, from: string, to: string, tenantName: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 20

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(`Laporan P&L`, 20, y)
  y += 7
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`${from} → ${to}`, 20, y)
  y += 5
  if (tenantName) {
    doc.text(tenantName, 20, y)
    y += 5
  }
  y += 4

  // Ringkasan
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Ringkasan', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const lines: Array<[string, string]> = [
    ['Pendapatan', formatRupiah(r.summary.revenue)],
    // pos.report.profit-gated rows — only printed for owner/admin/outlet_owner.
    ...(r.canSeeProfit
      ? ([
          ['HPP (modal)', formatRupiah(r.summary.hppCost)],
          ['Untung kotor', formatRupiah(r.summary.grossMargin)],
          ['Margin %', `${r.summary.grossMarginPct.toFixed(1)}%`],
        ] as Array<[string, string]>)
      : []),
    ['Diskon item', formatRupiah(r.summary.lineDiscountTotal)],
    ['Diskon cart', formatRupiah(r.summary.saleDiscountTotal)],
    ['Promo', formatRupiah(r.summary.promoTotal)],
    ['Pajak', formatRupiah(r.summary.taxTotal)],
    ['Tukar poin', formatRupiah(r.summary.loyaltyRedeemTotal)],
    ['Transaksi selesai', String(r.summary.salesCount)],
    ['Transaksi dibatalkan', String(r.summary.voidedCount)],
    ['Total dibatalkan', formatRupiah(r.summary.voidedTotal)],
  ]
  for (const [k, v] of lines) {
    doc.text(k, 20, y)
    doc.text(v, 100, y, { align: 'right' })
    y += 5
  }
  y += 4

  // Top items
  if (r.topByRevenue.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.text('Top 10 — by Pendapatan', 20, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    for (let i = 0; i < r.topByRevenue.length; i++) {
      const it = r.topByRevenue[i]!
      doc.text(`${i + 1}. ${it.name}`, 20, y, { maxWidth: 100 })
      doc.text(formatRupiah(it.revenue), 190, y, { align: 'right' })
      y += 5
      if (y > 270) {
        doc.addPage()
        y = 20
      }
    }
    y += 4
  }

  // Payment method
  if (r.byPaymentMethod.length > 0) {
    if (y > 250) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'bold')
    doc.text('Metode Pembayaran', 20, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    for (const m of r.byPaymentMethod) {
      doc.text(`${PAYMENT_LABEL[m.method]} (${m.count}×)`, 20, y)
      doc.text(formatRupiah(m.total), 190, y, { align: 'right' })
      y += 5
    }
    y += 4
  }

  // Cashier breakdown (only if multi-cashier)
  if (r.byCashier.length > 1) {
    if (y > 250) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'bold')
    doc.text('Per-Kasir', 20, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    for (const c of r.byCashier) {
      doc.text(`${c.name} (${c.count}×)`, 20, y, { maxWidth: 100 })
      doc.text(formatRupiah(c.total), 190, y, { align: 'right' })
      y += 5
    }
  }

  doc.setFontSize(8)
  doc.text(
    `Dicetak ${formatDate(new Date(), 'dd MMM yyyy, HH:mm')} • Vintra`,
    105,
    287,
    { align: 'center' },
  )

  const dataUrl = doc.output('datauristring')
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `Laporan-${from}-${to}.pdf`
  a.click()
}
