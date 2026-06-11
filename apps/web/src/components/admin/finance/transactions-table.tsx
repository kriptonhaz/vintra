import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { Undo2 } from 'lucide-react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils' // JUR-137

const PLAN_LABEL: Record<string, string> = {
  // Attendance — period-based, no tier
  attendance_1mo: 'Bulanan',
  attendance_3mo: '3 Bulan',
  attendance_6mo: '6 Bulan',
  attendance_12mo: '12 Bulan',
  attendance_trial: 'Trial',
  // POS — tier × duration
  pos_toko_monthly: 'Toko · Bulanan',
  pos_toko_annual: 'Toko · Tahunan',
  pos_komplit_monthly: 'Komplit · Bulanan',
  pos_komplit_annual: 'Komplit · Tahunan',
  pos_bisnis_monthly: 'Bisnis · Bulanan',
  pos_bisnis_annual: 'Bisnis · Tahunan',
  pos_trial: 'Trial',
  // Inventory — tier × duration
  inventory_toko_monthly: 'Toko · Bulanan',
  inventory_toko_annual: 'Toko · Tahunan',
  inventory_bisnis_monthly: 'Bisnis · Bulanan',
  inventory_bisnis_annual: 'Bisnis · Tahunan',
  inventory_multi_outlet_monthly: 'Multi-Outlet · Bulanan',
  inventory_multi_outlet_annual: 'Multi-Outlet · Tahunan',
  inventory_trial: 'Trial',
  // JUR-123: WhatsApp AI plans (was rendering as raw enum 'basic' / 'komplit')
  basic: 'Basic',
  komplit: 'Komplit',
}

const MODULE_LABEL: Record<string, string> = {
  attendance: 'Absensi',
  pos: 'POS',
  inventory: 'Inventaris',
  finance: 'Keuangan',
  // JUR-123: was rendering as raw enum 'whatsapp' in the Modul column
  whatsapp: 'WhatsApp AI',
}

/**
 * Returns the user-facing module label, with a special case for the
 * Komplit bundle: even though the row's `module_key` is `'pos'` (the
 * Komplit SKU is administered through the POS payment flow), the
 * actual scope is POS + Inventory + Absensi — so we label it
 * "Komplit (Bundle)" to avoid the misleading "POS" tag in the
 * payments history.
 */
function moduleLabelFor(moduleKey: string, planKey: string): string {
  if (planKey.startsWith('pos_komplit_')) return 'Komplit (Bundle)'
  return MODULE_LABEL[moduleKey] ?? moduleKey
}

export interface TransactionRow {
  id: string
  invoiceNumber: string
  tenantId: string
  tenantName?: string
  moduleKey: string
  planKey: string
  amountIdr: number
  transferDate: string
  status: string
  /** Attendance-only — populated when admin paid for N staff. */
  billedStaffCount: number | null
  /** POS Komplit-only — populated when admin paid for N outlets. */
  billedOutletCount: number | null
  recordedByEmail?: string | null
  refundOfTransactionId?: string | null
  createdAt: Date | string
  /** Only present in per-tenant view — signals whether the "Refund"
   * action should be shown/enabled. */
  hasRefund?: boolean
}

/**
 * Shared table used on both /admin/finance and the per-tenant "Riwayat
 * Pembayaran" section. Columns shown are controlled by `showTenant` and
 * `showRecordedBy`; per-row refund action is controlled by `onRefund`.
 */
