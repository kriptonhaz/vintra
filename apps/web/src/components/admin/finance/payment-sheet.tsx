import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Upload, X as XIcon } from 'lucide-react'
import {
  ATTENDANCE_PLANS,
  attendanceTotal,
  findPlan,
  addMonths,
} from '@vintra/shared'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils' // JUR-137
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  ReferralDiscountBanner,
  DiscountedTotal,
  type ReferralAttributionForSheet,
} from './referral-discount-banner'

// Indonesian label map for each plan — used both here and on the landing
// page mapping. Keeping in one place reduces duplication risk.
const PLAN_LABEL: Record<string, string> = {
  attendance_1mo: 'Bulanan',
  attendance_3mo: '3 Bulan',
  attendance_6mo: '6 Bulan',
  attendance_12mo: '12 Bulan',
}

const schema = z.object({
  planKey: z
    .string()
    .refine((k) => ATTENDANCE_PLANS.some((p) => p.key === k), 'Plan tidak valid'),
  billedStaffCount: z.coerce.number().int().min(1, 'Minimal 1 staf'),
  transferDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal salah'),
  bankReference: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
})
type FormValues = z.infer<typeof schema>

export interface PaymentSheetSubmit {
  planKey: string
  billedStaffCount: number
  transferDate: string
  bankReference?: string
  notes?: string
  /** `data:image/...;base64,...` — optional proof upload. */
  proofDataUrl?: string
}

export function PaymentSheet({
  mode,
  tenantName,
  /** Current subscription end — used to compute stacked period start. */
  currentExpiresAt,
  defaultBilledStaffCount,
  referralAttribution,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  mode: 'activate' | 'renew'
  tenantName: string
  currentExpiresAt?: Date | null
  defaultBilledStaffCount?: number
  /** JUR-96: see POSPaymentSheet for the rationale. */
  referralAttribution?: ReferralAttributionForSheet | null
  onClose: () => void
  onSubmit: (values: PaymentSheetSubmit) => void
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
      planKey: ATTENDANCE_PLANS[ATTENDANCE_PLANS.length - 1]!.key, // default to 12mo
      billedStaffCount: defaultBilledStaffCount ?? 1,
      transferDate: todayStr,
      bankReference: '',
      notes: '',
    },
  })

  // Watch for live computed summary
  const planKey = form.watch('planKey')
  const staffCount = Number(form.watch('billedStaffCount') || 0)
  const plan = findPlan(planKey)
  const total = plan && staffCount > 0 ? attendanceTotal(planKey, staffCount) : 0

  // Compute period preview:
  // - Renew with still-active subscription → starts at currentExpiresAt
  // - Otherwise starts today
  const now = new Date()
  const startFrom =
    mode === 'renew' &&
    currentExpiresAt &&
    currentExpiresAt.getTime() > now.getTime()
      ? currentExpiresAt
      : now
  const periodEnd = plan ? addMonths(startFrom, plan.durationMonths) : null

  async function handleProofChange(e: React.ChangeEvent<HTMLInputElement>) {
    setProofError(null)
    const file = e.target.files?.[0]
    if (!file) {
      setProofFile(null)
      setProofDataUrl(null)
      return
    }
    // 1 MB ceiling for finance proofs — matches server-side limit.
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
      planKey: values.planKey,
      billedStaffCount: values.billedStaffCount,
      transferDate: values.transferDate,
      bankReference: values.bankReference?.trim() || undefined,
      notes: values.notes?.trim() || undefined,
      proofDataUrl: proofDataUrl ?? undefined,
    })
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {mode === 'activate'
            ? t('admin.finance.sheetActivateTitle')
            : t('admin.finance.sheetRenewTitle')}
        </SheetTitle>
        <SheetDescription>
          {mode === 'activate'
            ? t('admin.finance.sheetActivateDesc', { tenantName })
            : t('admin.finance.sheetRenewDesc', { tenantName })}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <Select
              label={t('admin.finance.fieldPlan')}
              {...form.register('planKey')}
              options={ATTENDANCE_PLANS.map((p) => ({
                value: p.key,
                label: PLAN_LABEL[p.key] ?? p.key,
              }))}
              error={form.formState.errors.planKey?.message}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.finance.fieldBilledStaffCount')}
            </label>
            <Input
              type="number"
              min={1}
              {...form.register('billedStaffCount', { valueAsNumber: true })}
            />
            {form.formState.errors.billedStaffCount && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.billedStaffCount.message}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              {t('admin.finance.fieldBilledStaffCountHint')}
            </p>
          </div>

          <ReferralDiscountBanner attribution={referralAttribution} />

          {/* Live computed summary */}
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-900/20">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  {referralAttribution ? 'Total Bayar' : t('admin.finance.summaryTotal')}
                </p>
                <DiscountedTotal fullAmount={total} attribution={referralAttribution} />
                {plan && staffCount > 0 && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {plan.durationMonths} bln × {staffCount} staf × Rp{' '}
                    {formatRupiah(plan.pricePerStaffPerMonth)}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.finance.summaryPeriod')}
                </p>
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  {formatDate(startFrom, 'dd MMM yyyy')}{' '}
                  —{' '}
                  {periodEnd ? formatDate(periodEnd, 'dd MMM yyyy') : '—'}
                </p>
                {mode === 'renew' &&
                  currentExpiresAt &&
                  currentExpiresAt.getTime() > now.getTime() && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {t('admin.finance.summaryStackedHint')}
                    </p>
                  )}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.finance.fieldTransferDate')}
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
              {t('admin.finance.fieldBankReference')}
            </label>
            <Input
              {...form.register('bankReference')}
              placeholder={t('admin.finance.fieldBankReferencePlaceholder')}
            />
            <p className="mt-1 text-xs text-gray-500">
              {t('admin.finance.fieldBankReferenceHint')}
            </p>
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
            <p className="mt-1 text-xs text-gray-500">
              {t('admin.finance.fieldProofHint')}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.finance.fieldNotes')}
            </label>
            <Textarea
              rows={3}
              {...form.register('notes')}
              placeholder={t('admin.finance.fieldNotesPlaceholder')}
            />
          </div>

          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={loading}>
            {mode === 'activate'
              ? t('admin.finance.sheetActivateCta')
              : t('admin.finance.sheetRenewCta')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
