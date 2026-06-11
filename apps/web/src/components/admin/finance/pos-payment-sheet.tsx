import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Upload, X as XIcon } from 'lucide-react'
import {
  POS_PLANS,
  posTotal,
  findPOSPlan,
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

const PURCHASABLE_PLANS = POS_PLANS.filter(
  (p) => p.tier !== 'free' && !p.comingSoon,
)

const PLAN_LABEL: Record<string, string> = {
  pos_toko_monthly: 'POS Toko (POS-only) — Bulanan',
  pos_toko_annual: 'POS Toko (POS-only) — Tahunan',
  pos_komplit_monthly: 'Komplit (Bundle Semua Modul) — Bulanan',
  pos_komplit_annual: 'Komplit (Bundle Semua Modul) — Tahunan',
}

const schema = z.object({
  planKey: z
    .string()
    .refine((k) => PURCHASABLE_PLANS.some((p) => p.key === k), 'Paket tidak valid'),
  outletCount: z.coerce.number().int().min(1).max(100),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal salah'),
  bankReference: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
})
type FormValues = z.infer<typeof schema>

export interface POSPaymentSheetSubmit {
  planKey: string
  outletCount: number
  transferDate: string
  bankReference?: string
  notes?: string
  proofDataUrl?: string
}

export function POSPaymentSheet({
  mode,
  tenantName,
  currentExpiresAt,
  initialPlanKey,
  referralAttribution,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  mode: 'activate' | 'renew'
  tenantName: string
  currentExpiresAt?: Date | null
  /**
   * Optional plan to pre-select on open. Used by the "Aktifkan Komplit"
   * banner to default to `pos_komplit_annual` so admin can submit
   * without re-picking from the dropdown. Falls back to the regular
   * default (toko_annual) when not provided.
   */
  initialPlanKey?: string
  /** JUR-96: when present, show the discount banner + line-through
   *  full price + discounted total. The discount itself is applied
   *  server-side via applyReferralDiscount, so this is UX-only. */
  referralAttribution?: ReferralAttributionForSheet | null
  onClose: () => void
  onSubmit: (values: POSPaymentSheetSubmit) => void
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
      planKey:
        // Prefer caller-supplied initial plan when valid (e.g. Komplit
        // banner pre-selecting `pos_komplit_annual`), else fall back to
        // the historical default of POS Toko Annual.
        (initialPlanKey &&
          PURCHASABLE_PLANS.find((p) => p.key === initialPlanKey)?.key) ||
        PURCHASABLE_PLANS.find((p) => p.key === 'pos_toko_annual')?.key ||
        PURCHASABLE_PLANS[0]!.key,
      outletCount: 1,
      transferDate: todayStr,
      bankReference: '',
      notes: '',
    },
  })

  const planKey = form.watch('planKey')
  const outletCountWatch = form.watch('outletCount')
  const outletCount = Math.max(1, Math.floor(Number(outletCountWatch) || 1))
  const plan = findPOSPlan(planKey)
  const total = plan ? posTotal(planKey, outletCount) : 0

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
    if (file.size > 1 * 1024 * 1024) {
      setProofError('Ukuran file maks 1 MB')
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
      outletCount: Math.max(1, Math.floor(Number(values.outletCount) || 1)),
      transferDate: values.transferDate,
      bankReference: values.bankReference?.trim() || undefined,
      notes: values.notes?.trim() || undefined,
      proofDataUrl: proofDataUrl ?? undefined,
    })
  }

  // JUR-122: sheet is reused by the Komplit bundle banner — when the
  // user picked a pos_komplit_* plan, switch the title/description so
  // it doesn't say "Aktifkan Kasir" while they're actually activating
  // POS + Inventory + Absensi as a bundle.
  const isKomplitBundle = planKey.startsWith('pos_komplit_')
  const moduleLabel = isKomplitBundle ? 'Komplit' : 'Kasir'

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {mode === 'activate'
            ? `Aktifkan ${moduleLabel}`
            : `Perpanjang ${moduleLabel}`}
        </SheetTitle>
        <SheetDescription>
          {mode === 'activate'
            ? `Catat pembayaran untuk ${tenantName} dan aktifkan ${
                isKomplitBundle
                  ? 'paket Komplit (POS + Inventory + Absensi) sekaligus'
                  : 'modul Kasir'
              }.`
            : `Catat pembayaran untuk perpanjangan ${
                isKomplitBundle ? 'paket Komplit' : 'modul Kasir'
              } ${tenantName}.`}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <Select
            label="Paket"
            {...form.register('planKey')}
            options={PURCHASABLE_PLANS.map((p) => ({
              value: p.key,
              label: PLAN_LABEL[p.key] ?? p.key,
            }))}
            error={form.formState.errors.planKey?.message}
          />

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Jumlah Outlet
            </label>
            <Input
              type="number"
              min={1}
              max={100}
              step={1}
              {...form.register('outletCount')}
            />
            <p className="mt-1 text-xs text-gray-500">
              Outlet pertama termasuk dalam harga paket. Outlet ke-2 dst:
              {plan
                ? ` ${formatRupiah(plan.additionalOutletPerMonth)}/outlet/bulan`
                : ' (pilih paket dulu)'}
              .
            </p>
          </div>

          <ReferralDiscountBanner attribution={referralAttribution} />

          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-900/20">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  {referralAttribution ? 'Total Bayar' : 'Total'}
                </p>
                <DiscountedTotal fullAmount={total} attribution={referralAttribution} />
                {plan && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {plan.durationMonths} bln × ({formatRupiah(plan.pricePerMonth)}
                    {outletCount > 1 && (
                      <>
                        {' '}+ {outletCount - 1} ×{' '}
                        {formatRupiah(plan.additionalOutletPerMonth)}
                      </>
                    )}
                    )
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Periode
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
                      Periode disambung dari masa aktif saat ini.
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
            {mode === 'activate' ? 'Aktifkan' : 'Perpanjang'}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