export function TransactionsTable({
  rows,
  showTenant = false,
  showRecordedBy = false,
  emptyMessage,
  onRowClick,
  onRefund,
  renderTenantCell,
}: {
  rows: TransactionRow[]
  showTenant?: boolean
  showRecordedBy?: boolean
  emptyMessage?: string
  onRowClick?: (row: TransactionRow) => void
  onRefund?: (row: TransactionRow) => void
  /** Optional override for how the tenant cell renders (e.g., a Link to
   * the tenant detail page on the global finance page). */
  renderTenantCell?: (row: TransactionRow) => ReactNode
}) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
        {emptyMessage ?? t('admin.finance.empty')}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('admin.finance.colInvoice')}</TableHead>
          <TableHead>{t('admin.finance.colTransferDate')}</TableHead>
          {showTenant && <TableHead>{t('admin.finance.colTenant')}</TableHead>}
          <TableHead>{t('admin.finance.colModule')}</TableHead>
          <TableHead>{t('admin.finance.colPlan')}</TableHead>
          <TableHead className="text-right">
            {t('admin.finance.colAmount')}
          </TableHead>
          <TableHead>{t('admin.finance.colStatus')}</TableHead>
          {showRecordedBy && (
            <TableHead>{t('admin.finance.colRecordedBy')}</TableHead>
          )}
          {onRefund && <TableHead className="text-right">{t('admin.finance.colActions')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow
            key={r.id}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            className={onRowClick ? 'cursor-pointer' : undefined}
          >
            <TableCell className="font-mono text-xs">
              {r.invoiceNumber}
            </TableCell>
            <TableCell className="text-sm">
              {formatDate(r.transferDate, 'dd MMM yyyy')}
            </TableCell>
            {showTenant && (
              <TableCell
                className="text-sm"
                onClick={(e) => {
                  // Prevent row-click drawer when user is clicking into the
                  // tenant link — the link takes them away from this page.
                  if (
                    (e.target as HTMLElement).closest('a') &&
                    onRowClick
                  ) {
                    e.stopPropagation()
                  }
                }}
              >
                {renderTenantCell
                  ? renderTenantCell(r)
                  : r.tenantName ?? '—'}
              </TableCell>
            )}
            <TableCell className="text-sm">
              {moduleLabelFor(r.moduleKey, r.planKey)}
            </TableCell>
            <TableCell className="text-sm">
              {PLAN_LABEL[r.planKey] ?? r.planKey}
              {/* Suffix: only show what's meaningful for this row's
                  scope. Attendance bills per staff, Komplit bills per
                  outlet, other plans have no per-unit billing. */}
              {r.moduleKey === 'attendance' &&
                r.billedStaffCount != null &&
                r.billedStaffCount > 0 && (
                  <span className="text-gray-500">
                    {' '}· {r.billedStaffCount} staf
                  </span>
                )}
              {r.planKey.startsWith('pos_komplit_') &&
                r.billedOutletCount != null &&
                r.billedOutletCount > 0 && (
                  <span className="text-gray-500">
                    {' '}· {r.billedOutletCount} outlet
                  </span>
                )}
            </TableCell>
            <TableCell
              className={
                'text-right font-mono text-sm tabular-nums ' +
                (r.status === 'refund'
                  ? 'text-danger-700 dark:text-danger-400'
                  : 'text-gray-900 dark:text-gray-100')
              }
            >
              {r.status === 'refund' ? '−' : ''}
              {formatRupiah(r.amountIdr)}
            </TableCell>
            <TableCell>
              <StatusPill
                status={r.status}
                hasRefund={r.hasRefund}
                planKey={r.planKey}
              />
            </TableCell>
            {showRecordedBy && (
              <TableCell className="text-xs text-gray-500 dark:text-gray-400">
                {r.recordedByEmail ?? <span className="italic">—</span>}
              </TableCell>
            )}
            {onRefund && (
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                {r.status === 'paid' &&
                !r.hasRefund &&
                r.planKey !== 'attendance_trial' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onRefund(r)}
                    className="text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/30"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    {t('admin.finance.refundCta')}
                  </Button>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function StatusPill({
  status,
  hasRefund,
  planKey,
}: {
  status: string
  hasRefund?: boolean
  planKey?: string
}) {
  const { t } = useTranslation()
  if (status === 'refund') {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-danger-100 px-2 py-0.5 text-xs font-medium text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
        {t('admin.finance.statusRefund')}
      </span>
    )
  }
  if (hasRefund) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700/50 dark:text-gray-400">
        {t('admin.finance.statusRefunded')}
      </span>
    )
  }
  // Trial rows are stored as status='paid' so the ledger math works, but
  // visually they're a distinct brand-colored pill so they don't get
  // confused with real paid revenue.
  if (planKey === 'attendance_trial') {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
        {t('admin.finance.statusTrial')}
      </span>
    )
  }
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
      {t('admin.finance.statusPaid')}
    </span>
  )
}
