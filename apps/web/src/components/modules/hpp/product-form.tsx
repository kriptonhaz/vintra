import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Button } from '@/components/ui/button'
import { useTenantCategories } from '@/hooks/use-master-data'

interface ProductFormData {
  name: string
  sku?: string
  category?: string
  sellingPrice: string
  notes?: string
}

interface ProductFormProps {
  defaultValues?: ProductFormData
  onSubmit: (data: ProductFormData) => void
  onCancel: () => void
  loading?: boolean
}

export function ProductForm({
  defaultValues,
  onSubmit,
  onCancel,
  loading = false,
}: ProductFormProps) {
  const { data: tenantCategories = [] } = useTenantCategories()
  const categoryOptions = tenantCategories.map((c) => ({ value: c.name, label: c.name }))
  const [name, setName] = useState(defaultValues?.name ?? '')
  const [sku, setSku] = useState(defaultValues?.sku ?? '')
  const [category, setCategory] = useState(defaultValues?.category ?? '')
  const [sellingPrice, setSellingPrice] = useState(defaultValues?.sellingPrice ?? '')
  const [notes, setNotes] = useState(defaultValues?.notes ?? '')
  const [errors, setErrors] = useState<Partial<Record<keyof ProductFormData, string>>>({})

  function validate(): boolean {
    const newErrors: Partial<Record<keyof ProductFormData, string>> = {}

    if (!name.trim()) {
      newErrors.name = 'Nama produk wajib diisi'
    }

    if (!sellingPrice || Number(sellingPrice) <= 0) {
      newErrors.sellingPrice = 'Harga jual wajib diisi'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!validate()) return

    onSubmit({
      name: name.trim(),
      sku: sku.trim() || undefined,
      category: category || undefined,
      sellingPrice,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Nama Produk"
        placeholder="Contoh: Kopi Susu Gula Aren"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        required
        disabled={loading}
      />

      <Input
        label="SKU"
        placeholder="Kode produk (opsional)"
        value={sku}
        onChange={(e) => setSku(e.target.value)}
        disabled={loading}
      />

      <Select
        label="Kategori"
        placeholder="Pilih kategori"
        options={categoryOptions}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        disabled={loading}
      />

      <CurrencyInput
        label="Harga Jual"
        value={sellingPrice}
        onChange={setSellingPrice}
        error={errors.sellingPrice}
        placeholder="Rp 0"
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
          {defaultValues ? 'Simpan Perubahan' : 'Tambah Produk'}
        </Button>
      </div>
    </form>
  )
}

export { type ProductFormProps, type ProductFormData }
