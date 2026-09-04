/**
 * Laporan Pelanggan — per-customer spend, visit count, average
 * basket. Anonymous walk-ins (customer_id NULL) are excluded from
 * the table and surfaced as a single chip above it so owners still
 * see what share of revenue is unattributed.
 */
import * as React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { jsPDF } from 'jspdf'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Users,
} from 'lucide-react'
import { getPOSCashierMasters } from '@/server/functions/pos'
import {
  getPOSCustomersReport,
  type CustomerReportRow,
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
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { posTierLimits } from '@vintra/shared'
import { formatRupiah } from '@/lib/currency'
import { formatDate, formatNumberID } from '@/lib/utils'

export const Route = createFileRoute('/_authed/pos/reports/pelanggan')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('pos.report.view')) {
      throw redirect({ to: '/pos' })
    }
  },
  component: PelangganPage,
})

type SortBy = 'totalSpend' | 'salesCount' | 'avgBasket' | 'lastVisit' | 'name'

function PelangganPage() {
  const filters = useReportFilters()
  const { from, to, branchId } = filters

  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [sortBy, setSortBy] = React.useState<SortBy>('totalSpend')
  const [page, setPage] = React.useState(1)
  const [exporting, setExporting] = React.useState(false)
  const { toast } = useToast()

  // Debounce the search box so typing doesn't fire a query per char.
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  React.useEffect(() => {
    setPage(1)
  }, [from, to, branchId, debouncedSearch, sortBy])

  const mastersQuery = useQuery({
    queryKey: ['pos', 'cashier-masters'],
    queryFn: () => getPOSCashierMasters({ data: {} }),
    staleTime: 60 * 1000,
  })
  const masters = mastersQuery.data
  const limits = masters ? posTierLimits(masters.tier) : null
  const hasFeature = limits?.features.includes('pl_report') ?? false

  const pageSize = 25
  const report = useQuery({
    queryKey: [
      'pos',
      'report',
      'pelanggan',
      branchId,
      from,
      to,
      debouncedSearch,
      sortBy,
      page,
    ],
    queryFn: () =>
      getPOSCustomersReport({
        data: {
          branchId: branchId || undefined,
          from,
          to,
          search: debouncedSearch || undefined,
          sortBy,
          sortDir: 'desc',
          page,
          pageSize,
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
   * owner whatever page was on screen — nothing in the file said so, so
   * 25 customers read as the entire list. Search and sort carry over
   * verbatim: an export must contain exactly what the screen claims to
   * show, just all of it.
   */
  async function runExport(
    write: (
      rows: CustomerReportRow[],
      anonymous: { count: number; total: number },
      from: string,
      to: string,
    ) => void,
  ) {
    setExporting(true)
    try {
      const full = await getPOSCustomersReport({
        data: {
          branchId: branchId || undefined,
          from,
          to,
          search: debouncedSearch || undefined,
          sortBy,
          sortDir: 'desc',
          all: true,
        },
      })
      write(full.rows, full.anonymousSummary, from, to)
      if (full.truncated) {
        toast({
          title: 'Sebagian data tidak ikut',
          description: `Laporan ini punya ${full.totalCount} baris; file berisi ${full.rows.length} teratas. Persempit rentang tanggal atau pakai pencarian untuk mengunduh sisanya.`,
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

  const columns: ReportColumn<CustomerReportRow>[] = [
    {
      key: 'name',
      header: 'Pelanggan',
      cell: (row) => (
        <div>
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {row.name}
          </span>
          {row.phone && (
            <div className="mt-0.5 text-xs text-gray-500">{row.phone}</div>
          )}
        </div>
      ),
    },
    {
      key: 'salesCount',
      header: 'Transaksi',
      align: 'right',
      cell: (row) => formatNumberID(row.salesCount),
    },
    {
      key: 'totalSpend',
      header: 'Total belanja',
      align: 'right',
      cell: (row) => (
        <span className="font-semibold">{formatRupiah(row.totalSpend)}</span>
      ),
    },
    {
      key: 'avgBasket',
      header: 'Rata-rata',
      align: 'right',
      hideOnMobile: true,
      cell: (row) => formatRupiah(row.avgBasket),
    },
    {
      key: 'lastVisit',
      header: 'Kunjungan terakhir',
      align: 'right',
      hideOnMobile: true,
      cell: (row) =>
        row.lastVisit ? formatDate(new Date(row.lastVisit), 'dd MMM yyyy') : '—',
    },
  ]

  return (
    <div className="space-y-4">
      <ModuleBreadcrumb />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Laporan Pelanggan
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Pelanggan yang berbelanja pada rentang ini, beserta total belanja
            dan rata-rata transaksinya.
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
            Cari nama / HP
          </label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="cth. Budi atau 0812…"
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
              { value: 'totalSpend', label: 'Total belanja (terbanyak)' },
              { value: 'salesCount', label: 'Transaksi (terbanyak)' },
              { value: 'avgBasket', label: 'Rata-rata (tertinggi)' },
              { value: 'lastVisit', label: 'Kunjungan terbaru' },
              { value: 'name', label: 'Nama (A-Z)' },
            ]}
          />
        </div>
      </div>

      {r && r.anonymousSummary.count > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-800/40">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
          <p className="text-gray-700 dark:text-gray-300">
            {formatNumberID(r.anonymousSummary.count)} transaksi tanpa pelanggan
            ={' '}
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {formatRupiah(r.anonymousSummary.total)}
            </span>{' '}
            <span className="text-xs text-gray-500">
              (tidak dimasukkan ke daftar di bawah)
            </span>
          </p>
        </div>
      )}

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
            rowKey={(row) => row.customerId}
            emptyMessage={
              debouncedSearch
                ? 'Tidak ada pelanggan yang cocok.'
                : 'Belum ada transaksi pelanggan terdaftar pada rentang ini.'
            }
          />
          {totalCount > pageSize && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm dark:border-gray-700">
              <span className="text-xs text-gray-500">
                Halaman {page} dari {totalPages} — {formatNumberID(totalCount)}{' '}
                pelanggan
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
      <h2 className="text-base font-semibold">Laporan Pelanggan (Pro)</h2>
      <p className="mt-1">
        Pemecahan pendapatan per pelanggan: siapa pelanggan paling sering
        belanja, paling besar belanjanya, dan kapan terakhir mampir. Tersedia
        di paket Toko ke atas.
      </p>
    </div>
  )
}

function exportXlsx(
  rows: CustomerReportRow[],
  anonymous: { count: number; total: number },
  from: string,
  to: string,
) {
  const sheetRows: (string | number | null)[][] = [
    [`Laporan Pelanggan ${from} → ${to}`],
    [],
  ]
  if (anonymous.count > 0) {
    sheetRows.push(['Transaksi tanpa pelanggan', anonymous.count, anonymous.total])
    sheetRows.push([])
  }
  sheetRows.push([
    'Nama',
    'HP',
    'Transaksi',
    'Total belanja',
    'Rata-rata',
    'Kunjungan pertama',
    'Kunjungan terakhir',
  ])
  for (const row of rows) {
    sheetRows.push([
      row.name,
      row.phone,
      row.salesCount,
      row.totalSpend,
      Number(row.avgBasket.toFixed(2)),
      row.firstVisit
        ? formatDate(new Date(row.firstVisit), 'yyyy-MM-dd')
        : null,
      row.lastVisit
        ? formatDate(new Date(row.lastVisit), 'yyyy-MM-dd')
        : null,
    ])
  }
  downloadXlsx(
    [{ name: 'Pelanggan', rows: sheetRows }],
    `Laporan-Pelanggan-${from}-${to}.xlsx`,
  )
}

function exportCsv(
  rows: CustomerReportRow[],
  anonymous: { count: number; total: number },
  from: string,
  to: string,
) {
  const out: string[] = []
  out.push(`"Laporan Pelanggan ${from} → ${to}"`)
  out.push('')
  if (anonymous.count > 0) {
    out.push(`Transaksi tanpa pelanggan,${anonymous.count},${anonymous.total}`)
    out.push('')
  }
  out.push(
    [
      'Nama',
      'HP',
      'Transaksi',
      'Total belanja',
      'Rata-rata',
      'Kunjungan pertama',
      'Kunjungan terakhir',
    ].join(','),
  )
  for (const row of rows) {
    out.push(
      [
        csvCell(row.name),
        csvCell(row.phone),
        row.salesCount,
        row.totalSpend,
        row.avgBasket.toFixed(2),
        csvCell(
          row.firstVisit
            ? formatDate(new Date(row.firstVisit), 'yyyy-MM-dd')
            : null,
        ),
        csvCell(
          row.lastVisit
            ? formatDate(new Date(row.lastVisit), 'yyyy-MM-dd')
            : null,
        ),
      ].join(','),
    )
  }
  downloadCsvBlob(out, `Laporan-Pelanggan-${from}-${to}.csv`)
}

function exportPdf(
  rows: CustomerReportRow[],
  anonymous: { count: number; total: number },
  from: string,
  to: string,
) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = pdfHeader(doc, 'Laporan Pelanggan', from, to)
  if (anonymous.count > 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.text(
      `Transaksi tanpa pelanggan: ${anonymous.count}× = ${formatRupiah(anonymous.total)}`,
      20,
      y,
    )
    y += 6
    doc.setFont('helvetica', 'normal')
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Pelanggan', 20, y)
  doc.text('Trx', 105, y, { align: 'right' })
  doc.text('Total', 140, y, { align: 'right' })
  doc.text('Rata-rata', 170, y, { align: 'right' })
  doc.text('Terakhir', 195, y, { align: 'right' })
  y += 5
  doc.setFont('helvetica', 'normal')
  for (const row of rows) {
    if (y > 275) {
      doc.addPage()
      y = 20
    }
    const label = row.phone ? `${row.name} (${row.phone})` : row.name
    doc.text(label, 20, y, { maxWidth: 80 })
    doc.text(formatNumberID(row.salesCount), 105, y, { align: 'right' })
    doc.text(formatRupiah(row.totalSpend), 140, y, { align: 'right' })
    doc.text(formatRupiah(row.avgBasket), 170, y, { align: 'right' })
    doc.text(
      row.lastVisit ? formatDate(new Date(row.lastVisit), 'dd/MM/yy') : '—',
      195,
      y,
      { align: 'right' },
    )
    y += 5
  }
  pdfFooter(doc)
  downloadPdf(doc, `Laporan-Pelanggan-${from}-${to}.pdf`)
}
