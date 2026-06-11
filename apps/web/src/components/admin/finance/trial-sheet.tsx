import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { ATTENDANCE_TRIAL_DEFAULTS } from '@vintra/shared'
import { formatDate } from '@/lib/utils' // JUR-137: stable SSR/client dates
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'

const schema = z.object({
  durationDays: z.coerce
    .number()
    .int()
    .min(1, 'Minimal 1 hari')
    .max(30, 'Maksimal 30 hari'),
  unlimited: z.boolean(),
  staffCap: z.coerce
    .number()
    .int()
    .min(1, 'Minimal 1 staf')
    .max(100, 'Maksimal 100 staf')
    .optional(),
})
type FormValues = z.infer<typeof schema>

export interface TrialSheetSubmit {
  durationDays: number
  /** `null` = unlimited (no per-tenant staff cap during trial). */
  staffCap: number | null
}

/**
 * Dual-mode sheet: start a new trial or edit a running one. In edit
 * mode, pre-fills `durationDays` as the remaining days (rounded up)
 * and lets admin extend (or shorten) from there. The "Tanpa batas
 * staf" checkbox controls whether a per-tenant cap is set at all.
 */
export function TrialSheet({
  mode,
  tenantName,
  currentEndsAt,
  currentStaffCap,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  mode: 'start' | 'edit'
  tenantName: string
  /** For edit mode: the current `trial_ends_at` to derive remaining days. */
  currentEndsAt?: Date | null
  /** Null = unlimited (no per-tenant cap). */
  currentStaffCap?: number | null
  onClose: () => void
  onSubmit: (values: TrialSheetSubmit) => void
  loading: boolean
  error: string | null
}) {
  const { t } = useTranslation()

  const defaults = useMemo<FormValues>(() => {
    if (mode === 'edit' && currentEndsAt) {
      const msLeft = currentEndsAt.getTime() - Date.now()
      const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)))
      return {
        durationDays: daysLeft,
        unlimited: currentStaffCap === null || currentStaffCap === undefined,
        staffCap: currentStaffCap ?? undefined,
      }
    }
    return {
      durationDays: ATTENDANCE_TRIAL_DEFAULTS.durationDays,
      unlimited: ATTENDANCE_TRIAL_DEFAULTS.staffCap === null,
      staffCap: ATTENDANCE_TRIAL_DEFAULTS.staffCap ?? undefined,
    }
  }, [mode, currentEndsAt, currentStaffCap])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })

  const unlimited = form.watch('unlimited')
  const durationDays = Number(form.watch('durationDays') || 0)
  const previewEndsAt = useMemo(() => {
    return new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
  }, [durationDays])

  function handleSubmit(values: FormValues) {
    onSubmit({
      durationDays: values.durationDays,
      staffCap: values.unlimited ? null : (values.staffCap ?? null),
    })
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {mode === 'start'
            ? t('admin.finance.trialSheetStartTitle')
            : t('admin.finance.trialSheetEditTitle')}
        </SheetTitle>
        <SheetDescription>
          {mode === 'start'
            ? t('admin.finance.trialSheetStartDesc', { tenantName })
            : t('admin.finance.trialSheetEditDesc', { tenantName })}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {mode === 'edit' && currentEndsAt && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {t('admin.finance.trialCurrentEnds')}
              </p>
              <p className="mt-0.5 text-gray-900 dark:text-gray-100">
                {formatDate(currentEndsAt, 'dd MMMM yyyy')}
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.finance.fieldTrialDuration')}
            </label>
            <Input
              type="number"
              min={1}
              max={30}
              {...form.register('durationDays')}
            />
            {form.formState.errors.durationDays && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.durationDays.message}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              {t('admin.finance.fieldTrialDurationHint', {
                endsAt: formatDate(previewEndsAt, 'dd MMM yyyy'),
              })}
            </p>
          </div>

          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                {...form.register('unlimited')}
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              {t('admin.finance.fieldTrialUnlimited')}
            </label>
            {!unlimited && (
              <>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  {...form.register('staffCap')}
                />
                {form.formState.errors.staffCap && (
                  <p className="mt-1 text-xs text-danger-600">
                    {form.formState.errors.staffCap.message}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  {t('admin.finance.fieldTrialStaffCapHint')}
                </p>
              </>
            )}
            {unlimited && (
              <p className="text-xs text-gray-500">
                {t('admin.finance.fieldTrialUnlimitedHint')}
              </p>
            )}
          </div>

          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={loading}>
            {mode === 'start'
              ? t('admin.finance.trialSheetStartCta')
              : t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
