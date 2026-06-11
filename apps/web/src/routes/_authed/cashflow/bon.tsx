import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Lock, Plus, ChevronDown, HandCoins } from 'lucide-react'
import { getCashflowOverview } from '@/server/functions/cashflow'
import {
  listReceivables,
  listArCustomerOptions,
  getReceivablePayments,
  createReceivable,
  recordArPayment,
} from '@/server/functions/cashflow-ar'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CurrencyInput } from '@/components/ui/currency-input'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'
import { cn, formatDate } from '@/lib/utils'

export const Route = createFileRoute('/_authed/cashflow/bon')({
  loader: async () => {
    const overview = await getCashflowOverview()
    if (!overview.hasAccess) return { locked: true as const }
    const [list, customers] = await Promise.all([
      listReceivables(),
      listArCustomerOptions(),
    ])
    return { locked: false as const, list, customers }
  },
  component: BonPage,
})

type Bucket = 'lancar' | 't30' | 't60' | 't90'
type Receivable = Awaited<ReturnType<typeof listReceivables>>['items'][number]
type CustomerOption = Awaited<ReturnType<typeof listArCustomerOptions>>[number]

const BUCKET_LABEL: Record<Bucket, string> = {
  lancar: 'Lancar (≤30 hari)',
  t30: 'Telat 30 hari',
  t60: 'Telat 60 hari',
  t90: 'Telat 90+ hari',
}
const STATUS_LABEL: Record<string, string> = {
  outstanding: 'Belum dibayar',
  partial: 'Sebagian',
  paid: 'Lunas',
  written_off: 'Dihapus',
}
const METHOD_LABEL: Record<string, string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
  other: 'Lainnya',
}

function BonPage() {
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
            Bon Pelanggan
          </h2>
          <p className="mt-1 text-sm text-accent-800 dark:text-accent-300">
            Fitur ini termasuk dalam paket Komplit.
          </p>
        </div>
      </div>
    )
  }
  return <BonContent list={data.list} customers={data.customers} />
}

