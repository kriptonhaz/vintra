/**
 * Laporan Diskon — three blocks: manual discounts (cashier-applied
 * line + cart), promo codes (snapshotted at sale), and auto promos
 * (line-level auto_promo_id). Each block totals up so owners can
 * see how much revenue they're trading for promotions.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { jsPDF } from 'jspdf'
import { AlertCircle, Tag, Zap, Scissors } from 'lucide-react'
import { getPOSCashierMasters } from '@/server/functions/pos'
import {
  getPOSDiscountReport,
  type DiscountReport,
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

export const Route = createFileRoute('/_authed/pos/reports/diskon')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('pos.report.view')) {
      throw redirect({ to: '/pos' })
    }
  },
  component: DiskonPage,
})

function DiskonPage() {
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
    queryKey: ['pos', 'report', 'diskon', branchId, from, to],
    queryFn: () =>
      getPOSDiscountReport({
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
  const manualTotal = r ? r.manual.lineDiscount + r.manual.cartDiscount : 0
  const codesTotal = r
    ? r.promoCodes.reduce((s, c) => s + c.totalDiscount, 0)
    : 0
  const autoTotal = r
    ? r.autoPromos.reduce((s, a) => s + a.totalDiscount, 0)
    : 0
  const grandTotal = manualTotal + codesTotal + autoTotal

  const codeColumns: ReportColumn<DiscountReport['promoCodes'][number]>[] = [
    {
      key: 'code',
      header: 'Kode',
      cell: (row) => (
        <div>
          <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
            {row.code}
          </span>
          {row.name && (
            <div className="mt-0.5 text-xs text-gray-500">{row.name}</div>
          )}
        </div>
      ),
    },
    {
      key: 'salesCount',
      header: 'Dipakai',
      align: 'right',
      cell: (row) => `${formatNumberID(row.salesCount)}×`,
    },
    {
      key: 'totalDiscount',
      header: 'Total diskon',
      align: 'right',
      cell: (row) => (
        <span className="font-semibold">{formatRupiah(row.totalDiscount)}</span>
      ),
    },
  ]
  const autoColumns: ReportColumn<DiscountReport['autoPromos'][number]>[] = [
    {
      key: 'name',
      header: 'Promo',
      cell: (row) => (
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {row.name ?? `(dihapus) ${row.promoId.slice(0, 8)}…`}
        </span>
      ),
    },
    {
      key: 'linesCount',
      header: 'Line',
      align: 'right',
      cell: (row) => `${formatNumberID(row.linesCount)}×`,
    },
    {
      key: 'totalDiscount',
      header: 'Total diskon',
      align: 'right',
      cell: (row) => (
        <span className="font-semibold">{formatRupiah(row.totalDiscount)}</span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <ModuleBreadcrumb />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Laporan Diskon
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Diskon yang diberikan ke pelanggan — dari kasir, kode promo, dan promo
            otomatis. Total dipisah biar gampang dianalisa.
          </p>
        </div>
        {r && (
          <ExportMenu
            disabled={
              r.promoCodes.length === 0 &&
              r.autoPromos.length === 0 &&
              r.manual.lineDiscount === 0 &&
              r.manual.cartDiscount === 0
            }
            onXlsx={() => exportXlsx(r, from, to)}
            onCsv={() => exportCsv(r, from, to)}
            onPdf={() => exportPdf(r, from, to)}
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
          {/* Top-line totals */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TotalCard
              label="Total diskon"
              value={formatRupiah(grandTotal)}
              bold
            />
            <TotalCard label="Manual" value={formatRupiah(manualTotal)} />
            <TotalCard label="Kode promo" value={formatRupiah(codesTotal)} />
            <TotalCard label="Auto promo" value={formatRupiah(autoTotal)} />
          </div>

          {/* Manual block */}
          <Section icon={<Scissors className="h-4 w-4 text-brand-600" />} title="Diskon Manual (kasir)">
            <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
              <Stat
                label="Diskon per item"
                value={formatRupiah(r.manual.lineDiscount)}
              />
              <Stat
                label="Diskon per transaksi"
                value={formatRupiah(r.manual.cartDiscount)}
              />
              <Stat
                label="Transaksi dengan diskon"
                value={formatNumberID(r.manual.salesWithDiscount)}
              />
            </div>
          </Section>

          {/* Promo codes block */}
          <Section icon={<Tag className="h-4 w-4 text-brand-600" />} title="Kode Promo">
            <ReportTable
              columns={codeColumns}
              rows={r.promoCodes}
              rowKey={(row) => row.code}
              emptyMessage="Tidak ada kode promo terpakai pada rentang ini."
            />
          </Section>

          {/* Auto promos block */}
          <Section icon={<Zap className="h-4 w-4 text-brand-600" />} title="Promo Otomatis">
            <ReportTable
              columns={autoColumns}
              rows={r.autoPromos}
              rowKey={(row) => row.promoId}
              emptyMessage="Tidak ada promo otomatis terpakai pada rentang ini."
            />
          </Section>
        </>
      )}
    </div>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
        {icon}
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {title}
        </h2>
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </p>
    </div>
  )
}

