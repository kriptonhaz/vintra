import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Wallet, MessageCircle, CheckCircle2 } from 'lucide-react'
import { getInventoryOverview } from '@/server/functions/inventory'
import { Button } from '@/components/ui/button'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { INVENTORY_PLANS } from '@vintra/shared'
import { formatRupiah } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { buildSalesWaUrl } from '@/lib/constants' // JUR-127

export const Route = createFileRoute('/_authed/inventory/billing')({
  loader: () => getInventoryOverview(),
  component: BillingPage,
})

const SALES_WHATSAPP = buildSalesWaUrl(
  'Halo Vintra, saya ingin upgrade modul Inventory.',
)

function BillingPage() {
  const data = Route.useLoaderData()
  const { t } = useTranslation()

  // Group plans by tier so we render one card per tier with monthly +
  // annual variants stacked. multi_outlet flat tier was retired in
  // favour of additive per-location pricing on Toko + Bisnis; the
  // "+ Rp X/lokasi" line below tells that story.
  const tiers = ['free', 'toko', 'bisnis'] as const

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('inventory.billingTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('inventory.billingSubtitle')}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {tiers.map((tier) => {
          const plans = INVENTORY_PLANS.filter((p) => p.tier === tier)
          const isCurrent = data.tier === tier
          const isComingSoon = plans.every((p) => p.comingSoon)
          const monthlyPrice = plans.find((p) => p.durationMonths === 1)?.pricePerMonth
          const annualPrice = plans.find((p) => p.durationMonths === 12)?.pricePerMonth
          const tierName = {
            free: 'Gratis',
            toko: 'Toko',
            bisnis: 'Bisnis',
          }[tier]
          const monthlyExtra = plans.find(
            (p) => p.durationMonths === 1,
          )?.additionalLocationPerMonth
          const annualExtra = plans.find(
            (p) => p.durationMonths === 12,
          )?.additionalLocationPerMonth

          return (
            <div
              key={tier}
              className={cn(
                'flex flex-col rounded-xl border-2 p-5',
                isCurrent
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                  : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {tierName}
                </h3>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-medium text-white">
                    <CheckCircle2 className="h-3 w-3" />
                    {t('inventory.tierCurrent')}
                  </span>
                )}
                {isComingSoon && (
                  <span className="rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
                    {t('inventory.tierComingSoon')}
                  </span>
                )}
              </div>

              <div className="mt-3">
                {tier === 'free' ? (
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    Rp 0
                  </p>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {formatRupiah(monthlyPrice ?? 0)}
                      <span className="ml-1 text-xs font-normal text-gray-500">
                        /bulan lokasi pertama
                      </span>
                    </p>
                    {monthlyExtra != null && monthlyExtra > 0 && (
                      <p className="mt-1 text-xs font-medium text-brand-700 dark:text-brand-400">
                        + {formatRupiah(monthlyExtra)}/bulan per lokasi
                        tambahan
                      </p>
                    )}
                    {annualPrice != null && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Tahunan: {formatRupiah(annualPrice)}/bulan
                        {annualExtra != null && annualExtra > 0 && (
                          <>
                            {' '}(+ {formatRupiah(annualExtra)}/lokasi
                            tambahan)
                          </>
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>

              <ul className="mt-4 flex-1 space-y-2 text-sm">
                <TierFeatureRow tier={tier} />
              </ul>

              <div className="mt-5">
                {isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    {t('inventory.tierActive')}
                  </Button>
                ) : isComingSoon ? (
                  <a
                    href={SALES_WHATSAPP}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full"
                  >
                    <Button variant="outline" className="w-full">
                      <MessageCircle className="mr-1 h-4 w-4" />
                      {t('inventory.contactSales')}
                    </Button>
                  </a>
                ) : (
                  <a
                    href={SALES_WHATSAPP}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full"
                  >
                    <Button variant="brand" className="w-full">
                      <Wallet className="mr-1 h-4 w-4" />
                      {t('inventory.upgradeBtn')}
                    </Button>
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        {t('inventory.billingHowToUpgrade')}
      </div>
    </div>
  )
}

function TierFeatureRow({ tier }: { tier: string }) {
  const features: Record<string, string[]> = {
    free: [
      'Unlimited SKU',
      '1 lokasi (cabang/gudang)',
      'Riwayat 30 hari',
      'Stock in / out / penyesuaian',
      'Auto-sync HPP',
    ],
    toko: [
      'Unlimited SKU',
      'Multi-lokasi (bayar per lokasi tambahan)',
      'Riwayat tanpa batas',
      'Supplier & Purchase Order',
      'Notifikasi stok menipis',
      'Multi-unit (kg/pcs/dus)',
      'HPP sync 2 arah',
    ],
    bisnis: [
      'Semua fitur Toko',
      'Multi-lokasi + transfer antar gudang',
      'Variants (warna/ukuran)',
      'Batch / kadaluarsa',
      'Barcode',
      'Laporan COGS',
      'Laporan konsolidasi lintas lokasi',
    ],
  }
  return (
    <>
      {features[tier]?.map((f) => (
        <li
          key={f}
          className="flex items-start gap-2 text-gray-700 dark:text-gray-300"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
          <span>{f}</span>
        </li>
      ))}
    </>
  )
}
