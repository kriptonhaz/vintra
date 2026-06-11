import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Upload, X as XIcon } from 'lucide-react'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils' // JUR-137
import { waAnnualPrice, WA_ANNUAL_DISCOUNT_PCT } from '@vintra/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'

// Must stay in sync with `wa_subscription_plans` (the DB seed in
// `0041_wa_subscription_pricing.sql` was updated to 49k/149k to match
// the tenant-facing `/whatsapp/billing.tsx`). Pro + Enterprise are
// inactive (is_active=false in DB) and intentionally omitted here.
const WA_PLANS = [
  { key: 'basic', label: 'Basic', priceIdr: 49_000, maxInstances: 1, maxReplies: 5_000 },
  { key: 'komplit', label: 'Komplit', priceIdr: 149_000, maxInstances: 3, maxReplies: 20_000 },
] as const

const schema = z.object({
  planKey: z.enum(['basic', 'komplit']),
  period: z.enum(['monthly', 'annual']),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal salah'),
  bankReference: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
})
type FormValues = z.infer<typeof schema>

export interface WaPaymentSheetSubmit {
  planKey: 'basic' | 'komplit'
  amountIdr: number
  /** 1 for monthly, 12 for annual. Drives the subscription expiry. */
  durationMonths: number
  transferDate: string
  bankReference?: string
  notes?: string
  proofDataUrl?: string
}

export function WaPaymentSheet({
  mode = 'activate',
  tenantName,
  currentExpiresAt,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  mode?: 'activate' | 'renew'
  tenantName: string
  currentExpiresAt?: Date | null
  onClose: () => void
  onSubmit: (values: WaPaymentSheetSubmit) => void
  loading: boolean
  error: string | null
}) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofDataUrl, setProofDataUrl] = useState<string | null>(null)
  const [proofError, setProofError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      planKey: 'komplit',
      period: 'monthly',
      transferDate: todayStr,
      bankReference: '',
      notes: '',
    },
  })

  const planKey = form.watch('planKey')
  const period = form.watch('period')
  const plan = WA_PLANS.find((p) => p.key === planKey)!

  const isAnnual = period === 'annual'
  const durationMonths = isAnnual ? 12 : 1
  // Annual = 12 months minus the annual discount; monthly = list price.
  const amountIdr = isAnnual ? waAnnualPrice(plan.priceIdr) : plan.priceIdr
  const annualSaving = plan.priceIdr * 12 - waAnnualPrice(plan.priceIdr)

  const now = new Date()
  const periodStart = mode === 'renew' && currentExpiresAt && currentExpiresAt.getTime() > now.getTime()
    ? currentExpiresAt
    : now
  const periodEnd = new Date(periodStart)
  periodEnd.setMonth(periodEnd.getMonth() + durationMonths)

  async function handleProofChange(e: React.ChangeEvent<HTMLInputElement>) {
    setProofError(null)
    const file = e.target.files?.[0]
    if (!file) { setProofFile(null); setProofDataUrl(null); return }
    if (file.size > 1 * 1024 * 1024) { setProofError('Ukuran file maks 1 MB'); return }
    setProofFile(file)
    const reader = new FileReader()
    reader.onload = () => setProofDataUrl(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(file)
  }

  function handleSubmit(values: FormValues) {
    onSubmit({
      planKey: values.planKey,
      // Pre-referral price (monthly list price, or the discounted
      // annual price). The server still applies any referral discount
      // on top via the shared applyReferralDiscount helper.
      amountIdr,
      durationMonths,
      transferDate: values.transferDate,
      bankReference: values.bankReference?.trim() || undefined,
      notes: values.notes?.trim() || undefined,
      proofDataUrl: proofDataUrl ?? undefined,
    })
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{mode === 'renew' ? 'Perpanjang' : 'Aktifkan'} WhatsApp AI</SheetTitle>
        <SheetDescription>Catat pembayaran untuk {tenantName}</SheetDescription>
      </SheetHeader>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">

          <Select
            label="Paket"
            {...form.register('planKey')}
            options={WA_PLANS.map((p) => ({ value: p.key, label: `${p.label} — ${formatRupiah(p.priceIdr)}/bln` }))}
            error={form.formState.errors.planKey?.message}
          />

          <Select
            label="Periode Pembayaran"
            {...form.register('period')}
            options={[
              {
                value: 'monthly',
                label: `Bulanan — ${formatRupiah(plan.priceIdr)}/bln`,
              },
              {
                value: 'annual',
                label: `Tahunan — ${formatRupiah(waAnnualPrice(plan.priceIdr))}/thn (hemat ${WA_ANNUAL_DISCOUNT_PCT}%)`,
              },
            ]}
            error={form.formState.errors.period?.message}
          />

          {/* Summary */}
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-900/20">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Total
                </p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {formatRupiah(amountIdr)}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {plan.maxInstances} instansi · {new Intl.NumberFormat('id-ID').format(plan.maxReplies)} balasan AI/bln
                </p>
                {isAnnual && (
                  <p className="mt-0.5 text-xs font-medium text-brand-700 dark:text-brand-400">
                    Hemat {formatRupiah(annualSaving)} vs bayar bulanan
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Periode ({durationMonths} bln)
                </p>
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  {formatDate(periodStart, 'dd MMM yyyy')} —{' '}
                  {formatDate(periodEnd, 'dd MMM yyyy')}
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Tanggal Transfer</label>
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
              <p className="mt-1 text-xs text-danger-600">{form.formState.errors.transferDate.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Referensi Bank</label>
            <Input {...form.register('bankReference')} placeholder="No. referensi transfer (opsional)" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Bukti Transfer</label>
            {proofFile ? (
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                <span className="truncate text-gray-700 dark:text-gray-300">{proofFile.name} · {Math.round(proofFile.size / 1024)} KB</span>
                <button type="button" onClick={() => { setProofFile(null); setProofDataUrl(null) }} className="text-gray-500 hover:text-gray-900">
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                <Upload className="h-4 w-4" />
                <span>Upload bukti transfer</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleProofChange} />
              </label>
            )}
            {proofError && <p className="mt-1 text-xs text-danger-600">{proofError}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Catatan</label>
            <Textarea rows={2} {...form.register('notes')} placeholder="Catatan opsional" />
          </div>

          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" variant="brand" loading={loading}>{mode === 'renew' ? 'Perpanjang' : 'Aktifkan'} & Catat Pembayaran</Button>
        </div>
      </form>
    </Sheet>
  )
}
