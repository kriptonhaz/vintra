/**
 * Public storefront — checkout page at `<slug>.vintra.my.id/checkout`.
 *
 * Host-resolved (redirects to the store root on the apex / disabled
 * store). Reuses the storefront's CheckoutView + TotalsRows + DoneView
 * and `placeOrder`; on success it shows the confirmation (order number,
 * bank instructions, WhatsApp deep link). Phase 2 of the multi-page
 * storefront.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import {
  getStorefrontContext,
  getStorefront,
  validateStorefrontPromo,
  placeOrder,
} from '@/server/functions/storefront'
import { useCart } from '@/lib/storefront/cart-store'
import {
  CheckoutView,
  DoneView,
  TotalsRows,
  computeCheckoutTotals,
} from '@/lib/site-templates/sections-v2/shop'

export const Route = createFileRoute('/checkout')({
  loader: async () => {
    const ctx = await getStorefrontContext()
    if (!ctx) throw redirect({ to: '/' })
    const store = await getStorefront({ data: { slug: ctx.slug } })
    if (!store || !store.enabled) throw redirect({ to: '/' })
    return { ...ctx, store }
  },
  head: () => ({
    meta: [
      { title: 'Checkout' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
  }),
  component: CheckoutPage,
})

function CheckoutPage() {
  const { slug, businessName, brandColor, store } = Route.useLoaderData()
  const cart = useCart(slug)

  const [promoInput, setPromoInput] = useState('')
  const [promo, setPromo] = useState<{ code: string; amount: number } | null>(null)
  const [promoMsg, setPromoMsg] = useState<string | null>(null)
  const [promoChecking, setPromoChecking] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>(
    store.shipping.deliveryEnabled ? 'delivery' : 'pickup',
  )
  const [address, setAddress] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState(store.payment.methods[0] ?? '')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)
  const [done, setDone] = useState<Awaited<ReturnType<typeof placeOrder>> | null>(
    null,
  )

  const subtotal = cart.subtotal
  const totals = computeCheckoutTotals(store, {
    subtotal,
    promoAmount: promo?.amount ?? 0,
    fulfillment,
    zoneId,
  })

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
      cart.clear()
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : 'Gagal membuat pesanan')
    } finally {
      setSubmitting(false)
    }
  }

  const empty = cart.items.length === 0 && !done

  return (
    <div className="light-scope min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur">
        <a
          href={done ? '/' : '/cart'}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="max-w-[60vw] truncate">
            {done ? businessName : 'Keranjang'}
          </span>
        </a>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6 sm:px-6">
        {done ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <DoneView done={done} brandColor={brandColor} />
            <a
              href="/"
              className="mt-4 block w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-sm font-medium text-gray-700"
            >
              Kembali ke toko
            </a>
          </div>
        ) : empty ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-sm text-gray-500">Keranjang kamu masih kosong.</p>
            <a
              href="/"
              className="mt-4 inline-block rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
              style={{ backgroundColor: brandColor }}
            >
              Mulai belanja
            </a>
          </div>
        ) : (
          <>
            <h1 className="mb-4 text-xl font-bold">Checkout</h1>

            <div className="rounded-2xl border border-gray-200 bg-white p-4">
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
            </div>

            {/* Promo */}
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              {promo ? (
                <div className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 text-sm">
                  <span className="font-medium text-green-700">
                    Promo {promo.code} aktif
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPromo(null)
                      setPromoMsg(null)
                      setPromoInput('')
                    }}
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
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={applyPromo}
                      disabled={promoChecking || !promoInput.trim()}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      Pakai
                    </button>
                  </div>
                  {promoMsg && <p className="mt-1 text-xs text-gray-500">{promoMsg}</p>}
                </>
              )}
            </div>

            {/* Totals + submit */}
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <TotalsRows
                subtotal={subtotal}
                promoAmount={totals.promoAmount}
                taxAmount={totals.taxAmount}
                shippingFee={fulfillment === 'pickup' ? null : totals.shippingFee}
                total={totals.total}
              />
              {submitErr && <p className="mt-2 text-xs text-red-600">{submitErr}</p>}
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: brandColor }}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Buat Pesanan
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
