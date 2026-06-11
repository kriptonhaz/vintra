import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Upload,
  X as XIcon,
  Sparkles,
  ShoppingCart,
  Package,
} from 'lucide-react'
import { getAdditionalOutletContext } from '@/server/functions/admin-finance'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils'
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

type PackageKey = 'komplit' | 'pos-only' | 'inventory-only'

const schema = z.object({
  packageKey: z.enum(['komplit', 'pos-only', 'inventory-only']),
  additionalOutletCount: z.coerce.number().int().min(1).max(50),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal salah'),
  bankReference: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
})
type FormValues = z.infer<typeof schema>

export interface AdditionalOutletSubmit {
  packageKey: PackageKey
  additionalOutletCount: number
  transferDate: string
  bankReference?: string
  notes?: string
  proofDataUrl?: string
}

const ICON_BY_PACKAGE: Record<PackageKey, typeof Sparkles> = {
  komplit: Sparkles,
  'pos-only': ShoppingCart,
  'inventory-only': Package,
}

/**
 * Unified "Tambah Outlet" sheet. Replaces the per-module buttons —
 * admin opens this once and picks which package the new outlet uses:
 *
 *   - Komplit (bundle)       → 1 charged POS row at Komplit additional
 *                              rate + 1 paired Rp 0 Inventory row to
 *                              keep both billed counts in sync
 *   - POS only (à la carte)  → 1 POS row at Toko additional rate
 *   - Inventory only / gudang → 1 Inventory row at Toko additional rate
 *
 * Cost preview is marketing-aware: shows "Hemat X% dibanding outlet
 * pertama" so admin can quote the same number the tenant saw on the
 * pricing page.
 */
