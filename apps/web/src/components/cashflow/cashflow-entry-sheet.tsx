import { useEffect, useMemo, useState } from 'react'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CurrencyInput } from '@/components/ui/currency-input'
import { useToast } from '@/components/ui/toast'
import {
  createCashflowEntry,
  updateCashflowEntry,
} from '@/server/functions/cashflow'

export interface CashflowCategoryOption {
  id: string
  name: string
  kind: 'income' | 'expense'
  isSystem: boolean
}

export interface CashflowBranchOption {
  id: string
  name: string
}

export interface CashflowAccountOption {
  id: string
  name: string
}

export interface CashflowEntryDraft {
  id: string
  type: 'income' | 'expense'
  categoryId: string
  accountId: string
  amount: number
  date: string
  branchId: string | null
  note: string | null
}

/** Jakarta-local YYYY-MM-DD for the date input's default. */
function todayJakarta(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function CashflowEntrySheet({
  open,
  onClose,
  type,
  categories,
  branches,
  accounts,
  entry,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  type: 'income' | 'expense'
  categories: CashflowCategoryOption[]
  branches: CashflowBranchOption[]
  accounts: CashflowAccountOption[]
  entry?: CashflowEntryDraft | null
  onSaved: () => void | Promise<void>
}) {
  const { toast } = useToast()
  const isEdit = !!entry

  const categoryOptions = useMemo(
    () => categories.filter((c) => c.kind === type),
    [categories, type],
  )

  const [date, setDate] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [branchId, setBranchId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Re-seed the form each time the sheet opens (create) or targets a
  // different entry (edit). New entries default to the first account
  // (the tenant's default — accounts are ordered default-first).
  useEffect(() => {
    if (!open) return
    setError(null)
    if (entry) {
      setDate(entry.date)
      setCategoryId(entry.categoryId)
      setAccountId(entry.accountId)
      setAmount(String(entry.amount))
      setBranchId(entry.branchId ?? '')
      setNote(entry.note ?? '')
    } else {
      setDate(todayJakarta())
      setCategoryId('')
      setAccountId(accounts[0]?.id ?? '')
      setAmount('')
      setBranchId('')
      setNote('')
    }
  }, [open, entry, accounts])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const numericAmount = Number(amount)
    if (!categoryId) {
      setError('Pilih kategori dulu.')
      return
    }
    if (!numericAmount || numericAmount <= 0) {
      setError('Jumlah harus lebih dari 0.')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        type,
        categoryId,
        accountId: accountId || null,
        amount: numericAmount,
        date,
        branchId: branchId || null,
        note: note.trim() || null,
      }
      if (isEdit && entry) {
        await updateCashflowEntry({ data: { id: entry.id, ...payload } })
      } else {
        await createCashflowEntry({ data: payload })
      }
      toast({
        title: isEdit ? 'Catatan diperbarui' : 'Catatan tersimpan',
        variant: 'success',
      })
      await onSaved()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan catatan.'
      setError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const isIncome = type === 'income'
  const title = isEdit
    ? isIncome
      ? 'Ubah Pemasukan'
      : 'Ubah Pengeluaran'
    : isIncome
      ? 'Tambah Pemasukan'
      : 'Tambah Pengeluaran'

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>
          {isIncome
            ? 'Catat uang masuk ke usaha Anda.'
            : 'Catat uang keluar dari usaha Anda.'}
        </SheetDescription>
      </SheetHeader>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!isIncome && (
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-900/20 dark:text-warning-400">
              Mengeluarkan uang tunai dari laci kasir? Catat lewat{' '}
              <span className="font-semibold">Tarik Tunai</span> di Peti Kas agar
              saldo laci ikut berkurang.
            </p>
          )}
          <DateInput
            label="Tanggal"
            value={date}
            onChange={setDate}
            required
          />
          <Select
            label="Kategori"
            placeholder="Pilih kategori"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={categoryOptions.map((c) => ({
              label: c.name,
              value: c.id,
            }))}
          />
          <CurrencyInput
            label="Jumlah"
            value={amount}
            onChange={setAmount}
            placeholder="Rp 0"
          />
          {accounts.length > 1 && (
            <Select
              label="Akun"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              options={accounts.map((a) => ({ label: a.name, value: a.id }))}
            />
          )}
          {branches.length > 0 && (
            <Select
              label="Cabang (opsional)"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={[
                { label: 'Tanpa cabang', value: '' },
                ...branches.map((b) => ({ label: b.name, value: b.id })),
              ]}
            />
          )}
          <Textarea
            label="Catatan (opsional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="mis. bayar listrik bulan Mei"
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
