import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Lock,
  Plus,
  ChevronDown,
  CalendarClock,
  BellOff,
  Bell,
} from 'lucide-react'
import { getCashflowOverview } from '@/server/functions/cashflow'
import {
  listPayables,
  listCicilanSuppliers,
  createPayable,
  markInstallmentPaid,
  togglePayableReminders,
} from '@/server/functions/cashflow-ap'
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

export const Route = createFileRoute('/_authed/cashflow/cicilan')({
  loader: async () => {
    const overview = await getCashflowOverview()
    if (!overview.hasAccess) return { locked: true as const }
    const [list, suppliers] = await Promise.all([
      listPayables(),
      listCicilanSuppliers(),
    ])
    return { locked: false as const, list, suppliers }
  },
  component: CicilanPage,
})

type PayablesResult = Awaited<ReturnType<typeof listPayables>>
type Payable = PayablesResult['items'][number]
type Installment = Payable['lines'][number]
type SupplierOption = Awaited<ReturnType<typeof listCicilanSuppliers>>[number]

function CicilanPage() {
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
            Cicilan
          </h2>
          <p className="mt-1 text-sm text-accent-800 dark:text-accent-300">
            Fitur ini termasuk dalam paket Komplit.
          </p>
        </div>
      </div>
    )
  }
  return <CicilanContent list={data.list} suppliers={data.suppliers} />
}

function CicilanContent({
  list,
  suppliers,
}: {
  list: PayablesResult
  suppliers: SupplierOption[]
}) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['cashflow', 'ap'],
    queryFn: () => listPayables(),
    initialData: list,
  })
  const { items, summary } = query.data

  const [tambahOpen, setTambahOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [payTarget, setPayTarget] = useState<Installment | null>(null)

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['cashflow', 'ap'] })
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
            Cicilan
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Kelola cicilan dan tagihan berjadwal usaha Anda.
          </p>
        </div>
        <Button variant="brand" onClick={() => setTambahOpen(true)}>
          <Plus className="h-4 w-4" /> Tambah Cicilan
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total belum lunas" value={summary.totalOutstanding} />
        <SummaryCard label="Jatuh tempo bulan ini" value={summary.dueThisMonth} />
        <SummaryCard label="Jatuh tempo 30 hari" value={summary.dueNext30d} />
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <CalendarClock className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="font-medium text-gray-900 dark:text-gray-100">
            Belum ada cicilan
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Tambah cicilan untuk melacak tagihan berjadwal.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <PayableCard
              key={p.id}
              payable={p}
              expanded={expandedId === p.id}
              onToggle={() =>
                setExpandedId((id) => (id === p.id ? null : p.id))
              }
              onPay={(line) => setPayTarget(line)}
              onMuteChanged={refresh}
            />
          ))}
        </div>
      )}

      <TambahCicilanSheet
        open={tambahOpen}
        onClose={() => setTambahOpen(false)}
        suppliers={suppliers}
        onCreated={async () => {
          setTambahOpen(false)
          await refresh()
        }}
      />

      <MarkPaidDialog
        installment={payTarget}
        onClose={() => setPayTarget(null)}
        onDone={async () => {
          setPayTarget(null)
          await refresh()
        }}
      />
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {formatRupiah(value)}
      </p>
    </div>
  )
}

