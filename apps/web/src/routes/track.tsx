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
import { ArrowLeft, Loader2 } from 'lucide-react'
import {
  getStorefrontContext,
  trackOrder,
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
      </main>
    </div>
  )
}
