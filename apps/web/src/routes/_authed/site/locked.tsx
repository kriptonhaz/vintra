/**
 * JUR-176: Komplit upsell landing for the Situs feature.
 *
 * Reached when a free/Toko tenant clicks the "Situs · Pro 🔒" sidebar
 * entry, OR when they try to deep-link to /site/edit or
 * /site/analytics. Komplit tenants are bounced from this page
 * straight to the editor so it never becomes a dead end for them.
 *
 * The copy leans into what Komplit unlocks (custom landing,
 * subdomain, visit analytics) rather than feature-list bullets —
 * conversion is the goal, not exhaustive docs.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Globe, Sparkles, BarChart3, Palette, ArrowRight, Lock } from 'lucide-react'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'

export const Route = createFileRoute('/_authed/site/locked')({
  beforeLoad: ({ context }) => {
    // Komplit tenants get sent straight to the editor — this page
    // shouldn't be reachable if they already have access.
    const user = (
      context as {
        user?: {
          moduleSubscriptions?: { pos?: { features?: ReadonlyArray<string> } }
        }
      }
    ).user
    if (user?.moduleSubscriptions?.pos?.features?.includes('tenant_site')) {
      throw redirect({ to: '/site/edit' })
    }
  },
  component: SiteLockedPage,
})

function SiteLockedPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <ModuleBreadcrumb />
      <div className="mx-auto max-w-3xl px-4 pt-4 pb-16 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
              Situs
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-800 dark:bg-accent-900/30 dark:text-accent-300">
                <Lock className="h-2.5 w-2.5" />
                Pro
              </span>
            </h1>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
              Halaman publik untuk usaha Anda — termasuk di paket Komplit.
            </p>
          </div>
        </div>

        {/* Hero card */}
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-700 p-8 text-white shadow-xl">
          <Sparkles className="mb-3 h-7 w-7 opacity-80" />
          <h2 className="text-2xl font-bold sm:text-3xl">
            Punya halaman web sendiri, tanpa biaya tambahan.
          </h2>
          <p className="mt-3 max-w-xl text-base opacity-90">
            Tenant Komplit dapat URL khusus seperti{' '}
            <span className="font-mono">usaha-anda.vintra.my.id</span> — bisa
            dibagikan ke customer, dipasang di paket WhatsApp, atau jadi link IG bio.
          </p>
          <a
            href="/pricing"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-brand-700 shadow-lg transition hover:scale-105"
          >
            Lihat Paket Komplit
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        {/* Feature highlights */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <FeatureCard
            icon={<Palette className="h-5 w-5" />}
            title="Editor modular"
            desc="Atur section apa saja yang muncul, urutannya, dan warnanya. Tanpa coding."
          />
          <FeatureCard
            icon={<Globe className="h-5 w-5" />}
            title="URL khusus"
            desc="Klaim <slug>.vintra.my.id. SSL otomatis, langsung bisa dipakai."
          />
          <FeatureCard
            icon={<BarChart3 className="h-5 w-5" />}
            title="Analitik kunjungan"
            desc="Lihat berapa pengunjung per hari, dari mana mereka datang, dan tren mingguan."
          />
        </div>

        <p className="mt-8 text-center text-xs text-gray-500">
          Sudah berlangganan Komplit tapi belum lihat menu Situs?{' '}
          <a href="/dashboard" className="text-brand-700 hover:underline dark:text-brand-400">
            Refresh dashboard
          </a>
          .
        </p>
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{desc}</p>
    </div>
  )
}
