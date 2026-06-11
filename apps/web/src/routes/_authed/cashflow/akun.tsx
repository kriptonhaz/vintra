import { useEffect, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Lock, Plus, Pencil, Trash2, ArrowLeftRight, Wallet } from 'lucide-react'
import { getCashflowOverview } from '@/server/functions/cashflow'
import {
  listCashflowAccounts,
  listCashflowTransfers,
  createCashflowAccount,
  updateCashflowAccount,
  deleteCashflowAccount,
  createCashflowTransfer,
} from '@/server/functions/cashflow-accounts'
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'
import { cn, formatDate } from '@/lib/utils'

export const Route = createFileRoute('/_authed/cashflow/akun')({
  loader: async () => {
    const overview = await getCashflowOverview()
    if (!overview.hasAccess) return { locked: true as const }
    const [accounts, transfers] = await Promise.all([
      listCashflowAccounts(),
      listCashflowTransfers(),
    ])
    return { locked: false as const, accounts, transfers }
  },
  component: AkunPage,
})

type Account = Awaited<ReturnType<typeof listCashflowAccounts>>[number]
type Kind = 'cash' | 'bank' | 'ewallet' | 'other'

const KIND_LABEL: Record<Kind, string> = {
  cash: 'Kas / Tunai',
  bank: 'Bank',
  ewallet: 'E-Wallet',
  other: 'Lainnya',
}

function todayJakarta(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function AkunPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState<Account | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (data.locked) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-accent-200 bg-accent-50 p-8 text-center dark:border-accent-900/40 dark:bg-accent-900/20">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
            <Lock className="h-6 w-6 text-accent-700 dark:text-accent-400" />
          </div>
          <h2 className="text-lg font-semibold text-accent-900 dark:text-accent-200">
            Akun Kas & Bank
          </h2>
          <p className="mt-1 text-sm text-accent-800 dark:text-accent-300">
            Fitur ini termasuk dalam paket Komplit.
          </p>
        </div>
      </div>
    )
  }

  const { accounts, transfers } = data

  async function handleDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteCashflowAccount({ data: { id: deleting.id } })
      toast({ title: 'Akun dihapus', variant: 'success' })
      setDeleting(null)
      await router.invalidate()
    } catch (err) {
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Gagal menghapus.',
        variant: 'error',
      })
    } finally {
      setBusy(false)
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
            Akun Kas & Bank
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Pisahkan uang usaha per akun — kas, bank, e-wallet.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {accounts.length > 1 && (
            <Button variant="outline" onClick={() => setTransferOpen(true)}>
              <ArrowLeftRight className="h-4 w-4" /> Pindah Dana
            </Button>
          )}
          <Button variant="brand" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Tambah Akun
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => (
          <div
            key={a.id}
            className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-brand-600" />
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {a.name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Ubah"
                  onClick={() => setEditing(a)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {!a.isDefault && (
                  <button
                    type="button"
                    aria-label="Hapus"
                    onClick={() => setDeleting(a)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              {KIND_LABEL[a.kind]}
              {a.isDefault && ' · Akun utama'}
              {!a.isActive && ' · Nonaktif'}
            </p>
            <p
              className={cn(
                'mt-1 text-xl font-bold tabular-nums',
                a.balance >= 0
                  ? 'text-gray-900 dark:text-gray-100'
                  : 'text-red-700 dark:text-red-400',
              )}
            >
              {formatRupiah(a.balance)}
            </p>
          </div>
        ))}
      </div>

      {/* Recent transfers */}
      {transfers.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-200 px-5 py-3 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Pemindahan Dana Terakhir
            </h2>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {transfers.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 px-5 py-3 text-sm"
              >
                <ArrowLeftRight className="h-4 w-4 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-gray-900 dark:text-gray-100">
                    {t.fromName} → {t.toName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDate(t.date, 'dd MMM yyyy')}
                    {t.note ? ` · ${t.note}` : ''}
                  </p>
                </div>
                <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">
                  {formatRupiah(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)}>
        <SheetHeader onClose={() => setCreateOpen(false)}>
          <SheetTitle>Tambah Akun</SheetTitle>
          <SheetDescription>
            Buat akun baru untuk memisahkan uang usaha.
          </SheetDescription>
        </SheetHeader>
        <AccountForm
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={() => router.invalidate()}
        />
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)}>
        <SheetHeader onClose={() => setEditing(null)}>
          <SheetTitle>Ubah Akun</SheetTitle>
          <SheetDescription>Perbarui detail akun.</SheetDescription>
        </SheetHeader>
        <AccountForm
          mode="edit"
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => router.invalidate()}
        />
      </Sheet>

      <TransferDialog
        open={transferOpen}
        accounts={accounts}
        onClose={() => setTransferOpen(false)}
        onDone={() => router.invalidate()}
      />

      <ConfirmDialog
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Hapus akun?"
        description={`Akun "${deleting?.name ?? ''}" akan dihapus.`}
        confirmText="Hapus"
        variant="danger"
        loading={busy}
      />
    </div>
  )
}

function AccountForm({
  mode,
  account,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  account?: Account | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('cash')
  const [openingBalance, setOpeningBalance] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (account) {
      setName(account.name)
      setKind(account.kind)
      setOpeningBalance(String(account.openingBalance))
      setIsActive(account.isActive)
    } else {
      setName('')
      setKind('cash')
      setOpeningBalance('')
      setIsActive(true)
    }
    setError(null)
  }, [account])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Nama akun wajib diisi.')
      return
    }
    setSubmitting(true)
    try {
      if (mode === 'edit' && account) {
        await updateCashflowAccount({
          data: {
            id: account.id,
            name: name.trim(),
            kind,
            openingBalance: Number(openingBalance) || 0,
            isActive,
          },
        })
      } else {
        await createCashflowAccount({
          data: {
            name: name.trim(),
            kind,
            openingBalance: Number(openingBalance) || 0,
          },
        })
      }
      toast({ title: 'Akun tersimpan', variant: 'success' })
      await onSaved()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan akun.'
      setError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <Input
          label="Nama akun"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="mis. BCA, Mandiri, GoPay, Laci Kasir"
          autoFocus
        />
        <Select
          label="Jenis"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          options={[
            { label: 'Kas / Tunai', value: 'cash' },
            { label: 'Bank', value: 'bank' },
            { label: 'E-Wallet', value: 'ewallet' },
            { label: 'Lainnya', value: 'other' },
          ]}
        />
        <CurrencyInput
          label="Saldo awal"
          value={openingBalance}
          onChange={setOpeningBalance}
          placeholder="Rp 0"
        />
        {mode === 'edit' && account && !account.isDefault && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600"
            />
            Akun aktif
          </label>
        )}
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
  )
}

