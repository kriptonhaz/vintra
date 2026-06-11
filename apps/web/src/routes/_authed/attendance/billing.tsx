import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Package,
  Clock,
  Users,
  Wallet,
  MessageCircle,
  UserCheck,
  UserX,
} from 'lucide-react'
import {
  getAttendanceOverview,
  getMyBillingHistory,
} from '@/server/functions/attendance-settings'
import {
  getStaffQuota,
  listStaff,
  setStaffActive,
} from '@/server/functions/attendance-staff'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import {
  TransactionsTable,
  type TransactionRow,
} from '@/components/admin/finance/transactions-table'
import { BillingDetailDrawer } from '@/components/attendance/billing-detail-drawer'
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
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils' // JUR-137
import { buildSalesWaUrl } from '@/lib/constants' // JUR-127

export const Route = createFileRoute('/_authed/attendance/billing')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('attendance.manage')) {
      throw redirect({ to: '/attendance/check-in' })
    }
  },
  loader: async () => {
    const [overview, history, quota, staff] = await Promise.all([
      getAttendanceOverview(),
      getMyBillingHistory(),
      getStaffQuota(),
      listStaff(),
    ])
    return { overview, history, quota, staff }
  },
  component: BillingPage,
})

type QuotaStaff = Awaited<ReturnType<typeof listStaff>>[number]

