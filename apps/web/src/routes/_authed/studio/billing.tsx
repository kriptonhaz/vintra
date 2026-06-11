import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Coins,
  MessageCircle,
  CheckCircle2,
  Sparkles,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import {
  getKontenStatus,
  getMyKontenLedger,
} from '@/server/functions/konten'
import { Button } from '@/components/ui/button'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { buildSalesWaUrl } from '@/lib/constants'

export const Route = createFileRoute('/_authed/studio/billing')({
  loader: async () => {
    const [status, ledger] = await Promise.all([
      getKontenStatus(),
      getMyKontenLedger(),
    ])
    return { status, ledger }
  },
  component: StudioBillingPage,
})

// Pack catalog — hardcoded to mirror the WhatsApp billing pattern. When
// a real konten_credit_packs table + admin CRUD ships, replace this with
// a loader fetch. Numbers must stay in sync with the public /pricing page
// and the landing-page card.
const PACKS = [
  {
    key: 'starter',
    credits: 5,
    priceIdr: 12_500,
    perCredit: 2_500,
    headline: 'Coba dulu',
  },
  {
    key: 'regular',
    credits: 25,
    priceIdr: 50_000,
    perCredit: 2_000,
    headline: 'Reguler',
  },
  {
    key: 'hemat',
    credits: 50,
    priceIdr: 90_000,
    perCredit: 1_800,
    headline: 'Hemat 10%',
  },
  {
    key: 'paling-hemat',
    credits: 100,
    priceIdr: 140_000,
    perCredit: 1_400,
    headline: 'Paling hemat',
    popular: true,
  },
] as const

function StudioBillingPage() {
  const { status, ledger } = Route.useLoaderData()
  const { t } = useTranslation()

  const salesWa = buildSalesWaUrl(
    'Halo Vintra, saya ingin membeli paket kredit Konten & Branding.',
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('studio.billing.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('studio.billing.subtitle')}
        </p>
      </div>

      {/* Balance card */}
      <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5 dark:border-brand-900/40 dark:from-brand-900/20 dark:to-gray-800">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700 dark:text-brand-400">
          {t('studio.billing.balanceLabel')}
        </p>
        <p className="mt-1 flex items-baseline gap-1.5 text-3xl font-bold text-gray-900 dark:text-gray-100">
          <Coins className="h-6 w-6 text-brand-600 dark:text-brand-400" />
          <span>{status.balance.toLocaleString('id-ID')}</span>
          <span className="text-base font-normal text-gray-500 dark:text-gray-400">
            {t('studio.billing.credits')}
          </span>
        </p>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t('studio.billing.creditLegend')}
        </p>
      </div>

      {/* Pack grid */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('studio.billing.packsTitle')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PACKS.map((pack) => {
            const isPopular = 'popular' in pack && pack.popular
            return (
              <div
                key={pack.key}
                className={cn(
                  'relative flex flex-col rounded-xl border-2 p-5 transition-shadow',
                  isPopular
                    ? 'border-brand-500 bg-brand-50/30 dark:border-brand-400 dark:bg-brand-900/10'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
                )}
              >
                {isPopular && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-success-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    {t('studio.billing.popular')}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {pack.credits}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {t('studio.billing.credits')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {pack.headline}
                </p>
                <p className="mt-3 text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatRupiah(pack.priceIdr)}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {formatRupiah(pack.perCredit)} {t('studio.billing.perCredit')}
                </p>
              </div>
            )
          })}
        </div>

        <a
          href={salesWa}
          target="_blank"
          rel="noreferrer"
          className="mt-4 block"
        >
          <Button variant="brand" className="w-full sm:w-auto">
            <MessageCircle className="h-4 w-4" />
            {t('studio.billing.buyCta')}
          </Button>
        </a>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t('studio.billing.buyHint')}
        </p>
      </section>

      {/* Komplit signup gift highlight */}
      <div className="flex items-start gap-3 rounded-xl border border-accent-200 bg-accent-50 p-4 text-sm dark:border-accent-900/50 dark:bg-accent-900/20">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-700 dark:text-accent-400" />
        <div className="text-accent-900 dark:text-accent-200">
          <p className="font-medium">{t('studio.billing.komplitGiftTitle')}</p>
          <p className="mt-0.5 text-xs">
            {t('studio.billing.komplitGiftDesc')}
          </p>
        </div>
      </div>

      {/* Ledger */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('studio.billing.historyTitle')}
        </h2>
        {ledger.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {t('studio.billing.historyEmpty')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {ledger.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t(`studio.billing.ledger_${entry.type}`, {
                        defaultValue: entry.type,
                      })}
                    </p>
                    {entry.note && (
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {entry.note}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-400">
                      {formatDate(entry.createdAt, 'dd MMM yyyy HH:mm')}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums',
                      entry.delta >= 0
                        ? 'text-success-600 dark:text-success-400'
                        : 'text-danger-600',
                    )}
                  >
                    {entry.delta >= 0 ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                    {entry.delta >= 0 ? '+' : ''}
                    {entry.delta}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Sales fallback */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        {t('studio.billing.salesHelp')}{' '}
        <a
          href={salesWa}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp
        </a>
        .
      </div>

      {/* Discoverability — quick link back to gallery */}
      <div className="text-center">
        <Button variant="ghost" asChild>
          <Link to="/studio">
            <CheckCircle2 className="h-4 w-4" />
            {t('studio.billing.backToGallery')}
          </Link>
        </Button>
      </div>
    </div>
  )
}
