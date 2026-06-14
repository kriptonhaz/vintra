/**
 * Public storefront — cart page at `<slug>.vintra.my.id/cart`.
 *
 * Host-resolved (redirects to the store root on the apex). Renders the
 * per-slug localStorage cart (shared with the situs mini-cart drawer)
 * and links to /checkout. Phase 2 of the multi-page storefront.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { getStorefrontContext } from '@/server/functions/storefront'
import { useCart } from '@/lib/storefront/cart-store'
import { CartLineList } from '@/lib/site-templates/sections-v2/shop'
import { formatRupiah } from '@/lib/currency'

export const Route = createFileRoute('/cart')({
  loader: async () => {
    const ctx = await getStorefrontContext()
    if (!ctx) throw redirect({ to: '/' })
    return ctx
  },
  head: () => ({
    meta: [
      { title: 'Keranjang' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
  }),
  component: CartPage,
})

function CartPage() {
  const { slug, businessName, brandColor } = Route.useLoaderData()
  const cart = useCart(slug)

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

      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <h1 className="mb-4 text-xl font-bold">Keranjang</h1>

        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <CartLineList cart={cart} brandColor={brandColor} />
        </div>

        {cart.items.length > 0 ? (
          <div className="mt-4 space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex justify-between text-base font-bold">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatRupiah(cart.subtotal)}</span>
            </div>
            <p className="text-xs text-gray-500">
              Ongkir &amp; pajak dihitung di langkah checkout.
            </p>
            <a
              href="/checkout"
              className="mt-2 block w-full rounded-lg px-4 py-3 text-center text-sm font-semibold text-white"
              style={{ backgroundColor: brandColor }}
            >
              Lanjut ke Checkout
            </a>
            <a
              href="/"
              className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-sm font-medium text-gray-700"
            >
              Lanjut belanja
            </a>
          </div>
        ) : (
          <a
            href="/"
            className="mt-4 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-center text-sm font-medium text-gray-700"
          >
            Mulai belanja
          </a>
        )}
      </main>
    </div>
  )
}
