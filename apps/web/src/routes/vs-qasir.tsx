/**
 * JUR-13: /vs-qasir comparison page. Public no-auth route. Direct
 * conversion driver for tenants evaluating us against the obvious
 * competitor. Marketing copy + side-by-side feature table + dual CTAs.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Check, X, ArrowRight, MessageCircle } from 'lucide-react'
import { LandingNavbar } from '@/components/layout/landing-navbar'
import { LandingFooter } from '@/components/layout/landing-footer'
import { cn } from '@/lib/utils'
import { buildSalesWaUrl } from '@/lib/constants' // JUR-127
import i18n from '@/lib/i18n' // JUR-138

const WA_MIGRATION_CONSULT = buildSalesWaUrl(
  'Halo Vintra, saya mau konsultasi migrasi dari Qasir.',
)
const WA_MIGRATION_HELP = buildSalesWaUrl(
  'Halo Vintra, saya butuh bantuan migrasi dari Qasir.',
)

export const Route = createFileRoute('/vs-qasir')({
  head: () => ({
    meta: [
      { title: i18n.t('vsQasir.metaTitle') },
      { name: 'description', content: i18n.t('vsQasir.metaDescription') },
    ],
  }),
  component: VsQasirPage,
})

interface FeatureRow {
  labelKey: string
  qasir: string | boolean | { key: string }
  vintra: string | boolean | { key: string }
  /** Highlight a row visually when Vintra is the clear winner. */
  highlight?: boolean
}

// Keep the data table in JSX-resolution time so t() runs per render.
function useFeatureRows(): FeatureRow[] {
  return [
    { labelKey: 'vsQasir.features.unlimitedTx', qasir: true, vintra: true },
    { labelKey: 'vsQasir.features.unlimitedSku', qasir: true, vintra: true },
    { labelKey: 'vsQasir.features.unlimitedAttendance', qasir: true, vintra: true },
    { labelKey: 'vsQasir.features.loyalty', qasir: true, vintra: true },
    { labelKey: 'vsQasir.features.promo', qasir: true, vintra: true },
    {
      labelKey: 'vsQasir.features.autoHpp',
      qasir: false,
      vintra: true,
      highlight: true,
    },
    { labelKey: 'vsQasir.features.autoDeduct', qasir: true, vintra: true },
    { labelKey: 'vsQasir.features.thermal', qasir: true, vintra: true },
    // JUR-141 / JUR-145 PR 4 — Peti Kas parity. Both have it; we
    // call it out explicitly so the table makes clear we're not
    // missing this standard POS feature.
    { labelKey: 'vsQasir.features.cashDrawer', qasir: true, vintra: true },
    {
      labelKey: 'vsQasir.features.multiOutletLabel',
      qasir: { key: 'vsQasir.features.multiOutletQasir' },
      vintra: { key: 'vsQasir.features.multiOutletJq' },
      highlight: true,
    },
    {
      labelKey: 'vsQasir.features.commitmentLabel',
      qasir: { key: 'vsQasir.features.commitmentYes' },
      vintra: { key: 'vsQasir.features.commitmentNo' },
      highlight: true,
    },
    {
      labelKey: 'vsQasir.features.trialLabel',
      qasir: { key: 'vsQasir.features.trialQasir' },
      vintra: { key: 'vsQasir.features.trialJq' },
      highlight: true,
    },
  ]
}

function Cell({
  value,
  t,
}: {
  value: string | boolean | { key: string }
  t: (k: string) => string
}) {
  if (typeof value === 'boolean') {
    return value ? (
      <Check className="mx-auto h-5 w-5 text-success-600" />
    ) : (
      <X className="mx-auto h-5 w-5 text-gray-300" />
    )
  }
  const text = typeof value === 'string' ? value : t(value.key)
  return <span className="text-sm">{text}</span>
}

function VsQasirPage() {
  const { t } = useTranslation()
  const FEATURES = useFeatureRows()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <LandingNavbar />
      <main className="mx-auto max-w-5xl px-4 pt-24 pb-16 sm:px-6 lg:px-8">
        {/* Hero */}
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
            {t('vsQasir.hero.eyebrow')}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-100">
            {t('vsQasir.hero.title')}
          </h1>
          <p className="mt-3 text-base text-gray-600 dark:text-gray-400">
            {t('vsQasir.hero.subtitle')}
          </p>

          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/auth/register"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              {t('vsQasir.hero.ctaTry')} <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={WA_MIGRATION_CONSULT}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <MessageCircle className="h-4 w-4" /> {t('vsQasir.hero.ctaConsult')}
            </a>
          </div>
        </div>

        {/* Pricing headline */}
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('vsQasir.pricing.qasirLabel')}
            </p>
            <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-gray-100">
              {t('vsQasir.pricing.qasirPrice')}
              <span className="text-base font-normal text-gray-500">
                {t('vsQasir.pricing.perYear')}
              </span>
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t('vsQasir.pricing.qasirNote')}
            </p>
          </div>
          <div className="rounded-xl border-2 border-brand-500 bg-brand-50 p-6 dark:border-brand-400 dark:bg-brand-900/20">
            <p className="text-sm font-medium text-brand-700 dark:text-brand-300">
              {t('vsQasir.pricing.jqLabel')}
            </p>
            <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-gray-100">
              {t('vsQasir.pricing.jqPrice')}
              <span className="text-base font-normal text-gray-500">
                {t('vsQasir.pricing.perYear')}
              </span>
            </p>
            <p className="mt-1 text-xs text-brand-700 dark:text-brand-400">
              {t('vsQasir.pricing.jqNote')}
            </p>
          </div>
        </div>

        {/* Feature table */}
        <div className="mt-12">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t('vsQasir.compare.heading')}
          </h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">
                    {t('vsQasir.compare.colFeature')}
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700 dark:text-gray-300">
                    {t('vsQasir.compare.colQasir')}
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-brand-700 dark:text-brand-400">
                    {t('vsQasir.compare.colJq')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {FEATURES.map((row) => (
                  <tr
                    key={row.labelKey}
                    className={cn(
                      row.highlight && 'bg-brand-50/40 dark:bg-brand-900/10',
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      {t(row.labelKey)}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">
                      <Cell value={row.qasir} t={t} />
                    </td>
                    <td className="px-4 py-3 text-center text-gray-900 dark:text-gray-100">
                      <Cell value={row.vintra} t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Migration callout */}
        <div className="mt-10 rounded-xl border border-brand-200 bg-brand-50 p-6 dark:border-brand-800 dark:bg-brand-900/20">
          <h3 className="text-base font-semibold text-brand-900 dark:text-brand-200">
            {t('vsQasir.migration.title')}
          </h3>
          <p className="mt-2 text-sm text-brand-800 dark:text-brand-300">
            {t('vsQasir.migration.body')}
          </p>
          <a
            href={WA_MIGRATION_HELP}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <MessageCircle className="h-4 w-4" /> {t('vsQasir.migration.cta')}
          </a>
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t('vsQasir.bottom.title')}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t('vsQasir.bottom.subtitle')}
          </p>
          <Link
            to="/auth/register"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {t('vsQasir.bottom.cta')} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}
