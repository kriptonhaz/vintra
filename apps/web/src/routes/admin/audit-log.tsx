import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { listAuditLogs } from '@/server/functions/admin'
import { formatDate } from '@/lib/utils' // JUR-137
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export const Route = createFileRoute('/admin/audit-log')({
  loader: () => listAuditLogs(),
  component: AuditLogPage,
})

const ACTION_STYLES: Record<string, { i18nKey: string; className: string }> = {
  impersonate_start: {
    i18nKey: 'admin.auditLog.actionImpersonateStart',
    className: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  },
  impersonate_end: {
    i18nKey: 'admin.auditLog.actionImpersonateEnd',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  },
  grant_admin: {
    i18nKey: 'admin.auditLog.actionGrantAdmin',
    className: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
  },
  revoke_admin: {
    i18nKey: 'admin.auditLog.actionRevokeAdmin',
    className: 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
  },
  finance_record_payment: {
    i18nKey: 'admin.auditLog.actionFinanceRecordPayment',
    className: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
  },
  finance_record_refund: {
    i18nKey: 'admin.auditLog.actionFinanceRecordRefund',
    className: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  },
  attendance_trial_start: {
    i18nKey: 'admin.auditLog.actionAttendanceTrialStart',
    className: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
  },
  attendance_trial_update: {
    i18nKey: 'admin.auditLog.actionAttendanceTrialUpdate',
    className: 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400',
  },
  attendance_trial_end: {
    i18nKey: 'admin.auditLog.actionAttendanceTrialEnd',
    className: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  },
}

function AuditLogPage() {
  const logs = Route.useLoaderData()
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('admin.auditLog.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('admin.auditLog.subtitle')}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.auditLog.colTime')}</TableHead>
              <TableHead>{t('admin.auditLog.colAdmin')}</TableHead>
              <TableHead>{t('admin.auditLog.colAction')}</TableHead>
              <TableHead>{t('admin.auditLog.colTarget')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {t('admin.auditLog.empty')}
                </TableCell>
              </TableRow>
            ) : (
              logs.map((row) => {
                const meta = ACTION_STYLES[row.action] ?? {
                  i18nKey: row.action,
                  className:
                    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
                }
                return (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(row.createdAt, 'dd MMM yyyy, HH:mm')}
                    </TableCell>
                    <TableCell>
                      {row.adminEmail ?? (
                        <span className="font-mono text-xs text-gray-400">
                          {row.adminUserId.slice(0, 8)}…
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}
                      >
                        {t(meta.i18nKey, { defaultValue: row.action })}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                      {row.targetTenantName && (
                        <p className="font-medium">{row.targetTenantName}</p>
                      )}
                      {row.targetEmail && <p>{row.targetEmail}</p>}
                      {!row.targetTenantName && !row.targetEmail && (
                        <span className="text-gray-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
