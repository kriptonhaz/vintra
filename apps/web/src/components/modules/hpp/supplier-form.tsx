import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createSupplierSchema, type CreateSupplierInput } from '@vintra/shared/validators/hpp'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

type SupplierFormData = CreateSupplierInput

interface SupplierFormProps {
  defaultValues?: SupplierFormData
  onSubmit: (data: SupplierFormData) => void
  onCancel: () => void
  loading?: boolean
}

export function SupplierForm({
  defaultValues,
  onSubmit,
  onCancel,
  loading = false,
}: SupplierFormProps) {
  const { t } = useTranslation()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SupplierFormData>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: {
      name: defaultValues?.name ?? '',
      address: defaultValues?.address ?? '',
      phoneNumber: defaultValues?.phoneNumber ?? '',
      personInCharge: defaultValues?.personInCharge ?? '',
      notes: defaultValues?.notes ?? '',
    },
  })

  function onFormSubmit(data: SupplierFormData) {
    onSubmit({
      name: data.name.trim(),
      address: data.address?.trim() || undefined,
      phoneNumber: data.phoneNumber?.trim() || undefined,
      personInCharge: data.personInCharge?.trim() || undefined,
      notes: data.notes?.trim() || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <Input
          label={t('suppliers.labelName')}
          placeholder={t('suppliers.placeholderName')}
          error={errors.name?.message}
          required
          disabled={loading}
          {...register('name')}
        />

        <Input
          label={t('suppliers.labelAddress')}
          placeholder={t('suppliers.placeholderAddress')}
          error={errors.address?.message}
          disabled={loading}
          {...register('address')}
        />

        <Input
          label={t('suppliers.labelPhone')}
          placeholder={t('suppliers.placeholderPhone')}
          error={errors.phoneNumber?.message}
          disabled={loading}
          {...register('phoneNumber')}
        />

        <Input
          label={t('suppliers.labelPic')}
          placeholder={t('suppliers.placeholderPic')}
          error={errors.personInCharge?.message}
          disabled={loading}
          {...register('personInCharge')}
        />

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
          {defaultValues ? t('suppliers.btnSave') : t('suppliers.btnAdd')}
        </Button>
      </div>
    </form>
  )
}

export { type SupplierFormProps, type SupplierFormData }
