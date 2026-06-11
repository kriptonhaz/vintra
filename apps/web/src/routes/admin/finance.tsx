import { useState, useMemo } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Filter,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  Hash,
  MessageSquare,
} from 'lucide-react'
import {
  listTransactions,
  recordRefund,
  recordWaPayment,
} from '@/server/functions/admin-finance'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Sheet, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import {
  TransactionsTable,
  type TransactionRow,
} from '@/components/admin/finance/transactions-table'
import { TransactionDetailDrawer } from '@/components/admin/finance/transaction-detail-drawer'
import {
  RefundSheet,
  type RefundSheetSubmit,
} from '@/components/admin/finance/refund-sheet'
import { formatRupiah } from '@/lib/currency'
import { waAnnualPrice, WA_ANNUAL_DISCOUNT_PCT } from '@vintra/shared'

export const Route = createFileRoute('/admin/finance')({
  component: FinancePage,
})

function firstOfMonth(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function FinancePage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(todayStr())
  const [moduleKey, setModuleKey] = useState<string>('')
  const [status, setStatus] = useState<'all' | 'paid' | 'refund'>('all')
  const [tenantSearch, setTenantSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25

  const query = useQuery({
    queryKey: [
      'admin',
      'finance',
      'list',
      { from, to, moduleKey, status, tenantSearch, page, pageSize },
    ],
    queryFn: () =>
      listTransactions({
        data: {
          from,
          to,
          moduleKey: moduleKey || undefined,
          status,
          tenantSearch: tenantSearch || undefined,
          page,
          pageSize,
        },
      }),
  })

  const [detailId, setDetailId] = useState<string | null>(null)
  const [refundTarget, setRefundTarget] = useState<{
    id: string
    invoiceNumber: string
    amountIdr: number
    tenantName: string
  } | null>(null)
  const [refundError, setRefundError] = useState<string | null>(null)
  const [showWaPayment, setShowWaPayment] = useState(false)

  const refundMut = useMutation({
    mutationFn: (input: RefundSheetSubmit & { originalTransactionId: string }) =>
      recordRefund({
        data: {
          originalTransactionId: input.originalTransactionId,
          refundReason: input.refundReason,
          transferDate: input.transferDate,
          endSubscriptionNow: input.endSubscriptionNow,
          proofDataUrl: input.proofDataUrl,
        },
      }),
    onSuccess: async () => {
      setRefundTarget(null)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('admin.finance.toastRefundRecorded'),
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'finance'],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan refund'
      setRefundError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    },
  })

  const data = query.data
  const rows: TransactionRow[] = useMemo(
    () =>
      (data?.rows ?? []).map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        moduleKey: r.moduleKey,
        planKey: r.planKey,
        amountIdr: r.amountIdr,
        transferDate: r.transferDate,
        status: r.status,
        billedStaffCount: r.billedStaffCount ?? null,
        billedOutletCount: r.billedOutletCount ?? null,
        recordedByEmail: r.recordedByEmail,
        refundOfTransactionId: r.refundOfTransactionId ?? null,
        createdAt: r.createdAt,
      })),
    [data],
  )

  const summary = data?.summary ?? { paid: 0, refund: 0, net: 0, count: 0 }
  const totalPages = data?.totalPages ?? 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('admin.finance.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('admin.finance.subtitle')}
          </p>
        </div>
        <Button variant="brand" onClick={() => setShowWaPayment(true)}>
          <MessageSquare className="h-4 w-4" /> Catat Pembayaran WA
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label={t('admin.finance.statTotalPaid')}
          value={formatRupiah(summary.paid)}
          icon={<TrendingUp className="h-5 w-5 text-success-600 dark:text-success-400" />}
          tone="green"
        />
        <SummaryCard
          label={t('admin.finance.statTotalRefund')}
          value={formatRupiah(summary.refund)}
          icon={<TrendingDown className="h-5 w-5 text-danger-600 dark:text-danger-400" />}
          tone="danger"
        />
        <SummaryCard
          label={t('admin.finance.statNet')}
          value={formatRupiah(summary.net)}
          icon={<Wallet className="h-5 w-5 text-brand-600 dark:text-brand-400" />}
          tone="brand"
        />
        <SummaryCard
          label={t('admin.finance.statCount')}
          value={summary.count.toString()}
          icon={<Hash className="h-5 w-5 text-gray-500" />}
        />
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <Filter className="h-4 w-4" />
          {t('admin.finance.filterTitle')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('admin.finance.filterFrom')}
            </label>
            <DateInput
              value={from}
              onChange={(v) => {
                setFrom(v)
                setPage(1)
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('admin.finance.filterTo')}
            </label>
            <DateInput
              value={to}
              onChange={(v) => {
                setTo(v)
                setPage(1)
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('admin.finance.filterModule')}
            </label>
            <Select
              value={moduleKey}
              onChange={(e) => {
                setModuleKey(e.target.value)
                setPage(1)
              }}
              options={[
                { value: '', label: t('admin.finance.filterAllModules') },
                { value: 'attendance', label: 'Absensi' },
              ]}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('admin.finance.filterStatus')}
            </label>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as 'all' | 'paid' | 'refund')
                setPage(1)
              }}
              options={[
                { value: 'all', label: t('admin.finance.filterAllStatus') },
                { value: 'paid', label: t('admin.finance.statusPaid') },
                { value: 'refund', label: t('admin.finance.statusRefund') },
              ]}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('admin.finance.filterTenant')}
            </label>
            <Input
              type="search"
              value={tenantSearch}
              onChange={(e) => {
                setTenantSearch(e.target.value)
                setPage(1)
              }}
              placeholder={t('admin.finance.filterTenantPlaceholder')}
            />
          </div>
        </div>
      </div>

      {/* Table + pagination */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {query.isLoading ? (
          <div className="py-12 text-center text-sm text-gray-500">
            {t('common.loading')}
          </div>
        ) : (
          <TransactionsTable
            rows={rows}
            showTenant
            showRecordedBy
            onRowClick={(r) => setDetailId(r.id)}
            onRefund={(r) =>
              setRefundTarget({
                id: r.id,
                invoiceNumber: r.invoiceNumber,
                amountIdr: r.amountIdr,
                tenantName: r.tenantName ?? '',
              })
            }
            renderTenantCell={(r) => (
              <Link
                to="/admin/tenants/$tenantId"
                params={{ tenantId: r.tenantId }}
                className="text-brand-700 hover:underline dark:text-brand-400"
              >
                {r.tenantName ?? '—'}
              </Link>
            )}
          />
        )}

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('admin.finance.paginationHint', {
              page,
              totalPages,
            })}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1 || query.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-xs font-medium text-gray-600 dark:text-gray-400 tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || query.isFetching}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {detailId && (
        <TransactionDetailDrawer
          transactionId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      {refundTarget && (
        <RefundSheet
          originalInvoiceNumber={refundTarget.invoiceNumber}
          originalAmountIdr={refundTarget.amountIdr}
          tenantName={refundTarget.tenantName}
          onClose={() => {
            setRefundTarget(null)
            setRefundError(null)
          }}
          onSubmit={(values) =>
            refundMut.mutate({
              originalTransactionId: refundTarget.id,
              ...values,
            })
          }
          loading={refundMut.isPending}
          error={refundError}
        />
      )}

      {showWaPayment && (
        <WaPaymentSheet
          onClose={() => setShowWaPayment(false)}
          onSaved={async () => {
            setShowWaPayment(false)
            toast({ title: 'Pembayaran WA dicatat', variant: 'success' })
            await queryClient.invalidateQueries({ queryKey: ['admin', 'finance'] })
            await router.invalidate()
          }}
        />
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tone?: 'green' | 'danger' | 'brand'
}) {
  const valueTone =
    tone === 'green'
      ? 'text-success-700 dark:text-success-400'
      : tone === 'danger'
        ? 'text-danger-700 dark:text-danger-400'
        : tone === 'brand'
          ? 'text-brand-700 dark:text-brand-400'
          : 'text-gray-900 dark:text-gray-100'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {label}
        </span>
        {icon}
      </div>
      <p className={`text-xl font-bold ${valueTone}`}>{value}</p>
    </div>
  )
}

// ─── WA Payment Sheet ─────────────────────────────────────────────────────────

// Mirrors the customer-facing /whatsapp/billing.tsx + the
// wa_subscription_plans DB seed. Enterprise / Pro are inactive in DB
// (is_active=false) and intentionally omitted here.
const WA_PLANS = [
  { key: 'basic', label: 'Basic — Rp 49.000/bln', price: 49000 },
  { key: 'komplit', label: 'Komplit — Rp 149.000/bln', price: 149000 },
] as const

// JUR-96: validate a UUID v4-ish string before firing the attribution
// lookup — avoids hammering the server with every keystroke.
function WaPaymentSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [tenantId, setTenantId] = useState('')
  const [planKey, setPlanKey] = useState<'basic' | 'komplit'>('basic')
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [transferDate, setTransferDate] = useState(todayStr())
  const [bankReference, setBankReference] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedPlan = WA_PLANS.find((p) => p.key === planKey)!
  const isAnnual = period === 'annual'
  const durationMonths = isAnnual ? 12 : 1
  const amountIdr = isAnnual
    ? waAnnualPrice(selectedPlan.price)
    : selectedPlan.price

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await recordWaPayment({
        data: {
          tenantId,
          planKey,
          amountIdr,
          durationMonths,
          transferDate,
          bankReference: bankReference || undefined,
        },
      })
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>Catat Pembayaran WhatsApp AI</SheetTitle>
      </SheetHeader>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Tenant ID</label>
            <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="UUID tenant" required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Paket</label>
            <select
              value={planKey}
              onChange={(e) => setPlanKey(e.target.value as typeof planKey)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              {WA_PLANS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Periode Pembayaran</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as typeof period)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="monthly">
                Bulanan — {formatRupiah(selectedPlan.price)}/bln
              </option>
              <option value="annual">
                Tahunan — {formatRupiah(waAnnualPrice(selectedPlan.price))}/thn (hemat {WA_ANNUAL_DISCOUNT_PCT}%)
              </option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Tanggal Transfer</label>
            <DateInput value={transferDate} onChange={setTransferDate} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Referensi Bank (opsional)</label>
            <Input value={bankReference} onChange={(e) => setBankReference(e.target.value)} placeholder="No. referensi transfer" />
          </div>
          <div className="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-700/50">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Total
            </p>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {formatRupiah(amountIdr)}
            </p>
          </div>
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" variant="brand" loading={loading}>Simpan</Button>
        </div>
      </form>
    </Sheet>
  )
}
