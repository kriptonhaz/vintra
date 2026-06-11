import { createFileRoute, Link } from '@tanstack/react-router'
import { Bot, AlertTriangle, Lock, RefreshCw, Info } from 'lucide-react'
import { getWaSubscription, listWaInstances } from '@/server/functions/whatsapp'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { formatNumberID } from '@/lib/utils' // JUR-137

/**
 * Dashboard loader (JUR-84).
 *
 * Previously this swallowed every error as `null` and rendered "Belum
 * ada paket aktif" for ALL failure modes — Forbidden, api crash, and
 * "no plan" all looked identical. That made debugging miserable and
 * misled tenants who DID have an active plan into thinking they didn't.
 *
 * Now each subscription failure is tagged so the UI renders the right
 * state:
 *   - forbidden  → caller lacks `whatsapp.read` (shouldn't reach the
 *     route since sidebar hides it, but defense-in-depth for direct
 *     URL access)
 *   - error      → api/network failure; show retry CTA
 *   - no-plan    → subscription resolved but tier=free/maxReplies=0
 *   - ok         → has an active plan; render the dashboard
 *
 * Instances are always optional — failing to load them just means the
 * "Instansi Tersambung" card shows 0/0; not worth blocking the whole
 * page on.
 */
type SubResult =
  | { status: 'ok'; data: Awaited<ReturnType<typeof getWaSubscription>> }
  | { status: 'forbidden' }
  | { status: 'error'; message: string }

function classifySubError(err: unknown): SubResult {
  const msg = err instanceof Error ? err.message : String(err)
  // requirePermission throws 'Forbidden' literally; the apiFetch wrapper
  // hands back the api's response body verbatim, which for a 403 would
  // also contain "Forbidden" or "forbidden". Match both.
  if (/forbidden/i.test(msg)) return { status: 'forbidden' }
  return { status: 'error', message: msg }
}

export const Route = createFileRoute('/_authed/whatsapp/dashboard')({
  loader: async (): Promise<{
    sub: SubResult
    instances: Array<{ status: string }>
  }> => {
    const [subSettled, instancesSettled] = await Promise.allSettled([
      getWaSubscription(),
      listWaInstances(),
    ])
    const sub: SubResult =
      subSettled.status === 'fulfilled'
        ? { status: 'ok', data: subSettled.value }
        : classifySubError(subSettled.reason)
    const instances =
      instancesSettled.status === 'fulfilled'
        ? (instancesSettled.value as Array<{ status: string }>)
        : []
    return { sub, instances }
  },
  component: WaDashboardPage,
})

const TIER_LABEL: Record<string, string> = {
  basic: 'Basic',
  komplit: 'Komplit',
  enterprise: 'Enterprise',
  free: 'Free',
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Dashboard WhatsApp AI
        </h1>
      </div>
      {children}
    </div>
  )
}

function WaDashboardPage() {
  const { sub, instances } = Route.useLoaderData()

  if (sub.status === 'forbidden') {
    return (
      <PageShell>
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center dark:border-gray-600">
          <Lock className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Kamu tidak memiliki akses ke modul WhatsApp
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Hubungi pemilik atau admin tenant kalau kamu butuh akses ke fitur ini.
          </p>
          <Link
            to="/dashboard"
            className="mt-4 inline-block text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
          >
            Kembali ke Dashboard
          </Link>
        </div>
      </PageShell>
    )
  }

  if (sub.status === 'error') {
    return (
      <PageShell>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900 dark:text-red-200">
                Gagal memuat data WhatsApp
              </p>
              <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                Coba muat ulang halaman. Kalau masalahnya berlanjut, hubungi tim
                support.
              </p>
              {/* Hidden details for the operator-friendly variant — we
                  do NOT want to leak raw error text to end users, but
                  it's useful when reading the diff. */}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Muat ulang
              </button>
            </div>
          </div>
        </div>
      </PageShell>
    )
  }

  const subscription = sub.data
  // The api returns maxMonthlyReplies=0 when the tenant has no active
  // plan (or it expired). Treat that as "no plan" rather than a 100%
  // utilization state — same intent as the previous code, but only
  // takes effect AFTER we've ruled out forbidden + error above.
  const hasPlan = subscription && subscription.maxMonthlyReplies > 0

  if (!hasPlan) {
    return (
      <PageShell>
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center dark:border-gray-600">
          <Bot className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Belum ada paket WhatsApp AI aktif
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Hubungi admin untuk mengaktifkan paket Basic, Komplit, atau Enterprise.
          </p>
        </div>
      </PageShell>
    )
  }

  const pct = Math.min(
    100,
    Math.round((subscription.usedReplies / subscription.maxMonthlyReplies) * 100),
  )
  const nearLimit = pct >= 90
  const connectedCount = instances.filter((i) => i.status === 'connected').length

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard WhatsApp AI</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Ringkasan penggunaan bulan ini.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Paket Aktif" value={TIER_LABEL[subscription.tier] ?? subscription.tier} />
        <StatCard label="Instansi Tersambung" value={`${connectedCount} / ${instances.length}`} />
        <StatCard label="Balasan AI Bulan Ini" value={`${formatNumberID(subscription.usedReplies)} / ${formatNumberID(subscription.maxMonthlyReplies)}`} />
      </div>

      <MediaRetentionNotice />

      <div className={`rounded-xl border p-5 ${nearLimit ? 'border-warning-300 bg-warning-50 dark:border-warning-700 dark:bg-warning-900/20' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Kuota Balasan AI</p>
          {nearLimit && (
            <span className="flex items-center gap-1 text-xs font-medium text-warning-700 dark:text-warning-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Hampir mencapai batas
            </span>
          )}
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div className={`h-3 rounded-full transition-all ${nearLimit ? 'bg-warning-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {formatNumberID(subscription.usedReplies)} dari {formatNumberID(subscription.maxMonthlyReplies)} balasan digunakan
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</p>
      <p className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  )
}

/**
 * 24-hour media retention notice. Surfaced on the WhatsApp dashboard so
 * tenants understand the JUR-79 S3 lifecycle policy (kind=wa-media,
 * 1-day expiry) before they hit a "media tidak tersedia" placeholder
 * mid-conversation. Pairs with the chat composer's tooltip on the
 * instance detail page for in-flow reinforcement.
 */
function MediaRetentionNotice() {
  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 dark:border-primary-800 dark:bg-primary-900/20">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400" />
        <div>
          <p className="text-sm font-medium text-primary-900 dark:text-primary-200">
            Media WhatsApp disimpan 24 jam
          </p>
          <p className="mt-1 text-xs text-primary-800 dark:text-primary-300">
            Foto, video, dan dokumen yang dikirim atau diterima lewat WhatsApp
            otomatis dihapus dari penyimpanan setelah 24 jam. Pesan teks tetap
            tersimpan permanen, tapi pratinjau media akan menampilkan
            &ldquo;Media tidak tersedia&rdquo;. Simpan file penting di tempat
            lain kalau dibutuhkan jangka panjang.
          </p>
        </div>
      </div>
    </div>
  )
}
