import { useState, useMemo } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowLeftRight, Lock } from 'lucide-react'
import { getInventoryOverview } from '@/server/functions/inventory'
import { listRequisitions } from '@/server/functions/inventory-requisitions'
import { Button } from '@/components/ui/button'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { CreateRequisitionSheet } from '@/components/inventory/create-requisition-sheet'
import { cn, formatDate } from '@/lib/utils'

type ReqStatus = 'pending' | 'approved' | 'fulfilled' | 'rejected' | 'cancelled'

export const STATUS_LABEL: Record<ReqStatus, string> = {
  pending: 'Menunggu',
  approved: 'Disetujui',
  fulfilled: 'Dipenuhi',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
}

export function statusColor(s: string): string {
  return (
    {
      pending: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
      approved: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
      fulfilled:
        'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
      rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      cancelled:
        'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    }[s] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
  )
}

export const Route = createFileRoute('/_authed/inventory/requisitions/')({
  loader: async () => {
    // The requisition list follows the topbar branch switcher (fetched
    // client-side); the loader only resolves the tier gate.
    const overview = await getInventoryOverview()
    return {
      tier: overview.tier === 'free' ? ('free' as const) : ('paid' as const),
    }
  },
  component: RequisitionsPage,
})

function RequisitionsPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { selectedBranchId } = useBranch()
  const [createOpen, setCreateOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ReqStatus | 'all'>('all')

  const reqsQuery = useQuery({
    queryKey: ['inventory', 'requisitions', selectedBranchId],
    queryFn: () =>
      listRequisitions({
        data: {
          page: 1,
          pageSize: 50,
          branchId: selectedBranchId ?? undefined,
        },
      }),
    enabled: data.tier !== 'free',
  })

  if (data.tier === 'free') {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-accent-200 bg-accent-50 p-8 text-center dark:border-accent-900/40 dark:bg-accent-900/20">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
            <Lock className="h-6 w-6 text-accent-700 dark:text-accent-400" />
          </div>
          <h2 className="text-lg font-semibold text-accent-900 dark:text-accent-200">
            Permintaan stok antar cabang
          </h2>
          <p className="mt-1 text-sm text-accent-800 dark:text-accent-300">
            Fitur ini tersedia mulai paket Toko ke atas.
          </p>
          <Link to="/inventory/billing" className="mt-4 inline-block">
            <Button variant="brand">Lihat Paket</Button>
          </Link>
        </div>
      </div>
    )
  }

  const reqs = reqsQuery.data
  const filtered = useMemo(() => {
    const items = reqs?.items ?? []
    if (statusFilter === 'all') return items
    return items.filter((r) => r.status === statusFilter)
  }, [reqs?.items, statusFilter])

  if (!reqs) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          Memuat…
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
            Permintaan Stok
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Permintaan stok antar cabang — {reqs.total} permintaan.
          </p>
        </div>
        <Button variant="brand" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Buat Permintaan
        </Button>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-2 whitespace-nowrap">
          {(
            ['all', 'pending', 'approved', 'fulfilled', 'rejected', 'cancelled'] as const
          ).map((s) => {
            const count =
              s === 'all'
                ? reqs.items.length
                : reqs.items.filter((r) => r.status === s).length
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
                {s === 'all' ? 'Semua' : STATUS_LABEL[s]}
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
          <ArrowLeftRight className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {reqs.items.length === 0
              ? 'Belum ada permintaan stok'
              : 'Tidak ada permintaan di filter ini'}
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Outlet bisa mengajukan permintaan stok ke cabang utama.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map((r) => (
              <li key={r.id}>
                <Link
                  to="/inventory/requisitions/$reqId"
                  params={{ reqId: r.id }}
                  className="flex items-center gap-3 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
                      {r.requisitionNumber}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {r.requestingBranchName} ← {r.sourceBranchName} ·{' '}
                      {formatDate(r.createdAt, 'dd MMM yyyy')}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                      statusColor(r.status),
                    )}
                  >
                    {STATUS_LABEL[r.status as ReqStatus] ?? r.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <CreateRequisitionSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (id) => {
          setCreateOpen(false)
          await router.invalidate()
          queryClient.invalidateQueries({
            queryKey: ['inventory', 'requisitions'],
          })
          router.navigate({
            to: '/inventory/requisitions/$reqId',
            params: { reqId: id },
          })
        }}
      />
    </div>
  )
}