function PayableCard({
  payable: p,
  expanded,
  onToggle,
  onPay,
  onMuteChanged,
}: {
  payable: Payable
  expanded: boolean
  onToggle: () => void
  onPay: (line: Installment) => void
  onMuteChanged: () => void | Promise<void>
}) {
  const { toast } = useToast()
  const [muteBusy, setMuteBusy] = useState(false)

  async function toggleMute() {
    setMuteBusy(true)
    try {
      await togglePayableReminders({
        data: { payableId: p.id, muted: !p.remindersMuted },
      })
      await onMuteChanged()
    } catch (err) {
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Gagal',
        variant: 'error',
      })
    } finally {
      setMuteBusy(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-gray-400 transition-transform',
              expanded && 'rotate-180',
            )}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                {p.name}
              </span>
              {p.hasOverdue && (
                <span className="inline-flex shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  Telat
                </span>
              )}
            </span>
            <span className="block text-xs text-gray-500">
              {p.supplierName ? `${p.supplierName} · ` : ''}
              {p.paidCount}/{p.installmentCount} cicilan lunas
              {p.nextDue
                ? ` · jatuh tempo ${formatDate(p.nextDue, 'dd MMM yyyy')}`
                : ' · selesai'}
            </span>
          </span>
        </button>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {formatRupiah(p.outstanding)}
          </p>
          <p className="text-xs text-gray-500">belum lunas</p>
        </div>
        <button
          type="button"
          onClick={toggleMute}
          disabled={muteBusy}
          aria-label={p.remindersMuted ? 'Aktifkan pengingat' : 'Bisukan pengingat'}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
        >
          {p.remindersMuted ? (
            <BellOff className="h-4 w-4" />
          ) : (
            <Bell className="h-4 w-4" />
          )}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          {p.note && (
            <p className="px-4 pt-3 text-xs text-gray-500">Catatan: {p.note}</p>
          )}
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {p.lines.map((l) => (
                <tr key={l.id}>
                  <td className="p-3 text-gray-500">#{l.installmentIndex}</td>
                  <td className="p-3 tabular-nums text-gray-900 dark:text-gray-100">
                    {formatRupiah(l.amount)}
                  </td>
                  <td className="p-3 text-gray-600 dark:text-gray-400">
                    {formatDate(l.dueDate, 'dd MMM yyyy')}
                  </td>
                  <td className="p-3">
                    {l.paid ? (
                      <span className="inline-flex rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
                        Lunas
                      </span>
                    ) : l.overdue ? (
                      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        Telat
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        Belum
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {!l.paid && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onPay(l)}
                      >
                        Tandai Lunas
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TambahCicilanSheet({
  open,
  onClose,
  suppliers,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  suppliers: SupplierOption[]
  onCreated: () => void | Promise<void>
}) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [scheduleKind, setScheduleKind] = useState<'one_off' | 'monthly'>(
    'monthly',
  )
  const [totalAmount, setTotalAmount] = useState('')
  const [installmentCount, setInstallmentCount] = useState('3')
  const [firstDueDate, setFirstDueDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Nama cicilan wajib diisi.')
      return
    }
    if (!Number(totalAmount)) {
      setError('Jumlah harus lebih dari 0.')
      return
    }
    if (!firstDueDate) {
      setError('Tanggal jatuh tempo wajib diisi.')
      return
    }
    setSubmitting(true)
    try {
      await createPayable({
        data: {
          name: name.trim(),
          supplierId: supplierId || null,
          scheduleKind,
          totalAmount: Number(totalAmount),
          installmentCount:
            scheduleKind === 'one_off' ? 1 : Number(installmentCount) || 1,
          firstDueDate,
          note: note.trim() || null,
        },
      })
      toast({ title: 'Cicilan tersimpan', variant: 'success' })
      setName('')
      setSupplierId('')
      setScheduleKind('monthly')
      setTotalAmount('')
      setInstallmentCount('3')
      setFirstDueDate('')
      setNote('')
      await onCreated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan.'
      setError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>Tambah Cicilan</SheetTitle>
        <SheetDescription>
          Catat cicilan atau tagihan berjadwal.
        </SheetDescription>
      </SheetHeader>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Input
            label="Nama cicilan"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mis. Cicilan motor, Tabung gas vendor"
            autoFocus
          />
          {suppliers.length > 0 && (
            <Select
              label="Supplier (opsional)"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              options={[
                { label: 'Tanpa supplier', value: '' },
                ...suppliers.map((s) => ({ label: s.name, value: s.id })),
              ]}
            />
          )}
          <Select
            label="Jenis"
            value={scheduleKind}
            onChange={(e) =>
              setScheduleKind(e.target.value as 'one_off' | 'monthly')
            }
            options={[
              { label: 'Bulanan (beberapa cicilan)', value: 'monthly' },
              { label: 'Sekali bayar', value: 'one_off' },
            ]}
          />
          <CurrencyInput
            label="Total tagihan"
            value={totalAmount}
            onChange={setTotalAmount}
          />
          {scheduleKind === 'monthly' && (
            <Input
              type="number"
              min={2}
              max={120}
              label="Jumlah cicilan"
              value={installmentCount}
              onChange={(e) => setInstallmentCount(e.target.value)}
            />
          )}
          <DateInput
            label={
              scheduleKind === 'monthly'
                ? 'Jatuh tempo cicilan pertama'
                : 'Tanggal jatuh tempo'
            }
            value={firstDueDate}
            onChange={setFirstDueDate}
          />
          <Textarea
            label="Catatan (opsional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="brand" loading={submitting}>
            Simpan
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function MarkPaidDialog({
  installment,
  onClose,
  onDone,
}: {
  installment: Installment | null
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { toast } = useToast()
  const [method, setMethod] = useState<'cash' | 'transfer' | 'qris' | 'other'>(
    'cash',
  )
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!installment) return
    setSubmitting(true)
    try {
      await markInstallmentPaid({
        data: {
          paymentId: installment.id,
          method,
          note: note.trim() || null,
        },
      })
      toast({ title: 'Cicilan ditandai lunas', variant: 'success' })
      setMethod('cash')
      setNote('')
      await onDone()
    } catch (err) {
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Gagal',
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!installment} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Tandai Lunas</DialogTitle>
        <DialogDescription>
          {installment
            ? `Cicilan #${installment.installmentIndex} — ${formatRupiah(installment.amount)}. Akan tercatat sebagai pengeluaran di buku kas.`
            : ''}
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <Select
            label="Metode pembayaran"
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
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Batal
        </Button>
        <Button variant="brand" onClick={handleSubmit} loading={submitting}>
          Tandai Lunas
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
