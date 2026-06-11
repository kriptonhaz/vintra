import { useMemo, useState, useEffect, useRef } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Lock,
  TrendingUp,
  TrendingDown,
  Download,
  FileText,
} from 'lucide-react'
import { getCashflowOverview } from '@/server/functions/cashflow'
import {
  getCashflowDashboard,
  getCashflowEntriesCsv,
  getCashflowPLReportPdf,
} from '@/server/functions/cashflow-dashboard'
import { listCashflowAccounts } from '@/server/functions/cashflow-accounts'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { downloadPdfDataUrl } from '@/lib/print-pdf'
import { formatRupiah } from '@/lib/currency'
import { cn, formatDate } from '@/lib/utils'

type Preset = 'this_month' | 'last_month' | 'this_quarter' | 'custom'

/** Jakarta-local today as YYYY-MM-DD parts. */
function jakartaToday() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() }
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function presetRange(preset: Exclude<Preset, 'custom'>): {
  from: string
  to: string
} {
  const { y, m } = jakartaToday()
  if (preset === 'this_month') {
    return { from: ymd(y, m, 1), to: ymd(y, m, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()) }
  }
  if (preset === 'last_month') {
    const pm = m === 0 ? 11 : m - 1
    const py = m === 0 ? y - 1 : y
    return {
      from: ymd(py, pm, 1),
      to: ymd(py, pm, new Date(Date.UTC(py, pm + 1, 0)).getUTCDate()),
    }
  }
  // this_quarter
  const qStart = Math.floor(m / 3) * 3
  return {
    from: ymd(y, qStart, 1),
    to: ymd(y, qStart + 2, new Date(Date.UTC(y, qStart + 3, 0)).getUTCDate()),
  }
}

export const Route = createFileRoute('/_authed/cashflow/dashboard')({
  loader: async () => {
    const overview = await getCashflowOverview()
    if (!overview.hasAccess) return { locked: true as const }
    const { from, to } = presetRange('this_month')
    const [data, accounts] = await Promise.all([
      getCashflowDashboard({ data: { from, to } }),
      listCashflowAccounts(),
    ])
    return { locked: false as const, data, accounts, from, to }
  },
  component: DashboardPage,
})

type DashboardData = Awaited<ReturnType<typeof getCashflowDashboard>>
type CashflowAccount = Awaited<ReturnType<typeof listCashflowAccounts>>[number]

function DashboardPage() {
  const loaded = Route.useLoaderData()
  if (loaded.locked) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-accent-200 bg-accent-50 p-8 text-center dark:border-accent-900/40 dark:bg-accent-900/20">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
            <Lock className="h-6 w-6 text-accent-700 dark:text-accent-400" />
          </div>
          <h2 className="text-lg font-semibold text-accent-900 dark:text-accent-200">
            Dashboard Arus Kas
          </h2>
          <p className="mt-1 text-sm text-accent-800 dark:text-accent-300">
            Fitur ini termasuk dalam paket Komplit.
          </p>
        </div>
      </div>
    )
  }
  return (
    <DashboardContent
      initial={loaded.data}
      accounts={loaded.accounts}
      initialFrom={loaded.from}
      initialTo={loaded.to}
    />
  )
}