function TransferDialog({
  open,
  accounts,
  onClose,
  onDone,
}: {
  open: boolean
  accounts: Account[]
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { toast } = useToast()
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setFromId(accounts[0]?.id ?? '')
      setToId(accounts[1]?.id ?? '')
      setAmount('')
      setDate(todayJakarta())
      setNote('')
      setError(null)
    }
  }, [open, accounts])

  async function handleSubmit() {
    setError(null)
    if (!fromId || !toId || fromId === toId) {
      setError('Pilih akun asal dan tujuan yang berbeda.')
      return
    }
    if (!Number(amount)) {
      setError('Jumlah harus lebih dari 0.')
      return
    }
    setSubmitting(true)
    try {
      await createCashflowTransfer({
        data: {
          fromAccountId: fromId,
          toAccountId: toId,
          amount: Number(amount),
          date,
          note: note.trim() || null,
        },
      })
      toast({ title: 'Dana dipindahkan', variant: 'success' })
      await onDone()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memindahkan dana.'
      setError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const accountOptions = accounts.map((a) => ({ label: a.name, value: a.id }))

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Pindah Dana</DialogTitle>
        <DialogDescription>
          Pindahkan uang antar akun. Ini bukan pemasukan atau pengeluaran —
          laba bersih tidak berubah.
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <Select
            label="Dari akun"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            options={accountOptions}
          />
          <Select
            label="Ke akun"
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            options={accountOptions}
          />
          <CurrencyInput
            label="Jumlah"
            value={amount}
            onChange={setAmount}
          />
          <DateInput
            label="Tanggal"
            value={date}
            onChange={setDate}
          />
          <Textarea
            label="Catatan (opsional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Batal
        </Button>
        <Button variant="brand" onClick={handleSubmit} loading={submitting}>
          Pindahkan
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
