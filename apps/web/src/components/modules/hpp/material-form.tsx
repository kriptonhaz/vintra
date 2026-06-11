import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { UNITS } from '@vintra/shared'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Button } from '@/components/ui/button'
import { SupplierCombobox, type SupplierOption } from '@/components/ui/supplier-combobox'
import { formatRupiahDecimal } from '@/lib/currency'

// Form-specific schema — purchasePrice is raw digit string from CurrencyInput
const materialFormSchema = z.object({
  name: z.string().min(1, 'Nama bahan wajib diisi'),
  brand: z.string().optional(),
  unit: z.string().min(1, 'Satuan wajib dipilih'),
  purchasePrice: z.string().min(1, 'Harga beli wajib diisi').refine(
    (v) => Number(v) > 0,
    'Harga beli harus lebih dari 0',
  ),
  purchaseQty: z.string().min(1, 'Isi per kemasan wajib diisi').refine(
    (v) => Number(v) > 0,
    'Jumlah harus lebih dari 0',
  ),
  supplierId: z.string().optional(),
  supplierName: z.string().optional(),
  supplierAddress: z.string().optional(),
  supplierPhone: z.string().optional(),
  supplierPic: z.string().optional(),
  supplierNotes: z.string().optional(),
  notes: z.string().optional(),
})

type MaterialFormValues = z.infer<typeof materialFormSchema>

interface MaterialFormData {
  name: string
  brand?: string
  unit: string
  purchasePrice: string
  purchaseQty: string
  supplierId?: string
  supplierName?: string
  supplierAddress?: string
  supplierPhone?: string
  supplierPic?: string
  supplierNotes?: string
  notes?: string
}

interface Supplier {
  id: string
  name: string
}

interface MaterialFormProps {
  defaultValues?: MaterialFormData
  onSubmit: (data: MaterialFormData) => void
  onCancel: () => void
  loading?: boolean
  suppliers: Supplier[]
  /** When set, supplier is fixed and the combobox is hidden */
  fixedSupplierId?: string | null
}

const unitOptions = UNITS.map((u) => ({ value: u.value, label: u.label }))

