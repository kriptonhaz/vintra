/**
 * Penjualan per Produk — paginated, sortable per-item breakdown. The
 * server groups by `pos_sale_items.item_id`, so two lines for the
 * same SKU sum correctly even if names were renamed mid-period.
 * Ad-hoc lines collapse into a single "Item ad-hoc" row.
 */
import * as React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { jsPDF } from 'jspdf'
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { getPOSCashierMasters } from '@/server/functions/pos'
import {
  getPOSReportCategories,
  getPOSSalesByProduct,
  type ProductReportRow,
} from '@/server/functions/pos-reports'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { ReportFilterBar } from '@/components/pos/reports/filter-bar'
import { ReportTable, type ReportColumn } from '@/components/pos/reports/report-table'
import { useReportFilters } from '@/components/pos/reports/use-report-filters'
import { ExportMenu } from '@/components/pos/reports/export-menu'
import { useToast } from '@/components/ui/toast'
import {
  csvCell,
  downloadCsvBlob,
  downloadPdf,
  downloadXlsx,
  pdfFooter,
  pdfHeader,
} from '@/components/pos/reports/export-helpers'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { posTierLimits } from '@vintra/shared'
import { formatRupiah } from '@/lib/currency'
import { formatNumberID } from '@/lib/utils'
import { usePermissions } from '@/hooks/use-permissions'

export const Route = createFileRoute('/_authed/pos/reports/produk')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('pos.report.view')) {
      throw redirect({ to: '/pos' })
    }
  },
  component: ProdukPage,
})

type SortBy = 'revenue' | 'qty' | 'salesCount' | 'margin' | 'name'

