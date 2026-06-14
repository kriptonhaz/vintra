/**
 * Public storefront — product detail page at `<slug>.vintra.my.id/product/$id`.
 *
 * Host-resolved (same Host-header logic as the situs index route). On
 * the apex / unknown host it redirects to `/`. Themed by the tenant's
 * brand color, wrapped in `light-scope` so it always renders light
 * regardless of the visitor's OS dark preference.
 *
 * Phase 1 of the multi-page storefront. Add-to-cart writes to the same
 * per-slug localStorage cart the situs drawer uses; the cart link points
 * back to the store for now (a dedicated /cart page lands in Phase 2).
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeft, ShoppingCart, Plus, Minus, Check, Star } from 'lucide-react'
import { getStorefrontProduct } from '@/server/functions/storefront'
import { useCart } from '@/lib/storefront/cart-store'
import { formatRupiah } from '@/lib/currency'

export const Route = createFileRoute('/product/$id')({
  loader: async ({ params }) => {
    const res = await getStorefrontProduct({ data: { id: params.id } })
    // Apex / disabled store / missing item → bounce to the store root.
    if (!res) throw redirect({ to: '/' })
    return res
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { product, businessName } = loaderData
    const title = `${product.name} — ${businessName}`
    const desc =
      product.description?.slice(0, 160) ||
      `Beli ${product.name} di ${businessName}.`
    return {
      meta: [
        { title },
        { name: 'description', content: desc },
        { property: 'og:title', content: title },
        { property: 'og:description', content: desc },
        ...(product.imageUrl
          ? [{ property: 'og:image', content: product.imageUrl }]
          : []),
        { property: 'og:type', content: 'product' },
      ],
    }
  },
  component: ProductDetailPage,
})

type LoaderData = Awaited<ReturnType<typeof getStorefrontProduct>>
type Product = NonNullable<LoaderData>['product']

function ProductDetailPage() {
  const { slug, businessName, brandColor, product } = Route.useLoaderData()!
  const cart = useCart(slug)

  return (
    <div className="light-scope min-h-screen bg-white text-gray-900">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur">
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="max-w-[40vw] truncate">{businessName}</span>
        </a>
        <a
          href="/cart"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: brandColor }}
          aria-label="Keranjang"
        >
          <ShoppingCart className="h-4 w-4" />
          {cart.count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
              {cart.count}
            </span>
          )}
        </a>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="grid gap-6 sm:gap-10 lg:grid-cols-2">
          {/* Photo gallery */}
          <ProductGallery
            images={product.images}
            name={product.name}
            brandColor={brandColor}
          />

          {/* Details + buy box */}
          <ProductBuyBox
            slug={slug}
            product={product}
            brandColor={brandColor}
            cart={cart}
          />
        </div>

        {/* Reviews */}
        <ProductReviews
          ratingAvg={product.ratingAvg}
          reviewCount={product.reviewCount}
          reviews={product.reviews}
          brandColor={brandColor}
        />
      </main>

      <footer className="border-t border-gray-100 py-6 text-center text-xs text-gray-400">
        Powered by Vintra
      </footer>
    </div>
  )
}

