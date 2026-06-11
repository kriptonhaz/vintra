import { useState, useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Package,
  AlertTriangle,
  Wallet,
  Building2,
  ArrowRight,
  Pencil,
} from 'lucide-react'
import {
  getInventoryOverview,
  setInventoryMainBranch,
} from '@/server/functions/inventory'
import { listBranches } from '@/server/functions/attendance-branches'
import { formatRupiah, formatRupiahShort } from '@/lib/currency'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/inventory/')({
  component: InventoryDashboard,
})

function InventoryDashboard() {
  const { selectedBranchId } = useBranch()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)

  // Overview re-fetches whenever the topbar branch selection changes —
  // the stock stats (low-stock, stock value) reflect that branch.
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'overview', selectedBranchId],
    queryFn: () =>
      getInventoryOverview({
        data: { branchId: selectedBranchId ?? undefined },
      }),
  })

  // Tier label + colour for the badge.
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
            {t('inventory.dashboardTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('inventory.dashboardSubtitle')}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
            tierBadgeClass[data.tier],
          )}
        >
          {tierLabel[data.tier]}
        </span>
      </div>

      {/* Hero stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Package className="h-5 w-5" />}
          label={t('inventory.statActiveSku')}
          value={`${data.usage.activeItems}${data.caps.skuCap != null ? ` / ${data.caps.skuCap}` : ''}`}
          tone="brand"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label={t('inventory.statLowStock')}
          value={String(data.usage.lowStockItems)}
          tone={data.usage.lowStockItems > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          label={t('inventory.statStockValue')}
          value={formatRupiahShort(data.usage.stockValueIdr)}
          valueTitle={formatRupiah(data.usage.stockValueIdr)}
          tone="success"
        />
        <StatCard
          icon={<Building2 className="h-5 w-5" />}
          label={t('inventory.statBranches')}
          value={`${data.usage.branches}${data.caps.branchCap != null ? ` / ${data.caps.branchCap}` : ''}`}
          tone="neutral"
        />
      </div>

      {/* Main inventory branch — Free tier locks all stock to one
          branch; Toko+ ignores this and uses every branch, but we
          still surface the default here so the picker is consistent. */}
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {data.tier === 'free'
                ? t('inventory.mainBranchLabelFree')
                : t('inventory.mainBranchLabelPaid')}
            </p>
            <p className="mt-0.5 text-base font-semibold text-gray-900 dark:text-gray-100">
              {data.mainBranch?.name ?? t('inventory.mainBranchNone')}
            </p>
            {data.tier === 'free' && (
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t('inventory.mainBranchFreeHint')}
              </p>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={() => setPickerOpen(true)} className="gap-1">
          <Pencil className="h-4 w-4" />
          {t('inventory.mainBranchChange')}
        </Button>
      </div>

      <MainBranchDialog
        open={pickerOpen}
        currentBranchId={data.mainBranch?.id ?? null}
        onClose={() => setPickerOpen(false)}
        onSaved={async () => {
          setPickerOpen(false)
          toast({
            title: t('common.toastSavedTitle'),
            description: t('inventory.mainBranchSavedToast'),
            variant: 'success',
          })
          await queryClient.invalidateQueries({
            queryKey: ['inventory', 'overview'],
          })
        }}
        onError={(msg) =>
          toast({
            title: t('common.toastFailedTitle'),
            description: msg,
            variant: 'error',
          })
        }
      />

      {/* Quick actions */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('inventory.quickActionsTitle')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickAction
            href="/inventory/items"
            title={t('inventory.actionManageItems')}
            description={t('inventory.actionManageItemsDesc')}
          />
          <QuickAction
            href="/inventory/movements"
            title={t('inventory.actionRecordMovement')}
            description={t('inventory.actionRecordMovementDesc')}
          />
          {data.tier !== 'free' && (
            <QuickAction
              href="/inventory/po"
              title={t('inventory.actionPo')}
              description={t('inventory.actionPoDesc')}
            />
          )}
        </div>
      </div>

      {/* Free tier upgrade nudge */}
      {data.tier === 'free' && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-900/40 dark:bg-brand-900/20">
          <h2 className="font-semibold text-brand-900 dark:text-brand-200">
            {t('inventory.upgradeNudgeTitle')}
          </h2>
          <p className="mt-1 text-sm text-brand-800 dark:text-brand-300">
            {t('inventory.upgradeNudgeBody')}
          </p>
          <Link
            to="/inventory/billing"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            {t('inventory.upgradeNudgeCta')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  valueTitle,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  valueTitle?: string
  tone: 'brand' | 'success' | 'warning' | 'neutral'
}) {
  const toneIcon = {
    brand: 'bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400',
    success: 'bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-400',
    warning:
      'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
    neutral: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  }[tone]
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-md', toneIcon)}>
          {icon}
        </div>
      </div>
      <p
        title={valueTitle}
        className="mt-2 truncate text-2xl font-bold text-gray-900 dark:text-gray-100"
      >
        {value}
      </p>
    </div>
  )
}

function MainBranchDialog({
  open,
  currentBranchId,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean
  currentBranchId: string | null
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const { t } = useTranslation()
  const { data: branches = [], isLoading } = useQuery({
    queryKey: ['branches', 'all'],
    queryFn: () => listBranches(),
    enabled: open,
    staleTime: 60_000,
  })
  const [selected, setSelected] = useState<string>(currentBranchId ?? '')
  const [saving, setSaving] = useState(false)

  // Re-sync the selection whenever the dialog reopens with a different
  // current branch (e.g. user navigated away and came back).
  useEffect(() => {
    if (open) setSelected(currentBranchId ?? '')
  }, [open, currentBranchId])

  async function save() {
    if (!selected) return
    setSaving(true)
    try {
      await setInventoryMainBranch({ data: { branchId: selected } })
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal menyimpan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <div className="flex flex-col gap-3 px-6 py-5">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('inventory.mainBranchDialogTitle')}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t('inventory.mainBranchDialogDesc')}
          </p>
        </div>
        {isLoading ? (
          <p className="py-4 text-center text-sm text-gray-500">
            {t('common.loading')}
          </p>
        ) : branches.length === 0 ? (
          <p className="rounded-md bg-warning-50 p-3 text-sm text-warning-800 dark:bg-warning-900/20 dark:text-warning-200">
            {t('inventory.mainBranchNoBranches')}
          </p>
        ) : (
          <Select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        )}
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="brand"
            onClick={save}
            loading={saving}
            disabled={!selected || branches.length === 0}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function QuickAction({
  href,
  title,
  description,
}: {
  href: string
  title: string
  description: string
}) {
  return (
    <Link
      to={href}
      className="group flex items-start gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:border-brand-400 hover:bg-brand-50 dark:border-gray-700 dark:hover:border-brand-600 dark:hover:bg-brand-900/20"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900 dark:text-gray-100">{title}</p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {description}
        </p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
