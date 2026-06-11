import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getReferralCap } from '@/server/functions/referrals'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Gift } from 'lucide-react'

export const Route = createFileRoute('/_authed/referrals')({
  // Cap is needed by both child pages (the codes form caps the split;
  // the commission view shows the in-effect cap on attributions).
  // Loading it once at the layout level lets both children pick it up
  // from React Query cache with no extra round trip.
  //
  // `getReferralCap` now throws via `requireReferralAccess` when the
  // tenant isn't on the referral allowlist. Catch it and bounce to
  // the dashboard — the sidebar entry is already hidden for these
  // tenants, so this guard only fires on a direct-URL / bookmark hit.
  loader: async () => {
    try {
      return await getReferralCap()
    } catch {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: ReferralsLayout,
})

function ReferralsLayout() {
  const initialCap = Route.useLoaderData()
  const { data: capData = initialCap } = useQuery({
    queryKey: ['referral-cap'],
    queryFn: () => getReferralCap(),
    initialData: initialCap,
    staleTime: 10 * 60_000,
  })
  const cap = capData.capPct

  const { pathname } = useLocation()
  const tab: 'codes' | 'pendaftar' | 'commission' =
    pathname.startsWith('/referrals/commission')
      ? 'commission'
      : pathname.startsWith('/referrals/pendaftar')
        ? 'pendaftar'
        : 'codes'

  return (
    <div className="space-y-6">
      {/* Info card — shared between codes + commission tabs. Frames the
          program for first-time tenants who don't yet know what
          "discount + commission ≤ cap" means. */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/30">
              <Gift className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <CardTitle>Program Referral</CardTitle>
              <CardDescription className="mt-1">
                Bagikan kode ke teman pengusaha Anda. Mereka dapat diskon, Anda dapat komisi.
                Cap saat ini: <strong>{cap.toFixed(2)}%</strong> — total discount + komisi per kode tidak boleh melebihi nilai ini.
              </CardDescription>
              <p className="mt-2 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
                Diskon referral hanya berlaku untuk paket utama (POS,
                Inventory, Absensi / Komplit). Modul tambahan seperti{' '}
                <strong>WhatsApp AI</strong> tidak termasuk.
              </p>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Tab bar — Link components so the active state is URL-derived
          (no internal state to keep in sync). matches the pattern used
          on /pos and /attendance subpages. */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        <Link
          to="/referrals"
          className={
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
            (tab === 'codes'
              ? 'border-brand-600 text-brand-700 dark:text-brand-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')
          }
        >
          Kode
        </Link>
        <Link
          to="/referrals/pendaftar"
          className={
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
            (tab === 'pendaftar'
              ? 'border-brand-600 text-brand-700 dark:text-brand-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')
          }
        >
          Pendaftar
        </Link>
        <Link
          to="/referrals/commission"
          className={
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
            (tab === 'commission'
              ? 'border-brand-600 text-brand-700 dark:text-brand-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')
          }
        >
          Komisi
        </Link>
      </div>

      <Outlet />
    </div>
  )
}
