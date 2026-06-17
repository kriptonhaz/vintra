import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getMyCodeBudget } from '@/server/functions/marketing-codes'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Megaphone } from 'lucide-react'

export const Route = createFileRoute('/_authed/marketing')({
  // Guard: getMyCodeBudget throws via requireMarketingAgent when the caller
  // isn't an active agent. The sidebar entry is already hidden for
  // non-agents, so this only fires on a direct-URL / bookmark hit.
  loader: async () => {
    try {
      return await getMyCodeBudget()
    } catch {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: MarketingLayout,
})

function MarketingLayout() {
  const initial = Route.useLoaderData()
  const { data = initial } = useQuery({
    queryKey: ['marketing', 'code-budget'],
    queryFn: () => getMyCodeBudget(),
    initialData: initial,
    staleTime: 5 * 60_000,
  })
  const budget = data.budgetPct
  const isHead = data.role === 'head'

  const { pathname } = useLocation()
  const tab: 'codes' | 'referrals' | 'commission' | 'team' =
    pathname.startsWith('/marketing/commission')
      ? 'commission'
      : pathname.startsWith('/marketing/referrals')
        ? 'referrals'
        : pathname.startsWith('/marketing/team')
          ? 'team'
          : 'codes'

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/30">
              <Megaphone className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <CardTitle>
                Marketing Vintra{' '}
                <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 align-middle text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                  {isHead ? 'Kepala' : 'Staf'}
                </span>
              </CardTitle>
              <CardDescription className="mt-1">
                Bagikan kode Anda ke calon pelanggan. Mereka dapat diskon, Anda dapat
                komisi setiap kali mereka berlangganan. Budget Anda saat ini:{' '}
                <strong>{budget.toFixed(2)}%</strong> — total diskon + komisi per
                kode tidak boleh melebihi nilai ini.
                {isHead && (
                  <>
                    {' '}Sebagai kepala, Anda juga mendapat komisi override dari setiap
                    penjualan staf di tim Anda.
                  </>
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        <Link
          to="/marketing"
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
          to="/marketing/referrals"
          className={
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
            (tab === 'referrals'
              ? 'border-brand-600 text-brand-700 dark:text-brand-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')
          }
        >
          Referral
        </Link>
        <Link
          to="/marketing/commission"
          className={
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
            (tab === 'commission'
              ? 'border-brand-600 text-brand-700 dark:text-brand-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')
          }
        >
          Komisi
        </Link>
        {isHead && (
          <Link
            to="/marketing/team"
            className={
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
              (tab === 'team'
                ? 'border-brand-600 text-brand-700 dark:text-brand-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')
            }
          >
            Tim
          </Link>
        )}
      </div>

      <Outlet />
    </div>
  )
}