export function MaterialForm({
  defaultValues,
  onSubmit,
  onCancel,
  loading = false,
  suppliers,
  fixedSupplierId,
}: MaterialFormProps) {
  const { t } = useTranslation()
  const hasFixedSupplier = typeof fixedSupplierId === 'string'
  const [isNewSupplier, setIsNewSupplier] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
  } = useForm<MaterialFormValues>({
    resolver: zodResolver(materialFormSchema),
    defaultValues: {
      name: defaultValues?.name ?? '',
      brand: defaultValues?.brand ?? '',
      unit: defaultValues?.unit ?? '',
      purchasePrice: defaultValues?.purchasePrice ?? '',
      purchaseQty: defaultValues?.purchaseQty ?? '1',
      supplierId: hasFixedSupplier ? (fixedSupplierId ?? '') : (defaultValues?.supplierId ?? ''),
      supplierName: defaultValues?.supplierName ?? '',
      supplierAddress: '',
      supplierPhone: '',
      supplierPic: '',
      supplierNotes: '',
      notes: defaultValues?.notes ?? '',
    },
  })

  const supplierName = watch('supplierName')
  const showNewSupplierFields = isNewSupplier && (supplierName?.trim()?.length ?? 0) > 0

  // Watch purchase fields for auto-calc display
  const purchasePrice = watch('purchasePrice')
  const purchaseQty = watch('purchaseQty')

  const pricePerUnit = useMemo(() => {
    const pp = Number(purchasePrice) || 0
    const pq = Number(purchaseQty) || 0
    if (pp > 0 && pq > 0) return pp / pq
    return 0
  }, [purchasePrice, purchaseQty])

  function onFormSubmit(data: MaterialFormValues) {
    onSubmit({
      name: data.name.trim(),
      brand: data.brand?.trim() || undefined,
      unit: data.unit,
      purchasePrice: data.purchasePrice,
      purchaseQty: data.purchaseQty,
      supplierId: data.supplierId || undefined,
      supplierName: isNewSupplier ? data.supplierName?.trim() || undefined : undefined,
      supplierAddress: isNewSupplier ? data.supplierAddress?.trim() || undefined : undefined,
      supplierPhone: isNewSupplier ? data.supplierPhone?.trim() || undefined : undefined,
      supplierPic: isNewSupplier ? data.supplierPic?.trim() || undefined : undefined,
      supplierNotes: isNewSupplier ? data.supplierNotes?.trim() || undefined : undefined,
      notes: data.notes?.trim() || undefined,
    })
  }

  function handleSupplierSelect(supplier: SupplierOption) {
    setValue('supplierId', supplier.id, { shouldValidate: true })
    setValue('supplierName', supplier.name)
    setIsNewSupplier(false)
    setValue('supplierAddress', '')
    setValue('supplierPhone', '')
    setValue('supplierPic', '')
    setValue('supplierNotes', '')
  }

  function handleSupplierNameChange(name: string) {
    setValue('supplierName', name)
    const match = suppliers.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
    if (match) {
      setValue('supplierId', match.id)
      setIsNewSupplier(false)
    } else {
      setValue('supplierId', '')
      setIsNewSupplier(name.trim().length > 0)
    }
  }

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <Input
          label={t('suppliers.labelMaterialName')}
          placeholder={t('suppliers.placeholderMaterialName')}
          error={errors.name?.message}
          required
          disabled={loading}
          {...register('name')}
        />

        <Input
          label={t('suppliers.labelBrand')}
          placeholder={t('suppliers.placeholderBrand')}
          error={errors.brand?.message}
          disabled={loading}
          {...register('brand')}
        />

        <Select
          label={t('suppliers.labelUnit')}
          placeholder={t('suppliers.placeholderUnit')}
          options={unitOptions}
          error={errors.unit?.message}
          required
          disabled={loading}
          {...register('unit')}
        />

        {/* Bulk purchase pricing */}
        <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('suppliers.labelPurchasePrice')}</p>

          <Controller
            control={control}
            name="purchasePrice"
            render={({ field }) => (
              <CurrencyInput
                label={t('suppliers.labelPackagePrice')}
                value={field.value}
                onChange={field.onChange}
                error={errors.purchasePrice?.message}
                placeholder="Rp 0"
                disabled={loading}
              />
            )}
          />

          <Input
            label={t('suppliers.labelPackageQty')}
            type="number"
            placeholder={t('suppliers.placeholderPackageQty')}
            error={errors.purchaseQty?.message}
            required
            disabled={loading}
            min="0"
            step="any"
            {...register('purchaseQty')}
          />

          <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2.5 border border-gray-200 dark:bg-gray-800 dark:border-gray-700">
            <span className="text-sm text-gray-600 dark:text-gray-400">{t('suppliers.labelPricePerUnitDisplay')}</span>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {pricePerUnit > 0 ? formatRupiahDecimal(pricePerUnit) : '—'}
            </span>
          </div>
        </div>

        {!hasFixedSupplier && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('suppliers.supplierLabel')}
              </label>
              <SupplierCombobox
                value={supplierName ?? ''}
                onChange={handleSupplierNameChange}
                onSelect={handleSupplierSelect}
                suppliers={suppliers}
                placeholder={t('suppliers.supplierComboboxPlaceholder')}
                readOnly={loading}
              />
            </div>

            {showNewSupplierFields && (
              <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-3 dark:border-gray-600 dark:bg-gray-900/50">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.newSupplierSection')}
                </p>
                <Input
                  label={t('suppliers.labelSupplierAddress')}
                  placeholder={t('suppliers.placeholderSupplierAddress')}
                  disabled={loading}
                  {...register('supplierAddress')}
                />
                <Input
                  label={t('suppliers.labelSupplierPhone')}
                  placeholder={t('suppliers.placeholderSupplierPhone')}
                  disabled={loading}
                  {...register('supplierPhone')}
                />
                <Input
                  label={t('suppliers.labelSupplierPic')}
                  placeholder={t('suppliers.placeholderSupplierPic')}
                  disabled={loading}
                  {...register('supplierPic')}
                />
                <Textarea
                  label={t('suppliers.labelSupplierNotes')}
                  placeholder={t('suppliers.placeholderSupplierNotes')}
                  disabled={loading}
                  {...register('supplierNotes')}
                />
              </div>
            )}
          </div>
        )}

        <Textarea
          label={t('suppliers.labelNotes')}
          placeholder={t('suppliers.placeholderNotes')}
          error={errors.notes?.message}
          disabled={loading}
          {...register('notes')}
        />
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={loading}
        >
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="brand" loading={loading}>
          {defaultValues ? t('suppliers.btnSaveMaterial') : t('suppliers.btnAddMaterial')}
        </Button>
      </div>
    </form>
  )
}

export { type MaterialFormProps, type MaterialFormData }
