import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ShoppingCart,
  TrendingUp,
  Receipt,
  ArrowRight,
} from 'lucide-react'
import { getPOSOverview } from '@/server/functions/pos'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { Button } from '@/components/ui/button'
import { formatRupiah } from '@/lib/currency'
import { cn, formatDate } from '@/lib/utils' // JUR-137

export const Route = createFileRoute('/_authed/pos/')({
  component: POSDashboard,
})

function POSDashboard() {
  const { selectedBranchId } = useBranch()
  const { t } = useTranslation()

  // Today's stats / recent sales / top items follow the topbar branch
  // selection; no branch picked ⇒ the member's full allowed set.
  const { data, isLoading } = useQuery({
    queryKey: ['pos', 'overview', selectedBranchId],
    queryFn: () =>
      getPOSOverview({ data: { branchId: selectedBranchId ?? undefined } }),
  })

  const tierLabel: Record<string, string> = {
    free: 'Gratis',
    toko: 'Toko',
    bisnis: 'Bisnis',
    multi_outlet: 'Multi-Outlet',
  }
  const tierBadgeClass: Record<string, string> = {
    free: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    toko: 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400',
    bisnis: 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400',
    multi_outlet:
      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('common.loading')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('pos.dashboardTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('pos.dashboardSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
              tierBadgeClass[data.tier],
            )}
          >
            {tierLabel[data.tier]}
          </span>
          <Link to="/pos/cashier">
            <Button variant="brand">
              <ShoppingCart className="h-4 w-4" /> {t('pos.openCashier')}
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          label={t('pos.todaySales')}
          value={`${data.today.salesCount}`}
          hint={
            data.caps.salesPerDayCap != null
              ? `dari ${data.caps.salesPerDayCap} batas/hari`
              : undefined
          }
        />
        <StatCard
          icon={<ShoppingCart className="h-5 w-5" />}
          label={t('pos.todayItemsSold')}
          value={new Intl.NumberFormat('id-ID').format(
            data.topItems.reduce((sum, it) => sum + it.qtySold, 0),
          )}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label={t('pos.todayRevenue')}
          value={formatRupiah(data.today.revenue)}
        />
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          label={t('pos.avgTicket')}
          value={formatRupiah(data.today.avgTicket)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('pos.recentSales')}>
          {data.recentSales.length === 0 ? (
            <EmptyHint>{t('pos.noSalesYet')}</EmptyHint>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {data.recentSales.map((s) => (
                <li key={s.id} className="py-3">
                  <Link
                    to="/pos/sales/$saleId"
                    params={{ saleId: s.id }}
                    className="flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-900/40"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {s.saleNumber}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(s.createdAt, 'dd MMM yyyy, HH:mm')}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {formatRupiah(Number(s.total))}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/pos/sales"
            className="mt-2 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
          >
            {t('pos.viewAllSales')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Card>

        <Card title={t('pos.topItemsToday')}>
          {data.topItems.length === 0 ? (
            <EmptyHint>{t('pos.noTopItemsYet')}</EmptyHint>
          ) : (
            <ul className="max-h-80 divide-y divide-gray-200 overflow-y-auto pr-1 dark:divide-gray-700">
              {data.topItems.map((it) => (
                <li
                  key={it.name}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <span className="text-gray-700 dark:text-gray-300">{it.name}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {it.qtySold}x
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <span className="text-brand-600 dark:text-brand-400">{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      {children}
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500">{children}</p>
}