function BillingPage() {
  const { overview, history, quota, staff } = Route.useLoaderData()
  const { t } = useTranslation()

  const [detailId, setDetailId] = useState<string | null>(null)

  const { settings, currentPlan } = overview
  const expiresAt = settings.subscriptionExpiresAt
    ? new Date(settings.subscriptionExpiresAt)
    : null

  // Quick stat derivation — total paid (minus refunded) across all
  // history for this tenant. Kept local because it's tiny and the list
  // is already in memory.
  const totalPaid = history
    .filter((h) => h.status === 'paid' && !h.hasRefund)
    .reduce((sum, h) => sum + h.amountIdr, 0)
  const totalRefund = history
    .filter((h) => h.status === 'refund')
    .reduce((sum, h) => sum + h.amountIdr, 0)

  const rows: TransactionRow[] = history.map((h) => ({
    id: h.id,
    invoiceNumber: h.invoiceNumber,
    tenantId: '', // not shown on this page
    moduleKey: h.moduleKey,
    planKey: h.planKey,
    amountIdr: h.amountIdr,
    transferDate: h.transferDate,
    status: h.status,
    billedStaffCount: h.billedStaffCount,
    // Tenant-side attendance billing page never shows POS rows, but
    // include the field for type compatibility with TransactionRow.
    billedOutletCount: null,
    refundOfTransactionId: h.refundOfTransactionId,
    createdAt: h.createdAt,
    hasRefund: h.hasRefund,
  }))

  const renewHref = buildSalesWaUrl(
    'Halo Vintra, saya ingin memperpanjang langganan modul Absensi.',
  )

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('attendance.billingTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('attendance.billingSubtitle')}
          </p>
        </div>
        <a
          href={renewHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          <MessageCircle className="h-4 w-4" />
          {t('attendance.billingRenewCta')}
        </a>
      </div>

      {/* Current subscription summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Package className="h-5 w-5 text-brand-600 dark:text-brand-400" />}
          label={t('attendance.billingCurrentPlan')}
          value={currentPlan ? t(currentPlan.labelKey) : '—'}
          hint={
            currentPlan
              ? currentPlan.isTrial
                ? t('attendance.billingTrialFreeHint')
                : `Rp ${formatRupiah(currentPlan.pricePerStaffPerMonth)}/${t('attendance.perStaffPerMonth')}`
              : t('attendance.billingNoPlan')
          }
        />
        <StatCard
          icon={<Users className="h-5 w-5 text-brand-600 dark:text-brand-400" />}
          label={t('attendance.statBilledStaff')}
          value={
            currentPlan
              ? t('attendance.billedStaffValue', {
                  count: currentPlan.billedStaffCount ?? 0,
                })
              : '—'
          }
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-brand-600 dark:text-brand-400" />}
          label={t('attendance.statSubscription')}
          value={
            expiresAt ? formatDate(expiresAt, 'dd MMM yyyy') : '—'
          }
          hint={
            expiresAt && expiresAt.getTime() > Date.now()
              ? t('attendance.billingExpiresInDays', {
                  days: Math.max(
                    0,
                    Math.ceil(
                      (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
                    ),
                  ),
                })
              : expiresAt
                ? t('attendance.billingExpired')
                : undefined
          }
        />
        <StatCard
          icon={<Wallet className="h-5 w-5 text-success-600 dark:text-success-400" />}
          label={t('attendance.billingTotalPaid')}
          value={formatRupiah(totalPaid)}
          hint={
            totalRefund > 0
              ? t('attendance.billingRefundedSoFar', {
                  amount: formatRupiah(totalRefund),
                })
              : undefined
          }
        />
      </div>

      {/* Active-staff quota — which staff occupy the paid seats */}
      <StaffQuotaSection quota={quota} staff={staff} />

      {/* History table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('attendance.billingHistoryTitle')}
          </h2>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            {t('attendance.billingHistorySubtitle')}
          </p>
        </div>
        <TransactionsTable
          rows={rows}
          emptyMessage={t('attendance.billingEmpty')}
          onRowClick={(r) => setDetailId(r.id)}
        />
      </div>

      {detailId && (
        <BillingDetailDrawer
          transactionId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  )
}

type StaffQuota = Awaited<ReturnType<typeof getStaffQuota>>

/**
 * Active-staff quota manager. The billed cap is set by the platform
 * admin; here the owner chooses which staff occupy those paid seats by
 * toggling each one active/inactive. Only active staff count toward the
 * cap — deactivating frees a seat.
 */
function StaffQuotaSection({
  quota,
  staff,
}: {
  quota: StaffQuota
  staff: QuotaStaff[]
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const atLimit =
    quota.billedCount !== null &&
    quota.billedCount > 0 &&
    quota.activeCount >= quota.billedCount

  async function toggle(s: QuotaStaff) {
    setBusyId(s.id)
    try {
      await setStaffActive({ data: { id: s.id, isActive: !s.isActive } })
      toast({
        title: t('common.toastSavedTitle'),
        description: s.isActive
          ? t('attendance.quotaToastDeactivated', { name: s.fullName ?? '' })
          : t('attendance.quotaToastActivated', { name: s.fullName ?? '' }),
        variant: 'success',
      })
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal',
        variant: 'error',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-col gap-2 border-b border-gray-200 px-5 py-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('attendance.quotaSectionTitle')}
          </h2>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            {t('attendance.quotaSectionSubtitle')}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium ${
            atLimit
              ? 'border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-900 dark:bg-warning-900/20 dark:text-warning-300'
              : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          <UserCheck className="h-3.5 w-3.5" />
          {quota.billedCount === null
            ? t('attendance.quotaBadgeUnlimited', { active: quota.activeCount })
            : t('attendance.quotaBadge', {
                active: quota.activeCount,
                billed: quota.billedCount,
              })}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('attendance.quotaColName')}</TableHead>
            <TableHead>{t('attendance.quotaColBranch')}</TableHead>
            <TableHead>{t('attendance.quotaColStatus')}</TableHead>
            <TableHead className="text-right">
              {t('attendance.quotaColAction')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-10 text-center text-sm text-gray-500 dark:text-gray-400"
              >
                {t('attendance.quotaEmpty')}
              </TableCell>
            </TableRow>
          ) : (
            staff.map((s) => (
              <TableRow key={s.id} className={s.isActive ? '' : 'opacity-60'}>
                <TableCell className="font-medium">
                  {s.fullName ?? <span className="italic text-gray-400">—</span>}
                  {s.position && (
                    <p className="text-xs text-gray-500">{s.position}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                  {s.branchName ?? <span className="text-gray-400">—</span>}
                </TableCell>
                <TableCell>
                  <span
                    className={
                      s.isActive
                        ? 'inline-flex rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400'
                        : 'inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                    }
                  >
                    {s.isActive
                      ? t('attendance.quotaStatusActive')
                      : t('attendance.quotaStatusInactive')}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={busyId === s.id}
                    disabled={!s.isActive && atLimit}
                    title={
                      !s.isActive && atLimit
                        ? t('attendance.quotaReachedHint')
                        : undefined
                    }
                    onClick={() => toggle(s)}
                    className={
                      s.isActive
                        ? 'text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/30'
                        : 'text-success-700 hover:bg-success-50 dark:hover:bg-success-900/30'
                    }
                  >
                    {s.isActive ? (
                      <>
                        <UserX className="h-4 w-4" />
                        {t('attendance.quotaDeactivate')}
                      </>
                    ) : (
                      <>
                        <UserCheck className="h-4 w-4" />
                        {t('attendance.quotaActivate')}
                      </>
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
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
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {label}
        </span>
        {icon}
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      )}
    </div>
  )
}