function DashboardContent({
  initial,
  accounts,
  initialFrom,
  initialTo,
}: {
  initial: DashboardData
  accounts: CashflowAccount[]
  initialFrom: string
  initialTo: string
}) {
  const { toast } = useToast()
  const { selectedBranchId } = useBranch()
  const [preset, setPreset] = useState<Preset>('this_month')
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [branchId, setBranchId] = useState('')
  const [exporting, setExporting] = useState(false)

  // Seed the branch filter from the global topbar switcher once, on
  // first load. The dashboard keeps its own Select afterwards (it has
  // a "Semua cabang" all-branches option the global switcher lacks).
  const branchSeeded = useRef(false)
  useEffect(() => {
    if (branchSeeded.current || !selectedBranchId) return
    branchSeeded.current = true
    setBranchId(selectedBranchId)
  }, [selectedBranchId])

  function applyPreset(p: Preset) {
    setPreset(p)
    if (p !== 'custom') {
      const r = presetRange(p)
      setFrom(r.from)
      setTo(r.to)
    }
  }

  const query = useQuery({
    queryKey: ['cashflow', 'dashboard', from, to, branchId],
    queryFn: () =>
      getCashflowDashboard({
        data: { from, to, ...(branchId ? { branchId } : {}) },
      }),
    initialData:
      from === initialFrom && to === initialTo && branchId === ''
        ? initial
        : undefined,
  })
  const data = query.data ?? initial
  const k = data.kpis

  async function handleCsv() {
    setExporting(true)
    try {
      const res = await getCashflowEntriesCsv({
        data: { from, to, ...(branchId ? { branchId } : {}) },
      })
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Ekspor CSV gagal',
        variant: 'error',
      })
    } finally {
      setExporting(false)
    }
  }

  async function handlePdf() {
    setExporting(true)
    try {
      const res = await getCashflowPLReportPdf({
        data: { from, to, ...(branchId ? { branchId } : {}) },
      })
      downloadPdfDataUrl(res.dataUrl, res.fileName)
    } catch (err) {
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Ekspor PDF gagal',
        variant: 'error',
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            to="/cashflow"
            className="mb-1 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Catatan Kas
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Dashboard Arus Kas
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleCsv} loading={exporting}>
            <Download className="h-4 w-4" /> Unduh CSV
          </Button>
          <Button variant="outline" onClick={handlePdf} loading={exporting}>
            <FileText className="h-4 w-4" /> Unduh PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:flex-wrap sm:items-end">
        <Select
          label="Periode"
          value={preset}
          onChange={(e) => applyPreset(e.target.value as Preset)}
          options={[
            { label: 'Bulan ini', value: 'this_month' },
            { label: 'Bulan lalu', value: 'last_month' },
            { label: 'Kuartal ini', value: 'this_quarter' },
            { label: 'Kustom', value: 'custom' },
          ]}
          className="sm:w-44"
        />
        <DateInput
          label="Dari"
          value={from}
          disabled={preset !== 'custom'}
          onChange={setFrom}
          className="sm:w-40"
        />
        <DateInput
          label="Sampai"
          value={to}
          disabled={preset !== 'custom'}
          onChange={setTo}
          className="sm:w-40"
        />
        {data.branches.length > 0 && (
          <Select
            label="Cabang"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={[
              { label: 'Semua cabang', value: '' },
              ...data.branches.map((b) => ({ label: b.name, value: b.id })),
            ]}
            className="sm:w-48"
          />
        )}
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pemasukan"
          value={k.income}
          prev={k.prevIncome}
          tone="income"
        />
        <KpiCard
          label="Pengeluaran"
          value={k.expense}
          prev={k.prevExpense}
          tone="expense"
        />
        <KpiCard label="Laba Bersih" value={k.net} prev={k.prevNet} tone="net" />
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            Posisi Kas Bersih
          </p>
          <p
            className={cn(
              'mt-2 text-2xl font-bold tabular-nums',
              data.posisiKas >= 0
                ? 'text-gray-900 dark:text-gray-100'
                : 'text-red-700 dark:text-red-400',
            )}
          >
            {formatRupiah(data.posisiKas)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Laba + bon belum tertagih − cicilan belum lunas
          </p>
        </div>
      </div>

      {/* AR / AP */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/cashflow/bon"
          className="rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/40"
        >
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            Bon pelanggan belum tertagih
          </p>
          <p className="mt-2 text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {formatRupiah(data.outstandingAR)}
          </p>
        </Link>
        <Link
          to="/cashflow/cicilan"
          className="rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/40"
        >
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            Cicilan belum lunas
          </p>
          <p className="mt-2 text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {formatRupiah(data.outstandingAP)}
          </p>
        </Link>
      </div>

      {/* Saldo per akun (JUR-192) — only for multi-account tenants. */}
      {accounts.length > 1 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Saldo per akun
          </h2>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {accounts.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="text-gray-700 dark:text-gray-300">
                  {a.name}
                </span>
                <span
                  className={cn(
                    'font-medium tabular-nums',
                    a.balance >= 0
                      ? 'text-gray-900 dark:text-gray-100'
                      : 'text-red-700 dark:text-red-400',
                  )}
                >
                  {formatRupiah(a.balance)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Category breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryBars
          title="Pemasukan per kategori"
          rows={data.incomeByCategory}
          tone="income"
        />
        <CategoryBars
          title="Pengeluaran per kategori"
          rows={data.expenseByCategory}
          tone="expense"
        />
      </div>

      {/* Per-branch comparison — only meaningful with >1 outlet and the
          "Semua cabang" (all branches) view selected. */}
      {branchId === '' && data.branches.length > 1 && (
        <BranchComparison rows={data.byBranch} />
      )}

      {/* Daily trend */}
      <DailyTrend rows={data.dailyTrend} />
    </div>
  )
}

function KpiCard({
  label,
  value,
  prev,
  tone,
}: {
  label: string
  value: number
  prev: number
  tone: 'income' | 'expense' | 'net'
}) {
  const delta = prev === 0 ? null : ((value - prev) / Math.abs(prev)) * 100
  const valueColor =
    tone === 'income'
      ? 'text-success-700 dark:text-success-400'
      : tone === 'expense'
        ? 'text-red-700 dark:text-red-400'
        : value >= 0
          ? 'text-gray-900 dark:text-gray-100'
          : 'text-red-700 dark:text-red-400'
  // For expense, an increase is "bad" → red; for income/net, increase is good.
  const up = delta != null && delta >= 0
  const goodDirection = tone === 'expense' ? !up : up
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
        {label}
      </p>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums', valueColor)}>
        {formatRupiah(value)}
      </p>
      {delta != null && (
        <p
          className={cn(
            'mt-1 inline-flex items-center gap-1 text-xs font-medium',
            goodDirection
              ? 'text-success-600 dark:text-success-400'
              : 'text-red-600 dark:text-red-400',
          )}
        >
          {up ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )}
          {Math.abs(delta).toFixed(0)}% vs periode lalu
        </p>
      )}
    </div>
  )
}

function CategoryBars({
  title,
  rows,
  tone,
}: {
  title: string
  rows: { name: string; total: number }[]
  tone: 'income' | 'expense'
}) {
  const max = useMemo(
    () => Math.max(1, ...rows.map((r) => r.total)),
    [rows],
  )
  const barColor = tone === 'income' ? 'bg-success-500' : 'bg-red-500'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">Belum ada data.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.name}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-300">
                  {r.name}
                </span>
                <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">
                  {formatRupiah(r.total)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                <div
                  className={cn('h-full rounded-full', barColor)}
                  style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type BranchRow = {
  branchId: string | null
  name: string
  income: number
  expense: number
  net: number
}

/**
 * Horizontal grouped bars comparing each outlet's income vs. expense,
 * so the owner can spot at a glance which branch carries the business.
 * Hovering or clicking a row opens a popover with the exact figures.
 */
function BranchComparison({ rows }: { rows: BranchRow[] }) {
  // `active` is the currently revealed popover. Hover sets it; clicking
  // pins it (so it survives the mouse leaving on touch / careful reads).
  const [active, setActive] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const max = useMemo(
    () => Math.max(1, ...rows.flatMap((r) => [r.income, r.expense])),
    [rows],
  )

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          Perbandingan per cabang
        </h2>
        <p className="text-sm text-gray-400">Belum ada data pada periode ini.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Perbandingan per cabang
        </h2>
        {/* Legend */}
        <div className="flex gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-success-500" /> Pemasukan
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-red-500" /> Pengeluaran
          </span>
        </div>
      </div>
      <ul className="space-y-4">
        {rows.map((r) => {
          const key = r.branchId ?? '__none__'
          const open = pinned === key || active === key
          return (
            <li key={key} className="relative">
              <button
                type="button"
                onMouseEnter={() => setActive(key)}
                onMouseLeave={() => setActive(null)}
                onClick={() =>
                  setPinned((cur) => (cur === key ? null : key))
                }
                className="block w-full rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                aria-expanded={open}
              >
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="truncate pr-2 text-gray-700 dark:text-gray-300">
                    {r.name}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-medium tabular-nums',
                      r.net >= 0
                        ? 'text-gray-900 dark:text-gray-100'
                        : 'text-red-700 dark:text-red-400',
                    )}
                  >
                    {formatRupiah(r.net)}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div
                      className="h-full rounded-full bg-success-500 transition-[width]"
                      style={{
                        width: `${Math.max(2, (r.income / max) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div
                      className="h-full rounded-full bg-red-500 transition-[width]"
                      style={{
                        width: `${Math.max(2, (r.expense / max) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </button>

              {/* Popover with the exact figures for this outlet. */}
              {open && (
                <div
                  role="tooltip"
                  className="absolute left-0 top-full z-20 mt-2 w-64 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg dark:border-gray-600 dark:bg-gray-900"
                >
                  <p className="mb-2 font-semibold text-gray-900 dark:text-gray-100">
                    {r.name}
                  </p>
                  <dl className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">
                        Pemasukan
                      </dt>
                      <dd className="font-medium tabular-nums text-success-700 dark:text-success-400">
                        {formatRupiah(r.income)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">
                        Pengeluaran
                      </dt>
                      <dd className="font-medium tabular-nums text-red-700 dark:text-red-400">
                        {formatRupiah(r.expense)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-100 pt-1.5 dark:border-gray-700">
                      <dt className="text-gray-500 dark:text-gray-400">
                        Laba bersih
                      </dt>
                      <dd
                        className={cn(
                          'font-semibold tabular-nums',
                          r.net >= 0
                            ? 'text-gray-900 dark:text-gray-100'
                            : 'text-red-700 dark:text-red-400',
                        )}
                      >
                        {formatRupiah(r.net)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function DailyTrend({
  rows,
}: {
  rows: { date: string; income: number; expense: number }[]
}) {
  const max = useMemo(
    () => Math.max(1, ...rows.flatMap((r) => [r.income, r.expense])),
    [rows],
  )
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Tren harian
        </h2>
        <div className="flex gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-success-500" /> Masuk
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-red-500" /> Keluar
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">Belum ada data pada periode ini.</p>
      ) : (
        <div className="flex h-40 items-end gap-1 overflow-x-auto">
          {rows.map((r) => (
            <div
              key={r.date}
              className="flex min-w-[8px] flex-1 flex-col items-center gap-0.5"
              title={`${formatDate(r.date, 'dd MMM')} · masuk ${formatRupiah(r.income)} · keluar ${formatRupiah(r.expense)}`}
            >
              <div className="flex h-32 w-full items-end justify-center gap-0.5">
                <div
                  className="w-1/2 rounded-t bg-success-500"
                  style={{ height: `${(r.income / max) * 100}%` }}
                />
                <div
                  className="w-1/2 rounded-t bg-red-500"
                  style={{ height: `${(r.expense / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
