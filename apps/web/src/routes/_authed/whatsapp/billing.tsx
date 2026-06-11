import { createFileRoute } from '@tanstack/react-router'
import { Wallet, MessageCircle, CheckCircle2 } from 'lucide-react'
import { getWaSubscription } from '@/server/functions/whatsapp'
import { Button } from '@/components/ui/button'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { formatRupiah } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { buildSalesWaUrl } from '@/lib/constants' // JUR-127

export const Route = createFileRoute('/_authed/whatsapp/billing')({
  loader: () => getWaSubscription().catch(() => null),
  component: WaBillingPage,
})

const SALES_WA = buildSalesWaUrl(
  'Halo Vintra, saya ingin berlangganan paket WhatsApp AI.',
)

// Tier ladder must stay in sync with packages/db/src/schema/whatsapp-plans.ts
// AND the wa_subscription_plans rows in Supabase. The API enforces caps from
// the DB row at request time; this array is the customer-facing copy +
// feature bullets only.
const PLANS = [
  {
    key: 'basic',
    name: 'Basic',
    priceIdr: 49_000,
    maxInstances: 1,
    maxReplies: 5_000,
    ragScope: 'stock' as const,
    features: [
      '1 nomor WhatsApp',
      '5.000 balasan AI/bulan',
      'RAG: harga, stok, ketersediaan menu (resep / HPP), alamat, jam buka, metode bayar',
    ],
  },
  {
    key: 'komplit',
    name: 'Komplit',
    priceIdr: 149_000,
    maxInstances: 3,
    maxReplies: 20_000,
    ragScope: 'full' as const,
    features: [
      '3 nomor WhatsApp',
      '20.000 balasan AI/bulan',
      'Semua RAG di Basic + promo, poin loyalitas, riwayat pesanan',
    ],
    popular: true,
  },
  // Pro tier exists in `wa_subscription_plans` (is_active=false) and stays
  // hidden from the customer-facing pricing until the differentiator
  // features ship — see Linear ticket for the build plan (multi-staff
  // chat assignment, multi-branch RAG, advanced analytics).
] as const

function WaBillingPage() {
  const subscription = Route.useLoaderData()
  const currentTier = subscription?.tier ?? 'free'

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tagihan WhatsApp AI</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Pilih paket yang sesuai dengan kebutuhan bisnis Anda.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {PLANS.map((plan) => {
          const isCurrent = currentTier === plan.key
          return (
            <div
              key={plan.key}
              className={cn(
                'flex flex-col rounded-xl border-2 p-5',
                isCurrent
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                  : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{plan.name}</h3>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-medium text-white">
                    <CheckCircle2 className="h-3 w-3" /> Aktif
                  </span>
                )}
                {'popular' in plan && plan.popular && !isCurrent && (
                  <span className="rounded-full bg-success-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                    Populer
                  </span>
                )}
              </div>

              <div className="mt-3">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatRupiah(plan.priceIdr)}
                  <span className="ml-1 text-xs font-normal text-gray-500">/bulan</span>
                </p>
              </div>

              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>Paket Aktif</Button>
                ) : (
                  <a href={SALES_WA} target="_blank" rel="noreferrer" className="block w-full">
                    <Button variant="brand" className="w-full">
                      <Wallet className="mr-1 h-4 w-4" /> Upgrade
                    </Button>
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        Untuk upgrade atau pertanyaan tagihan, hubungi tim kami via{' '}
        <a href={SALES_WA} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400">
          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
        </a>.
      </div>
    </div>
  )
}
