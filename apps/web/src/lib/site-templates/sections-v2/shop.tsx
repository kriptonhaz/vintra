/**
 * Shop (Toko Online) — public storefront section.
 *
 * Self-contained: fetches its own catalog + config via getStorefront
 * (keyed by the tenant's public slug from `data.tenant.publicSlug`),
 * keeps the cart in a module-level store, and renders a fixed-position
 * cart drawer that walks cart → checkout → confirmation. Nothing here
 * touches the cached public-site data pipeline.
 *
 * In the editor preview (`isEditorPreview`) the catalog renders so the
 * tenant can see the layout, but the floating cart + add-to-cart are
 * disabled (no real shopping inside the editor).
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ShoppingCart,
  X,
  Plus,
  Minus,
  Trash2,
  Check,
  Loader2,
  Search,
} from 'lucide-react'
import { formatRupiah } from '@/lib/currency'
import { useCart, cartLineKey } from '@/lib/storefront/cart-store'
import {
  getStorefront,
  validateStorefrontPromo,
  placeOrder,
  trackOrder,
} from '@/server/functions/storefront'
import type { SectionDef, SectionRenderProps } from '../v2-types'
import { resolveSectionBg, BG_COLOR_FIELD } from './section-bg'

const TRACK_STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu pembayaran',
  confirmed: 'Pembayaran dikonfirmasi',
  ready: 'Siap diambil',
  shipped: 'Sedang dikirim',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tunai (bayar di tempat)',
  qris: 'QRIS',
  transfer: 'Transfer Bank',
  card: 'Kartu',
  ewallet: 'E-Wallet',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
  ovo: 'OVO',
}

type Storefront = NonNullable<Awaited<ReturnType<typeof getStorefront>>>
type StoreProduct = Storefront['products'][number]

/** Page numbers to render — windowed with `null` gaps for ellipsis. */
function pageWindow(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i)
  const pages = new Set([0, total - 1, current])
  if (current > 0) pages.add(current - 1)
  if (current < total - 1) pages.add(current + 1)
  const sorted = [...pages].sort((a, b) => a - b)
  const out: Array<number | null> = []
  let prev = -1
  for (const p of sorted) {
    if (prev !== -1 && p - prev > 1) out.push(null)
    out.push(p)
    prev = p
  }
  return out
}