function TotalCard({
  label,
  value,
  bold,
}: {
  label: string
  value: string
  bold?: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={
          bold
            ? 'mt-1 text-lg font-bold text-gray-900 dark:text-gray-100'
            : 'mt-1 text-base text-gray-900 dark:text-gray-100'
        }
      >
        {value}
      </p>
    </div>
  )
}

function UpgradeBanner() {
  return (
    <div className="rounded-xl border border-warning-200 bg-warning-50 p-6 text-sm text-warning-900 dark:border-warning-700 dark:bg-warning-900/20 dark:text-warning-200">
      <h2 className="text-base font-semibold">Laporan Diskon (Pro)</h2>
      <p className="mt-1">
        Lihat total diskon yang diberikan ke pelanggan: per kasir, per kode
        promo, dan per promo otomatis. Tersedia di paket Toko ke atas.
      </p>
    </div>
  )
}

function exportXlsx(r: DiscountReport, from: string, to: string) {
  const manualRows: (string | number | null)[][] = [
    [`Laporan Diskon ${from} → ${to}`],
    [],
    ['Diskon Manual'],
    ['Diskon per item', r.manual.lineDiscount],
    ['Diskon per transaksi', r.manual.cartDiscount],
    ['Transaksi dengan diskon', r.manual.salesWithDiscount],
  ]
  const codeRows: (string | number | null)[][] = [
    ['Kode', 'Nama', 'Dipakai', 'Total diskon'],
    ...r.promoCodes.map((c) => [c.code, c.name, c.salesCount, c.totalDiscount]),
  ]
  const autoRows: (string | number | null)[][] = [
    ['Promo', 'Line', 'Total diskon'],
    ...r.autoPromos.map((a) => [a.name ?? a.promoId, a.linesCount, a.totalDiscount]),
  ]
  downloadXlsx(
    [
      { name: 'Manual', rows: manualRows },
      { name: 'Kode Promo', rows: codeRows },
      { name: 'Promo Otomatis', rows: autoRows },
    ],
    `Laporan-Diskon-${from}-${to}.xlsx`,
  )
}

function exportCsv(r: DiscountReport, from: string, to: string) {
  const out: string[] = []
  out.push(`"Laporan Diskon ${from} → ${to}"`)
  out.push('')
  out.push('Manual')
  out.push(`Diskon per item,${r.manual.lineDiscount}`)
  out.push(`Diskon per transaksi,${r.manual.cartDiscount}`)
  out.push(`Transaksi dengan diskon,${r.manual.salesWithDiscount}`)
  out.push('')
  out.push('Kode Promo')
  out.push('Kode,Nama,Dipakai,Total diskon')
  for (const c of r.promoCodes) {
    out.push(
      [csvCell(c.code), csvCell(c.name), c.salesCount, c.totalDiscount].join(','),
    )
  }
  out.push('')
  out.push('Promo Otomatis')
  out.push('Promo,Line,Total diskon')
  for (const a of r.autoPromos) {
    out.push([csvCell(a.name ?? a.promoId), a.linesCount, a.totalDiscount].join(','))
  }
  downloadCsvBlob(out, `Laporan-Diskon-${from}-${to}.csv`)
}

function exportPdf(r: DiscountReport, from: string, to: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = pdfHeader(doc, 'Laporan Diskon', from, to)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Manual', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  for (const [k, v] of [
    ['Diskon per item', formatRupiah(r.manual.lineDiscount)],
    ['Diskon per transaksi', formatRupiah(r.manual.cartDiscount)],
    [
      'Transaksi dengan diskon',
      formatNumberID(r.manual.salesWithDiscount),
    ],
  ] as const) {
    doc.text(k, 20, y)
    doc.text(v, 110, y, { align: 'right' })
    y += 5
  }
  y += 4

  if (y > 240) {
    doc.addPage()
    y = 20
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Kode Promo', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  if (r.promoCodes.length === 0) {
    doc.text('Tidak ada kode promo terpakai.', 20, y)
    y += 5
  } else {
    for (const c of r.promoCodes) {
      if (y > 275) {
        doc.addPage()
        y = 20
      }
      const label = c.name ? `${c.code} — ${c.name}` : c.code
      doc.text(`${label} (${c.salesCount}×)`, 20, y, { maxWidth: 100 })
      doc.text(formatRupiah(c.totalDiscount), 190, y, { align: 'right' })
      y += 5
    }
  }
  y += 4

  if (y > 240) {
    doc.addPage()
    y = 20
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Promo Otomatis', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  if (r.autoPromos.length === 0) {
    doc.text('Tidak ada promo otomatis terpakai.', 20, y)
  } else {
    for (const a of r.autoPromos) {
      if (y > 275) {
        doc.addPage()
        y = 20
      }
      const label = a.name ?? `(dihapus) ${a.promoId.slice(0, 8)}…`
      doc.text(`${label} (${a.linesCount}×)`, 20, y, { maxWidth: 100 })
      doc.text(formatRupiah(a.totalDiscount), 190, y, { align: 'right' })
      y += 5
    }
  }
  pdfFooter(doc)
  downloadPdf(doc, `Laporan-Diskon-${from}-${to}.pdf`)
}