export function AdditionalOutletSheet({
  tenantId,
  tenantName,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  tenantId: string
  tenantName: string
  onClose: () => void
  onSubmit: (values: AdditionalOutletSubmit) => void
  loading: boolean
  error: string | null
}) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofDataUrl, setProofDataUrl] = useState<string | null>(null)
  const [proofError, setProofError] = useState<string | null>(null)

  const { data: ctx, isLoading } = useQuery({
    queryKey: ['admin-additional-outlet-context', tenantId],
    queryFn: () => getAdditionalOutletContext({ data: { tenantId } }),
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      packageKey: 'komplit',
      additionalOutletCount: 1,
      transferDate: todayStr,
      bankReference: '',
      notes: '',
    },
  })
  const packageKey = form.watch('packageKey')
  const count = Math.max(1, Number(form.watch('additionalOutletCount')) || 1)

  // Auto-select the first available option on first load so the form
  // is never in an invalid state when only POS or Inventory à la carte
  // is offered.
  useEffect(() => {
    if (!ctx?.hasActive) return
    const has = (k: PackageKey) => ctx.options.some((o) => o.packageKey === k)
    if (!has(packageKey)) {
      const first = ctx.options[0]
      if (first) form.setValue('packageKey', first.packageKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx])

  const selected = ctx?.hasActive
    ? ctx.options.find((o) => o.packageKey === packageKey) ?? null
    : null

  // Months remaining depends on which module the package draws from.
  // Komplit + pos-only → POS expiry. Inventory-only → Inventory expiry.
  const monthsRemaining = ctx?.hasActive
    ? packageKey === 'inventory-only'
      ? ctx.monthsRemaining.inventory
      : ctx.monthsRemaining.pos
    : 0
  const periodEndIso = ctx?.hasActive
    ? packageKey === 'inventory-only'
      ? ctx.periodEndAt.inventory
      : ctx.periodEndAt.pos
    : null

  const totalAmount =
    selected != null
      ? selected.ratePerMonth * monthsRemaining * count
      : 0
  // Marketing math — how much cheaper than equivalent N outlets at the
  // "first outlet" rate? Surfaces the same "Hemat X%" the tenant saw on
  // the pricing page so the admin can quote it back.
  const savingsPct =
    selected && selected.firstOutletPricePerMonth > 0
      ? Math.max(
          0,
          Math.round(
            ((selected.firstOutletPricePerMonth - selected.ratePerMonth) /
              selected.firstOutletPricePerMonth) *
              100,
          ),
        )
      : 0

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
      packageKey: values.packageKey,
      additionalOutletCount: values.additionalOutletCount,
      transferDate: values.transferDate,
      bankReference: values.bankReference?.trim() || undefined,
      notes: values.notes?.trim() || undefined,
      proofDataUrl: proofDataUrl ?? undefined,
    })
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>Tambah Outlet — {tenantName}</SheetTitle>
        <SheetDescription>
          Pilih paket yang dipakai di outlet baru, lalu catat pembayaran
          pro-rata. Tenant akan bisa langsung membuat cabang baru di
          /master/branches setelah pembayaran tercatat.
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {isLoading && (
            <p className="text-sm text-gray-500">Memuat paket aktif...</p>
          )}
          {ctx && !ctx.hasActive && (
            <div className="rounded-lg border border-warning-300 bg-warning-50 p-3 text-sm text-warning-900 dark:border-warning-900/40 dark:bg-warning-900/20 dark:text-warning-200">
              Tenant belum punya paket berbayar aktif. Aktifkan dulu paket
              POS / Inventory / Komplit sebelum menambah outlet.
            </div>
          )}

          {ctx?.hasActive && (
            <>
              <div>
                <p className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                  Outlet baru pakai paket apa?
                </p>
                <div className="grid gap-2">
                  {ctx.options.map((opt) => {
                    const Icon = ICON_BY_PACKAGE[opt.packageKey]
                    const isSelected = packageKey === opt.packageKey
                    const optSavings =
                      opt.firstOutletPricePerMonth > 0
                        ? Math.max(
                            0,
                            Math.round(
                              ((opt.firstOutletPricePerMonth -
                                opt.ratePerMonth) /
                                opt.firstOutletPricePerMonth) *
                                100,
                            ),
                          )
                        : 0
                    return (
                      <button
                        key={opt.packageKey}
                        type="button"
                        onClick={() =>
                          form.setValue('packageKey', opt.packageKey, {
                            shouldDirty: true,
                          })
                        }
                        className={`flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
                          isSelected
                            ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20'
                            : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'
                        }`}
                      >
                        <div
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                            isSelected
                              ? 'bg-brand-600 text-white'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {opt.label}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                            {opt.description}
                          </p>
                          <p className="mt-1.5 text-xs font-medium text-brand-700 dark:text-brand-300">
                            {formatRupiah(opt.ratePerMonth)}/bulan/outlet
                            {optSavings > 0 && (
                              <span className="ml-1.5 inline-flex items-center rounded-full bg-success-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-success-700 dark:bg-success-900/30 dark:text-success-400">
                                Hemat {optSavings}%
                              </span>
                            )}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {selected && (
                <>
                  <div className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-gray-900 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Outlet ditagih saat ini
                      </p>
                      <p className="mt-0.5 text-base font-semibold text-gray-900 dark:text-gray-100">
                        {packageKey === 'inventory-only'
                          ? ctx.currentBilledOutletCount.inventory
                          : ctx.currentBilledOutletCount.pos}{' '}
                        outlet
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Sisa periode
                      </p>
                      <p className="mt-0.5 text-base font-semibold text-gray-900 dark:text-gray-100">
                        ~ {monthsRemaining} bulan
                      </p>
                      {periodEndIso && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          sampai{' '}
                          {formatDate(new Date(periodEndIso), 'dd MMM yyyy')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      label="Jumlah outlet tambahan"
                      {...form.register('additionalOutletCount')}
                      error={
                        form.formState.errors.additionalOutletCount?.message
                      }
                    />
                  </div>

                  <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-900/20">
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      Total Bayar (pro-rata)
                    </p>
                    <p className="mt-0.5 text-2xl font-bold text-brand-700 dark:text-brand-300">
                      {formatRupiah(totalAmount)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {formatRupiah(selected.ratePerMonth)} ×{' '}
                      {monthsRemaining} bln × {count} outlet
                    </p>
                    {savingsPct > 0 && (
                      <p className="mt-1.5 text-xs font-medium text-success-700 dark:text-success-400">
                        Outlet tambahan ini lebih murah {savingsPct}%
                        dibanding tarif outlet pertama (
                        {formatRupiah(selected.firstOutletPricePerMonth)}/bln).
                      </p>
                    )}
                    {selected.bundled && (
                      <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                        Tarif ini sudah include POS + Inventory + Absensi.
                        Sistem otomatis tambah kapasitas pada modul Inventory
                        juga.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Tanggal Transfer
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
                      Referensi Bank (opsional)
                    </label>
                    <Input
                      {...form.register('bankReference')}
                      placeholder="No. transaksi / berita acara"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Bukti Transfer (opsional)
                    </label>
                    {proofFile ? (
                      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                        <span className="truncate text-gray-700 dark:text-gray-300">
                          {proofFile.name} ·{' '}
                          {Math.round(proofFile.size / 1024)} KB
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
                        <span>Pilih file (JPG/PNG/WebP, maks 1 MB)</span>
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
                      Catatan (opsional)
                    </label>
                    <Textarea
                      rows={3}
                      {...form.register('notes')}
                      placeholder="Detail tambahan, e.g. nama outlet baru, alasan, dll"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="submit"
            variant="brand"
            loading={loading}
            disabled={!selected}
          >
            Catat Pembayaran
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
