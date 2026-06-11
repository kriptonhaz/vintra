import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getTransaction } from '@/server/functions/admin-finance'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils' // JUR-137
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'

const PLAN_LABEL: Record<string, string> = {
  attendance_1mo: 'Bulanan',
  attendance_3mo: '3 Bulan',
  attendance_6mo: '6 Bulan',
  attendance_12mo: '12 Bulan',
  attendance_trial: 'Trial',
  pos_toko_monthly: 'Toko · Bulanan',
  pos_toko_annual: 'Toko · Tahunan',
  pos_komplit_monthly: 'Komplit · Bulanan',
  pos_komplit_annual: 'Komplit · Tahunan',
  pos_bisnis_monthly: 'Bisnis · Bulanan',
  pos_bisnis_annual: 'Bisnis · Tahunan',
  pos_trial: 'Trial',
  inventory_toko_monthly: 'Toko · Bulanan',
  inventory_toko_annual: 'Toko · Tahunan',
  inventory_bisnis_monthly: 'Bisnis · Bulanan',
  inventory_bisnis_annual: 'Bisnis · Tahunan',
  inventory_multi_outlet_monthly: 'Multi-Outlet · Bulanan',
  inventory_multi_outlet_annual: 'Multi-Outlet · Tahunan',
  inventory_trial: 'Trial',
}

const MODULE_LABEL: Record<string, string> = {
  attendance: 'Absensi',
  pos: 'POS',
  inventory: 'Inventaris',
  finance: 'Keuangan',
}

/** Same Komplit-aware label as in TransactionsTable. */
function moduleLabelFor(moduleKey: string, planKey: string): string {
  if (planKey.startsWith('pos_komplit_')) return 'Komplit (Bundle)'
  return MODULE_LABEL[moduleKey] ?? moduleKey
}

/**
 * Read-only detail view for a transaction. Fetches full fields + a
 * short-lived signed proof URL. Used on both the tenant detail page
 * and the cross-tenant finance list.
 */
export function TransactionDetailDrawer({
  transactionId,
  onClose,
}: {
  transactionId: string
  onClose: () => void
}) {
  const { t } = useTranslation()

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'finance', 'transaction', transactionId],
    queryFn: () => getTransaction({ data: { id: transactionId } }),
  })

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {data ? data.invoiceNumber : t('admin.finance.detailLoading')}
        </SheetTitle>
        <SheetDescription>
          {data
            ? data.status === 'refund'
              ? t('admin.finance.detailDescRefund')
              : t('admin.finance.detailDescPaid')
            : ''}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {isLoading && (
          <p className="text-sm text-gray-500">{t('admin.finance.detailLoading')}</p>
        )}
        {error && (
          <p className="text-sm text-danger-600">
            {error instanceof Error ? error.message : 'Gagal memuat detail'}
          </p>
        )}
        {data && (
          <>
            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {t('admin.finance.detailAmount')}
              </p>
              <p
                className={
                  'mt-1 text-2xl font-bold ' +
                  (data.status === 'refund'
                    ? 'text-danger-700 dark:text-danger-400'
                    : 'text-gray-900 dark:text-gray-100')
                }
              >
                {data.status === 'refund' ? '−' : ''}
                {formatRupiah(data.amountIdr)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {data.status === 'refund'
                  ? t('admin.finance.statusRefund')
                  : t('admin.finance.statusPaid')}
              </p>
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              <Row label={t('admin.finance.colModule')} value={moduleLabelFor(data.moduleKey, data.planKey)} />
              <Row label={t('admin.finance.colPlan')} value={PLAN_LABEL[data.planKey] ?? data.planKey} />
              <Row
                label={t('admin.finance.detailPeriod')}
                value={`${formatDate(data.periodStartAt, 'dd MMM yyyy')} — ${formatDate(data.periodEndAt, 'dd MMM yyyy')}`}
              />
              <Row
                label={t('admin.finance.colTransferDate')}
                value={formatDate(data.transferDate, 'dd MMM yyyy')}
              />
              {data.billedStaffCount != null && (
                <Row
                  label={t('admin.finance.detailBilledStaffCount')}
                  value={`${data.billedStaffCount} staf`}
                />
              )}
              {data.bankReference && (
                <Row
                  label={t('admin.finance.fieldBankReference')}
                  value={data.bankReference}
                />
              )}
              <Row
                label={t('admin.finance.colRecordedBy')}
                value={data.recordedByEmail ?? '—'}
              />
              <Row
                label={t('admin.finance.detailCreatedAt')}
                value={formatDate(data.createdAt, 'dd MMM yyyy, HH:mm')}
              />
            </dl>

            {data.notes && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {data.status === 'refund'
                    ? t('admin.finance.refundReason')
                    : t('admin.finance.fieldNotes')}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">
                  {data.notes}
                </p>
              </div>
            )}

            {data.proofUrl && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('admin.finance.detailProof')}
                </p>
                <a
                  href={data.proofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <img
                    src={data.proofUrl}
                    alt="Bukti transfer"
                    className="max-h-96 w-full object-contain bg-gray-50 dark:bg-gray-900"
                  />
                </a>
                <p className="mt-1 text-xs text-gray-500">
                  {t('admin.finance.detailProofHint')}
                </p>
              </div>
            )}

            {data.refundTransaction && (
              <div className="rounded-lg border border-danger-200 bg-danger-50 p-4 dark:border-danger-900 dark:bg-danger-900/20">
                <p className="text-xs font-medium uppercase tracking-wide text-danger-700 dark:text-danger-300">
                  {t('admin.finance.detailLinkedRefund')}
                </p>
                <p className="mt-1 font-mono text-sm text-danger-900 dark:text-danger-100">
                  {data.refundTransaction.invoiceNumber}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {formatDate(data.refundTransaction.transferDate, 'dd MMM yyyy')}
                </p>
              </div>
            )}

            {data.originalTransaction && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400">
                  {t('admin.finance.detailLinkedOriginal')}
                </p>
                <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                  {data.originalTransaction.invoiceNumber}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {formatRupiah(data.originalTransaction.amountIdr)} ·{' '}
                  {formatDate(data.originalTransaction.transferDate, 'dd MMM yyyy')}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  )
}
