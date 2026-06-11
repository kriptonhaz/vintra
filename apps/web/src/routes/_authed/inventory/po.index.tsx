import { useState, useMemo } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, ShoppingCart, Lock, Search } from 'lucide-react'
import { getInventoryOverview } from '@/server/functions/inventory'
import { listPurchaseOrders } from '@/server/functions/inventory-po'
import { useBranch } from '@/hooks/use-branch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { CreatePoSheet } from '@/components/inventory/create-po-sheet'
import { formatRupiah } from '@/lib/currency'
import { cn, formatDate } from '@/lib/utils' // JUR-137

type PoStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled'

export const Route = createFileRoute('/_authed/inventory/po/')({
  loader: async () => {
    // The PO list follows the topbar branch switcher (fetched
    // client-side); the loader only resolves the tier gate.
    const overview = await getInventoryOverview()
    return {
      tier: overview.tier === 'free' ? ('free' as const) : ('paid' as const),
      overview,
    }
  },
  component: PoPage,
})

function PoPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const { selectedBranchId } = useBranch()
  const poQuery = useQuery({
    queryKey: ['inventory', 'po', selectedBranchId],
    queryFn: () =>
      listPurchaseOrders({
        data: {
          page: 1,
          pageSize: 50,
          branchId: selectedBranchId ?? undefined,
        },
      }),
    enabled: data.tier !== 'free',
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<PoStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  if (data.tier === 'free') {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-accent-200 bg-accent-50 p-8 text-center dark:border-accent-900/40 dark:bg-accent-900/20">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
            <Lock className="h-6 w-6 text-accent-700 dark:text-accent-400" />
          </div>
          <h2 className="text-lg font-semibold text-accent-900 dark:text-accent-200">
            {t('inventory.poUpgradeTitle')}
          </h2>
          <p className="mt-1 text-sm text-accent-800 dark:text-accent-300">
            {t('inventory.poUpgradeBody')}
          </p>
          <Link to="/inventory/billing" className="mt-4 inline-block">
            <Button variant="brand">{t('inventory.poUpgradeCta')}</Button>
          </Link>
        </div>
      </div>
    )
  }

  const pos = poQuery.data

  // Distinct supplier names for the filter dropdown.
  const supplierNames = useMemo(() => {
    const set = new Set<string>()
    for (const p of pos?.items ?? []) if (p.supplierName) set.add(p.supplierName)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [pos?.items])

  // Filter rows in-memory rather than refiring the server query — the
  // page size is capped at 50 PO rows, well within client-side filter
  // territory. If we ever paginate properly, swap this for a refetch.
  //
  // `searchScoped` applies search + supplier filter but NOT status, so
  // the status chip counts below stay accurate for the current search.
  const searchScoped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null
    return (pos?.items ?? []).filter((p) => {
      if (supplierFilter && p.supplierName !== supplierFilter) return false
      if (fromTs !== null || toTs !== null) {
        const ts = new Date(p.createdAt).getTime()
        if (fromTs !== null && ts < fromTs) return false
        if (toTs !== null && ts > toTs) return false
      }
      if (!q) return true
      return (
        p.poNumber.toLowerCase().includes(q) ||
        (p.supplierName ?? '').toLowerCase().includes(q) ||
        (p.branchName ?? '').toLowerCase().includes(q)
      )
    })
  }, [pos?.items, searchQuery, supplierFilter, dateFrom, dateTo])

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return searchScoped
    return searchScoped.filter((p) => p.status === statusFilter)
  }, [searchScoped, statusFilter])

  if (!pos) {
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('inventory.poTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('inventory.poSubtitle', { count: pos.total })}
          </p>
        </div>
        <Button variant="brand" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('inventory.poCreate')}
        </Button>
      </div>

      {/* Search + supplier + date filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="relative flex-1 sm:min-w-[14rem]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('inventory.poSearchPlaceholder')}
            className="pl-9"
          />
        </div>
        {supplierNames.length > 0 && (
          <div className="sm:w-56">
            <Select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              options={[
                { value: '', label: t('inventory.poAllSuppliers') },
                ...supplierNames.map((n) => ({ value: n, label: n })),
              ]}
            />
          </div>
        )}
        <DateInput
          label={t('inventory.poDateFrom')}
          value={dateFrom}
          onChange={setDateFrom}
          max={dateTo || undefined}
          className="sm:w-44"
        />
        <DateInput
          label={t('inventory.poDateTo')}
          value={dateTo}
          onChange={setDateTo}
          min={dateFrom || undefined}
          className="sm:w-44"
        />
      </div>

      {/* Status filter chips. "All" is the default; clicking again
          deselects (returns to all). Counts are derived live so users
          see how many POs are in each bucket without firing a query. */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-2 whitespace-nowrap">
          {(
            ['all', 'draft', 'sent', 'partial', 'received', 'cancelled'] as const
          ).map((s) => {
            const count =
              s === 'all'
                ? searchScoped.length
                : searchScoped.filter((p) => p.status === s).length
            const active = statusFilter === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/50',
                )}
              >
                {t(`inventory.poStatus_${s}`)}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                    active
                      ? 'bg-brand-600 text-white'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {pos.items.length === 0
              ? t('inventory.poEmptyTitle')
              : t('inventory.poFilterEmptyTitle')}
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {pos.items.length === 0
              ? t('inventory.poEmptyBody')
              : t('inventory.poFilterEmptyBody')}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map((po) => (
              <li key={po.id}>
                <Link
                  to="/inventory/po/$poId"
                  params={{ poId: po.id }}
                  className="flex items-center gap-3 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
                      {po.poNumber}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {po.supplierName} · {po.branchName} ·{' '}
                      {formatDate(po.createdAt, 'dd MMM yyyy')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">
                      {formatRupiah(po.subtotal)}
                    </p>
                    <span
                      className={cn(
                        'mt-0.5 inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                        statusColor(po.status),
                      )}
                    >
                      {t(`inventory.poStatus_${po.status}`)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <CreatePoSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (newPoId) => {
          setCreateOpen(false)
          await router.invalidate()
          queryClient.invalidateQueries({ queryKey: ['inventory', 'po'] })
          // Jump to detail so the user sees what they just made and
          // can mark it sent / receive when ready.
          router.navigate({ to: '/inventory/po/$poId', params: { poId: newPoId } })
        }}
      />
    </div>
  )
}

function statusColor(s: string) {
  return (
    {
      draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
      sent: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
      partial: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
      received:
        'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
      cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    }[s] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
  )
}