function ProductGallery({
  images,
  name,
  brandColor,
}: {
  images: string[]
  name: string
  brandColor: string
}) {
  const [active, setActive] = useState(0)

  if (images.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl bg-gray-50">
        <div
          className="aspect-square w-full opacity-20"
          style={{ backgroundColor: brandColor }}
        />
      </div>
    )
  }

  const current = images[Math.min(active, images.length - 1)]
  return (
    <div>
      <div className="overflow-hidden rounded-2xl bg-gray-50">
        <img
          src={current}
          alt={name}
          className="aspect-square w-full object-contain"
        />
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 bg-gray-50 transition"
              style={{
                borderColor: i === active ? brandColor : 'transparent',
              }}
              aria-label={`Foto ${i + 1}`}
            >
              <img
                src={src}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ProductBuyBox({
  product,
  brandColor,
  cart,
}: {
  slug: string
  product: Product
  brandColor: string
  cart: ReturnType<typeof useCart>
}) {
  const dims = product.variantConfig?.dims ?? []
  const isVariant = product.hasVariants && product.variants.length > 0
  const [sel, setSel] = useState<(string | null)[]>(() => dims.map(() => null))
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)

  const allPicked = !isVariant || dims.every((_, i) => sel[i] != null)
  const variant = isVariant
    ? product.variants.find(
        (v) =>
          v.value1 === sel[0] && (dims.length < 2 || v.value2 === (sel[1] ?? '')),
      )
    : undefined

  // Effective price + stock: variant (if chosen) else the item itself.
  const price = isVariant
    ? (variant?.price ?? Number(product.unitPrice))
    : Number(product.unitPrice)
  const available = isVariant ? (variant?.available ?? null) : product.available
  const maxQty = available
  const outOfStock = available != null && available <= 0
  const canAdd = (!isVariant || !!variant) && !outOfStock

  function add() {
    cart.add(
      {
        itemId: product.id,
        variantId: variant?.id ?? null,
        variantLabel: variant?.label ?? null,
        name: product.name,
        unitPrice: price,
        imageUrl: product.imageUrl,
        maxQty: available,
        weightGrams: product.weightGrams,
      },
      Math.max(1, qty),
    )
    setAdded(true)
    setTimeout(() => setAdded(false), 2500)
  }

  return (
    <div>
      {product.category && (
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          {product.category}
        </p>
      )}
      <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
        {product.name}
      </h1>
      {product.reviewCount > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <Stars value={product.ratingAvg} />
          <span className="text-sm text-gray-500">
            {product.ratingAvg.toFixed(1)} · {product.reviewCount} ulasan
          </span>
        </div>
      )}
      <p className="mt-2 text-2xl font-bold" style={{ color: brandColor }}>
        {isVariant && !variant
          ? `mulai ${formatRupiah(Number(product.unitPrice))}`
          : formatRupiah(price)}
      </p>
      {available != null && (
        <p className="mt-1 text-sm text-gray-500">
          {outOfStock ? 'Stok habis' : `Stok: ${available}`}
        </p>
      )}

      {product.description && (
        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-gray-600">
          {product.description}
        </p>
      )}

      {/* Variant dimensions */}
      {isVariant && (
        <div className="mt-5 space-y-4">
          {dims.map((dim, di) => (
            <div key={di}>
              <p className="mb-1.5 text-sm font-medium text-gray-700">
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
                        setSel((prev) => prev.map((x, i) => (i === di ? val : x)))
                      }
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium transition hover:border-gray-400"
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
        </div>
      )}

      {/* Quantity */}
      <div className="mt-5 flex items-center gap-3">
        <span className="text-sm font-medium text-gray-700">Jumlah</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300"
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
            className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 disabled:opacity-40"
            aria-label="Tambah"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Add to cart */}
      <button
        type="button"
        onClick={add}
        disabled={!canAdd}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50 sm:text-base"
        style={{ backgroundColor: brandColor }}
      >
        {added ? (
          <>
            <Check className="h-5 w-5" /> Ditambahkan
          </>
        ) : (
          <>
            <Plus className="h-5 w-5" />
            {isVariant && !variant
              ? 'Pilih variasi dulu'
              : outOfStock
                ? 'Stok habis'
                : 'Tambah ke Keranjang'}
          </>
        )}
      </button>

      {added && (
        <a
          href="/cart"
          className="mt-3 block w-full rounded-xl border border-gray-300 py-3 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Lihat keranjang &amp; checkout →
        </a>
      )}
    </div>
  )
}

/** Star row. `value` is 0–5; renders filled / half / empty. */
export function Stars({
  value,
  size = 16,
}: {
  value: number
  size?: number
}) {
  return (
    <div className="flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i))
        return (
          <div
            key={i}
            className="relative"
            style={{ width: size, height: size }}
          >
            <Star
              className="absolute inset-0 text-gray-300"
              style={{ width: size, height: size }}
            />
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
            >
              <Star
                className="text-amber-400"
                style={{ width: size, height: size, fill: 'currentColor' }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

type ReviewItem = Product['reviews'][number]

function ProductReviews({
  ratingAvg,
  reviewCount,
  reviews,
  brandColor,
}: {
  ratingAvg: number
  reviewCount: number
  reviews: ReviewItem[]
  brandColor: string
}) {
  return (
    <section className="mt-10 border-t border-gray-100 pt-8">
      <h2 className="text-lg font-bold">Ulasan pembeli</h2>
      {reviewCount === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          Belum ada ulasan. Ulasan muncul setelah pembeli menerima pesanannya.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-3xl font-bold" style={{ color: brandColor }}>
              {ratingAvg.toFixed(1)}
            </span>
            <div>
              <Stars value={ratingAvg} size={18} />
              <p className="mt-0.5 text-xs text-gray-500">
                {reviewCount} ulasan
              </p>
            </div>
          </div>
          <ul className="mt-5 space-y-4">
            {reviews.map((r, i) => (
              <li key={i} className="border-b border-gray-100 pb-4 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {r.customerName}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(r.createdAt).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <div className="mt-1">
                  <Stars value={r.rating} size={14} />
                </div>
                {r.comment && (
                  <p className="mt-1.5 whitespace-pre-line text-sm text-gray-600">
                    {r.comment}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
