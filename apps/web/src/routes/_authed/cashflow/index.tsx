import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Lock, Wallet, Pencil, Trash2, ArrowDownRight, ArrowUpRight } from 'lucide-react'
import {
  getCashflowOverview,
  listCashflowCategories,
  listCashflowBranches,
  listCashflowEntries,
  deleteCashflowEntry,
} from '@/server/functions/cashflow'
import { listCashflowAccounts } from '@/server/functions/cashflow-accounts'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import {
  CashflowEntrySheet,
  type CashflowEntryDraft,
} from '@/components/cashflow/cashflow-entry-sheet'
import { formatRupiah } from '@/lib/currency'
import { cn, formatDate } from '@/lib/utils'
import { buildSalesWaUrl } from '@/lib/constants'

/** Current calendar month as a Jakarta-local YYYY-MM-DD range. */
function monthRange(): { from: string; to: string } {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const mm = String(m + 1).padStart(2, '0')
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

export const Route = createFileRoute('/_authed/cashflow/')({
  loader: async () => {
    const overview = await getCashflowOverview()
    if (!overview.hasAccess) return { locked: true as const }
    const { from, to } = monthRange()
    const [categories, branches, accounts, entries] = await Promise.all([
      listCashflowCategories(),
      listCashflowBranches(),
      listCashflowAccounts(),
      listCashflowEntries({ data: { from, to, page: 1 } }),
    ])
    return {
      locked: false as const,
      categories,
      branches,
      accounts,
      entries,
      from,
      to,
    }
  },
  component: CashflowLedgerPage,
})

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  pos_sale: 'POS',
  bank_import: 'Bank',
  pos_cash_payout: 'Tarik Tunai',
  po_payment: 'Pembayaran PO',
}

type EntriesResult = Awaited<ReturnType<typeof listCashflowEntries>>
type CashflowCategory = Awaited<ReturnType<typeof listCashflowCategories>>[number]
type CashflowBranch = Awaited<ReturnType<typeof listCashflowBranches>>[number]
type CashflowAccount = Awaited<ReturnType<typeof listCashflowAccounts>>[number]

function CashflowLedgerPage() {
  const data = Route.useLoaderData()

  if (data.locked) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-accent-200 bg-accent-50 p-8 text-center dark:border-accent-900/40 dark:bg-accent-900/20">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
            <Lock className="h-6 w-6 text-accent-700 dark:text-accent-400" />
          </div>
          <h2 className="text-lg font-semibold text-accent-900 dark:text-accent-200">
            Cashflow Monitoring
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-accent-800 dark:text-accent-300">
            Pantau pemasukan dan pengeluaran usaha Anda dalam satu catatan.
            Fitur ini termasuk dalam paket Komplit.
          </p>
          <a
            href={buildSalesWaUrl(
              'Halo, saya ingin upgrade ke paket Komplit untuk fitur Cashflow.',
            )}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-4 inline-block"
          >
            <Button variant="brand">Upgrade ke Komplit</Button>
          </a>
        </div>
      </div>
    )
  }

  return (
    <LedgerContent
      categories={data.categories}
      branches={data.branches}
      accounts={data.accounts}
      entries={data.entries}
      initialFrom={data.from}
      initialTo={data.to}
    />
  )
}