function ProdukPage() {
  const { has } = usePermissions()
  const canSeeProfit = has('pos.report.profit')
  const filters = useReportFilters()
  const { from, to, branchId } = filters

  const [categoryId, setCategoryId] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [sortBy, setSortBy] = React.useState<SortBy>('revenue')
  const [exporting, setExporting] = React.useState(false)
  const { toast } = useToast()

  // Reset to page 1 whenever the filter scope changes — otherwise a
  // page-5 cursor on a fresh date range usually points past the end.
  React.useEffect(() => {
    setPage(1)
  }, [from, to, branchId, categoryId, sortBy])

  const mastersQuery = useQuery({
    queryKey: ['pos', 'cashier-masters'],
    queryFn: () => getPOSCashierMasters({ data: {} }),
    staleTime: 60 * 1000,
  })
  const masters = mastersQuery.data
  const limits = masters ? posTierLimits(masters.tier) : null
  const hasFeature = limits?.features.includes('pl_report') ?? false

  const categoriesQuery = useQuery({
    queryKey: ['pos', 'report', 'categories'],
    queryFn: () => getPOSReportCategories(),
    staleTime: 10 * 60 * 1000,
    enabled: hasFeature,
  })

  const pageSize = 25
  const report = useQuery({
    queryKey: [
      'pos',
      'report',
      'produk',
      branchId,
      from,
      to,
      categoryId,
      page,
      sortBy,
    ],
    queryFn: () =>
      getPOSSalesByProduct({
        data: {
          branchId: branchId || undefined,
          categoryId: categoryId || undefined,
          from,
          to,
          page,
          pageSize,
          sortBy,
          sortDir: 'desc',
        },
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
  const totalCount = r?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  /**
   * Re-fetch the WHOLE result set before writing the file.
   *
   * The table shows 25 rows at a time, and exporting `rows` gave the
   * owner whatever page was on screen — a 100-product catalog meant
   * four downloads to stitch together by hand, with nothing in the file
   * saying it was partial. The filters carry over verbatim: an export
   * must contain exactly what the screen claims to show, just all of it.
   */
  async function runExport(
    write: (
      rows: ProductReportRow[],
      from: string,
      to: string,
      withProfit: boolean,
    ) => void,
  ) {
    setExporting(true)
    try {
      const full = await getPOSSalesByProduct({
        data: {
          branchId: branchId || undefined,
          categoryId: categoryId || undefined,
          from,
          to,
          all: true,
          sortBy,
          sortDir: 'desc',
        },
      })
      write(full.rows, from, to, canSeeProfit && full.canSeeProfit)
      if (full.truncated) {
        toast({
          title: 'Sebagian data tidak ikut',
          description: `Laporan ini punya ${full.totalCount} baris; file berisi ${full.rows.length} teratas. Persempit rentang tanggal atau filter kategori untuk mengunduh sisanya.`,
          variant: 'error',
        })
      }
    } catch (err) {
      toast({
        title: 'Gagal menyiapkan file',
        description:
          err instanceof Error ? err.message : 'Coba lagi sebentar lagi.',
        variant: 'error',
      })
    } finally {
      setExporting(false)
    }
  }

  const columns: ReportColumn<ProductReportRow>[] = [
    {
      key: 'name',
      header: 'Nama',
      cell: (row) => (
        <div>
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {row.name}
          </span>
          {row.sku && (
            <span className="ml-2 text-xs text-gray-500">{row.sku}</span>
          )}
          {row.categoryName && (
            <div className="mt-0.5 text-xs text-gray-500">
              {row.categoryName}
            </div>
          )}
        </div>
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
      key: 'avgUnitPrice',
      header: 'Harga rata-rata',
      align: 'right',
      hideOnMobile: true,
      cell: (row) => formatRupiah(row.avgUnitPrice),
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
            key: 'hpp',
            header: 'HPP',
            align: 'right' as const,
            hideOnMobile: true,
            cell: (row: ProductReportRow) => formatRupiah(row.hppCost),
          },
          {
            key: 'margin',
            header: 'Untung',
            align: 'right' as const,
            cell: (row: ProductReportRow) => (
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
            hideOnMobile: true,
            cell: (row: ProductReportRow) => `${row.marginPct.toFixed(1)}%`,
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
            Penjualan per Produk
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Detail per item terjual. Bisa urut dan filter berdasarkan kategori.
          </p>
        </div>
        {r && (
          <ExportMenu
            disabled={rows.length === 0}
            loading={exporting}
            onXlsx={() => void runExport(exportXlsx)}
            onCsv={() => void runExport(exportCsv)}
            onPdf={() => void runExport(exportPdf)}
          />
        )}
      </div>
      <ReportFilterBar state={filters} branches={masters?.branches ?? []} />

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Kategori
          </label>
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={[
              { value: '', label: 'Semua kategori' },
              ...(categoriesQuery.data ?? []).map((c) => ({
                value: c.id,
                label: c.name,
              })),
            ]}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Urutkan
          </label>
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            options={[
              { value: 'revenue', label: 'Pendapatan (terbanyak)' },
              { value: 'qty', label: 'Qty (terbanyak)' },
              { value: 'salesCount', label: 'Transaksi (terbanyak)' },
              ...(canSeeProfit
                ? [{ value: 'margin', label: 'Untung (terbesar)' }]
                : []),
              { value: 'name', label: 'Nama (A-Z)' },
            ]}
          />
        </div>
      </div>

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
            rowKey={(row) => row.itemId ?? `adhoc-${row.name}`}
            emptyMessage="Tidak ada penjualan pada rentang ini."
          />
          {totalCount > pageSize && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm dark:border-gray-700">
              <span className="text-xs text-gray-500">
                Halaman {page} dari {totalPages} — {formatNumberID(totalCount)}{' '}
                item
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Sebelumnya
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Berikutnya
                  <ChevronRight className="h-4 w-4" />
                </Button>
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
      <h2 className="text-base font-semibold">Laporan Produk (Pro)</h2>
      <p className="mt-1">
        Detail per-produk: qty terjual, pendapatan, margin per item. Tersedia
        di paket Toko ke atas.
      </p>
    </div>
  )
}

function exportXlsx(
  rows: ProductReportRow[],
  from: string,
  to: string,
  showProfit: boolean,
) {
  const header: (string | number | null)[] = [
    'Nama',
    'SKU',
    'Kategori',
    'Qty',
    'Transaksi',
    'Harga rata-rata',
    'Pendapatan',
  ]
  if (showProfit) header.push('HPP', 'Untung', 'Margin %')
  const sheetRows: (string | number | null)[][] = [
    [`Penjualan per Produk ${from} → ${to}`],
    [],
    header,
  ]
  for (const row of rows) {
    const cols: (string | number | null)[] = [
      row.name,
      row.sku,
      row.categoryName,
      row.qtySold,
      row.salesCount,
      Number(row.avgUnitPrice.toFixed(2)),
      row.revenue,
    ]
    if (showProfit) {
      cols.push(row.hppCost, row.margin, Number(row.marginPct.toFixed(2)))
    }
    sheetRows.push(cols)
  }
  downloadXlsx(
    [{ name: 'Produk', rows: sheetRows }],
    `Laporan-Produk-${from}-${to}.xlsx`,
  )
}

function exportCsv(
  rows: ProductReportRow[],
  from: string,
  to: string,
  showProfit: boolean,
) {
  const out: string[] = []
  out.push(`"Penjualan per Produk ${from} → ${to}"`)
  out.push('')
  const header = [
    'Nama',
    'SKU',
    'Kategori',
    'Qty',
    'Transaksi',
    'Harga rata-rata',
    'Pendapatan',
  ]
  if (showProfit) header.push('HPP', 'Untung', 'Margin %')
  out.push(header.join(','))
  for (const row of rows) {
    const cols = [
      csvCell(row.name),
      csvCell(row.sku),
      csvCell(row.categoryName),
      row.qtySold,
      row.salesCount,
      row.avgUnitPrice.toFixed(2),
      row.revenue,
    ]
    if (showProfit) cols.push(row.hppCost, row.margin, row.marginPct.toFixed(2))
    out.push(cols.join(','))
  }
  downloadCsvBlob(out, `Laporan-Produk-${from}-${to}.csv`)
}

function exportPdf(
  rows: ProductReportRow[],
  from: string,
  to: string,
  showProfit: boolean,
) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = pdfHeader(doc, 'Penjualan per Produk', from, to)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Nama', 20, y)
  doc.text('Qty', 110, y, { align: 'right' })
  doc.text('Trx', 130, y, { align: 'right' })
  doc.text('Pendapatan', 165, y, { align: 'right' })
  if (showProfit) doc.text('Margin', 190, y, { align: 'right' })
  y += 5
  doc.setFont('helvetica', 'normal')
  for (const row of rows) {
    if (y > 275) {
      doc.addPage()
      y = 20
    }
    doc.text(row.name, 20, y, { maxWidth: 85 })
    doc.text(formatNumberID(row.qtySold), 110, y, { align: 'right' })
    doc.text(formatNumberID(row.salesCount), 130, y, { align: 'right' })
    doc.text(formatRupiah(row.revenue), 165, y, { align: 'right' })
    if (showProfit) doc.text(formatRupiah(row.margin), 190, y, { align: 'right' })
    y += 5
  }
  pdfFooter(doc)
  downloadPdf(doc, `Laporan-Produk-${from}-${to}.pdf`)
}
