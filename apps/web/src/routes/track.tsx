/**
 * Public storefront — order tracking page at `<slug>.vintra.my.id/track`.
 *
 * Host-resolved (redirects to the store root on the apex / disabled
 * store). Customers look up an order by order number + WhatsApp number;
 * reuses `trackOrder` + the shared `TrackResultView`. Phase 3 of the
 * multi-page storefront — replaces the former in-situs tracking modal.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeft, Loader2, Star, Check, PackageCheck } from 'lucide-react'
import {
  getStorefrontContext,
  trackOrder,
  submitProductReview,
  confirmOrderReceived,
} from '@/server/functions/storefront'
import { TrackResultView } from '@/lib/site-templates/sections-v2/shop'

export const Route = createFileRoute('/track')({
  loader: async () => {
    const ctx = await getStorefrontContext()
    if (!ctx) throw redirect({ to: '/' })
    return ctx
  },
  head: () => ({
    meta: [
      { title: 'Lacak Pesanan' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
  }),
  component: TrackPage,
})

function TrackPage() {
  const { slug, businessName, brandColor } = Route.useLoaderData()

  const [orderNumber, setOrderNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<
    Awaited<ReturnType<typeof trackOrder>> | null
  >(null)

  const [confirming, setConfirming] = useState(false)
  const [confirmErr, setConfirmErr] = useState<string | null>(null)

  async function lookup() {
    if (!orderNumber.trim() || !phone.trim()) return
    setLoading(true)
    setResult(null)
    setConfirmErr(null)
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

  // Re-fetch silently (no spinner / no clear) after the buyer confirms
  // receipt, so the status + review form update in place.
  async function refresh() {
    try {
      setResult(
        await trackOrder({
          data: { slug, orderNumber: orderNumber.trim(), phone: phone.trim() },
        }),
      )
    } catch {
      /* keep current result */
    }
  }

  async function handleConfirmReceived() {
    setConfirmErr(null)
    setConfirming(true)
    try {
      const res = await confirmOrderReceived({
        data: { slug, orderNumber: orderNumber.trim(), phone: phone.trim() },
      })
      if (res.ok) {
        await refresh()
      } else {
        setConfirmErr(res.message)
      }
    } catch {
      setConfirmErr('Gagal mengonfirmasi. Coba lagi.')
    } finally {
      setConfirming(false)
    }
  }

  const canConfirmReceipt =
    result?.found && (result.status === 'shipped' || result.status === 'ready')

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm'

  return (
    <div className="light-scope min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur">
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="max-w-[60vw] truncate">{businessName}</span>
        </a>
      </header>

      <main className="mx-auto max-w-md px-4 py-6 sm:px-6">
        <h1 className="mb-1 text-xl font-bold">Lacak Pesanan</h1>
        <p className="mb-4 text-sm text-gray-500">
          Masukkan nomor pesanan dan nomor WhatsApp yang dipakai saat pesan.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            lookup()
          }}
          className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4"
        >
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
            inputMode="tel"
            className={inputCls}
          />
          <button
            type="submit"
            disabled={loading || !orderNumber.trim() || !phone.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: brandColor }}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Cek status
          </button>
        </form>

        {result && (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
            <TrackResultView result={result} brandColor={brandColor} />
          </div>
        )}

        {canConfirmReceipt && (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-600">
              Sudah terima pesananmu? Konfirmasi supaya pesanan ditandai
              selesai.
            </p>
            {confirmErr && (
              <p className="mt-2 text-xs text-red-600">{confirmErr}</p>
            )}
            <button
              type="button"
              onClick={handleConfirmReceived}
              disabled={confirming}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: brandColor }}
            >
              {confirming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PackageCheck className="h-4 w-4" />
              )}
              Pesanan diterima
            </button>
          </div>
        )}

        {result?.found && result.canReview && (
          <ReviewSection
            slug={slug}
            orderNumber={result.orderNumber}
            phone={phone.trim()}
            items={result.items}
            brandColor={brandColor}
          />
        )}
      </main>
    </div>
  )
}

type TrackResult = NonNullable<Awaited<ReturnType<typeof trackOrder>>>
type TrackItem = Extract<TrackResult, { found: true }>['items'][number]

/**
 * Per-product review forms for a completed order. Lists each distinct
 * purchased product (deduped by itemId) that hasn't been reviewed yet,
 * with a star picker + optional comment.
 */
function ReviewSection({
  slug,
  orderNumber,
  phone,
  items,
  brandColor,
}: {
  slug: string
  orderNumber: string
  phone: string
  items: TrackItem[]
  brandColor: string
}) {
  // Dedupe to one entry per product; skip lines with no itemId (deleted
  // catalog item) and ones already reviewed.
  const seen = new Set<string>()
  const reviewable = items.filter((i) => {
    if (!i.itemId || i.reviewed || seen.has(i.itemId)) return false
    seen.add(i.itemId)
    return true
  })

  if (reviewable.length === 0) return null

  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-bold">Beri ulasan</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        Bagikan pengalamanmu untuk produk yang sudah kamu terima.
      </p>
      <div className="mt-3 space-y-3">
        {reviewable.map((it) => (
          <ReviewForm
            key={it.itemId}
            slug={slug}
            orderNumber={orderNumber}
            phone={phone}
            itemId={it.itemId!}
            productName={it.name}
            brandColor={brandColor}
          />
        ))}
      </div>
    </div>
  )
}

function ReviewForm({
  slug,
  orderNumber,
  phone,
  itemId,
  productName,
  brandColor,
}: {
  slug: string
  orderNumber: string
  phone: string
  itemId: string
  productName: string
  brandColor: string
}) {
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (rating < 1) {
      setError('Pilih jumlah bintang dulu')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const res = await submitProductReview({
        data: {
          slug,
          orderNumber,
          phone,
          itemId,
          rating,
          comment: comment.trim() || undefined,
        },
      })
      if (res.ok) setDone(true)
      else setError(res.message)
    } catch {
      setError('Gagal mengirim ulasan')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-700">
        <Check className="h-4 w-4" />
        Terima kasih atas ulasan untuk {productName}!
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-sm font-medium text-gray-900">{productName}</p>
      <div className="mt-1.5 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${n} bintang`}
            className="p-0.5"
          >
            <Star
              className="h-6 w-6"
              style={{
                color: '#f59e0b',
                fill: (hover || rating) >= n ? '#f59e0b' : 'transparent',
              }}
            />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Tulis ulasan (opsional)"
        rows={2}
        maxLength={1000}
        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="mt-2 flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: brandColor }}
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Kirim ulasan
      </button>
    </div>
  )
}