function LedgerContent({
  categories,
  branches,
  accounts,
  entries,
  initialFrom,
  initialTo,
}: {
  categories: CashflowCategory[]
  branches: CashflowBranch[]
  accounts: CashflowAccount[]
  entries: EntriesResult
  initialFrom: string
  initialTo: string
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { selectedBranchId } = useBranch()

  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>(
    'all',
  )
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [hidePos, setHidePos] = useState(false)
  const [page, setPage] = useState(1)

  const [sheetType, setSheetType] = useState<'income' | 'expense'>('income')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<CashflowEntryDraft | null>(null)
  const [deleting, setDeleting] = useState<{ id: string } | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const entriesQuery = useQuery({
    queryKey: [
      'cashflow',
      'entries',
      from,
      to,
      typeFilter,
      categoryId,
      accountId,
      hidePos,
      page,
      selectedBranchId,
    ],
    queryFn: () =>
      listCashflowEntries({
        data: {
          from,
          to,
          page,
          ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(accountId ? { accountId } : {}),
          ...(hidePos ? { hidePos: true } : {}),
          ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
        },
      }),
    initialData:
      from === initialFrom &&
      to === initialTo &&
      typeFilter === 'all' &&
      categoryId === '' &&
      accountId === '' &&
      !hidePos &&
      page === 1 &&
      !selectedBranchId
        ? entries
        : undefined,
  })

  const result = entriesQuery.data
  const items = result?.items ?? []
  const totals = result?.totals ?? { income: 0, expense: 0, net: 0 }
  const total = result?.total ?? 0
  const pageSize = result?.pageSize ?? 30
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function resetPageAnd(fn: () => void) {
    fn()
    setPage(1)
  }

  function openCreate(type: 'income' | 'expense') {
    setEditing(null)
    setSheetType(type)
    setSheetOpen(true)
  }

  function openEdit(item: (typeof items)[number]) {
    setEditing({
      id: item.id,
      type: item.type,
      categoryId: item.categoryId,
      accountId: item.accountId,
      amount: item.amount,
      date: item.date,
      branchId: item.branchId,
      note: item.note,
    })
    setSheetType(item.type)
    setSheetOpen(true)
  }

  async function refreshEntries() {
    await queryClient.invalidateQueries({ queryKey: ['cashflow', 'entries'] })
  }

  async function handleDelete() {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await deleteCashflowEntry({ data: { id: deleting.id } })
      toast({ title: 'Catatan dihapus', variant: 'success' })
      setDeleting(null)
      await refreshEntries()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghapus.'
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    } finally {
      setDeleteLoading(false)
    }
  }

  const categoryFilterOptions = useMemo(
    () => [
      { label: 'Semua kategori', value: '' },
      ...categories.map((c) => ({
        label: `${c.name} · ${c.kind === 'income' ? 'Masuk' : 'Keluar'}`,
        value: c.id,
      })),
    ],
    [categories],
  )

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Catatan Kas
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Catat pemasukan dan pengeluaran usaha Anda.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="brand" onClick={() => openCreate('income')}>
            <ArrowDownRight className="h-4 w-4" /> Tambah Pemasukan
          </Button>
          <Button variant="outline" onClick={() => openCreate('expense')}>
            <ArrowUpRight className="h-4 w-4" /> Tambah Pengeluaran
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <TotalCard label="Pemasukan" value={totals.income} tone="income" />
        <TotalCard label="Pengeluaran" value={totals.expense} tone="expense" />
        <TotalCard label="Selisih" value={totals.net} tone="net" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:flex-wrap sm:items-end">
        <DateInput
          label="Dari"
          value={from}
          onChange={(v) => resetPageAnd(() => setFrom(v))}
          className="sm:w-44"
        />
        <DateInput
          label="Sampai"
          value={to}
          onChange={(v) => resetPageAnd(() => setTo(v))}
          className="sm:w-44"
        />
        <Select
          label="Kategori"
          value={categoryId}
          onChange={(e) => resetPageAnd(() => setCategoryId(e.target.value))}
          options={categoryFilterOptions}
          className="sm:w-56"
        />
        {accounts.length > 1 && (
          <Select
            label="Akun"
            value={accountId}
            onChange={(e) => resetPageAnd(() => setAccountId(e.target.value))}
            options={[
              { label: 'Semua akun', value: '' },
              ...accounts.map((a) => ({ label: a.name, value: a.id })),
            ]}
            className="sm:w-44"
          />
        )}
        <div className="flex gap-2">
          {(['all', 'income', 'expense'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => resetPageAnd(() => setTypeFilter(t))}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                typeFilter === t
                  ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
              )}
            >
              {t === 'all' ? 'Semua' : t === 'income' ? 'Masuk' : 'Keluar'}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-400 sm:ml-auto">
          <input
            type="checkbox"
            checked={hidePos}
            onChange={(e) => resetPageAnd(() => setHidePos(e.target.checked))}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600"
          />
          Sembunyikan baris POS
        </label>
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <Wallet className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="font-medium text-gray-900 dark:text-gray-100">
            Belum ada catatan kas
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Tambah pemasukan atau pengeluaran untuk mulai mencatat.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 dark:border-gray-700">
              <tr>
                <th className="p-3 text-left">Tanggal</th>
                <th className="p-3 text-left">Kategori</th>
                <th className="p-3 text-right">Jumlah</th>
                <th className="p-3 text-left">Catatan</th>
                <th className="p-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map((item) => {
                const isIncome = item.type === 'income'
                return (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap p-3 text-gray-600 dark:text-gray-400">
                      {formatDate(item.date, 'dd MMM yyyy')}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                            isIncome
                              ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                          )}
                        >
                          {isIncome ? 'Masuk' : 'Keluar'}
                        </span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {item.categoryName}
                        </span>
                        {accounts.length > 1 && (
                          <span className="text-xs text-gray-400">
                            · {item.accountName}
                          </span>
                        )}
                        {item.branchName && (
                          <span className="text-xs text-gray-400">
                            · {item.branchName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap p-3 text-right font-medium tabular-nums',
                        isIncome
                          ? 'text-success-700 dark:text-success-400'
                          : 'text-red-700 dark:text-red-400',
                      )}
                    >
                      {isIncome ? '+' : '−'}
                      {formatRupiah(item.amount)}
                    </td>
                    <td className="max-w-xs p-3 text-gray-600 dark:text-gray-400">
                      <span className="line-clamp-1">{item.note || '—'}</span>
                    </td>
                    <td className="p-3 text-right">
                      {item.source === 'manual' ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-label="Ubah"
                            onClick={() => openEdit(item)}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Hapus"
                            onClick={() => setDeleting({ id: item.id })}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : item.source === 'pos_sale' && item.sourceRef ? (
                        <Link
                          to="/pos/sales/$saleId"
                          params={{ saleId: item.sourceRef }}
                          className="inline-flex rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-400"
                        >
                          Lihat POS
                        </Link>
                      ) : (
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                          {SOURCE_LABEL[item.source] ?? item.source}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Halaman {page} dari {pageCount} · {total} catatan
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-4">
        <Link
          to="/cashflow/dashboard"
          className="text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          Dashboard →
        </Link>
        <Link
          to="/cashflow/bon"
          className="text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          Bon pelanggan →
        </Link>
        <Link
          to="/cashflow/cicilan"
          className="text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          Cicilan →
        </Link>
        <Link
          to="/cashflow/akun"
          className="text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          Akun kas & bank →
        </Link>
        <Link
          to="/cashflow/kategori"
          className="text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          Kelola kategori →
        </Link>
      </div>

      <CashflowEntrySheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        type={sheetType}
        categories={categories}
        branches={branches}
        accounts={accounts}
        entry={editing}
        onSaved={refreshEntries}
      />

      <ConfirmDialog
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Hapus catatan kas?"
        description="Catatan ini akan dihapus permanen."
        confirmText="Hapus"
        variant="danger"
        loading={deleteLoading}
      />
    </div>
  )
}

function TotalCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'income' | 'expense' | 'net'
}) {
  const color =
    tone === 'income'
      ? 'text-success-700 dark:text-success-400'
      : tone === 'expense'
        ? 'text-red-700 dark:text-red-400'
        : value >= 0
          ? 'text-gray-900 dark:text-gray-100'
          : 'text-red-700 dark:text-red-400'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
        {label}
      </p>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums', color)}>
        {formatRupiah(value)}
      </p>
    </div>
  )
}