function ShopRender({ data, settings, theme, isEditorPreview }: SectionRenderProps) {
  const slug = data.tenant.publicSlug
  const heading = (settings.heading as string)?.trim() || 'Belanja Online'

  const { data: store, isLoading } = useQuery({
    queryKey: ['storefront', slug],
    queryFn: () => getStorefront({ data: { slug: slug as string } }),
    enabled: !!slug,
    staleTime: 60_000,
  })

  const cart = useCart(slug ?? '')
  const [trackOpen, setTrackOpen] = useState(false)
  const [pickerProduct, setPickerProduct] = useState<StoreProduct | null>(null)
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const showSearch = settings.showSearch !== false
  const showCategories = settings.showCategories !== false
  // Desktop column count — mobile stays at 2. Mirrors the Services
  // section. Default 4 (retail catalogs are usually dense).
  const gridColumns = (() => {
    const v = String(settings.gridColumns ?? '4')
    return v === '2' || v === '3' ? v : '4'
  })()
  const gridColsClass =
    gridColumns === '2'
      ? ''
      : gridColumns === '3'
        ? 'lg:grid-cols-3'
        : 'lg:grid-cols-3 xl:grid-cols-4'
  const paginationEnabled = settings.paginationEnabled === true
  const pageSize = (() => {
    const n = Number(settings.itemsPerPage)
    return n === 12 || n === 48 ? n : 24
  })()

  // Reset to the first page whenever the search/category filter changes
  // so the visitor isn't stranded on a now-empty page.
  useEffect(() => {
    setPage(0)
  }, [query, activeCategory])

  // Live site hides the whole section when the store is off; the editor
  // preview still shows the catalog (with a hint) so layout is visible.
  if (!slug) return null
  if (!isEditorPreview && store && !store.enabled) return null

  // Catalog filtering (client-side). Categories come from the products'
  // own category names; the active filter + search query narrow the grid.
  const products = store?.products ?? []
  const categories = Array.from(
    new Set(products.map((p) => p.category).filter((c): c is string => !!c)),
  ).sort((a, b) => a.localeCompare(b, 'id'))
  const q = query.trim().toLowerCase()
  const filtered = products.filter(
    (p) =>
      (activeCategory == null || p.category === activeCategory) &&
      (q === '' || p.name.toLowerCase().includes(q)),
  )

  // Pagination over the filtered list. `safePage` clamps in case the
  // filter shrank the result below the current page.
  const totalPages = paginationEnabled
    ? Math.max(1, Math.ceil(filtered.length / pageSize))
    : 1
  const safePage = Math.min(page, totalPages - 1)
  const visible = paginationEnabled
    ? filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)
    : filtered

  const goToPage = (p: number) => {
    setPage(p)
    if (typeof document !== 'undefined') {
      document
        .getElementById('shop')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const bg = resolveSectionBg(settings, 'bg-white dark:bg-gray-900')

  return (
    <section
      id="shop"
      className={`py-12 sm:py-16 lg:py-20 ${bg.className}`}
      style={bg.style}
      data-section-surface={bg.surface}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 text-center sm:mb-10">
          <div
            className="mx-auto mb-3 h-1 w-12 rounded-full sm:mb-4"
            style={{ backgroundColor: theme.brandColor }}
          />
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl lg:text-4xl dark:text-gray-100">
            {heading}
          </h2>
          {isEditorPreview && store && !store.enabled && (
            <p className="mt-2 text-xs italic text-amber-600">
              Toko online belum aktif — aktifkan di Situs → Toko Online.
            </p>
          )}
          {!isEditorPreview && store?.enabled && (
            <button
              type="button"
              onClick={() => setTrackOpen(true)}
              className="mt-3 text-sm font-medium underline"
              style={{ color: theme.brandColor }}
            >
              Lacak pesanan
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/4] animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800"
              />
            ))}
          </div>
        ) : !store || store.products.length === 0 ? (
          <p className="text-center text-sm text-gray-500">
            Belum ada produk yang dijual online.
          </p>
        ) : (
          <>
            {(showSearch || (showCategories && categories.length > 0)) && (
              <div className="mb-6 space-y-4 sm:mb-8">
                {showSearch && (
                  <div className="relative mx-auto max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Cari produk…"
                      className="w-full rounded-full border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      style={{ ['--tw-ring-color' as string]: theme.brandColor }}
                    />
                  </div>
                )}
                {showCategories && categories.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {[null, ...categories].map((c) => {
                      const active = activeCategory === c
                      return (
                        <button
                          key={c ?? '__all__'}
                          type="button"
                          onClick={() => setActiveCategory(c)}
                          className="rounded-full border border-gray-300 px-3.5 py-1.5 text-sm font-medium transition hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-600"
                          style={
                            active
                              ? {
                                  backgroundColor: theme.brandColor,
                                  borderColor: theme.brandColor,
                                  color: '#fff',
                                }
                              : undefined
                          }
                        >
                          <span
                            className={
                              active
                                ? ''
                                : 'text-gray-600 dark:text-gray-300'
                            }
                          >
                            {c ?? 'Semua'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                Tidak ada produk yang cocok.
              </p>
            ) : (
              <>
              <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${gridColsClass}`}>
                {visible.map((p) => {
              const isVariant = p.hasVariants && p.variants.length > 0
              const inCart = cart.items
                .filter((i) => i.itemId === p.id)
                .reduce((n, i) => n + i.qty, 0)
              const soldOut = p.available != null && p.available <= 0
              const atMax =
                !isVariant && p.available != null && inCart >= p.available
              return (
                <div
                  key={p.id}
                  className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-gray-50 dark:bg-gray-800">
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        // Eager in the editor preview: inside the scaled
                        // (transform) preview frame, lazy-load's observer
                        // often never fires, leaving photos blank. Live
                        // site keeps lazy for performance.
                        loading={isEditorPreview ? 'eager' : 'lazy'}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div
                        className="h-full w-full opacity-20"
                        style={{ backgroundColor: theme.brandColor }}
                      />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col p-3">
                    <p className="text-sm font-semibold leading-tight text-gray-900 dark:text-gray-100">
                      {p.name}
                    </p>
                    <p
                      className="mt-1 text-base font-bold"
                      style={{ color: theme.brandColor }}
                    >
                      {isVariant
                        ? `mulai ${formatRupiah(Number(p.unitPrice))}`
                        : formatRupiah(Number(p.unitPrice))}
                    </p>
                    {soldOut ? (
                      <span className="mt-auto pt-2 text-xs font-medium text-gray-400">
                        Stok habis
                      </span>
                    ) : isVariant ? (
                      <button
                        type="button"
                        disabled={isEditorPreview}
                        onClick={() => setPickerProduct(p)}
                        className="mt-auto flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ backgroundColor: theme.brandColor }}
                      >
                        <Plus className="h-4 w-4" />
                        {inCart > 0 ? `Pilih variasi (${inCart})` : 'Pilih Variasi'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isEditorPreview || atMax}
                        onClick={() =>
                          cart.add(
                            {
                              itemId: p.id,
                              variantId: null,
                              variantLabel: null,
                              name: p.name,
                              unitPrice: Number(p.unitPrice),
                              imageUrl: p.imageUrl,
                              maxQty: p.available,
                              weightGrams: p.weightGrams,
                            },
                            1,
                          )
                        }
                        className="mt-auto flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ backgroundColor: theme.brandColor }}
                      >
                        <Plus className="h-4 w-4" />
                        {inCart > 0 ? `Keranjang (${inCart})` : 'Keranjang'}
                      </button>
                    )}
                  </div>
                </div>
              )
                })}
              </div>
              {paginationEnabled && totalPages > 1 && (
                <nav
                  className="mt-8 flex items-center justify-center gap-1.5"
                  aria-label="Navigasi halaman"
                >
                  <button
                    type="button"
                    onClick={() => goToPage(safePage - 1)}
                    disabled={safePage === 0}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Sebelumnya
                  </button>
                  {pageWindow(safePage, totalPages).map((p, idx) =>
                    p === null ? (
                      <span
                        key={`gap-${idx}`}
                        className="px-2 text-sm text-gray-400"
                      >
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => goToPage(p)}
                        aria-current={p === safePage ? 'page' : undefined}
                        className={`min-w-9 rounded-lg px-3 py-2 text-sm font-medium transition ${
                          p === safePage
                            ? 'text-white'
                            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}
                        style={
                          p === safePage
                            ? { backgroundColor: theme.brandColor }
                            : undefined
                        }
                      >
                        {p + 1}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={() => goToPage(safePage + 1)}
                    disabled={safePage === totalPages - 1}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Berikutnya
                  </button>
                </nav>
              )}
              </>
            )}
          </>
        )}
      </div>

      {!isEditorPreview && store?.enabled && (
        <CartWidget slug={slug} store={store} brandColor={theme.brandColor} />
      )}
      {trackOpen && (
        <TrackModal
          slug={slug}
          brandColor={theme.brandColor}
          onClose={() => setTrackOpen(false)}
        />
      )}
      {pickerProduct && !isEditorPreview && (
        <VariantPicker
          product={pickerProduct}
          slug={slug}
          brandColor={theme.brandColor}
          onClose={() => setPickerProduct(null)}
        />
      )}
    </section>
  )
}

// ─── Variant picker modal ──────────────────────────────────────────

function VariantPicker({
  product,
  slug,
  brandColor,
  onClose,
}: {
  product: StoreProduct
  slug: string
  brandColor: string
  onClose: () => void
}) {
  const cart = useCart(slug)
  const dims = product.variantConfig?.dims ?? []
  const [sel, setSel] = useState<(string | null)[]>(() => dims.map(() => null))
  const [qty, setQty] = useState(1)

  const allPicked = dims.every((_, i) => sel[i] != null)
  const variant = allPicked
    ? product.variants.find(
        (v) =>
          v.value1 === sel[0] && (dims.length < 2 || v.value2 === (sel[1] ?? '')),
      )
    : undefined
  const available = variant?.available ?? null
  const outOfStock = variant != null && available != null && available <= 0
  const maxQty = available ?? null
  const canAdd = !!variant && !outOfStock

  function add() {
    if (!variant) return
    cart.add(
      {
        itemId: product.id,
        variantId: variant.id,
        variantLabel: variant.label,
        name: product.name,
        unitPrice: variant.price,
        imageUrl: product.imageUrl,
        maxQty: variant.available,
        weightGrams: product.weightGrams,
      },
      Math.max(1, qty),
    )
    onClose()
  }

  const priceText = variant
    ? formatRupiah(variant.price)
    : `mulai ${formatRupiah(Number(product.unitPrice))}`

  return (
    <div
      className="fixed inset-0 z-[960] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {product.imageUrl && (
              <img
                src={product.imageUrl}
                alt={product.name}
                className="h-16 w-16 shrink-0 rounded-lg object-contain"
              />
            )}
            <div>
              <h3 className="font-bold text-gray-900 dark:text-gray-100">
                {product.name}
              </h3>
              <p className="text-sm font-semibold" style={{ color: brandColor }}>
                {priceText}
              </p>
              {variant && available != null && (
                <p className="text-xs text-gray-500">
                  {outOfStock ? 'Stok habis' : `Stok: ${available}`}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {dims.map((dim, di) => (
            <div key={di}>
              <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {dim.name}
              </p>
              <div className="flex flex-wrap gap-2">
                {dim.values.map((val) => {
                  const active = sel[di] === val
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() =>
                        setSel((prev) =>
                          prev.map((x, i) => (i === di ? val : x)),
                        )
                      }
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium transition hover:border-gray-400 dark:border-gray-600"
                      style={
                        active
                          ? {
                              backgroundColor: brandColor,
                              borderColor: brandColor,
                              color: '#fff',
                            }
                          : undefined
                      }
                    >
                      {val}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {allPicked && !variant && (
            <p className="text-sm text-gray-500">Kombinasi tidak tersedia.</p>
          )}

          {/* Quantity */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Jumlah
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 dark:border-gray-600"
                aria-label="Kurangi"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-sm tabular-nums">{qty}</span>
              <button
                type="button"
                onClick={() =>
                  setQty((q) => (maxQty != null ? Math.min(maxQty, q + 1) : q + 1))
                }
                disabled={maxQty != null && qty >= maxQty}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 disabled:opacity-40 dark:border-gray-600"
                aria-label="Tambah"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={add}
            disabled={!canAdd}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: brandColor }}
          >
            <Plus className="h-4 w-4" />
            {!allPicked
              ? 'Pilih variasi dulu'
              : outOfStock
                ? 'Stok habis'
                : 'Tambah ke Keranjang'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Track-order modal (lookup by order number + phone) ────────────

function TrackModal({
  slug,
  brandColor,
  onClose,
}: {
  slug: string
  brandColor: string
  onClose: () => void
}) {
  const [orderNumber, setOrderNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<
    Awaited<ReturnType<typeof trackOrder>> | null
  >(null)

  async function lookup() {
    if (!orderNumber.trim() || !phone.trim()) return
    setLoading(true)
    setResult(null)
    try {
      setResult(
        await trackOrder({
          data: { slug, orderNumber: orderNumber.trim(), phone: phone.trim() },
        }),
      )
    } catch {
      setResult({ found: false })
    } finally {
      setLoading(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800'

  return (
    <div className="fixed inset-0 z-[960] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Lacak Pesanan
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <input
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="No. pesanan (ORD-…)"
            className={inputCls}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Nomor WhatsApp"
            className={inputCls}
          />
          <button
            type="button"
            onClick={lookup}
            disabled={loading || !orderNumber.trim() || !phone.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: brandColor }}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Cek status
          </button>
        </div>

        {result && (
          <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
            {!result.found ? (
              <p className="text-center text-sm text-gray-500">
                Pesanan tidak ditemukan. Periksa nomor pesanan & WhatsApp.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {result.orderNumber}
                  </span>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: brandColor }}
                  >
                    {TRACK_STATUS_LABEL[result.status] ?? result.status}
                  </span>
                </div>
                <ul className="space-y-1 text-sm">
                  {result.items.map((i, idx) => (
                    <li key={idx} className="flex justify-between">
                      <span className="text-gray-700 dark:text-gray-300">
                        {i.name}
                        {i.variantLabel ? ` (${i.variantLabel})` : ''} ×{i.qty}
                      </span>
                      <span className="tabular-nums">{formatRupiah(i.subtotal)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-bold dark:border-gray-800">
                  <span>Total</span>
                  <span className="tabular-nums">{formatRupiah(result.total)}</span>
                </div>
                {result.trackingNumber && (
                  <p className="rounded-lg bg-gray-50 p-2 text-sm dark:bg-gray-800">
                    {result.courierName ? `${result.courierName} — ` : ''}Resi:{' '}
                    <span className="font-medium tabular-nums">
                      {result.trackingNumber}
                    </span>
                  </p>
                )}
                {result.status === 'cancelled' && result.cancelReason && (
                  <p className="text-xs italic text-gray-500">
                    Alasan: {result.cancelReason}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Floating cart button + drawer ─────────────────────────────────

type DrawerView = 'cart' | 'checkout' | 'done'

function CartWidget({
  slug,
  store,
  brandColor,
}: {
  slug: string
  store: Storefront
  brandColor: string
}) {
  const cart = useCart(slug)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<DrawerView>('cart')

  // Promo state.
  const [promoInput, setPromoInput] = useState('')
  const [promo, setPromo] = useState<{ code: string; amount: number } | null>(
    null,
  )
  const [promoMsg, setPromoMsg] = useState<string | null>(null)
  const [promoChecking, setPromoChecking] = useState(false)

  // Checkout form.
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>(
    store.shipping.deliveryEnabled ? 'delivery' : 'pickup',
  )
  const [address, setAddress] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState(
    store.payment.methods[0] ?? '',
  )
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)
  const [done, setDone] = useState<Awaited<ReturnType<typeof placeOrder>> | null>(
    null,
  )

  // Totals.
  const subtotal = cart.subtotal
  const promoAmount = promo ? Math.min(promo.amount, subtotal) : 0
  const taxBase = Math.max(0, subtotal - promoAmount)
  const taxAmount = store.tax.apply
    ? store.tax.lines.reduce(
        (s, t) => s + Math.round((taxBase * t.percent) / 100),
        0,
      )
    : 0
  const selectedZone = store.shipping.zones.find((z) => z.id === zoneId)
  const shippingFee =
    fulfillment === 'pickup'
      ? 0
      : selectedZone
        ? selectedZone.fee
        : store.shipping.flatFee
  const total = taxBase + taxAmount + shippingFee

  async function applyPromo() {
    if (!promoInput.trim()) return
    setPromoChecking(true)
    setPromoMsg(null)
    try {
      const res = await validateStorefrontPromo({
        data: { slug, code: promoInput.trim(), subtotal },
      })
      if (res.valid) {
        setPromo({ code: res.code, amount: res.amount })
        setPromoMsg(`Promo "${res.name}" diterapkan`)
      } else {
        setPromo(null)
        setPromoMsg(res.message)
      }
    } catch {
      setPromoMsg('Gagal memeriksa promo')
    } finally {
      setPromoChecking(false)
    }
  }

  async function submit() {
    setSubmitErr(null)
    if (!name.trim() || !phone.trim()) {
      setSubmitErr('Nama dan nomor WhatsApp wajib diisi')
      return
    }
    if (fulfillment === 'delivery' && !address.trim()) {
      setSubmitErr('Alamat pengiriman wajib diisi')
      return
    }
    if (!paymentMethod) {
      setSubmitErr('Pilih metode pembayaran')
      return
    }
    setSubmitting(true)
    try {
      const res = await placeOrder({
        data: {
          slug,
          fulfillmentType: fulfillment,
          customerName: name,
          customerPhone: phone,
          items: cart.items.map((i) => ({
            itemId: i.itemId,
            variantId: i.variantId,
            qty: i.qty,
          })),
          shippingRecipient: fulfillment === 'delivery' ? name : null,
          shippingPhone: fulfillment === 'delivery' ? phone : null,
          shippingAddress: fulfillment === 'delivery' ? address : null,
          shippingZoneId: fulfillment === 'delivery' && zoneId ? zoneId : null,
          promoCode: promo?.code ?? null,
          paymentMethod,
          customerNote: note.trim() || null,
        },
      })
      setDone(res)
      setView('done')
      cart.clear()
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : 'Gagal membuat pesanan')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          if (view === 'done') setView('cart')
        }}
        className="fixed bottom-5 right-5 z-[900] flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition hover:scale-105"
        style={{ backgroundColor: brandColor }}
        aria-label="Buka keranjang"
      >
        <ShoppingCart className="h-6 w-6" />
        {cart.count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">
            {cart.count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[950] flex justify-end" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-gray-900">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {view === 'cart'
                  ? 'Keranjang'
                  : view === 'checkout'
                    ? 'Checkout'
                    : 'Pesanan Dibuat'}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Tutup"
                className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {view === 'cart' && (
                <CartView
                  cart={cart}
                  brandColor={brandColor}
                  promoInput={promoInput}
                  setPromoInput={setPromoInput}
                  applyPromo={applyPromo}
                  promo={promo}
                  promoMsg={promoMsg}
                  promoChecking={promoChecking}
                  clearPromo={() => {
                    setPromo(null)
                    setPromoMsg(null)
                    setPromoInput('')
                  }}
                />
              )}

              {view === 'checkout' && (
                <CheckoutView
                  store={store}
                  name={name}
                  setName={setName}
                  phone={phone}
                  setPhone={setPhone}
                  fulfillment={fulfillment}
                  setFulfillment={setFulfillment}
                  address={address}
                  setAddress={setAddress}
                  zoneId={zoneId}
                  setZoneId={setZoneId}
                  paymentMethod={paymentMethod}
                  setPaymentMethod={setPaymentMethod}
                  note={note}
                  setNote={setNote}
                />
              )}

              {view === 'done' && done && (
                <DoneView done={done} brandColor={brandColor} />
              )}
            </div>

            {/* Footer */}
            {view !== 'done' && cart.items.length > 0 && (
              <div className="border-t border-gray-200 px-5 py-4 dark:border-gray-700">
                <TotalsRows
                  subtotal={subtotal}
                  promoAmount={promoAmount}
                  taxAmount={taxAmount}
                  shippingFee={fulfillment === 'pickup' ? null : shippingFee}
                  total={total}
                />
                {submitErr && (
                  <p className="mt-2 text-xs text-red-600">{submitErr}</p>
                )}
                {view === 'cart' ? (
                  <button
                    type="button"
                    onClick={() => setView('checkout')}
                    className="mt-3 w-full rounded-lg px-4 py-3 text-sm font-semibold text-white"
                    style={{ backgroundColor: brandColor }}
                  >
                    Lanjut ke Checkout
                  </button>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setView('cart')}
                      className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200"
                    >
                      Kembali
                    </button>
                    <button
                      type="button"
                      onClick={submit}
                      disabled={submitting}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                      style={{ backgroundColor: brandColor }}
                    >
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                      Buat Pesanan
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function CartView({
  cart,
  brandColor,
  promoInput,
  setPromoInput,
  applyPromo,
  promo,
  promoMsg,
  promoChecking,
  clearPromo,
}: {
  cart: ReturnType<typeof useCart>
  brandColor: string
  promoInput: string
  setPromoInput: (v: string) => void
  applyPromo: () => void
  promo: { code: string; amount: number } | null
  promoMsg: string | null
  promoChecking: boolean
  clearPromo: () => void
}) {
  if (cart.items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-gray-500">
        Keranjang masih kosong.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {cart.items.map((i) => (
        <div key={cartLineKey(i)} className="flex gap-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
            {i.imageUrl && (
              <img src={i.imageUrl} alt={i.name} className="h-full w-full object-contain" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {i.name}
            </p>
            {i.variantLabel && (
              <p className="truncate text-xs text-gray-500">{i.variantLabel}</p>
            )}
            <p className="text-sm font-semibold" style={{ color: brandColor }}>
              {formatRupiah(i.unitPrice)}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => cart.setQty(cartLineKey(i), i.qty - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 dark:border-gray-600"
                aria-label="Kurangi"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-6 text-center text-sm tabular-nums">{i.qty}</span>
              <button
                type="button"
                onClick={() => cart.setQty(cartLineKey(i), i.qty + 1)}
                disabled={i.maxQty != null && i.qty >= i.maxQty}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 disabled:opacity-40 dark:border-gray-600"
                aria-label="Tambah"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => cart.remove(cartLineKey(i))}
                className="ml-auto rounded-md p-1.5 text-gray-400 hover:text-red-600"
                aria-label="Hapus"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Promo */}
      <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
        {promo ? (
          <div className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 text-sm dark:bg-green-900/20">
            <span className="font-medium text-green-700 dark:text-green-300">
              Promo {promo.code} aktif
            </span>
            <button
              type="button"
              onClick={clearPromo}
              className="text-xs text-gray-500 underline"
            >
              Hapus
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                placeholder="Kode promo"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
              <button
                type="button"
                onClick={applyPromo}
                disabled={promoChecking || !promoInput.trim()}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-gray-600"
              >
                Pakai
              </button>
            </div>
            {promoMsg && (
              <p className="mt-1 text-xs text-gray-500">{promoMsg}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CheckoutView({
  store,
  name,
  setName,
  phone,
  setPhone,
  fulfillment,
  setFulfillment,
  address,
  setAddress,
  zoneId,
  setZoneId,
  paymentMethod,
  setPaymentMethod,
  note,
  setNote,
}: {
  store: Storefront
  name: string
  setName: (v: string) => void
  phone: string
  setPhone: (v: string) => void
  fulfillment: 'delivery' | 'pickup'
  setFulfillment: (v: 'delivery' | 'pickup') => void
  address: string
  setAddress: (v: string) => void
  zoneId: string
  setZoneId: (v: string) => void
  paymentMethod: string
  setPaymentMethod: (v: string) => void
  note: string
  setNote: (v: string) => void
}) {
  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800'
  const labelCls =
    'mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300'
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Nama</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Nomor WhatsApp</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0812xxxxxxx"
          className={inputCls}
        />
      </div>

      {store.shipping.deliveryEnabled && store.shipping.pickupEnabled && (
        <div className="flex gap-2">
          {(['delivery', 'pickup'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFulfillment(f)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                fulfillment === f
                  ? 'border-gray-900 dark:border-gray-100'
                  : 'border-gray-300 text-gray-600 dark:border-gray-600'
              }`}
            >
              {f === 'delivery' ? 'Kirim' : 'Ambil sendiri'}
            </button>
          ))}
        </div>
      )}

      {fulfillment === 'delivery' && (
        <>
          <div>
            <label className={labelCls}>Alamat pengiriman</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              className={inputCls}
            />
          </div>
          {store.shipping.zones.length > 0 && (
            <div>
              <label className={labelCls}>Zona ongkir</label>
              <select
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                className={inputCls}
              >
                <option value="">
                  Ongkir flat ({formatRupiah(store.shipping.flatFee)})
                </option>
                {store.shipping.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({formatRupiah(z.fee)})
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      <div>
        <label className={labelCls}>Metode pembayaran</label>
        <select
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className={inputCls}
        >
          {store.payment.methods.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_LABEL[m] ?? m}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>Catatan (opsional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={inputCls}
        />
      </div>
    </div>
  )
}

function DoneView({
  done,
  brandColor,
}: {
  done: NonNullable<Awaited<ReturnType<typeof placeOrder>>>
  brandColor: string
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: brandColor }}
        >
          <Check className="h-7 w-7" />
        </div>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          Pesanan kamu
        </p>
        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {done.orderNumber}
        </p>
        <p className="mt-1 text-lg font-semibold" style={{ color: brandColor }}>
          {formatRupiah(done.total)}
        </p>
      </div>

      {done.bankAccounts.length > 0 && (
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Transfer ke
          </p>
          <div className="space-y-2">
            {done.bankAccounts.map((b, i) => (
              <div key={i} className="text-sm">
                <p className="font-semibold text-gray-900 dark:text-gray-100">
                  {b.bankName}
                </p>
                <p className="tabular-nums text-gray-700 dark:text-gray-300">
                  {b.accountNumber}
                </p>
                <p className="text-xs text-gray-500">a.n. {b.accountHolder}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {done.checkoutNote && (
        <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {done.checkoutNote}
        </p>
      )}

      <p className="text-center text-xs text-gray-500">
        Simpan nomor pesanan untuk lacak status. Setelah bayar, konfirmasi lewat
        WhatsApp.
      </p>

      {done.waLink && (
        <a
          href={done.waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white"
        >
          <ShoppingCart className="h-4 w-4" />
          Konfirmasi via WhatsApp
        </a>
      )}
    </div>
  )
}

function TotalsRows({
  subtotal,
  promoAmount,
  taxAmount,
  shippingFee,
  total,
}: {
  subtotal: number
  promoAmount: number
  taxAmount: number
  shippingFee: number | null
  total: number
}) {
  const row = 'flex justify-between text-sm'
  return (
    <div className="space-y-1">
      <div className={row}>
        <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
        <span className="tabular-nums">{formatRupiah(subtotal)}</span>
      </div>
      {promoAmount > 0 && (
        <div className={row}>
          <span className="text-gray-600 dark:text-gray-400">Promo</span>
          <span className="tabular-nums text-green-600">
            −{formatRupiah(promoAmount)}
          </span>
        </div>
      )}
      {taxAmount > 0 && (
        <div className={row}>
          <span className="text-gray-600 dark:text-gray-400">Pajak</span>
          <span className="tabular-nums">{formatRupiah(taxAmount)}</span>
        </div>
      )}
      {shippingFee != null && (
        <div className={row}>
          <span className="text-gray-600 dark:text-gray-400">Ongkir</span>
          <span className="tabular-nums">{formatRupiah(shippingFee)}</span>
        </div>
      )}
      <div className="flex justify-between border-t border-gray-200 pt-1 text-base font-bold dark:border-gray-700">
        <span>Total</span>
        <span className="tabular-nums">{formatRupiah(total)}</span>
      </div>
    </div>
  )
}

export const shopSection: SectionDef = {
  type: 'shop',
  name: 'Toko Online',
  description: 'Katalog produk dengan keranjang & checkout (butuh Toko Online aktif).',
  icon: 'ShoppingCart',
  allowMultiple: false,
  defaultSettings: {
    heading: 'Belanja Online',
    showSearch: true,
    showCategories: true,
    gridColumns: '4',
    paginationEnabled: false,
    itemsPerPage: '24',
  },
  fields: [
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 60,
      default: 'Belanja Online',
    },
    {
      key: 'showSearch',
      type: 'toggle',
      label: 'Tampilkan pencarian produk',
      help: 'Kotak cari untuk memfilter produk berdasarkan nama.',
      default: true,
    },
    {
      key: 'showCategories',
      type: 'toggle',
      label: 'Tampilkan filter kategori',
      help: 'Tombol kategori (dari kategori inventaris) untuk menyaring produk. Otomatis tersembunyi jika produk belum punya kategori.',
      default: true,
    },
    {
      key: 'gridColumns',
      type: 'select',
      label: 'Jumlah kolom (desktop)',
      help: 'Mobile selalu 2 kolom. 4 kolom cocok untuk katalog dengan banyak produk.',
      options: [
        { value: '2', label: '2 kolom' },
        { value: '3', label: '3 kolom' },
        { value: '4', label: '4 kolom (default)' },
      ],
      default: '4',
    },
    {
      key: 'paginationEnabled',
      type: 'toggle',
      label: 'Aktifkan halaman (pagination)',
      help: 'Bagi katalog ke beberapa halaman bernomor. Cocok untuk toko dengan banyak produk.',
      default: false,
    },
    {
      key: 'itemsPerPage',
      type: 'select',
      label: 'Produk per halaman',
      help: 'Hanya berlaku saat pagination aktif.',
      options: [
        { value: '12', label: '12 produk' },
        { value: '24', label: '24 produk (default)' },
        { value: '48', label: '48 produk' },
      ],
      default: '24',
    },
    BG_COLOR_FIELD,
  ],
  Render: ShopRender,
}
