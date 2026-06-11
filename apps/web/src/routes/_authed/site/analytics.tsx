/**
 * JUR-176 follow-up: tenant public-site analytics dashboard.
 *
 * Three stats up top (today / 7-day / 30-day, with unique visitors
 * inline), one daily bar chart, and a top-referrers list. No charts
 * library — plain CSS bars are good enough for the numbers we're
 * showing and ship 0 KB.
 *
 * Permission gate: `booking.write` to match the editor. Future:
 * unbundle into a dedicated `site.read` if we want supervisors to
 * see analytics without edit rights.
 */
import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getSiteAnalyticsSummary } from '@/server/functions/site-analytics'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { cn } from '@/lib/utils'
import { BarChart3, Users, Eye, TrendingUp, Link as LinkIcon, ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/_authed/site/analytics')({
  beforeLoad: ({ context }) => {
    const user = (
      context as {
        user?: {
          permissions?: string[]
          moduleSubscriptions?: { pos?: { features?: ReadonlyArray<string> } }
        }
      }
    ).user
    if (!user?.permissions?.includes('booking.write')) {
      throw redirect({ to: '/dashboard' })
    }
    if (!user.moduleSubscriptions?.pos?.features?.includes('tenant_site')) {
      throw redirect({ to: '/site/locked' })
    }
  },
  component: SiteAnalyticsPage,
})

function SiteAnalyticsPage() {
  const [rangeDays, setRangeDays] = useState<7 | 14 | 30 | 90>(30)
  const { data, isLoading } = useQuery({
    queryKey: ['site-analytics', rangeDays],
    queryFn: () => getSiteAnalyticsSummary({ data: { rangeDays } }),
    staleTime: 60_000,
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <ModuleBreadcrumb />
      <div className="mx-auto max-w-6xl px-4 pt-4 pb-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
              <BarChart3 className="h-6 w-6 text-brand-600" />
              Analitik Situs
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Lalu lintas halaman publik Anda — bukan analytics dashboard Vintra.
            </p>
          </div>
          <RangePicker value={rangeDays} onChange={setRangeDays} />
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonStatCard key={i} />
            ))}
          </div>
        ) : !data ? (
          <p className="rounded-2xl bg-white px-5 py-8 text-center text-sm text-gray-500 dark:bg-gray-800">
            Belum ada data.
          </p>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                icon={<Eye className="h-5 w-5" />}
                label="Hari Ini"
                value={data.todayVisits}
                hint="kunjungan"
              />
              <StatCard
                icon={<TrendingUp className="h-5 w-5" />}
                label={`${rangeDays} Hari Terakhir`}
                value={data.totalVisits}
                hint="kunjungan total"
              />
              <StatCard
                icon={<Users className="h-5 w-5" />}
                label="Pengunjung Unik"
                value={data.uniqueVisitors}
                hint={`dalam ${rangeDays} hari (per IP per hari)`}
              />
            </div>

            {/* Daily chart */}
            <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Tren Harian
              </h2>
              <p className="mt-0.5 mb-5 text-xs text-gray-500">
                Bar = total kunjungan per hari. Dihitung pakai zona waktu Jakarta.
              </p>
              <DailyBarChart days={data.daily} rangeDays={rangeDays} />
            </section>

            {/* Top referrers */}
            <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <LinkIcon className="h-4 w-4 text-gray-500" />
                Sumber Trafik Teratas
              </h2>
              <p className="mt-0.5 mb-3 text-xs text-gray-500">
                Dari mana pengunjung datang (referer header). Kosong = pengunjung mengetik URL langsung atau via WhatsApp/iOS app yang menutup referrer.
              </p>
              {data.topReferrers.length === 0 ? (
                <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-xs text-gray-500 dark:bg-gray-900/40">
                  Belum ada data referrer.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.topReferrers.map((r) => (
                    <li
                      key={r.referrer ?? 'unknown'}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm"
                    >
                      <a
                        href={r.referrer ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-gray-700 hover:text-brand-600 dark:text-gray-300"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <span className="truncate">
                          {displayReferrer(r.referrer)}
                        </span>
                      </a>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                        {r.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="mt-6 text-center text-xs text-gray-400">
              Pengukuran dilakukan saat halaman dimuat di server (SSR). Polling antrian
              setiap 15 detik tidak dihitung sebagai kunjungan terpisah.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Range picker ────────────────────────────────────────────────────

function RangePicker({
  value,
  onChange,
}: {
  value: 7 | 14 | 30 | 90
  onChange: (v: 7 | 14 | 30 | 90) => void
}) {
  const options: Array<{ value: 7 | 14 | 30 | 90; label: string }> = [
    { value: 7, label: '7H' },
    { value: 14, label: '14H' },
    { value: 30, label: '30H' },
    { value: 90, label: '90H' },
  ]
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-semibold transition',
            value === opt.value
              ? 'bg-brand-600 text-white shadow-sm'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ─── Stat card ───────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: number
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
        <span className="text-brand-600">{icon}</span>
        {label}
      </div>
      <p className="mt-3 text-3xl font-bold text-gray-900 dark:text-gray-100">
        {value.toLocaleString('id-ID')}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

function SkeletonStatCard() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="h-3 w-20 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="mt-4 h-8 w-16 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="mt-2 h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
    </div>
  )
}

// ─── Daily bar chart ─────────────────────────────────────────────────

function DailyBarChart({
  days,
  rangeDays,
}: {
  days: Array<{ day: string; total: number; unique: number }>
  rangeDays: number
}) {
  // Build a complete day series (filling zero rows for days with no
  // visits) so the bar chart's gaps don't lie about the cadence.
  const today = new Date()
  const series: Array<{ day: string; total: number; unique: number }> = []
  const byDay = new Map(days.map((d) => [d.day, d]))
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const iso = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
    const entry = byDay.get(iso)
    series.push({
      day: iso,
      total: entry?.total ?? 0,
      unique: entry?.unique ?? 0,
    })
  }
  const max = Math.max(1, ...series.map((s) => s.total))

  return (
    <div>
      <div className="flex h-44 items-end gap-1 sm:gap-1.5">
        {series.map((s) => {
          const heightPct = (s.total / max) * 100
          return (
            <div
              key={s.day}
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${formatDayShort(s.day)}: ${s.total} kunjungan · ${s.unique} unik`}
            >
              <div className="relative w-full">
                <div
                  className="w-full rounded-t-md bg-brand-600 transition-all group-hover:bg-brand-700"
                  style={{ height: `${Math.max(2, heightPct * 1.6)}px` }}
                />
                {s.total > 0 && (
                  <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {s.total}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {/* X axis — every Nth day depending on range */}
      <div className="mt-2 flex justify-between text-[10px] text-gray-400">
        <span>{formatDayShort(series[0]?.day)}</span>
        {series.length > 14 && (
          <span>{formatDayShort(series[Math.floor(series.length / 2)]?.day)}</span>
        )}
        <span>Hari ini</span>
      </div>
    </div>
  )
}

function formatDayShort(iso: string | undefined): string {
  if (!iso) return ''
  // iso is YYYY-MM-DD in Jakarta tz already.
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function displayReferrer(ref: string | null): string {
  if (!ref) return '(direct)'
  try {
    const u = new URL(ref)
    return u.host + (u.pathname !== '/' ? u.pathname : '')
  } catch {
    return ref
  }
}
