import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search, FileDown } from 'lucide-react'
import { listSales } from '@/server/functions/pos'
import { getDailyZReportPDF } from '@/server/functions/pos-receipt'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils' // JUR-137
import { type POSPaymentMethod } from '@vintra/shared'
import {
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table'

// Keyed by the raw DB string (sales rows carry payment_method as text).
const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  ewallet: 'E-Wallet',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
  ovo: 'OVO',
}

// Stable display order for the reconciliation summary cards.
const PAGE_SIZE = 50

const PAYMENT_ORDER: string[] = [
  'cash',
  'qris',
  'transfer',
  'card',
  'ewallet',
  'gopay',
  'shopeepay',
  'ovo',
]

interface SalesSearch {
  date?: string
  branchId?: string
  status?: 'completed' | 'voided'
  paymentMethod?: POSPaymentMethod
}

export const Route = createFileRoute('/_authed/pos/sales/')({
  validateSearch: (s: Record<string, unknown>): SalesSearch => ({
    date: typeof s.date === 'string' ? s.date : undefined,
    branchId: typeof s.branchId === 'string' ? s.branchId : undefined,
    status:
      s.status === 'completed' || s.status === 'voided' ? s.status : undefined,
    paymentMethod:
      typeof s.paymentMethod === 'string'
        ? (s.paymentMethod as SalesSearch['paymentMethod'])
        : undefined,
  }),
  component: SalesPage,
})

function SalesPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { t } = useTranslation()
  const { toast } = useToast()

  /**
   * The list is newest-first, so without a pager everything older than the
   * first page was simply unreachable — a branch ringing a few hundred sales
   * a day would see only its most recent hours and read that as "the morning
   * is missing".
   */
  const [page, setPage] = React.useState(1)
  const [from, setFrom] = React.useState(search.date ?? '')
  const [to, setTo] = React.useState(search.date ?? '')
  const { selectedBranchId } = useBranch()

  // A page number from the previous filter is meaningless, and an
  // out-of-range page renders an empty table that reads as "no transactions".
  React.useEffect(() => {
    setPage(1)
  }, [from, to, search.status, search.paymentMethod, selectedBranchId])

  const sales = useQuery({
    queryKey: [
      'pos',
      'sales',
      from,
      to,
      search.status,
      search.paymentMethod,
      selectedBranchId,
    ],
    queryFn: () =>
      listSales({
        data: {
          from: from || undefined,
          to: to || undefined,
          status: search.status,
          paymentMethod: search.paymentMethod,
          branchId: selectedBranchId ?? undefined,
          page: 1,
          pageSize: 100,
        },
      }),
  })

  // Per-method reconciliation totals (completed sales, respects the
  // date filter, ignores the payment-method filter — see listSales).
  const paymentSummary = React.useMemo(() => {
    const rows = sales.data?.byPaymentMethod ?? []
    const sorted = [...rows].sort(
      (a, b) => PAYMENT_ORDER.indexOf(a.method) - PAYMENT_ORDER.indexOf(b.method),
    )
    return {
      sorted,
      grandTotal: rows.reduce((s, m) => s + m.total, 0),
      grandCount: rows.reduce((s, m) => s + m.count, 0),
    }
  }, [sales.data])

  const downloadZ = useMutation({
    mutationFn: (date: string) => getDailyZReportPDF({ data: { date } }),
    onSuccess: (data) => {
      const a = document.createElement('a')
      a.href = data.dataUrl
      a.download = data.fileName
      a.click()
    },
    onError: () => toast({ title: 'Gagal mengunduh Z-Report', variant: 'error' }),
  })

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('pos.salesTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('pos.salesSubtitle')}
          </p>
        </div>
        {from && from === to && (
          <Button
            variant="outline"
            onClick={() => downloadZ.mutate(from)}
            loading={downloadZ.isPending}
          >
            <FileDown className="h-4 w-4" /> Z-Report ({from})
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <DateInput
          label="Dari"
          value={from}
          onChange={setFrom}
        />
        <DateInput
          label="Sampai"
          value={to}
          onChange={setTo}
        />
        <Select
          label="Status"
          value={search.status ?? ''}
          onChange={(e) => {
            const v = e.target.value
            navigate({
              to: '.',
              search: (s) => ({
                ...s,
                status: (v || undefined) as SalesSearch['status'],
              }),
            })
          }}
          options={[
            { value: '', label: 'Semua' },
            { value: 'completed', label: 'Selesai' },
            { value: 'voided', label: 'Dibatalkan' },
          ]}
        />
        <Select
          label="Metode"
          value={search.paymentMethod ?? ''}
          onChange={(e) => {
            const v = e.target.value
            navigate({
              to: '.',
              search: (s) => ({
                ...s,
                paymentMethod: (v ||
                  undefined) as SalesSearch['paymentMethod'],
              }),
            })
          }}
          options={[
            { value: '', label: 'Semua' },
            { value: 'cash', label: 'Tunai' },
            { value: 'qris', label: 'QRIS' },
            { value: 'transfer', label: 'Transfer' },
            { value: 'card', label: 'Kartu' },
            { value: 'ewallet', label: 'E-Wallet' },
            { value: 'gopay', label: 'GoPay' },
            { value: 'shopeepay', label: 'ShopeePay' },
            { value: 'ovo', label: 'OVO' },
          ]}
        />
      </div>

      {sales.data?.historyClampedDays != null && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-900 dark:border-warning-700 dark:bg-warning-900/20 dark:text-warning-200">
          Riwayat dibatasi {sales.data.historyClampedDays} hari terakhir di paket Free.{' '}
          <Link to="/pos/billing" className="underline">
            Upgrade ke Toko
          </Link>{' '}
          untuk riwayat lengkap.
        </div>
      )}

      {!sales.isLoading && paymentSummary.sorted.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Ringkasan per Metode Bayar
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Transaksi selesai
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            {paymentSummary.sorted.map((m) => (
              <div
                key={m.method}
                className="min-w-[140px] flex-1 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40"
              >
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {PAYMENT_LABEL[m.method] ?? m.method}
                </p>
                <p className="mt-0.5 text-base font-bold text-gray-900 dark:text-gray-100">
                  {formatRupiah(m.total)}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {m.count} transaksi
                </p>
              </div>
            ))}
            <div className="min-w-[140px] flex-1 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-900 dark:bg-brand-900/20">
              <p className="text-xs font-medium text-brand-600 dark:text-brand-400">
                Total
              </p>
              <p className="mt-0.5 text-base font-bold text-brand-700 dark:text-brand-300">
                {formatRupiah(paymentSummary.grandTotal)}
              </p>
              <p className="text-xs text-brand-500/70 dark:text-brand-400/70">
                {paymentSummary.grandCount} transaksi
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        {sales.isLoading ? (
          <p className="py-8 text-center text-sm text-gray-500">Memuat…</p>
        ) : (sales.data?.sales.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            Belum ada transaksi pada rentang ini.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>No.</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Metode</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.data?.sales.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{formatDate(s.createdAt, 'dd MMM yyyy, HH:mm')}</TableCell>
                  <TableCell className="font-mono text-xs">{s.saleNumber}</TableCell>
                  <TableCell>{s.branchName}</TableCell>
                  <TableCell>{PAYMENT_LABEL[s.paymentMethod] ?? s.paymentMethod}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatRupiah(Number(s.total))}
                  </TableCell>
                  <TableCell>
                    {s.status === 'voided' ? (
                      <Badge variant="danger">Dibatalkan</Badge>
                    ) : (
                      <Badge variant="success">Selesai</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/pos/sales/$saleId"
                      params={{ saleId: s.id }}
                      className="text-brand-700 hover:underline"
                    >
                      Detail
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      )}

      {/* Pager. Rendered whenever there is more than one page — a count with
          no way to move is just a statistic. */}
      {(sales.data?.total ?? 0) > PAGE_SIZE && (
        <div className="mt-3 flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Menampilkan {(page - 1) * PAGE_SIZE + 1}–
            {Math.min(page * PAGE_SIZE, sales.data?.total ?? 0)} dari{' '}
            {sales.data?.total ?? 0} transaksi
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={page <= 1 || sales.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Sebelumnya
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {page} / {Math.max(1, Math.ceil((sales.data?.total ?? 0) / PAGE_SIZE))}
            </span>
            <Button
              variant="outline"
              disabled={
                page >= Math.ceil((sales.data?.total ?? 0) / PAGE_SIZE) ||
                sales.isFetching
              }
              onClick={() => setPage((p) => p + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
