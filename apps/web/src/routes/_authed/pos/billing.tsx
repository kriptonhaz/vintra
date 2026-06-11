import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Wallet, MessageCircle, CheckCircle2 } from 'lucide-react'
import { getPOSOverview } from '@/server/functions/pos'
import { Button } from '@/components/ui/button'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { POS_PLANS } from '@vintra/shared'
import { formatRupiah } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { buildSalesWaUrl } from '@/lib/constants' // JUR-127

export const Route = createFileRoute('/_authed/pos/billing')({
  loader: () => getPOSOverview(),
  component: BillingPage,
})

const SALES_WHATSAPP = buildSalesWaUrl(
  'Halo Vintra, saya ingin upgrade modul Kasir.',
)

function BillingPage() {
  const data = Route.useLoaderData()
  const { t } = useTranslation()

  // Komplit (JUR-5b) is the headline bundle — POS + Inventory +
  // Attendance + HPP + customer DB at one flat price. Toko stays as
  // the à-la-carte POS-only option; Bisnis is reserved for future
  // upgrade with cross-outlet consolidated reports etc.
  const tiers = ['free', 'toko', 'komplit', 'bisnis'] as const

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('pos.billingTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('pos.billingSubtitle')}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {tiers.map((tier) => {
          const plans = POS_PLANS.filter((p) => p.tier === tier)
          const isCurrent = data.tier === tier
          const isComingSoon = plans.every((p) => p.comingSoon)
          const monthlyPlan = plans.find((p) => p.durationMonths === 1)
          const annualPlan = plans.find((p) => p.durationMonths === 12)
          const monthlyPrice = monthlyPlan?.pricePerMonth
          const annualPrice = annualPlan?.pricePerMonth
          const monthlyAdd = monthlyPlan?.additionalOutletPerMonth ?? 0
          const annualAdd = annualPlan?.additionalOutletPerMonth ?? 0
          const tierName = {
            free: 'Gratis',
            toko: 'POS Toko',
            komplit: 'Komplit',
            bisnis: 'Bisnis',
          }[tier]
          const isPopular = tier === 'komplit'

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
                    {t('pos.tierCurrent')}
                  </span>
                )}
                {!isCurrent && isPopular && (
                  <span className="rounded-full bg-success-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                    Populer
                  </span>
                )}
                {isComingSoon && (
                  <span className="rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
                    {t('pos.tierComingSoon')}
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
                        /bulan/outlet pertama
                      </span>
                    </p>
                    {annualPrice != null && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        Tahunan: {formatRupiah(annualPrice)}/bulan
                      </p>
                    )}
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      + {formatRupiah(monthlyAdd)}/outlet tambahan
                      {annualAdd > 0 && annualAdd !== monthlyAdd && (
                        <> (atau {formatRupiah(annualAdd)} di paket tahunan)</>
                      )}
                    </p>
                  </>
                )}
              </div>

              <ul className="mt-4 flex-1 space-y-2 text-sm">
                <TierFeatureRow tier={tier} />
              </ul>

              <div className="mt-5">
                {isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    {t('pos.tierActive')}
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
                      {t('pos.contactSales')}
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
                      {t('pos.upgradeBtn')}
                    </Button>
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        {t('pos.billingHowToUpgrade')}
      </div>
    </div>
  )
}

function TierFeatureRow({ tier }: { tier: string }) {
  const features: Record<string, string[]> = {
    free: [
      'Transaksi tanpa batas',
      'Riwayat tanpa batas',
      '1 kasir, 1 outlet',
      'Tunai + QRIS',
      'Struk default',
    ],
    toko: [
      'POS-only (tanpa Inventory + Absensi)',
      'Transaksi tanpa batas',
      '3 kasir per outlet',
      'Semua metode bayar',
      'Logo + footer kustom',
      'Diskon penjualan',
      'Z-Report harian',
      'Customer database',
    ],
    komplit: [
      'Semua modul: POS + Inventory + Absensi + HPP',
      'Unlimited kasir, unlimited karyawan',
      'Unlimited SKU, unlimited transaksi',
      'Customer database + loyalty *',
      'Promo codes *',
      'Diskon per item (line discount) *',
      'Auto-deduct bahan dari resep *',
      'Cetak struk thermal *',
      'Outlet tambahan bayar per outlet',
    ],
    bisnis: [
      'Semua fitur Toko',
      'Unlimited kasir per outlet',
      'Customer database + loyalty',
      'Promo codes',
      'Diskon per item',
      'Kitchen display + shift mgmt',
      'Konsolidasi cross-outlet',
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
