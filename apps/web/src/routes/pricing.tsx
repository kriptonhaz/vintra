/**
 * Public /pricing page — Qasir-style detailed pricing destination.
 *
 * Structure (top → bottom):
 *  1. Hero with marketing wedges
 *  2. 4-card row: Free + Komplit Annual ⭐ + Komplit Monthly + Enterprise
 *  3. Comparison table grouped by category (POS / Inventory / Reports /
 *     Outlet / Pegawai / Strategi Bisnis)
 *  4. "Butuh satu modul aja?" — per-module à-la-carte cards
 *  5. Small "Bandingkan dengan Qasir" callout
 *  6. FAQ accordion
 *  7. CTA banner
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  Check,
  Minus,
  Sparkles,
  ShoppingCart,
  Package,
  Building2,
  Users,
  TrendingUp,
  ChevronDown,
  MessageCircle,
  ArrowRight,
  Calendar,
  Globe,
  Coins,
  Image as ImageIcon,
} from 'lucide-react'
import { POS_PLANS, INVENTORY_PLANS, waAnnualPrice } from '@vintra/shared'
import { LandingNavbar } from '@/components/layout/landing-navbar'
import { LandingFooter } from '@/components/layout/landing-footer'
import { WhatsappFloat } from '@/components/layout/whatsapp-float'
import { cn } from '@/lib/utils'
import { SALES_WHATSAPP_PHONE, buildSalesWaUrl } from '@/lib/constants' // JUR-127
import i18n from '@/lib/i18n' // JUR-138

export const Route = createFileRoute('/pricing')({
  head: () => ({
    meta: [
      { title: i18n.t('pricingPage.metaTitle') },
      { name: 'description', content: i18n.t('pricingPage.metaDescription') },
    ],
  }),
  component: PricingPage,
})

// ─── Marketing constants ────────────────────────────────────────────
// WA messages stay in Indonesian — sales team is Indonesian-speaking.
const WA_KOMPLIT_ANNUAL = buildSalesWaUrl(
  'Halo Vintra, saya ingin aktifkan paket Komplit Tahunan.',
)
const WA_KOMPLIT_MONTHLY = buildSalesWaUrl(
  'Halo Vintra, saya ingin aktifkan paket Komplit Bulanan.',
)
const WA_ENTERPRISE = buildSalesWaUrl(
  'Halo Vintra, saya tertarik paket Enterprise (5+ outlet / kustomisasi).',
)
const WA_POS_TOKO = buildSalesWaUrl(
  'Halo Vintra, saya ingin aktifkan POS Toko (POS-only).',
)
const WA_INVENTORY = buildSalesWaUrl(
  'Halo Vintra, saya ingin aktifkan modul Inventory Toko.',
)
const WA_ATTENDANCE = buildSalesWaUrl(
  'Halo Vintra, saya ingin aktifkan modul Absensi Karyawan.',
)
const WA_AI_BASIC = buildSalesWaUrl(
  'Halo Vintra, saya ingin aktifkan WhatsApp AI paket Basic (Rp 49.000/bulan).',
)
const WA_AI_KOMPLIT = buildSalesWaUrl(
  'Halo Vintra, saya ingin aktifkan WhatsApp AI paket Komplit (Rp 149.000/bulan).',
)
const WA_KONTEN_CREDITS = buildSalesWaUrl(
  'Halo Vintra, saya ingin membeli paket kredit Konten & Branding.',
)

// Pulled live from POS_PLANS so the page auto-updates if pricing changes.
function planByKey(key: string) {
  return POS_PLANS.find((p) => p.key === key)
}

// ─── Page component ────────────────────────────────────────────────

function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <LandingNavbar />
      <Hero />
      <PlanCards />
      <ComparisonTable />
      <PerModuleSection />
      <WhatsAppPricingSection />
      <KontenPricingSection />
      <QasirCallout />
      <FaqSection />
      <CtaBanner />
      <LandingFooter />
      <WhatsappFloat />
    </div>
  )
}

// ─── Section: Hero ─────────────────────────────────────────────────

function Hero() {
  const { t } = useTranslation()
  return (
    <section className="border-b border-gray-100 bg-gradient-to-b from-brand-50/50 to-white pt-16 pb-12 sm:pt-24 sm:pb-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-bold tracking-wider uppercase text-brand-700">
          <Sparkles className="h-3.5 w-3.5" />
          {t('pricingPage.hero.badge')}
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          {t('pricingPage.hero.title')}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-gray-600 sm:text-lg">
          {t('pricingPage.hero.subtitle')}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium text-gray-700">
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-4 w-4 text-success-600" />
            {t('pricingPage.hero.wedge1')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-4 w-4 text-success-600" />
            {t('pricingPage.hero.wedge2')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-4 w-4 text-success-600" />
            {t('pricingPage.hero.wedge3')}
          </span>
        </div>
      </div>
    </section>
  )
}

// ─── Section: 4 plan cards ─────────────────────────────────────────

function PlanCards() {
  const { t } = useTranslation()
  const komplitAnnual = planByKey('pos_komplit_annual')!
  const komplitMonthly = planByKey('pos_komplit_monthly')!

  const freeHighlights = t('pricingPage.plans.free.highlights', { returnObjects: true }) as string[]
  const annualHighlights = t('pricingPage.plans.komplitAnnual.highlights', { returnObjects: true }) as string[]
  const monthlyHighlights = t('pricingPage.plans.komplitMonthly.highlights', { returnObjects: true }) as string[]
  const enterpriseHighlights = t('pricingPage.plans.enterprise.highlights', { returnObjects: true }) as string[]

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Free */}
          <PlanCard
            name={t('pricingPage.plans.free.name')}
            tagline={t('pricingPage.plans.free.tagline')}
            price="Rp 0"
            priceUnit={t('pricingPage.plans.free.priceUnit')}
            highlights={freeHighlights}
            ctaLabel={t('pricingPage.plans.free.cta')}
            ctaHref="/auth/register"
          />
          {/* Komplit Annual ⭐ */}
          <PlanCard
            name={t('pricingPage.plans.komplitAnnual.name')}
            tagline={t('pricingPage.plans.komplitAnnual.tagline')}
            price={`Rp ${formatNum(komplitAnnual.pricePerMonth)}`}
            priceUnit={t('pricingPage.plans.komplitAnnual.priceUnit')}
            secondaryPrice={t('pricingPage.plans.komplitAnnual.secondaryPriceTpl', {
              total: formatNum(komplitAnnual.pricePerMonth * 12),
            })}
            additionalOutlet={t('pricingPage.plans.komplitAnnual.additionalOutletTpl', {
              price: formatNum(komplitAnnual.additionalOutletPerMonth),
            })}
            highlights={annualHighlights}
            ctaLabel={t('pricingPage.plans.komplitAnnual.cta')}
            ctaHref={WA_KOMPLIT_ANNUAL}
            popular
            popularBadge={t('pricingPage.plans.popularBadge')}
          />
          {/* Komplit Monthly */}
          <PlanCard
            name={t('pricingPage.plans.komplitMonthly.name')}
            tagline={t('pricingPage.plans.komplitMonthly.tagline')}
            price={`Rp ${formatNum(komplitMonthly.pricePerMonth)}`}
            priceUnit={t('pricingPage.plans.komplitMonthly.priceUnit')}
            additionalOutlet={t('pricingPage.plans.komplitMonthly.additionalOutletTpl', {
              price: formatNum(komplitMonthly.additionalOutletPerMonth),
            })}
            highlights={monthlyHighlights}
            ctaLabel={t('pricingPage.plans.komplitMonthly.cta')}
            ctaHref={WA_KOMPLIT_MONTHLY}
          />
          {/* Enterprise */}
          <PlanCard
            name={t('pricingPage.plans.enterprise.name')}
            tagline={t('pricingPage.plans.enterprise.tagline')}
            price={t('pricingPage.plans.enterprise.price')}
            priceUnit=""
            highlights={enterpriseHighlights}
            ctaLabel={t('pricingPage.plans.enterprise.cta')}
            ctaHref={WA_ENTERPRISE}
            ctaVariant="outline"
          />
        </div>

        {/* Disclaimer strip */}
        <div className="mt-6 grid gap-2 text-center text-xs text-gray-500 sm:flex sm:justify-center sm:gap-6">
          <span>{t('pricingPage.plans.disclaimerFeatures')}</span>
          <span>{t('pricingPage.plans.disclaimerTax')}</span>
          <span>{t('pricingPage.plans.disclaimerOutlet')}</span>
        </div>
      </div>
    </section>
  )
}

