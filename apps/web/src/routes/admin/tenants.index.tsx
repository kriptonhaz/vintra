import { useState, useMemo, useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Search, Users, Package, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDate } from '@/lib/utils' // JUR-137
import { listTenants } from '@/server/functions/admin'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export const Route = createFileRoute('/admin/tenants/')({
  loader: () => listTenants({ data: { page: 1, pageSize: 25 } }),
  component: TenantsPage,
})

function TenantsPage() {
  const initialData = Route.useLoaderData()
  const { t } = useTranslation()
  const { toast } = useToast()
  
  const [data, setData] = useState(initialData)
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  async function loadPage(nextPage: number, currentSearch: string) {
    setRefreshing(true)
    try {
      const res = await listTenants({
        data: {
          page: nextPage,
          pageSize: 25,
          search: currentSearch || undefined,
        },
      })
      setData(res)
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal memuat',
        variant: 'error',
      })
    } finally {
      setRefreshing(false)
    }
  }

  // Handle search with a small delay (debounce)
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadPage(1, search)
    }, 400)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('admin.tenants.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('admin.tenants.subtitle', { count: data.totalCount })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <Search className="h-4 w-4 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.tenants.search')}
          className="border-0 shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.tenants.colBusinessName')}</TableHead>
              <TableHead>{t('admin.tenants.colOwner')}</TableHead>
              <TableHead>{t('admin.tenants.colStatus')}</TableHead>
              <TableHead>{t('admin.tenants.colModules')}</TableHead>
              <TableHead>{t('admin.tenants.colMembers')}</TableHead>
              <TableHead>{t('admin.tenants.colCreatedAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {refreshing ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {t('common.loading')}
                </TableCell>
              </TableRow>
            ) : data.rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {t('admin.tenants.noResults')}
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link
                      to="/admin/tenants/$tenantId"
                      params={{ tenantId: t.id }}
                      className="font-medium text-brand-700 hover:underline dark:text-brand-400"
                    >
                      {t.businessName}
                    </Link>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t.slug}
                    </p>
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-400">
                    {t.ownerEmail ?? (
                      <span className="italic text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={t.subscriptionStatus} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {t.activeModules.map((m) => (
                        <span
                          key={m}
                          className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
                        >
                          <Package className="h-3 w-3" />
                          {m}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                      <Users className="h-3 w-3" />
                      {t.memberCount}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(t.createdAt, 'dd MMM yyyy')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination footer */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('records.paginationHint', {
              page: data.page,
              totalPages: data.totalPages,
            })}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={data.page <= 1 || refreshing}
              onClick={() => loadPage(data.page - 1, search)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-xs font-medium text-gray-600 dark:text-gray-400 tabular-nums">
              {data.page} / {data.totalPages}
            </span>
            <button
              type="button"
              disabled={data.page >= data.totalPages || refreshing}
              onClick={() => loadPage(data.page + 1, search)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Derived status badge for the tenant list. Four states:
 *   - comp  → free access via an applied comp grant (JUR-194, violet)
 *   - paid  → has a currently-active paid subscription (green)
 *   - trial → trial is currently running (brand)
 *   - free  → HPP-only, never subscribed, or paid/trial expired (gray)
 * Source is derived server-side in listTenants.
 */
function StatusBadge({
  status,
}: {
  status: 'paid' | 'trial' | 'free' | 'comp'
}) {
  const { t } = useTranslation()
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium'
  const className =
    status === 'comp'
      ? `${base} bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300`
      : status === 'paid'
        ? `${base} bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400`
        : status === 'trial'
          ? `${base} bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400`
          : `${base} bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300`
  const labelKey =
    status === 'comp'
      ? 'admin.tenants.statusComp'
      : status === 'paid'
        ? 'admin.tenants.statusPaid'
        : status === 'trial'
          ? 'admin.tenants.statusTrial'
          : 'admin.tenants.statusFree'
  return <span className={className}>{t(labelKey)}</span>
}
