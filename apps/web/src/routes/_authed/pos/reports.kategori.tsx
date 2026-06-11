/**
 * Penjualan per Kategori — owner cut of the P&L. Groups completed
 * line items by inventory category and shows qty / transaction
 * count / revenue, plus margin columns when the caller has
 * `pos.report.profit`. Ad-hoc + uncategorised lines collapse into
 * "Tanpa Kategori" so totals reconcile back to the headline revenue.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { jsPDF } from 'jspdf'
import { AlertCircle } from 'lucide-react'
import { getPOSCashierMasters } from '@/server/functions/pos'
import {
  getPOSSalesByCategory,
  type CategoryReportRow,
} from '@/server/functions/pos-reports'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { ReportFilterBar } from '@/components/pos/reports/filter-bar'
import { ReportTable, type ReportColumn } from '@/components/pos/reports/report-table'
import { useReportFilters } from '@/components/pos/reports/use-report-filters'
import { ExportMenu } from '@/components/pos/reports/export-menu'
import {
  csvCell,
  downloadCsvBlob,
  downloadPdf,
  downloadXlsx,
  pdfFooter,
  pdfHeader,
} from '@/components/pos/reports/export-helpers'
import { posTierLimits } from '@vintra/shared'
import { formatRupiah } from '@/lib/currency'
import { formatNumberID } from '@/lib/utils'
import { usePermissions } from '@/hooks/use-permissions'

export const Route = createFileRoute('/_authed/pos/reports/kategori')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('pos.report.view')) {
      throw redirect({ to: '/pos' })
    }
  },
  component: KategoriPage,
})

function KategoriPage() {
  const { has } = usePermissions()
  const canSeeProfit = has('pos.report.profit')
  const filters = useReportFilters()
  const { from, to, branchId } = filters

  const mastersQuery = useQuery({
    queryKey: ['pos', 'cashier-masters'],
    queryFn: () => getPOSCashierMasters({ data: {} }),
    staleTime: 60 * 1000,
  })
  const masters = mastersQuery.data
  const limits = masters ? posTierLimits(masters.tier) : null
  const hasFeature = limits?.features.includes('pl_report') ?? false

  const report = useQuery({
    queryKey: ['pos', 'report', 'kategori', branchId, from, to],
    queryFn: () =>
      getPOSSalesByCategory({
        data: { branchId: branchId || undefined, from, to },
      }),
    enabled: hasFeature && Boolean(from) && Boolean(to),
    staleTime: 60 * 1000,
  })

  if (!hasFeature) {
    return (
      <div className="space-y-4">
        <ModuleBreadcrumb />
        <UpgradeBanner />
      </div>
    )
  }

  const r = report.data
  const rows = r?.rows ?? []
  const totals = rows.reduce(
    (acc, row) => {
      acc.qty += row.qtySold
      acc.salesCount += row.salesCount
      acc.revenue += row.revenue
      acc.hppCost += row.hppCost
      return acc
    },
    { qty: 0, salesCount: 0, revenue: 0, hppCost: 0 },
  )
  const totalMargin = totals.revenue - totals.hppCost
  const totalMarginPct =
    totals.revenue > 0 ? (totalMargin / totals.revenue) * 100 : 0

  const columns: ReportColumn<CategoryReportRow>[] = [
    {
      key: 'category',
      header: 'Kategori',
      cell: (row) => (
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {row.categoryName}
        </span>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      cell: (row) => formatNumberID(row.qtySold),
    },
    {
      key: 'salesCount',
      header: 'Transaksi',
      align: 'right',
      cell: (row) => formatNumberID(row.salesCount),
    },
    {
      key: 'revenue',
      header: 'Pendapatan',
      align: 'right',
      cell: (row) => (
        <span className="font-semibold">{formatRupiah(row.revenue)}</span>
      ),
    },
    ...(canSeeProfit && r?.canSeeProfit
      ? [
          {
            key: 'margin',
            header: 'Untung kotor',
            align: 'right' as const,
            cell: (row: CategoryReportRow) => (
              <span
                className={
                  row.margin >= 0
                    ? 'text-success-700 dark:text-success-300'
                    : 'text-danger-700 dark:text-danger-300'
                }
              >
                {formatRupiah(row.margin)}
              </span>
            ),
          },
          {
            key: 'marginPct',
            header: 'Margin %',
            align: 'right' as const,
            cell: (row: CategoryReportRow) => `${row.marginPct.toFixed(1)}%`,
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <ModuleBreadcrumb />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Penjualan per Kategori
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Pemecahan pendapatan berdasarkan kategori item. Ad-hoc dan item
            tanpa kategori dikumpulkan jadi satu.
          </p>
        </div>
        {r && (
          <ExportMenu
            disabled={rows.length === 0}
            onXlsx={() =>
              exportXlsx(rows, totals, totalMargin, totalMarginPct, from, to, canSeeProfit && r.canSeeProfit)
            }
            onCsv={() =>
              exportCsv(rows, totals, totalMargin, totalMarginPct, from, to, canSeeProfit && r.canSeeProfit)
            }
            onPdf={() =>
              exportPdf(rows, totals, totalMargin, totalMarginPct, from, to, canSeeProfit && r.canSeeProfit)
            }
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
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <ReportTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.categoryId ?? 'uncategorized'}
            emptyMessage="Tidak ada penjualan pada rentang ini."
          />
          {rows.length > 0 && (
            <div className="border-t border-gray-200 px-4 py-3 text-sm dark:border-gray-700 sm:flex sm:items-center sm:justify-between">
              <span className="font-medium text-gray-700 dark:text-gray-300">
                Total
              </span>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 sm:mt-0 sm:justify-end">
                <span className="text-xs text-gray-500">
                  Qty <span className="font-medium text-gray-900 dark:text-gray-100">{formatNumberID(totals.qty)}</span>
                </span>
                <span className="text-xs text-gray-500">
                  Transaksi <span className="font-medium text-gray-900 dark:text-gray-100">{formatNumberID(totals.salesCount)}</span>
                </span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {formatRupiah(totals.revenue)}
                </span>
                {canSeeProfit && r.canSeeProfit && (
                  <span
                    className={
                      totalMargin >= 0
                        ? 'font-semibold text-success-700 dark:text-success-300'
                        : 'font-semibold text-danger-700 dark:text-danger-300'
                    }
                  >
                    {formatRupiah(totalMargin)} ({totalMarginPct.toFixed(1)}%)
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UpgradeBanner() {
  return (
    <div className="rounded-xl border border-warning-200 bg-warning-50 p-6 text-sm text-warning-900 dark:border-warning-700 dark:bg-warning-900/20 dark:text-warning-200">
      <h2 className="text-base font-semibold">Laporan Kategori (Pro)</h2>
      <p className="mt-1">
        Lihat pendapatan dan margin per kategori untuk rentang tanggal pilihan
        kamu. Tersedia di paket Toko ke atas.
      </p>
    </div>
  )
}

function exportXlsx(
  rows: CategoryReportRow[],
  totals: { qty: number; salesCount: number; revenue: number; hppCost: number },
  totalMargin: number,
  totalMarginPct: number,
  from: string,
  to: string,
  showProfit: boolean,
) {
  const header: (string | number | null)[] = [
    'Kategori',
    'Qty',
    'Transaksi',
    'Pendapatan',
  ]
  if (showProfit) header.push('Untung kotor', 'Margin %')
  const sheetRows: (string | number | null)[][] = [
    [`Penjualan per Kategori ${from} → ${to}`],
    [],
    header,
  ]
  for (const row of rows) {
    const cols: (string | number | null)[] = [
      row.categoryName,
      row.qtySold,
      row.salesCount,
      row.revenue,
    ]
    if (showProfit) cols.push(row.margin, Number(row.marginPct.toFixed(2)))
    sheetRows.push(cols)
  }
  const totalRow: (string | number | null)[] = [
    'Total',
    totals.qty,
    totals.salesCount,
    totals.revenue,
  ]
  if (showProfit) totalRow.push(totalMargin, Number(totalMarginPct.toFixed(2)))
  sheetRows.push(totalRow)
  downloadXlsx(
    [{ name: 'Kategori', rows: sheetRows }],
    `Laporan-Kategori-${from}-${to}.xlsx`,
  )
}

function exportCsv(
  rows: CategoryReportRow[],
  totals: { qty: number; salesCount: number; revenue: number; hppCost: number },
  totalMargin: number,
  totalMarginPct: number,
  from: string,
  to: string,
  showProfit: boolean,
) {
  const out: string[] = []
  out.push(`"Penjualan per Kategori ${from} → ${to}"`)
  out.push('')
  const header = ['Kategori', 'Qty', 'Transaksi', 'Pendapatan']
  if (showProfit) header.push('Untung kotor', 'Margin %')
  out.push(header.join(','))
  for (const row of rows) {
    const cols = [
      csvCell(row.categoryName),
      row.qtySold,
      row.salesCount,
      row.revenue,
    ]
    if (showProfit) cols.push(row.margin, row.marginPct.toFixed(2))
    out.push(cols.join(','))
  }
  const totalsRow = ['Total', totals.qty, totals.salesCount, totals.revenue]
  if (showProfit) totalsRow.push(totalMargin, totalMarginPct.toFixed(2))
  out.push(totalsRow.join(','))
  downloadCsvBlob(out, `Laporan-Kategori-${from}-${to}.csv`)
}

function exportPdf(
  rows: CategoryReportRow[],
  totals: { qty: number; salesCount: number; revenue: number; hppCost: number },
  totalMargin: number,
  totalMarginPct: number,
  from: string,
  to: string,
  showProfit: boolean,
) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = pdfHeader(doc, 'Penjualan per Kategori', from, to)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Kategori', 20, y)
  doc.text('Qty', 90, y, { align: 'right' })
  doc.text('Trx', 115, y, { align: 'right' })
  doc.text('Pendapatan', 165, y, { align: 'right' })
  if (showProfit) doc.text('Margin', 190, y, { align: 'right' })
  y += 5
  doc.setFont('helvetica', 'normal')
  for (const row of rows) {
    if (y > 275) {
      doc.addPage()
      y = 20
    }
    doc.text(row.categoryName, 20, y, { maxWidth: 65 })
    doc.text(formatNumberID(row.qtySold), 90, y, { align: 'right' })
    doc.text(formatNumberID(row.salesCount), 115, y, { align: 'right' })
    doc.text(formatRupiah(row.revenue), 165, y, { align: 'right' })
    if (showProfit) doc.text(formatRupiah(row.margin), 190, y, { align: 'right' })
    y += 5
  }
  doc.setFont('helvetica', 'bold')
  if (y > 275) {
    doc.addPage()
    y = 20
  }
  doc.text('Total', 20, y)
  doc.text(formatNumberID(totals.qty), 90, y, { align: 'right' })
  doc.text(formatNumberID(totals.salesCount), 115, y, { align: 'right' })
  doc.text(formatRupiah(totals.revenue), 165, y, { align: 'right' })
  if (showProfit) {
    doc.text(`${formatRupiah(totalMargin)} (${totalMarginPct.toFixed(1)}%)`, 190, y, { align: 'right' })
  }
  pdfFooter(doc)
  downloadPdf(doc, `Laporan-Kategori-${from}-${to}.pdf`)
}