interface PlanCardProps {
  name: string
  tagline: string
  price: string
  priceUnit: string
  secondaryPrice?: string
  additionalOutlet?: string
  highlights: string[]
  ctaLabel: string
  ctaHref: string
  ctaVariant?: 'brand' | 'outline'
  popular?: boolean
  popularBadge?: string
}

function PlanCard({
  name,
  tagline,
  price,
  priceUnit,
  secondaryPrice,
  additionalOutlet,
  highlights,
  ctaLabel,
  ctaHref,
  ctaVariant = 'brand',
  popular,
  popularBadge,
}: PlanCardProps) {
  const isExternal = ctaHref.startsWith('http')
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-xl border-2 bg-white p-5 sm:p-6',
        popular
          ? 'border-brand-500 shadow-lg shadow-brand-500/10'
          : 'border-gray-200',
      )}
    >
      {popular && popularBadge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-md">
          {popularBadge}
        </span>
      )}
      <div>
        <h3 className="text-lg font-bold text-gray-900">{name}</h3>
        <p className="mt-1 text-xs text-gray-500">{tagline}</p>
      </div>
      <div className="mt-4 mb-4">
        <p className="flex items-baseline">
          <span className="text-3xl font-bold text-gray-900">{price}</span>
          {priceUnit && (
            <span className="ml-1 text-xs text-gray-500">{priceUnit}</span>
          )}
        </p>
        {secondaryPrice && (
          <p className="mt-0.5 text-xs text-gray-500">{secondaryPrice}</p>
        )}
        {additionalOutlet && (
          <p className="mt-2 rounded bg-accent-50 px-2 py-1 text-[11px] font-medium text-accent-800">
            {additionalOutlet}
          </p>
        )}
      </div>
      <ul className="mb-6 flex-1 space-y-2 text-sm">
        {highlights.map((h) => (
          <li key={h} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
            <span className="text-gray-700">{h}</span>
          </li>
        ))}
      </ul>
      {isExternal ? (
        <a
          href={ctaHref}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors',
            ctaVariant === 'brand'
              ? 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800'
              : 'border border-gray-300 bg-white text-gray-900 hover:bg-gray-50',
          )}
        >
          <MessageCircle className="h-4 w-4" />
          {ctaLabel}
        </a>
      ) : (
        <Link
          to={ctaHref}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors',
            ctaVariant === 'brand'
              ? 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800'
              : 'border border-gray-300 bg-white text-gray-900 hover:bg-gray-50',
          )}
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  )
}