function BonContent({
  list,
  customers,
}: {
  list: Awaited<ReturnType<typeof listReceivables>>
  customers: CustomerOption[]
}) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['cashflow', 'ar'],
    queryFn: () => listReceivables(),
    initialData: list,
  })
  const result = query.data
  const summary = result.summary
  const items = result.items

  const [bucketFilter, setBucketFilter] = useState<Bucket | null>(null)
  const [showSettled, setShowSettled] = useState(false)
  const [tambahOpen, setTambahOpen] = useState(false)
  const [payTarget, setPayTarget] = useState<Receivable | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const visible = useMemo(() => {
    return items.filter((r) => {
      const settled = r.status === 'paid' || r.status === 'written_off'
      if (settled && !showSettled) return false
      if (bucketFilter && r.bucket !== bucketFilter) return false
      return true
    })
  }, [items, bucketFilter, showSettled])

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['cashflow', 'ar'] })
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
            Bon Pelanggan
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Lacak utang pelanggan — total belum tertagih{' '}
            <strong>{formatRupiah(result.totalOutstanding)}</strong>.
          </p>
        </div>
        <Button variant="brand" onClick={() => setTambahOpen(true)}>
          <Plus className="h-4 w-4" /> Tambah Bon
        </Button>
      </div>

      {/* Aging buckets */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(['lancar', 't30', 't60', 't90'] as const).map((b) => {
          const active = bucketFilter === b
          return (
            <button
              key={b}
              type="button"
              onClick={() => setBucketFilter(active ? null : b)}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                active
                  ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/30'
                  : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800',
                b === 't90' && !active && 'border-red-200 dark:border-red-900/40',
              )}
            >
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {BUCKET_LABEL[b]}
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {formatRupiah(summary[b].total)}
              </p>
              <p className="text-xs text-gray-500">{summary[b].count} bon</p>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between">
        {bucketFilter ? (
          <button
            type="button"
            onClick={() => setBucketFilter(null)}
            className="text-sm text-brand-600 hover:underline dark:text-brand-400"
          >
            Hapus filter: {BUCKET_LABEL[bucketFilter]}
          </button>
        ) : (
          <span />
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={showSettled}
            onChange={(e) => setShowSettled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600"
          />
          Tampilkan yang lunas
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <HandCoins className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="font-medium text-gray-900 dark:text-gray-100">
            Belum ada bon
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Catat bon pelanggan untuk melacak utang yang belum tertagih.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 dark:border-gray-700">
              <tr>
                <th className="p-3 text-left">Pelanggan</th>
                <th className="p-3 text-right">Jumlah</th>
                <th className="p-3 text-right">Sisa</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {visible.map((r) => (
                <BonRow
                  key={r.id}
                  receivable={r}
                  expanded={expandedId === r.id}
                  onToggle={() =>
                    setExpandedId((id) => (id === r.id ? null : r.id))
                  }
                  onPay={() => setPayTarget(r)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TambahBonSheet
        open={tambahOpen}
        onClose={() => setTambahOpen(false)}
        customers={customers}
        onCreated={async () => {
          setTambahOpen(false)
          await refresh()
        }}
      />

      <PaymentDialog
        receivable={payTarget}
        onClose={() => setPayTarget(null)}
        onRecorded={async () => {
          setPayTarget(null)
          await refresh()
        }}
      />
    </div>
  )
}

function BonRow({
  receivable: r,
  expanded,
  onToggle,
  onPay,
}: {
  receivable: Receivable
  expanded: boolean
  onToggle: () => void
  onPay: () => void
}) {
  const settled = r.status === 'paid' || r.status === 'written_off'
  const payments = useQuery({
    queryKey: ['cashflow', 'ar', 'payments', r.id],
    queryFn: () => getReceivablePayments({ data: { receivableId: r.id } }),
    enabled: expanded,
  })

  return (
    <>
      <tr>
        <td className="p-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1.5 text-left"
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 text-gray-400 transition-transform',
                expanded && 'rotate-180',
              )}
            />
            <span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {r.customerName}
              </span>
              <span className="block text-xs text-gray-500">
                {r.dueDate
                  ? `Jatuh tempo ${formatDate(r.dueDate, 'dd MMM yyyy')}`
                  : `Dibuat ${formatDate(r.createdAt, 'dd MMM yyyy')}`}
                {!settled && ` · ${r.ageDays} hari`}
              </span>
            </span>
          </button>
        </td>
        <td className="p-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
          {formatRupiah(r.amount)}
        </td>
        <td className="p-3 text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">
          {formatRupiah(r.outstanding)}
        </td>
        <td className="p-3">
          <span
            className={cn(
              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
              r.status === 'paid'
                ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                : r.status === 'partial'
                  ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400'
                  : r.status === 'written_off'
                    ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
            )}
          >
            {STATUS_LABEL[r.status] ?? r.status}
          </span>
        </td>
        <td className="p-3 text-right">
          {!settled && (
            <Button variant="outline" size="sm" onClick={onPay}>
              Catat Pembayaran
            </Button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-gray-900/40">
          <td colSpan={5} className="p-4">
            {r.note && (
              <p className="mb-2 text-xs text-gray-500">Catatan: {r.note}</p>
            )}
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
              Riwayat pembayaran
            </p>
            {payments.isLoading ? (
              <p className="text-sm text-gray-400">Memuat…</p>
            ) : !payments.data || payments.data.length === 0 ? (
              <p className="text-sm text-gray-400">Belum ada pembayaran.</p>
            ) : (
              <ul className="space-y-1">
                {payments.data.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-600 dark:text-gray-400">
                      {formatDate(p.paidAt, 'dd MMM yyyy, HH:mm')} ·{' '}
                      {METHOD_LABEL[p.method] ?? p.method}
                      {p.note ? ` · ${p.note}` : ''}
                    </span>
                    <span className="font-medium tabular-nums text-success-700 dark:text-success-400">
                      {formatRupiah(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function TambahBonSheet({
  open,
  onClose,
  customers,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  customers: CustomerOption[]
  onCreated: () => void | Promise<void>
}) {
  const { toast } = useToast()
  const [customerId, setCustomerId] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!customerId) {
      setError('Pilih pelanggan dulu.')
      return
    }
    if (!Number(amount)) {
      setError('Jumlah harus lebih dari 0.')
      return
    }
    setSubmitting(true)
    try {
      await createReceivable({
        data: {
          customerId,
          amount: Number(amount),
          dueDate: dueDate || null,
          note: note.trim() || null,
        },
      })
      toast({ title: 'Bon tersimpan', variant: 'success' })
      setCustomerId('')
      setAmount('')
      setDueDate('')
      setNote('')
      await onCreated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan bon.'
      setError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>Tambah Bon</SheetTitle>
        <SheetDescription>
          Catat utang pelanggan yang dibeli secara kredit.
        </SheetDescription>
      </SheetHeader>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {customers.length === 0 ? (
            <p className="rounded-lg bg-warning-50 p-3 text-sm text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
              Belum ada pelanggan. Tambah pelanggan dulu di menu Pelanggan.
            </p>
          ) : (
            <Select
              label="Pelanggan"
              placeholder="Pilih pelanggan"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              options={customers.map((c) => ({
                label: c.phone ? `${c.name} · ${c.phone}` : c.name,
                value: c.id,
              }))}
            />
          )}
          <CurrencyInput label="Jumlah bon" value={amount} onChange={setAmount} />
          <DateInput
            label="Jatuh tempo (opsional)"
            value={dueDate}
            onChange={setDueDate}
          />
          <Textarea
            label="Catatan (opsional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="submit"
            variant="brand"
            loading={submitting}
            disabled={customers.length === 0}
          >
            Simpan
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function PaymentDialog({
  receivable,
  onClose,
  onRecorded,
}: {
  receivable: Receivable | null
  onClose: () => void
  onRecorded: () => void | Promise<void>
}) {
  const { toast } = useToast()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'transfer' | 'qris' | 'other'>(
    'cash',
  )
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!receivable) return
    setError(null)
    const value = Number(amount)
    if (!value || value <= 0) {
      setError('Jumlah harus lebih dari 0.')
      return
    }
    setSubmitting(true)
    try {
      await recordArPayment({
        data: {
          receivableId: receivable.id,
          amount: value,
          method,
          note: note.trim() || null,
        },
      })
      toast({ title: 'Pembayaran tercatat', variant: 'success' })
      setAmount('')
      setMethod('cash')
      setNote('')
      await onRecorded()
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal mencatat pembayaran.'
      setError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!receivable} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Catat Pembayaran</DialogTitle>
        <DialogDescription>
          {receivable
            ? `${receivable.customerName} — sisa ${formatRupiah(receivable.outstanding)}`
            : ''}
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <CurrencyInput
            label="Jumlah pembayaran"
            value={amount}
            onChange={setAmount}
          />
          <Select
            label="Metode"
            value={method}
            onChange={(e) =>
              setMethod(e.target.value as 'cash' | 'transfer' | 'qris' | 'other')
            }
            options={[
              { label: 'Tunai', value: 'cash' },
              { label: 'Transfer', value: 'transfer' },
              { label: 'QRIS', value: 'qris' },
              { label: 'Lainnya', value: 'other' },
            ]}
          />
          <Input
            label="Catatan (opsional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button
          variant="ghost"
          onClick={onClose}
          disabled={submitting}
        >
          Batal
        </Button>
        <Button variant="brand" onClick={handleSubmit} loading={submitting}>
          Simpan Pembayaran
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
