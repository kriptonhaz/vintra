/**
 * JUR-9: Owner page for managing tenant promotions.
 *
 * Five UI scopes mapped to four DB trigger types:
 *   - `code`         → `code`
 *   - `product`      → `auto_products` (1 target)
 *   - `multi_product`→ `auto_products` (>=1 targets)
 *   - `category`     → `auto_category`
 *   - `cart`         → `auto_cart`
 *
 * The form body switches its extra fields based on the chosen scope.
 * Product picker is a searchable Combobox (single) or MultiCombobox
 * (multi) sourcing sellable items only — non-sellable raw materials
 * (the duplicate-name source) never appear. Category picker is multi.
 *
 * Komplit-only — non-Komplit shows an upgrade banner.
 */
import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Power, Tag, Sparkles, Calendar, ImagePlus, X as XIcon } from 'lucide-react'
import {
  listPromotions,
  upsertPromotion,
  deactivatePromotion,
  listSellablePromoProducts,
  listPromoCategories,
} from '@/server/functions/promotions'
import { getPOSSettings } from '@/server/functions/pos'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Combobox, MultiCombobox } from '@/components/ui/combobox'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { posTierLimits } from '@vintra/shared'
import { formatRupiah } from '@/lib/currency'
import { formatDateJakarta } from '@/lib/jakarta-time'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/pos/promos')({
  component: PromosPage,
})

type Scope = 'code' | 'product' | 'multi_product' | 'category' | 'cart'
type DiscountType = 'percent' | 'fixed'

interface FormValues {
  id?: string
  name: string
  scope: Scope
  code: string
  /** Used by scope = product (length 1) | multi_product (>=1). */
  itemIds: string[]
  /** Used by scope = category (>=1). */
  categoryIds: string[]
  /**
   * Initial chip labels for the pickers — needed when editing because
   * the option list is fetched lazily via search, so prior picks have
   * no name to render until the search returns them.
   */
  seedItems: Array<{ id: string; name: string }>
  seedCategories: Array<{ id: string; name: string }>
  discountType: DiscountType
  discountValue: string
  maxDiscountAmount: string
  minCartTotal: string
  startsAt: string
  endsAt: string
  totalRedemptionCap: string
  perCustomerCap: string
  isActive: boolean
  imageDataUrl: string | null
  existingImageUrl: string | null
  removeImage: boolean
}

const EMPTY: FormValues = {
  name: '',
  scope: 'code',
  code: '',
  itemIds: [],
  categoryIds: [],
  seedItems: [],
  seedCategories: [],
  discountType: 'percent',
  discountValue: '',
  maxDiscountAmount: '',
  minCartTotal: '',
  startsAt: '',
  endsAt: '',
  totalRedemptionCap: '',
  perCustomerCap: '',
  isActive: true,
  imageDataUrl: null,
  existingImageUrl: null,
  removeImage: false,
}

/** Map an existing promo's DB triggerType + target counts back to the UI scope. */
function scopeFromPromo(p: {
  triggerType: string
  itemTargets: Array<{ id: string; name: string }>
  categoryTargets: Array<{ id: string; name: string }>
}): Scope {
  if (p.triggerType === 'code') return 'code'
  if (p.triggerType === 'auto_cart') return 'cart'
  if (p.triggerType === 'auto_category') return 'category'
  // auto_product (legacy) + auto_products. Single target → "product",
  // anything else (incl. zero, defensive) → "multi_product".
  if (p.itemTargets.length === 1) return 'product'
  return 'multi_product'
}

