/**
 * JUR-185: shared public queue page renderer. Used by both:
 *   - `/q/$slug` route (path-based, direct access)
 *   - `/` index route (when accessed via subdomain like
 *     `mantra.vintra.my.id/`)
 *
 * Lifted out of the route file so the index route can render the same
 * UI without URL rewriting — fixes the SSR/CSR hydration mismatch that
 * happened when nginx rewrote `<sub>.vintra.my.id/` → `/q/<sub>` but
 * the browser URL stayed at `/`. Now both server and client decide
 * what to render based on the same loader data; no path rewriting,
 * no flash, no mismatch.
 *
 * No auth. Polls every 15s via TanStack Query so the live queue feels
 * live without WebSocket infra.
 */
import { useQuery } from '@tanstack/react-query'
import { getPublicQueueData } from '@/server/functions/public-tenant'
import { formatRupiah } from '@/lib/currency'
import { MapPin, Clock, Users, Sparkles } from 'lucide-react'

type QueueData = NonNullable<Awaited<ReturnType<typeof getPublicQueueData>>>

const DAY_LABELS_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

export function PublicQueuePage({
  slug,
  initial,
}: {
  slug: string
  initial: QueueData
}) {
  const { data: state = initial } = useQuery({
    queryKey: ['public-queue', slug],
    queryFn: async () => {
      const next = await getPublicQueueData({ data: { slug } })
      // Polling can resolve null if the tenant un-claims the slug mid-
      // session. Fall back to the seed instead of crashing the render.
      return next ?? initial
    },
    initialData: initial,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })

  const { tenant, mode, branches, services, resources, queue } = state
  const mainBranch = branches.find((b) => b.isMain) ?? branches[0] ?? null
  const todayHours = pickTodaysHours(mainBranch?.businessHours ?? null)
  const isOpen = isOpenNow(todayHours)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <main className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-6">
        {/* Header */}
        <header className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl">
            {tenant.businessName}
          </h1>
          {mainBranch?.address && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
              <MapPin className="h-3.5 w-3.5" />
              {mainBranch.address}
            </p>
          )}
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isOpen ? 'bg-success-500' : 'bg-gray-400'
              }`}
            />
            {todayHours ? (
              <span className="text-gray-700 dark:text-gray-300">
                {isOpen ? 'Buka sekarang' : 'Tutup sekarang'} ·{' '}
                <span className="text-gray-500">
                  {todayHours.open}–{todayHours.close}
                </span>
              </span>
            ) : (
              <span className="text-gray-500">Jam operasional belum diatur</span>
            )}
          </div>
        </header>

        {/* Queue card — the value prop, only for queue mode */}
        {mode === 'queue' && resources.length > 0 && (
          <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-center gap-2">
              <Users className="h-5 w-5 text-brand-600" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Antrian Sekarang
              </h2>
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-gray-400">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inset-0 animate-ping rounded-full bg-success-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success-500" />
                </span>
                LIVE
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {resources.map((r) => {
                const inProgress = queue.find(
                  (q) => q.resourceId === r.id && q.status === 'in_progress',
                )
                const waiting = queue.filter(
                  (q) => q.resourceId === r.id && q.status !== 'in_progress',
                )
                return (
                  <div
                    key={r.id}
                    className={`rounded-xl border p-4 ${
                      r.isPaused
                        ? 'border-warning-200 bg-warning-50 dark:border-warning-900/40 dark:bg-warning-950/20'
                        : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
                    }`}
                  >
                    <p className="truncate text-sm font-medium text-gray-700 dark:text-gray-300">
                      {r.name}
                      {r.isPaused && (
                        <span className="ml-2 rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] font-medium text-warning-800 dark:bg-warning-900/30 dark:text-warning-300">
                          Pause
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-gray-100">
                      {waiting.length}
                      <span className="ml-1 text-xs font-normal text-gray-500">
                        antrian
                      </span>
                    </p>
                    {inProgress && (
                      <p className="mt-1 text-xs text-success-700 dark:text-success-400">
                        ⏵ Sedang dikerjakan{' '}
                        <span className="font-mono">{inProgress.ticketNumber}</span>
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mt-4 text-center text-xs text-gray-500">
              Datang langsung untuk ambil tiket. Antrian update otomatis tiap 15 detik.
            </p>
          </section>
        )}

        {mode !== 'queue' && (
          <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Datang langsung atau hubungi kami untuk booking.
            </p>
          </section>
        )}

        {services.length > 0 && (
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
              Layanan & Harga
            </h2>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {services.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color ?? '#677084' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {s.name}
                    </p>
                    {s.durationMin > 0 && (
                      <p className="text-[11px] text-gray-500">{s.durationMin} menit</p>
                    )}
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {formatRupiah(Number(s.price))}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {mainBranch?.businessHours && mainBranch.businessHours.length > 0 && (
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <Clock className="h-4 w-4 text-gray-500" />
              Jam Operasional
            </h2>
            <ul className="space-y-1 text-sm">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                const h = mainBranch.businessHours?.find((x) => x.day === d)
                const today = new Date().getDay()
                return (
                  <li
                    key={d}
                    className={`flex items-center justify-between rounded px-2 py-1 ${
                      d === today ? 'bg-brand-50 font-medium dark:bg-brand-950/20' : ''
                    }`}
                  >
                    <span className="text-gray-700 dark:text-gray-300">
                      {DAY_LABELS_ID[d]}
                    </span>
                    <span className="text-gray-500">
                      {h ? `${h.open}–${h.close}` : 'Tutup'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <footer className="mt-12 text-center">
          <a
            href="https://vintra.my.id"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-600 dark:hover:text-brand-400"
          >
            <Sparkles className="h-3 w-3" />
            Powered by Vintra
          </a>
        </footer>
      </main>
    </div>
  )
}

export function PublicQueueNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6 text-center dark:bg-gray-900">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Halaman tidak ditemukan
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          URL ini belum diklaim oleh usaha manapun.
        </p>
        <a
          href="https://vintra.my.id"
          className="mt-6 inline-block text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          Kunjungi Vintra →
        </a>
      </div>
    </div>
  )
}

function pickTodaysHours(
  hours: Array<{ day: number; open: string; close: string }> | null,
): { open: string; close: string } | null {
  if (!hours || hours.length === 0) return null
  const today = new Date().getDay()
  const match = hours.find((h) => h.day === today)
  return match ? { open: match.open, close: match.close } : null
}

function isOpenNow(
  hours: { open: string; close: string } | null,
): boolean {
  if (!hours) return false
  const now = new Date()
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
  return timeStr >= hours.open && timeStr < hours.close
}
