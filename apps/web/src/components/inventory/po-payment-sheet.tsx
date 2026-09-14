import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { recordPoPayment } from '@/server/functions/inventory-po'
import { Button } from '@/components/ui/button'
import { CurrencyInput } from '@/components/ui/currency-input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'
import { PO_PAYMENT_METHODS, poRemainingAmount } from '@/lib/po-payment'
import {
  poPaymentFormSchema,
  type PoPaymentFormValues,
} from '@/lib/schemas/po-payment'

/** Jakarta-local YYYY-MM-DD for the date input's default. */
function todayJakarta(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function PoPaymentSheet({
  open,
  po,
  onClose,
  onRecorded,
}: {
  open: boolean
  po: { id: string; poNumber: string; subtotal: number; paidAmount: number }
  onClose: () => void
  onRecorded: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const remaining = poRemainingAmount(po)

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PoPaymentFormValues>({
    resolver: zodResolver(poPaymentFormSchema),
    defaultValues: { amount: '', method: 'transfer', paidAt: '', note: '' },
  })

  // Re-seed each time the sheet opens. Paying off the rest is the common
  // case; the user lowers the amount for a DP or an installment.
  useEffect(() => {
    if (!open) return
    reset({
      amount: remaining > 0 ? String(remaining) : '',
      method: 'transfer',
      paidAt: todayJakarta(),
      note: '',
    })
  }, [open, remaining, reset])

  async function onSubmit(values: PoPaymentFormValues) {
    const amount = Number(values.amount)
    // The server re-checks under a row lock; this just surfaces it inline.
    if (amount > remaining + 0.005) {
      setError('amount', {
        message: t('inventory.poPaymentErrOverRemaining', {
          amount: formatRupiah(remaining),
        }),
      })
      return
    }
    try {
      await recordPoPayment({
        data: {
          purchaseOrderId: po.id,
          amount,
          method: values.method,
          paidAt: values.paidAt,
          note: values.note?.trim() || null,
        },
      })
      await onRecorded()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal',
        variant: 'error',
      })
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('inventory.poPaymentRecord')}</SheetTitle>
        <SheetDescription>
          {t('inventory.poPaymentSheetDesc', { poNumber: po.poNumber })}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <dl className="space-y-1 rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-900/40">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-600 dark:text-gray-400">
                {t('inventory.poPaymentTotal')}
              </dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">
                {formatRupiah(po.subtotal)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-600 dark:text-gray-400">
                {t('inventory.poPaymentPaid')}
              </dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">
                {formatRupiah(po.paidAmount)}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-gray-200 pt-1 dark:border-gray-700">
              <dt className="font-medium text-gray-700 dark:text-gray-300">
                {t('inventory.poPaymentRemaining')}
              </dt>
              <dd className="font-semibold text-gray-900 dark:text-gray-100">
                {formatRupiah(remaining)}
              </dd>
            </div>
          </dl>

          <div>
            <Controller
              name="amount"
              control={control}
              render={({ field }) => (
                <CurrencyInput
                  label={t('inventory.poPaymentFieldAmount')}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Rp 0"
                  error={errors.amount?.message}
                />
              )}
            />
            {remaining > 0 && (
              <button
                type="button"
                onClick={() =>
                  setValue('amount', String(remaining), { shouldValidate: true })
                }
                className="mt-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                {t('inventory.poPaymentFillRemaining')}
              </button>
            )}
          </div>

          <Controller
            name="paidAt"
            control={control}
            render={({ field }) => (
              <DateInput
                label={t('inventory.poPaymentFieldDate')}
                value={field.value}
                onChange={field.onChange}
                error={errors.paidAt?.message}
                required
              />
            )}
          />

          <Select
            label={t('inventory.poPaymentFieldMethod')}
            {...register('method')}
            options={PO_PAYMENT_METHODS.map((m) => ({
              value: m,
              label: t(`inventory.poPaymentMethod_${m}`),
            }))}
            error={errors.method?.message}
          />

          <Textarea
            label={t('inventory.poPaymentFieldNote')}
            rows={3}
            placeholder={t('inventory.poPaymentNotePlaceholder')}
            {...register('note')}
            error={errors.note?.message}
          />

          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('inventory.poPaymentCashflowHint')}
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={isSubmitting}>
            {t('inventory.poPaymentSave')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
