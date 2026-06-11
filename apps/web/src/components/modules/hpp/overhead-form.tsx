import { useState } from 'react'
import { OVERHEAD_PERIODS, ALLOCATION_TYPES } from '@vintra/shared'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Button } from '@/components/ui/button'

interface OverheadFormData {
  name: string
  amount: string
  period: string
  allocationType: string
  notes?: string
}

interface OverheadFormProps {
  defaultValues?: OverheadFormData
  onSubmit: (data: OverheadFormData) => void
  onCancel: () => void
  loading?: boolean
}

const periodOptions = OVERHEAD_PERIODS.map((p) => ({
  value: p.value,
  label: p.label,
}))

const allocationOptions = ALLOCATION_TYPES.map((a) => ({
  value: a.value,
  label: a.label,
}))

export function OverheadForm({
  defaultValues,
  onSubmit,
  onCancel,
  loading = false,
}: OverheadFormProps) {
  const [name, setName] = useState(defaultValues?.name ?? '')
  const [amount, setAmount] = useState(defaultValues?.amount ?? '')
  const [period, setPeriod] = useState(defaultValues?.period ?? 'monthly')
  const [allocationType, setAllocationType] = useState(
    defaultValues?.allocationType ?? 'per_product',
  )
  const [notes, setNotes] = useState(defaultValues?.notes ?? '')
  const [errors, setErrors] = useState<Partial<Record<keyof OverheadFormData, string>>>({})

  function validate(): boolean {
    const newErrors: Partial<Record<keyof OverheadFormData, string>> = {}

    if (!name.trim()) {
      newErrors.name = 'Nama biaya wajib diisi'
    }

    if (!amount || Number(amount) <= 0) {
      newErrors.amount = 'Jumlah biaya wajib diisi'
    }

    if (!period) {
      newErrors.period = 'Periode wajib dipilih'
    }

    if (!allocationType) {
      newErrors.allocationType = 'Tipe alokasi wajib dipilih'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!validate()) return

    onSubmit({
      name: name.trim(),
      amount,
      period,
      allocationType,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Nama Biaya"
        placeholder="Contoh: Sewa tempat, Listrik, Gas"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        required
        disabled={loading}
      />

      <CurrencyInput
        label="Jumlah Biaya"
        value={amount}
        onChange={setAmount}
        error={errors.amount}
        placeholder="Rp 0"
        disabled={loading}
      />

      <Select
        label="Periode"
        placeholder="Pilih periode"
        options={periodOptions}
        value={period}
        onChange={(e) => setPeriod(e.target.value)}
        error={errors.period}
        required
        disabled={loading}
      />

      <Select
        label="Tipe Alokasi"
        placeholder="Pilih tipe alokasi"
        options={allocationOptions}
        value={allocationType}
        onChange={(e) => setAllocationType(e.target.value)}
        error={errors.allocationType}
        required
        disabled={loading}
      />

      <Textarea
        label="Catatan"
        placeholder="Catatan tambahan (opsional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={loading}
      />

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={loading}
        >
          Batal
        </Button>
        <Button type="submit" loading={loading}>
          {defaultValues ? 'Simpan Perubahan' : 'Tambah Biaya Overhead'}
        </Button>
      </div>
    </form>
  )
}

export { type OverheadFormProps, type OverheadFormData }