// ─── Section: Comparison table ─────────────────────────────────────

interface FeatureRow {
  label: string
  free: string | boolean
  komplit: string | boolean
  enterprise: string | boolean
}

interface FeatureGroup {
  icon: typeof ShoppingCart
  title: string
  rows: FeatureRow[]
}

function useFeatureGroups(): FeatureGroup[] {
  const { t } = useTranslation()
  return [
    {
      icon: ShoppingCart,
      title: t('pricingPage.comparison.groups.pos.title'),
      rows: [
        { label: t('pricingPage.comparison.groups.pos.row1'), free: true, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row2'), free: t('pricingPage.comparison.groups.pos.row2Free'), komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row3'), free: true, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row4'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row5'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row6'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row7'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row8'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row9'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row10'), free: true, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row11'), free: t('pricingPage.comparison.groups.pos.row11Free'), komplit: t('pricingPage.comparison.groups.pos.row11Paid'), enterprise: t('pricingPage.comparison.groups.pos.row11Paid') },
        { label: t('pricingPage.comparison.groups.pos.row12'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row13'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row14'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.row15'), free: false, komplit: true, enterprise: true },
        // JUR-141 / JUR-145 PR 4 — Peti Kas parity rows.
        { label: t('pricingPage.comparison.groups.pos.cashDrawer'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.cashDropPayout'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.pos.cashVariance'), free: false, komplit: true, enterprise: true },
      ],
    },
    {
      icon: Package,
      title: t('pricingPage.comparison.groups.inventory.title'),
      rows: [
        { label: t('pricingPage.comparison.groups.inventory.row1'), free: true, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.inventory.row2'), free: true, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.inventory.row3'), free: true, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.inventory.row4'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.inventory.row5'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.inventory.row6'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.inventory.row7'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.inventory.row8'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.inventory.row9'), free: false, komplit: true, enterprise: true },
      ],
    },
    {
      // Booking & Reservasi is a free module for internal use; the
      // customer-facing online booking page (row2) rides on the public
      // Situs subdomain, which is Komplit-only.
      icon: Calendar,
      title: t('pricingPage.comparison.groups.booking.title'),
      rows: [
        { label: t('pricingPage.comparison.groups.booking.row1'), free: true, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.booking.row2'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.booking.row3'), free: true, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.booking.row4'), free: true, komplit: true, enterprise: true },
      ],
    },
    {
      icon: Building2,
      title: t('pricingPage.comparison.groups.outlet.title'),
      rows: [
        { label: t('pricingPage.comparison.groups.outlet.row1'), free: true, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.outlet.row2'), free: false, komplit: t('pricingPage.comparison.groups.outlet.row2Komplit'), enterprise: t('pricingPage.comparison.groups.outlet.row2Enterprise') },
        { label: t('pricingPage.comparison.groups.outlet.row3'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.outlet.row4'), free: false, komplit: false, enterprise: true },
      ],
    },
    {
      icon: Users,
      title: t('pricingPage.comparison.groups.employees.title'),
      rows: [
        { label: t('pricingPage.comparison.groups.employees.row1'), free: t('pricingPage.comparison.groups.employees.row1Free'), komplit: t('pricingPage.comparison.groups.employees.row1Paid'), enterprise: t('pricingPage.comparison.groups.employees.row1Paid') },
        { label: t('pricingPage.comparison.groups.employees.row2'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.employees.row3'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.employees.row4'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.employees.row5'), free: false, komplit: true, enterprise: true },
      ],
    },
    {
      icon: TrendingUp,
      title: t('pricingPage.comparison.groups.strategy.title'),
      rows: [
        { label: t('pricingPage.comparison.groups.strategy.row1'), free: true, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.strategy.row2'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.strategy.row3'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.strategy.row4'), free: false, komplit: false, enterprise: true },
        { label: t('pricingPage.comparison.groups.strategy.row5'), free: false, komplit: false, enterprise: true },
      ],
    },
    {
      icon: MessageCircle,
      title: t('pricingPage.comparison.groups.whatsapp.title'),
      rows: [
        { label: t('pricingPage.comparison.groups.whatsapp.row1'), free: t('pricingPage.comparison.groups.whatsapp.row1FreeKomplit'), komplit: t('pricingPage.comparison.groups.whatsapp.row1FreeKomplit'), enterprise: true },
        { label: t('pricingPage.comparison.groups.whatsapp.row2'), free: false, komplit: t('pricingPage.comparison.groups.whatsapp.row2Paid'), enterprise: t('pricingPage.comparison.groups.whatsapp.row2Paid') },
        { label: t('pricingPage.comparison.groups.whatsapp.row3'), free: false, komplit: t('pricingPage.comparison.groups.whatsapp.row2Paid'), enterprise: t('pricingPage.comparison.groups.whatsapp.row2Paid') },
        { label: t('pricingPage.comparison.groups.whatsapp.row4'), free: t('pricingPage.comparison.groups.whatsapp.row4Free'), komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.whatsapp.row5'), free: false, komplit: t('pricingPage.comparison.groups.whatsapp.row2Paid'), enterprise: t('pricingPage.comparison.groups.whatsapp.row2Paid') },
      ],
    },
    {
      // Situs (online microsite) is a Komplit-tier feature.
      icon: Globe,
      title: t('pricingPage.comparison.groups.situs.title'),
      rows: [
        { label: t('pricingPage.comparison.groups.situs.row1'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.situs.row2'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.situs.row3'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.situs.row4'), free: false, komplit: true, enterprise: true },
        { label: t('pricingPage.comparison.groups.situs.row5'), free: false, komplit: true, enterprise: true },
      ],
    },
  ]
}

function ComparisonTable() {
  const { t } = useTranslation()
  const groups = useFeatureGroups()
  const cols = {
    free: t('pricingPage.comparison.colFree'),
    komplit: t('pricingPage.comparison.colKomplit'),
    komplitMobile: t('pricingPage.comparison.colKomplitMobile'),
    enterprise: t('pricingPage.comparison.colEnterprise'),
  }
  return (
    <section className="bg-gray-50 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            {t('pricingPage.comparison.title')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {t('pricingPage.comparison.subtitle')}
          </p>
        </div>

        {/* Desktop: 4-column table. Mobile: stacked card per group. */}
        <div className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {/* Header — sticky on desktop scroll, hidden on mobile (each group has its own mini header) */}
          <div className="hidden grid-cols-[2fr_1fr_1fr_1fr] border-b border-gray-200 bg-gray-50 p-4 lg:grid">
            <div></div>
            <div className="text-center text-sm font-bold text-gray-700">{cols.free}</div>
            <div className="text-center text-sm font-bold text-brand-700">{cols.komplit}</div>
            <div className="text-center text-sm font-bold text-gray-700">{cols.enterprise}</div>
          </div>

          {groups.map((group) => (
            <FeatureGroupBlock key={group.title} group={group} cols={cols} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureGroupBlock({
  group,
  cols,
}: {
  group: FeatureGroup
  cols: { free: string; komplit: string; komplitMobile: string; enterprise: string }
}) {
  const Icon = group.icon
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-2 bg-gray-50 px-4 py-3">
        <Icon className="h-4 w-4 text-brand-600" />
        <h3 className="text-sm font-bold text-gray-900">{group.title}</h3>
      </div>
      {group.rows.map((row, idx) => (
        <FeatureRowItem key={row.label} row={row} alt={idx % 2 === 1} cols={cols} />
      ))}
    </div>
  )
}

function FeatureRowItem({
  row,
  alt,
  cols,
}: {
  row: FeatureRow
  alt: boolean
  cols: { free: string; komplit: string; komplitMobile: string; enterprise: string }
}) {
  return (
    <div
      className={cn(
        'border-b border-gray-100 last:border-b-0 lg:grid lg:grid-cols-[2fr_1fr_1fr_1fr] lg:items-center',
        alt ? 'bg-gray-50/40' : 'bg-white',
      )}
    >
      {/* Mobile layout: label on top, 3 tier values below in a row */}
      <div className="px-4 py-3 text-sm text-gray-700 lg:py-3">{row.label}</div>
      <div className="grid grid-cols-3 gap-2 px-4 pb-3 lg:contents lg:gap-0 lg:pb-0">
        <ValueCell value={row.free} mobileLabel={cols.free} />
        <ValueCell value={row.komplit} mobileLabel={cols.komplitMobile} highlight />
        <ValueCell value={row.enterprise} mobileLabel={cols.enterprise} />
      </div>
    </div>
  )
}

function ValueCell({
  value,
  mobileLabel,
  highlight,
}: {
  value: string | boolean
  mobileLabel: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 rounded-md py-2 lg:flex-row lg:gap-0 lg:rounded-none lg:py-0',
        highlight ? 'bg-brand-50/50 lg:bg-brand-50/30' : 'bg-gray-50/50 lg:bg-transparent',
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500 lg:hidden">
        {mobileLabel}
      </span>
      {typeof value === 'boolean' ? (
        value ? (
          <Check
            className={cn(
              'h-5 w-5',
              highlight ? 'text-brand-600' : 'text-success-600',
            )}
          />
        ) : (
          <Minus className="h-4 w-4 text-gray-300" />
        )
      ) : (
        <span
          className={cn(
            'text-center text-xs font-medium',
            highlight ? 'text-brand-700' : 'text-gray-700',
          )}
        >
          {value}
        </span>
      )}
    </div>
  )
}

// ─── Section: Per-module à-la-carte ────────────────────────────────

function PerModuleSection() {
  const { t } = useTranslation()
  const posTokoAnnual = planByKey('pos_toko_annual')!
  const posTokoMonthly = planByKey('pos_toko_monthly')!
  const inventoryTokoAnnual = INVENTORY_PLANS.find(
    (p) => p.key === 'inventory_toko_annual',
  )!
  const inventoryTokoMonthly = INVENTORY_PLANS.find(
    (p) => p.key === 'inventory_toko_monthly',
  )!

  const posTokoHighlights = t('pricingPage.perModule.cards.posToko.highlights', { returnObjects: true }) as string[]
  const inventoryTokoHighlights = t('pricingPage.perModule.cards.inventoryToko.highlights', { returnObjects: true }) as string[]
  const attendanceHighlights = t('pricingPage.perModule.cards.attendance.highlights', { returnObjects: true }) as string[]
  const waAiHighlights = t('pricingPage.perModule.cards.waAi.highlights', { returnObjects: true }) as string[]

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            {t('pricingPage.perModule.title')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {t('pricingPage.perModule.subtitle')}
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ModuleCard
            name={t('pricingPage.perModule.cards.posToko.name')}
            tagline={t('pricingPage.perModule.cards.posToko.tagline')}
            annualPrice={posTokoAnnual.pricePerMonth}
            monthlyPrice={posTokoMonthly.pricePerMonth}
            highlights={posTokoHighlights}
            ctaHref={WA_POS_TOKO}
          />
          <ModuleCard
            name={t('pricingPage.perModule.cards.inventoryToko.name')}
            tagline={t('pricingPage.perModule.cards.inventoryToko.tagline')}
            annualPrice={inventoryTokoAnnual.pricePerMonth}
            monthlyPrice={inventoryTokoMonthly.pricePerMonth}
            highlights={inventoryTokoHighlights}
            ctaHref={WA_INVENTORY}
          />
          <ModuleCard
            name={t('pricingPage.perModule.cards.attendance.name')}
            tagline={t('pricingPage.perModule.cards.attendance.tagline')}
            annualPrice={5000}
            monthlyPrice={8000}
            priceUnit={t('pricingPage.perModule.cards.attendance.priceUnit')}
            highlights={attendanceHighlights}
            ctaHref={WA_ATTENDANCE}
          />
          <ModuleCard
            name={t('pricingPage.perModule.cards.waAi.name')}
            tagline={t('pricingPage.perModule.cards.waAi.tagline')}
            annualPrice={49000}
            monthlyPrice={49000}
            highlights={waAiHighlights}
            ctaHref="#whatsapp-pricing"
            badge={t('pricingPage.perModule.cards.waAi.badge')}
          />
        </div>

        {/* Hint: bundle is cheaper if multiple modules */}
        <div className="mt-6 rounded-xl border border-accent-200 bg-accent-50 p-4 text-center text-sm text-accent-900">
          <Trans
            i18nKey="pricingPage.perModule.bundleHint"
            components={{ strong: <strong /> }}
          />
        </div>
      </div>
    </section>
  )
}

function ModuleCard({
  name,
  tagline,
  annualPrice,
  monthlyPrice,
  priceUnit,
  highlights,
  ctaHref,
  badge,
}: {
  name: string
  tagline: string
  annualPrice: number
  monthlyPrice: number
  priceUnit?: string
  highlights: string[]
  ctaHref: string
  badge?: string
}) {
  const { t } = useTranslation()
  const unit = priceUnit ?? t('pricingPage.perModule.priceUnitDefault')
  return (
    <div className="relative flex flex-col rounded-xl border border-gray-200 bg-white p-5">
      {badge && (
        <span className="absolute -top-2.5 right-3 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700">
          {badge}
        </span>
      )}
      <h3 className="text-base font-bold text-gray-900">{name}</h3>
      <p className="mt-0.5 text-xs text-gray-500">{tagline}</p>
      <div className="mt-3">
        <p className="flex items-baseline">
          <span className="text-2xl font-bold text-gray-900">
            Rp {formatNum(annualPrice)}
          </span>
          <span className="ml-1 text-xs text-gray-500">{unit}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-gray-500">
          {t('pricingPage.perModule.secondaryTpl', {
            monthly: formatNum(monthlyPrice),
            unit,
          })}
        </p>
      </div>
      <ul className="mt-4 mb-5 flex-1 space-y-1.5 text-xs">
        {highlights.map((h) => (
          <li key={h} className="flex items-start gap-1.5">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" />
            <span className="text-gray-600">{h}</span>
          </li>
        ))}
      </ul>
      <a
        href={ctaHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
      >
        <MessageCircle className="h-4 w-4" />
        {t('pricingPage.perModule.ctaActivate')}
      </a>
    </div>
  )
}

// ─── Section: WhatsApp AI tier ladder ─────────────────────────────
//
// The 3 tiers must stay in sync with `wa_subscription_plans` in
// Supabase AND `apps/web/src/routes/_authed/whatsapp/billing.tsx`.

function WhatsAppPricingSection() {
  const { t } = useTranslation()
  const basicHighlights = t('pricingPage.waPricing.tiers.basic.highlights', { returnObjects: true }) as string[]
  const komplitHighlights = t('pricingPage.waPricing.tiers.komplit.highlights', { returnObjects: true }) as string[]

  return (
    <section id="whatsapp-pricing" className="bg-white py-12 sm:py-16 scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-bold tracking-wider uppercase text-brand-700">
            <MessageCircle className="h-3.5 w-3.5" />
            {t('pricingPage.waPricing.badge')}
          </span>
          <h2 className="mt-3 text-2xl font-bold text-gray-900 sm:text-3xl">
            {t('pricingPage.waPricing.title')}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-600 sm:text-base">
            {t('pricingPage.waPricing.subtitle')}
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:max-w-3xl md:grid-cols-2 md:mx-auto">
          <WaTierCard
            name={t('pricingPage.waPricing.tiers.basic.name')}
            tagline={t('pricingPage.waPricing.tiers.basic.tagline')}
            priceIdr={49000}
            replies={t('pricingPage.waPricing.tiers.basic.replies')}
            instances={t('pricingPage.waPricing.tiers.basic.instances')}
            highlights={basicHighlights}
            ctaHref={WA_AI_BASIC}
          />
          <WaTierCard
            name={t('pricingPage.waPricing.tiers.komplit.name')}
            tagline={t('pricingPage.waPricing.tiers.komplit.tagline')}
            priceIdr={149000}
            replies={t('pricingPage.waPricing.tiers.komplit.replies')}
            instances={t('pricingPage.waPricing.tiers.komplit.instances')}
            popular
            highlights={komplitHighlights}
            ctaHref={WA_AI_KOMPLIT}
          />
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          <Trans
            i18nKey="pricingPage.waPricing.footnote"
            components={{
              waLink: (
                <a
                  href={`https://wa.me/${SALES_WHATSAPP_PHONE}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand-700 hover:underline"
                />
              ),
            }}
          />
        </p>
      </div>
    </section>
  )
}

// ─── Section: Konten & Branding pricing ────────────────────────────

const KONTEN_PACKS = [
  { credits: 5, priceIdr: 12_500, perCredit: 2_500 },
  { credits: 25, priceIdr: 50_000, perCredit: 2_000 },
  { credits: 50, priceIdr: 90_000, perCredit: 1_800 },
  { credits: 100, priceIdr: 140_000, perCredit: 1_400, popular: true },
] as const

function KontenPricingSection() {
  const { t } = useTranslation()
  const features = t('pricingPage.kontenPricing.features', {
    returnObjects: true,
  }) as string[]

  return (
    <section
      id="konten-pricing"
      className="bg-gradient-to-br from-accent-50/60 to-white py-12 sm:py-16 scroll-mt-20"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-100 px-3 py-1 text-xs font-bold tracking-wider uppercase text-accent-800">
            <ImageIcon className="h-3.5 w-3.5" />
            {t('pricingPage.kontenPricing.badge')}
          </span>
          <h2 className="mt-3 text-2xl font-bold text-gray-900 sm:text-3xl">
            {t('pricingPage.kontenPricing.title')}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-600 sm:text-base">
            {t('pricingPage.kontenPricing.subtitle')}
          </p>
        </div>

        {/* Feature highlights */}
        <ul className="mx-auto mt-6 grid max-w-3xl gap-2 sm:grid-cols-2">
          {features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-2 text-sm text-gray-700"
            >
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
              {f}
            </li>
          ))}
        </ul>

        {/* Credit legend */}
        <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-gray-600">
          <Trans
            i18nKey="pricingPage.kontenPricing.creditLegend"
            components={{ b: <strong className="font-semibold" /> }}
          />
        </p>

        {/* Pack grid */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {KONTEN_PACKS.map((pack) => {
            const isPopular = 'popular' in pack && pack.popular
            return (
              <div
                key={pack.credits}
                className={cn(
                  'relative flex flex-col rounded-2xl border-2 p-5',
                  isPopular
                    ? 'border-accent-500 bg-accent-50/40 shadow-md'
                    : 'border-gray-200 bg-white',
                )}
              >
                {isPopular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-700 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    {t('pricingPage.kontenPricing.popularBadge')}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-accent-600" />
                  <span className="text-lg font-bold text-gray-900">
                    {pack.credits}
                  </span>
                  <span className="text-sm text-gray-500">
                    {t('pricingPage.kontenPricing.credits')}
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold text-gray-900">
                  Rp {formatNum(pack.priceIdr)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Rp {formatNum(pack.perCredit)}{' '}
                  {t('pricingPage.kontenPricing.perCredit')}
                </p>
              </div>
            )
          })}
        </div>

        {/* Komplit gift highlight */}
        <div className="mx-auto mt-6 flex max-w-3xl items-start gap-3 rounded-xl border border-accent-200 bg-accent-50 p-4 text-sm text-accent-900">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-700" />
          <div>
            <p className="font-semibold">
              {t('pricingPage.kontenPricing.komplitGiftTitle')}
            </p>
            <p className="mt-0.5 text-xs">
              {t('pricingPage.kontenPricing.komplitGiftDesc')}
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <a
            href={WA_KONTEN_CREDITS}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-800"
          >
            <MessageCircle className="h-4 w-4" />
            {t('pricingPage.kontenPricing.cta')}
          </a>
          <p className="mt-2 text-xs text-gray-500">
            {t('pricingPage.kontenPricing.ctaHint')}
          </p>
        </div>
      </div>
    </section>
  )
}

function WaTierCard({
  name,
  tagline,
  priceIdr,
  replies,
  instances,
  highlights,
  ctaHref,
  popular,
}: {
  name: string
  tagline: string
  priceIdr: number
  replies: string
  instances: string
  highlights: string[]
  ctaHref: string
  popular?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={`relative flex flex-col rounded-2xl border-2 p-6 ${
        popular
          ? 'border-brand-500 bg-brand-50/40 shadow-md'
          : 'border-gray-200 bg-white'
      }`}
    >
      {popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          {t('pricingPage.waPricing.popularBadge')}
        </span>
      )}
      <h3 className="text-lg font-bold text-gray-900">{name}</h3>
      <p className="mt-0.5 text-xs text-gray-500">{tagline}</p>
      <div className="mt-4">
        <p className="flex items-baseline">
          <span className="text-3xl font-bold text-gray-900">
            Rp {formatNum(priceIdr)}
          </span>
          <span className="ml-1 text-sm text-gray-500">
            {t('pricingPage.perModule.priceUnitDefault')}
          </span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {t('pricingPage.waPricing.summaryTpl', { replies, instances })}
        </p>
        <p className="mt-1 text-xs font-medium text-brand-700">
          {t('pricingPage.waPricing.annualLine', {
            price: formatNum(waAnnualPrice(priceIdr)),
          })}
        </p>
      </div>
      <ul className="mt-5 mb-6 flex-1 space-y-2 text-sm">
        {highlights.map((h) => (
          <li key={h} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span className="text-gray-700">{h}</span>
          </li>
        ))}
      </ul>
      <a
        href={ctaHref}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold ${
          popular
            ? 'bg-brand-600 text-white hover:bg-brand-700'
            : 'border border-gray-300 bg-white text-gray-900 hover:bg-gray-50'
        }`}
      >
        <MessageCircle className="h-4 w-4" />
        {t('pricingPage.waPricing.ctaActivateTpl', { name })}
      </a>
    </div>
  )
}

// ─── Section: Qasir callout ────────────────────────────────────────

function QasirCallout() {
  const { t } = useTranslation()
  return (
    <section className="bg-gray-50 py-12 sm:py-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="text-center">
            <h2 className="text-xl font-bold text-gray-900 sm:text-2xl">
              {t('pricingPage.qasirCallout.title')}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {t('pricingPage.qasirCallout.subtitle')}
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border-2 border-brand-500 bg-brand-50/50 p-5">
              <div className="text-xs font-bold tracking-wide uppercase text-brand-700">
                {t('pricingPage.qasirCallout.jqHeader')}
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {t('pricingPage.qasirCallout.jqPrice')}
                <span className="ml-1 text-sm font-normal text-gray-500">
                  {t('pricingPage.qasirCallout.perYear')}
                </span>
              </p>
              <ul className="mt-3 space-y-1.5 text-sm">
                <CompareLine label={t('pricingPage.qasirCallout.jqLine1')} win />
                <CompareLine label={t('pricingPage.qasirCallout.jqLine2')} win />
                <CompareLine label={t('pricingPage.qasirCallout.jqLine3')} win />
                <CompareLine label={t('pricingPage.qasirCallout.jqLine4')} />
              </ul>
            </div>
            <div className="rounded-xl border border-gray-200 p-5">
              <div className="text-xs font-bold tracking-wide uppercase text-gray-500">
                {t('pricingPage.qasirCallout.qasirHeader')}
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {t('pricingPage.qasirCallout.qasirPrice')}
                <span className="ml-1 text-sm font-normal text-gray-500">
                  {t('pricingPage.qasirCallout.perYear')}
                </span>
              </p>
              <ul className="mt-3 space-y-1.5 text-sm">
                <CompareLine label={t('pricingPage.qasirCallout.qasirLine1')} lose />
                <CompareLine label={t('pricingPage.qasirCallout.qasirLine2')} lose />
                <CompareLine label={t('pricingPage.qasirCallout.qasirLine3')} lose />
                <CompareLine label={t('pricingPage.qasirCallout.qasirLine4')} />
              </ul>
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm font-semibold text-success-700">
              {t('pricingPage.qasirCallout.savings')}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function CompareLine({
  label,
  win,
  lose,
}: {
  label: string
  win?: boolean
  lose?: boolean
}) {
  return (
    <li className="flex items-start gap-2">
      {win && <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />}
      {lose && <Minus className="mt-0.5 h-4 w-4 shrink-0 text-danger-500" />}
      {!win && !lose && (
        <span className="mt-0.5 inline-block h-4 w-4 shrink-0" />
      )}
      <span
        className={cn(
          'text-gray-700',
          win && 'font-medium',
          lose && 'text-gray-500',
        )}
      >
        {label}
      </span>
    </li>
  )
}

// ─── Section: FAQ ──────────────────────────────────────────────────

function FaqSection() {
  const { t } = useTranslation()
  const [openIdx, setOpenIdx] = useState<number | null>(0)
  const faqs = t('pricingPage.faq.items', { returnObjects: true }) as {
    q: string
    a: string
  }[]
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            {t('pricingPage.faq.title')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {t('pricingPage.faq.subtitle')}
          </p>
        </div>

        <div className="mt-8 space-y-3">
          {faqs.map((faq, idx) => (
            <FaqItem
              key={faq.q}
              q={faq.q}
              a={faq.a}
              open={openIdx === idx}
              onToggle={() => setOpenIdx(openIdx === idx ? null : idx)}
            />
          ))}
        </div>

        <div className="mt-8 text-center text-sm text-gray-600">
          {t('pricingPage.faq.stillQuestions')}{' '}
          <a
            href={`https://wa.me/${SALES_WHATSAPP_PHONE}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-700 hover:underline"
          >
            {t('pricingPage.faq.chatLink')}
          </a>
        </div>
      </div>
    </section>
  )
}

function FaqItem({
  q,
  a,
  open,
  onToggle,
}: {
  q: string
  a: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-gray-50 sm:px-5"
      >
        <span className="text-sm font-semibold text-gray-900 sm:text-base">
          {q}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-gray-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-4 text-sm text-gray-700 sm:px-5">
          {a}
        </div>
      )}
    </div>
  )
}

// ─── Section: CTA banner ───────────────────────────────────────────

function CtaBanner() {
  const { t } = useTranslation()
  return (
    <section className="bg-gradient-to-br from-brand-700 via-brand-800 to-primary-950 py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
        <h2 className="text-2xl font-bold text-white sm:text-3xl">
          {t('pricingPage.ctaBanner.title')}
        </h2>
        <p className="mt-3 text-sm text-brand-50 sm:text-base">
          {t('pricingPage.ctaBanner.subtitle')}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/auth/register"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-bold text-brand-700 shadow-md transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            {t('pricingPage.ctaBanner.ctaFree')}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href={WA_KOMPLIT_ANNUAL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-white/40 bg-transparent px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10"
          >
            <MessageCircle className="h-4 w-4" />
            {t('pricingPage.ctaBanner.ctaConsult')}
          </a>
        </div>
      </div>
    </section>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────

function formatNum(n: number) {
  return new Intl.NumberFormat('id-ID').format(n)
}