function PromosPage() {
  const { toast } = useToast()
  const qc = useQueryClient()

  const settings = useQuery({
    queryKey: ['pos', 'settings'],
    queryFn: () => getPOSSettings(),
    staleTime: 5 * 60 * 1000,
  })
  const hasFeature = settings.data
    ? posTierLimits(settings.data.tier).features.includes('promo_codes')
    : false

  const promos = useQuery({
    queryKey: ['pos', 'promotions'],
    queryFn: () => listPromotions({ data: { includeInactive: true } }),
    enabled: hasFeature,
    staleTime: 30 * 1000,
  })

  const [editing, setEditing] = React.useState<FormValues | null>(null)
  const [deactivateId, setDeactivateId] = React.useState<string | null>(null)

  const saveMut = useMutation({
    mutationFn: (v: FormValues) =>
      upsertPromotion({
        data: {
          id: v.id,
          name: v.name,
          scope: v.scope,
          code: v.scope === 'code' ? v.code : undefined,
          itemIds:
            v.scope === 'product' || v.scope === 'multi_product'
              ? v.itemIds
              : undefined,
          categoryIds: v.scope === 'category' ? v.categoryIds : undefined,
          discountType: v.discountType,
          discountValue: parseFloat(v.discountValue || '0'),
          maxDiscountAmount: v.maxDiscountAmount
            ? parseFloat(v.maxDiscountAmount)
            : undefined,
          minCartTotal: v.minCartTotal
            ? parseFloat(v.minCartTotal)
            : undefined,
          startsAt: v.startsAt
            ? new Date(v.startsAt).toISOString()
            : undefined,
          endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : undefined,
          totalRedemptionCap: v.totalRedemptionCap
            ? parseInt(v.totalRedemptionCap, 10)
            : undefined,
          perCustomerCap: v.perCustomerCap
            ? parseInt(v.perCustomerCap, 10)
            : undefined,
          isActive: v.isActive,
          imageDataUrl: v.imageDataUrl ?? undefined,
          removeImage: v.removeImage || undefined,
        },
      }),
    onSuccess: () => {
      toast({ title: 'Promo disimpan', variant: 'success' })
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['pos', 'promotions'] })
    },
    onError: (err: Error) =>
      toast({ title: 'Gagal menyimpan', description: err.message, variant: 'error' }),
  })

  const deactivateMut = useMutation({
    mutationFn: (id: string) => deactivatePromotion({ data: { id } }),
    onSuccess: () => {
      toast({ title: 'Promo dinonaktifkan', variant: 'success' })
      setDeactivateId(null)
      qc.invalidateQueries({ queryKey: ['pos', 'promotions'] })
    },
    onError: (err: Error) =>
      toast({ title: 'Gagal nonaktifkan', description: err.message, variant: 'error' }),
  })

  if (settings.isLoading) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <p className="text-sm text-gray-500">Memuat…</p>
      </div>
    )
  }

  if (!hasFeature) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-warning-200 bg-warning-50 p-6 text-sm text-warning-900 dark:border-warning-700 dark:bg-warning-900/20 dark:text-warning-200">
          <h2 className="text-base font-semibold">Promo (Komplit)</h2>
          <p className="mt-1">
            Buat kode promo (contoh: HEMAT20) atau auto-promo per produk dan
            cart-wide (happy hour). Tersedia di paket Komplit. Upgrade dari
            halaman billing untuk mengaktifkan.
          </p>
        </div>
      </div>
    )
  }

  const list = promos.data ?? []

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Promo
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Kelola kode promo, auto-promo per produk / kategori, dan promo cart-wide.
          </p>
        </div>
        <Button variant="brand" onClick={() => setEditing({ ...EMPTY })}>
          <Plus className="h-4 w-4" /> Promo Baru
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-600">
          Belum ada promo. Buat yang pertama untuk mulai.
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((p) => (
            <li
              key={p.id}
              className={cn(
                'flex items-start gap-3 rounded-xl border bg-white p-4 dark:bg-gray-800',
                p.isActive
                  ? 'border-gray-200 dark:border-gray-700'
                  : 'border-gray-200 opacity-60 dark:border-gray-700',
              )}
            >
              {p.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  className="h-10 w-10 shrink-0 rounded-md object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                  {p.triggerType === 'code' ? (
                    <Tag className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                    {p.name}
                  </p>
                  {!p.isActive && (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      Nonaktif
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {scopeSubtitle(p)}
                  {' · '}
                  {p.discountType === 'percent'
                    ? `${p.discountValue}%`
                    : formatRupiah(p.discountValue)}
                </p>
                {(p.startsAt || p.endsAt) && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-500">
                    <Calendar className="h-3 w-3" />
                    {formatDateJakarta(p.startsAt)} → {formatDateJakarta(p.endsAt)}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      id: p.id,
                      name: p.name,
                      scope: scopeFromPromo(p),
                      code: p.code ?? '',
                      itemIds: p.itemTargets.map((t) => t.id),
                      categoryIds: p.categoryTargets.map((t) => t.id),
                      seedItems: p.itemTargets,
                      seedCategories: p.categoryTargets,
                      discountType: p.discountType as DiscountType,
                      discountValue: String(p.discountValue),
                      maxDiscountAmount:
                        p.maxDiscountAmount != null
                          ? String(p.maxDiscountAmount)
                          : '',
                      minCartTotal:
                        p.minCartTotal != null ? String(p.minCartTotal) : '',
                      startsAt: p.startsAt
                        ? new Date(p.startsAt).toISOString().slice(0, 16)
                        : '',
                      endsAt: p.endsAt
                        ? new Date(p.endsAt).toISOString().slice(0, 16)
                        : '',
                      totalRedemptionCap:
                        p.totalRedemptionCap != null
                          ? String(p.totalRedemptionCap)
                          : '',
                      perCustomerCap:
                        p.perCustomerCap != null
                          ? String(p.perCustomerCap)
                          : '',
                      isActive: p.isActive,
                      imageDataUrl: null,
                      existingImageUrl: p.imageUrl ?? null,
                      removeImage: false,
                    })
                  }
                  className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {p.isActive && (
                  <button
                    type="button"
                    onClick={() => setDeactivateId(p.id)}
                    className="rounded-md p-2 text-gray-500 hover:bg-warning-50 hover:text-warning-700 dark:hover:bg-warning-900/20"
                    aria-label="Nonaktifkan"
                  >
                    <Power className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Sheet open={true} onClose={() => setEditing(null)}>
          <SheetHeader onClose={() => setEditing(null)}>
            <SheetTitle>{editing.id ? 'Edit Promo' : 'Promo Baru'}</SheetTitle>
            <SheetDescription>
              Pilih cakupan promo + diskon + window aktif. Cap redemption opsional.
            </SheetDescription>
          </SheetHeader>
          <PromoForm
            value={editing}
            onChange={setEditing}
            onSubmit={(v) => saveMut.mutate(v)}
            onCancel={() => setEditing(null)}
            loading={saveMut.isPending}
          />
        </Sheet>
      )}

      <ConfirmDialog
        open={!!deactivateId}
        title="Nonaktifkan promo?"
        description="Promo bisa diaktifkan ulang nanti dari daftar. Transaksi yang sudah pakai promo ini tetap tercatat."
        confirmText="Nonaktifkan"
        cancelText="Batal"
        variant="danger"
        onConfirm={() => deactivateId && deactivateMut.mutate(deactivateId)}
        onCancel={() => setDeactivateId(null)}
        loading={deactivateMut.isPending}
      />
    </div>
  )
}

/** List-row subtitle: "Kode: HEMAT20" / "Roti Canai Coklat" / "5 produk" / etc. */
function scopeSubtitle(p: {
  triggerType: string
  code: string | null
  itemTargets: Array<{ id: string; name: string }>
  categoryTargets: Array<{ id: string; name: string }>
}): string {
  if (p.triggerType === 'code' && p.code) return `Kode: ${p.code}`
  if (p.triggerType === 'auto_cart') return 'Auto · semua produk'
  if (p.triggerType === 'auto_category') {
    const names = p.categoryTargets.map((t) => t.name)
    if (names.length === 0) return 'Auto · kategori'
    if (names.length <= 2) return `Kategori: ${names.join(', ')}`
    return `Kategori: ${names.slice(0, 2).join(', ')} + ${names.length - 2} lainnya`
  }
  // auto_product (legacy) + auto_products
  const names = p.itemTargets.map((t) => t.name)
  if (names.length === 0) return 'Auto · per produk'
  if (names.length === 1) return `Auto · ${names[0]}`
  if (names.length <= 2) return `Auto · ${names.join(' + ')}`
  return `Auto · ${names.slice(0, 2).join(' + ')} + ${names.length - 2} lainnya`
}

function PromoForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  loading,
}: {
  value: FormValues
  onChange: (v: FormValues) => void
  onSubmit: (v: FormValues) => void
  onCancel: () => void
  loading: boolean
}) {
  // Live preview against a reference Rp 100k cart so the owner can
  // sanity-check the math at form time.
  const previewCart = 100000
  const dv = parseFloat(value.discountValue || '0')
  const max = parseFloat(value.maxDiscountAmount || '0')
  let previewAmount = 0
  if (dv > 0) {
    previewAmount =
      value.discountType === 'percent'
        ? Math.round((previewCart * dv) / 100)
        : Math.min(dv, previewCart)
    if (max > 0 && previewAmount > max) previewAmount = max
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(value)
  }

  const previewSrc = value.removeImage
    ? null
    : (value.imageDataUrl ?? value.existingImageUrl)

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      onChange({
        ...value,
        imageDataUrl: typeof reader.result === 'string' ? reader.result : null,
        removeImage: false,
      })
    }
    reader.readAsDataURL(file)
  }

  function handleRemoveImage() {
    onChange({
      ...value,
      imageDataUrl: null,
      removeImage: !!value.existingImageUrl,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Banner Promo (opsional)
          </label>
          {previewSrc ? (
            <div className="relative inline-block">
              <img
                src={previewSrc}
                alt="Preview banner promo"
                className="h-32 max-w-full rounded-lg border border-gray-200 object-cover dark:border-gray-700"
              />
              <button
                type="button"
                onClick={handleRemoveImage}
                className="absolute -right-2 -top-2 rounded-full bg-white p-1 text-gray-500 shadow ring-1 ring-gray-200 hover:text-red-600 dark:bg-gray-800 dark:ring-gray-700"
                aria-label="Hapus banner"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
              <ImagePlus className="h-6 w-6" />
              <span>Klik untuk pilih gambar</span>
              <span className="text-[11px] text-gray-400">
                JPG/PNG/WebP, maks 2 MB
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFilePick}
                className="sr-only"
              />
            </label>
          )}
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            Kalau diisi, AI WhatsApp akan kirim gambar ini saat menyebut promo.
          </p>
        </div>

        <Input
          label="Nama promo"
          placeholder="cth. Promo Lebaran 2026"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          required
        />

        <ScopeField value={value} onChange={onChange} />

        {value.scope === 'code' && (
          <Input
            label="Kode"
            placeholder="HEMAT20"
            value={value.code}
            onChange={(e) =>
              onChange({ ...value, code: e.target.value.toUpperCase() })
            }
            required
          />
        )}

        {(value.scope === 'product' || value.scope === 'multi_product') && (
          <ProductTargetPicker
            scope={value.scope}
            itemIds={value.itemIds}
            seedItems={value.seedItems}
            onChange={(ids, seed) =>
              onChange({ ...value, itemIds: ids, seedItems: seed })
            }
          />
        )}

        {value.scope === 'category' && (
          <CategoryTargetPicker
            categoryIds={value.categoryIds}
            seedCategories={value.seedCategories}
            onChange={(ids, seed) =>
              onChange({ ...value, categoryIds: ids, seedCategories: seed })
            }
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Tipe diskon"
            value={value.discountType}
            onChange={(e) =>
              onChange({
                ...value,
                discountType: e.target.value as DiscountType,
              })
            }
            options={[
              { value: 'percent', label: 'Persen (%)' },
              { value: 'fixed', label: 'Fixed Rupiah' },
            ]}
          />
          <Input
            label={value.discountType === 'percent' ? 'Persen' : 'Nilai (Rp)'}
            type="number"
            min={0}
            max={value.discountType === 'percent' ? 100 : undefined}
            step="any"
            value={value.discountValue}
            onChange={(e) =>
              onChange({ ...value, discountValue: e.target.value })
            }
            required
          />
        </div>

        {value.discountType === 'percent' && (
          <Input
            label="Maks diskon (Rp, opsional)"
            type="number"
            min={0}
            value={value.maxDiscountAmount}
            onChange={(e) =>
              onChange({ ...value, maxDiscountAmount: e.target.value })
            }
            placeholder="cth. 50000 (= maks Rp 50k)"
          />
        )}

        <Input
          label="Minimal belanja (Rp, opsional)"
          type="number"
          min={0}
          value={value.minCartTotal}
          onChange={(e) => onChange({ ...value, minCartTotal: e.target.value })}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Mulai (opsional)"
            type="datetime-local"
            value={value.startsAt}
            onChange={(e) => onChange({ ...value, startsAt: e.target.value })}
          />
          <Input
            label="Berakhir (opsional)"
            type="datetime-local"
            value={value.endsAt}
            onChange={(e) => onChange({ ...value, endsAt: e.target.value })}
          />
        </div>

        {value.scope === 'code' && (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Kuota total (opsional)"
              type="number"
              min={1}
              value={value.totalRedemptionCap}
              onChange={(e) =>
                onChange({ ...value, totalRedemptionCap: e.target.value })
              }
              placeholder="cth. 100"
            />
            <Input
              label="Per pelanggan (opsional)"
              type="number"
              min={1}
              value={value.perCustomerCap}
              onChange={(e) =>
                onChange({ ...value, perCustomerCap: e.target.value })
              }
              placeholder="cth. 1"
            />
          </div>
        )}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.isActive}
            onChange={(e) => onChange({ ...value, isActive: e.target.checked })}
            className="rounded border-gray-300"
          />
          <span className="text-sm">Aktif</span>
        </label>

        <div className="rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:bg-brand-900/20 dark:text-brand-300">
          Pratinjau: belanja Rp 100.000 → diskon{' '}
          <strong>{formatRupiah(previewAmount)}</strong>.
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" variant="brand" loading={loading}>
          Simpan
        </Button>
      </div>
    </form>
  )
}

const SCOPE_OPTIONS: Array<{ value: Scope; label: string; hint: string }> = [
  { value: 'code', label: 'Kode promo', hint: 'Customer ketik kode saat checkout' },
  { value: 'product', label: 'Satu produk', hint: 'Apply otomatis saat produk masuk cart' },
  { value: 'multi_product', label: 'Beberapa produk', hint: 'Apply untuk kumpulan produk' },
  { value: 'category', label: 'Kategori', hint: 'Apply ke produk dalam kategori tertentu' },
  { value: 'cart', label: 'Semua (cart-wide)', hint: 'Apply otomatis ke total belanja' },
]

function ScopeField({
  value,
  onChange,
}: {
  value: FormValues
  onChange: (v: FormValues) => void
}) {
  // When switching scope, drop the picks from the previous scope so a
  // save can't smuggle in stale itemIds for a now-cart-wide promo.
  function handleScopeChange(next: Scope) {
    onChange({
      ...value,
      scope: next,
      itemIds:
        next === 'product' || next === 'multi_product' ? value.itemIds : [],
      categoryIds: next === 'category' ? value.categoryIds : [],
    })
  }
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Cakupan
      </label>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {SCOPE_OPTIONS.map((opt) => {
          const active = opt.value === value.scope
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleScopeChange(opt.value)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                active
                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-900/20 dark:ring-brand-800'
                  : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800',
              )}
            >
              <p
                className={cn(
                  'font-medium',
                  active
                    ? 'text-brand-700 dark:text-brand-300'
                    : 'text-gray-900 dark:text-gray-100',
                )}
              >
                {opt.label}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                {opt.hint}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ProductTargetPicker({
  scope,
  itemIds,
  seedItems,
  onChange,
}: {
  scope: 'product' | 'multi_product'
  itemIds: string[]
  seedItems: Array<{ id: string; name: string }>
  onChange: (
    ids: string[],
    seed: Array<{ id: string; name: string }>,
  ) => void
}) {
  // Debounced server-side search — the picker calls onSearchChange on
  // every keystroke; we flush after 250ms so a fast typist doesn't fire
  // a query per character.
  const [query, setQuery] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250)
    return () => clearTimeout(t)
  }, [query])

  const search = useQuery({
    queryKey: ['promo', 'sellable-products', debounced],
    queryFn: () =>
      listSellablePromoProducts({ data: { search: debounced || undefined } }),
    staleTime: 30 * 1000,
  })

  // Combine seed (already-picked from listPromotions) with the fresh
  // search hits so chip labels render correctly even before search
  // returns. Dedupe by id; seed wins for name.
  const options = React.useMemo(() => {
    const byId = new Map<string, { id: string; name: string; hint?: string }>()
    for (const it of seedItems) byId.set(it.id, { id: it.id, name: it.name })
    for (const r of search.data ?? []) {
      const hintParts: string[] = []
      if (r.sku) hintParts.push(r.sku)
      if (r.categoryName) hintParts.push(r.categoryName)
      byId.set(r.id, {
        id: r.id,
        name: r.name,
        hint: hintParts.join(' · ') || undefined,
      })
    }
    return Array.from(byId.values()).map((o) => ({
      value: o.id,
      label: o.name,
      hint: o.hint,
    }))
  }, [seedItems, search.data])

  if (scope === 'product') {
    const value = itemIds[0] ?? ''
    return (
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Produk
        </label>
        <Combobox
          value={value}
          onChange={(id) => {
            if (!id) {
              onChange([], seedItems)
              return
            }
            const matched = options.find((o) => o.value === id)
            const nextSeed = matched
              ? [{ id: matched.value, name: matched.label }]
              : seedItems
            onChange([id], nextSeed)
          }}
          options={options}
          placeholder="Pilih produk"
          searchPlaceholder="Cari produk…"
          onSearchChange={setQuery}
          loading={search.isFetching}
        />
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          Hanya produk yang aktif & bisa dijual yang muncul.
        </p>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Produk (beberapa)
      </label>
      <MultiCombobox
        values={itemIds}
        onChange={(ids) => {
          // Persist the latest name for each picked id into seed so chip
          // labels survive an option-list swap from a fresh search.
          const seedById = new Map(seedItems.map((s) => [s.id, s]))
          for (const o of options) {
            if (ids.includes(o.value)) {
              seedById.set(o.value, { id: o.value, name: o.label })
            }
          }
          const nextSeed = ids
            .map((id) => seedById.get(id))
            .filter((s): s is { id: string; name: string } => !!s)
          onChange(ids, nextSeed)
        }}
        options={options}
        placeholder="Pilih produk…"
        searchPlaceholder="Cari produk…"
        onSearchChange={setQuery}
        loading={search.isFetching}
        maxSelection={200}
      />
      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
        Pilih satu atau beberapa produk yang dapat promo ini.
      </p>
    </div>
  )
}

function CategoryTargetPicker({
  categoryIds,
  seedCategories,
  onChange,
}: {
  categoryIds: string[]
  seedCategories: Array<{ id: string; name: string }>
  onChange: (
    ids: string[],
    seed: Array<{ id: string; name: string }>,
  ) => void
}) {
  const list = useQuery({
    queryKey: ['promo', 'categories'],
    queryFn: () => listPromoCategories(),
    staleTime: 10 * 60 * 1000,
  })

  const options = React.useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>()
    for (const it of seedCategories) byId.set(it.id, it)
    for (const r of list.data ?? []) byId.set(r.id, r)
    return Array.from(byId.values()).map((o) => ({
      value: o.id,
      label: o.name,
    }))
  }, [seedCategories, list.data])

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Kategori
      </label>
      <MultiCombobox
        values={categoryIds}
        onChange={(ids) => {
          const seedById = new Map(seedCategories.map((s) => [s.id, s]))
          for (const o of options) {
            if (ids.includes(o.value)) {
              seedById.set(o.value, { id: o.value, name: o.label })
            }
          }
          const nextSeed = ids
            .map((id) => seedById.get(id))
            .filter((s): s is { id: string; name: string } => !!s)
          onChange(ids, nextSeed)
        }}
        options={options}
        placeholder="Pilih kategori…"
        searchPlaceholder="Cari kategori…"
        loading={list.isFetching}
      />
      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
        Promo akan apply ke semua produk dalam kategori yang dipilih.
      </p>
    </div>
  )
}
