import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Upload, X as XIcon } from 'lucide-react'
import { formatRupiah } from '@/lib/currency'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'

const schema = z.object({
  refundReason: z.string().min(1, 'Alasan wajib diisi').max(1000),
  transferDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal salah'),
  endSubscriptionNow: z.boolean(),
})
type FormValues = z.infer<typeof schema>

export interface RefundSheetSubmit {
  refundReason: string
  transferDate: string
  endSubscriptionNow: boolean
  proofDataUrl?: string
}

export function RefundSheet({
  originalInvoiceNumber,
  originalAmountIdr,
  tenantName,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  originalInvoiceNumber: string
  originalAmountIdr: number
  tenantName: string
  onClose: () => void
  onSubmit: (values: RefundSheetSubmit) => void
  loading: boolean
  error: string | null
}) {
  const { t } = useTranslation()
  const todayStr = new Date().toISOString().slice(0, 10)

  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofDataUrl, setProofDataUrl] = useState<string | null>(null)
  const [proofError, setProofError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      refundReason: '',
      transferDate: todayStr,
      endSubscriptionNow: true,
    },
  })

  async function handleProofChange(e: React.ChangeEvent<HTMLInputElement>) {
    setProofError(null)
    const file = e.target.files?.[0]
    if (!file) {
      setProofFile(null)
      setProofDataUrl(null)
      return
    }
    if (file.size > 1 * 1024 * 1024) {
      setProofError('Ukuran file maks 1 MB')
      setProofFile(null)
      setProofDataUrl(null)
      return
    }
    setProofFile(file)
    const reader = new FileReader()
    reader.onload = () => {
      setProofDataUrl(typeof reader.result === 'string' ? reader.result : null)
    }
    reader.readAsDataURL(file)
  }

  function handleSubmit(values: FormValues) {
    onSubmit({
      refundReason: values.refundReason.trim(),
      transferDate: values.transferDate,
      endSubscriptionNow: values.endSubscriptionNow,
      proofDataUrl: proofDataUrl ?? undefined,
    })
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('admin.finance.refundSheetTitle')}</SheetTitle>
        <SheetDescription>
          {t('admin.finance.refundSheetDesc', {
            invoice: originalInvoiceNumber,
            tenant: tenantName,
          })}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Summary of what's being refunded */}
          <div className="rounded-lg border border-danger-200 bg-danger-50 p-4 dark:border-danger-900 dark:bg-danger-900/20">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('admin.finance.refundAmount')}
            </p>
            <p className="text-xl font-bold text-danger-700 dark:text-danger-300">
              {formatRupiah(originalAmountIdr)}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.finance.refundReason')}
            </label>
            <Textarea
              rows={3}
              {...form.register('refundReason')}
              placeholder={t('admin.finance.refundReasonPlaceholder')}
            />
            {form.formState.errors.refundReason && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.refundReason.message}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.finance.refundTransferDate')}
            </label>
            <Controller
              name="transferDate"
              control={form.control}
              render={({ field }) => (
                <DateInput
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  max={todayStr}
                />
              )}
            />
            {form.formState.errors.transferDate && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.transferDate.message}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.finance.fieldProof')}
            </label>
            {proofFile ? (
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                <span className="truncate text-gray-700 dark:text-gray-300">
                  {proofFile.name} · {Math.round(proofFile.size / 1024)} KB
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setProofFile(null)
                    setProofDataUrl(null)
                  }}
                  className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
                  aria-label="Hapus bukti"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                <Upload className="h-4 w-4" />
                <span>{t('admin.finance.fieldProofCta')}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleProofChange}
                />
              </label>
            )}
            {proofError && (
              <p className="mt-1 text-xs text-danger-600">{proofError}</p>
            )}
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
            <input
              type="checkbox"
              {...form.register('endSubscriptionNow')}
              className="mt-0.5 h-4 w-4"
            />
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {t('admin.finance.refundEndSubscriptionLabel')}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {t('admin.finance.refundEndSubscriptionHint')}
              </p>
            </div>
          </label>

          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={loading}>
            {t('admin.finance.refundSheetCta')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
