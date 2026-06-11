import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, FileDown, Lock, Wallet, X as XIcon } from 'lucide-react'
import {
  listCashSessions,
  getCashSessionDetail,
} from '@/server/functions/pos-cash'
import { getPOSCashierMasters } from '@/server/functions/pos'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/pos/cash-sessions')({
  component: CashSessionsPage,
})

function firstOfMonth(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function today(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function CashSessionsPage() {
  const { t } = useTranslation()

  // Date range defaults to current month — owner's likeliest entry
  // point is "show me this month's reconciliation".
  const [from, setFrom] = React.useState(firstOfMonth())
  const [to, setTo] = React.useState(today())
  // Branch comes from the global topbar switcher ('' = all branches).
  const { selectedBranchId } = useBranch()
  const branchId = selectedBranchId ?? ''
  const [status, setStatus] = React.useState<'all' | 'open' | 'closed'>('all')
  const [hasVarianceOnly, setHasVarianceOnly] = React.useState(false)
  const [openDetail, setOpenDetail] = React.useState<string | null>(null)

  // Reuse the cashier-masters fetch for the branch list + variance
  // threshold (drives row highlight). Owners on this page already
  // had pos.read.
  const masters = useQuery({
    queryKey: ['pos', 'cashier-masters', ''],
    queryFn: () => getPOSCashierMasters({ data: {} }),
    staleTime: 5 * 60 * 1000,
  })
  const varianceThreshold =
    masters.data?.cashDrawer?.varianceThreshold ?? 10000

  const list = useQuery({
    queryKey: [
      'pos',
      'cash-sessions-list',
      from,
      to,
      branchId,
      status,
      hasVarianceOnly,
    ],
    queryFn: () =>
      listCashSessions({
        data: {
          from: from || undefined,
          to: to || undefined,
          branchId: branchId || undefined,
          status,
          hasVarianceOnly,
          page: 1,
          pageSize: 100,
        },
      }),
  })

  function handleExportCsv() {
    if (!list.data) return
    // PR 4 deliverable per the JUR-145 plan, but a minimal client-
    // side CSV here so the page is usable today. Spec for the final
    // column shape lives in JUR-145.
    const rows = list.data.sessions.map((s) => {
      const cashierName =
        [s.cashierFirstName, s.cashierLastName].filter(Boolean).join(' ') || ''
      return [
        formatDate(s.openedAt, 'yyyy-MM-dd HH:mm'),
        s.branchName,
        cashierName,
        s.openingBalance,
        s.expectedClosing ?? '',
        s.actualClosing ?? '',
        s.variance ?? '',
        s.status,
        s.closedAt ? formatDate(s.closedAt, 'yyyy-MM-dd HH:mm') : '',
        s.forceClosed ? 'force_closed' : '',
      ]
    })
    const header = [
      'opened_at',
      'branch',
      'cashier',
      'opening',
      'expected',
      'actual',
      'variance',
      'status',
      'closed_at',
      'flag',
    ]
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `peti-kas-${from}-to-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            <Wallet className="h-6 w-6 text-brand-600" />
            {t('pos.cashSessions.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('pos.cashSessions.subtitle')}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExportCsv}
          disabled={!list.data || list.data.sessions.length === 0}
        >
          <FileDown className="h-4 w-4" />
          {t('pos.cashSessions.exportCsv')}
        </Button>
      </div>

      {/* Filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('pos.cashSessions.filterFrom')}
          </label>
          <DateInput value={from} onChange={setFrom} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('pos.cashSessions.filterTo')}
          </label>
          <DateInput value={to} onChange={setTo} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('pos.cashSessions.filterStatus')}
          </label>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'all' | 'open' | 'closed')}
            options={[
              { value: 'all', label: t('pos.cashSessions.statusAll') },
              { value: 'open', label: t('pos.cashSessions.statusOpen') },
              { value: 'closed', label: t('pos.cashSessions.statusClosed') },
            ]}
          />
        </div>
        <label className="flex items-end gap-2 pb-1.5 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={hasVarianceOnly}
            onChange={(e) => setHasVarianceOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600"
          />
          {t('pos.cashSessions.filterVarianceOnly')}
        </label>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {list.isLoading ? (
          <p className="p-6 text-sm text-gray-500">{t('common.loading')}</p>
        ) : !list.data || list.data.sessions.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">
            {t('pos.cashSessions.empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('pos.cashSessions.colDate')}</TableHead>
                <TableHead>{t('pos.cashSessions.colBranch')}</TableHead>
                <TableHead>{t('pos.cashSessions.colCashier')}</TableHead>
                <TableHead>{t('pos.cashSessions.colOpening')}</TableHead>
                <TableHead>{t('pos.cashSessions.colExpected')}</TableHead>
                <TableHead>{t('pos.cashSessions.colActual')}</TableHead>
                <TableHead>{t('pos.cashSessions.colVariance')}</TableHead>
                <TableHead>{t('pos.cashSessions.colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.sessions.map((s) => {
                const varianceNum =
                  s.variance != null ? parseFloat(s.variance) : null
                const isWarn =
                  varianceNum != null &&
                  Math.abs(varianceNum) >= varianceThreshold
                const cashierName =
                  [s.cashierFirstName, s.cashierLastName]
                    .filter(Boolean)
                    .join(' ') || '—'
                return (
                  <TableRow
                    key={s.id}
                    onClick={() => setOpenDetail(s.id)}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  >
                    <TableCell className="text-sm">
                      <div>{formatDate(s.openedAt, 'dd MMM yyyy')}</div>
                      <div className="text-xs text-gray-500">
                        {formatDate(s.openedAt, 'HH:mm')}
                        {s.closedAt
                          ? `–${formatDate(s.closedAt, 'HH:mm')}`
                          : ''}
                      </div>
                    </TableCell>
                    <TableCell>{s.branchName}</TableCell>
                    <TableCell>{cashierName}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatRupiah(parseFloat(s.openingBalance))}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {s.expectedClosing != null
                        ? formatRupiah(parseFloat(s.expectedClosing))
                        : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {s.actualClosing != null
                        ? formatRupiah(parseFloat(s.actualClosing))
                        : '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'tabular-nums',
                        isWarn && 'font-semibold text-danger-600 dark:text-danger-400',
                        !isWarn && varianceNum != null && 'text-gray-500',
                      )}
                    >
                      {varianceNum == null
                        ? '—'
                        : (
                            <span className="inline-flex items-center gap-1">
                              {isWarn && <AlertTriangle className="h-3.5 w-3.5" />}
                              {varianceNum >= 0 ? '+' : ''}
                              {formatRupiah(varianceNum)}
                            </span>
                          )}
                    </TableCell>
                    <TableCell>
                      {s.status === 'open' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                          {t('pos.cashSessions.statusOpen')}
                        </span>
                      ) : s.forceClosed ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-900/30 dark:text-warning-300">
                          <Lock className="h-3 w-3" />
                          {t('pos.cashSessions.statusForceClosed')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {t('pos.cashSessions.statusClosed')}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {openDetail && (
        <CashSessionDetailDrawer
          sessionId={openDetail}
          varianceThreshold={varianceThreshold}
          onClose={() => setOpenDetail(null)}
        />
      )}
    </div>
  )
}

function CashSessionDetailDrawer({
  sessionId,
  varianceThreshold,
  onClose,
}: {
  sessionId: string
  varianceThreshold: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const detailQuery = useQuery({
    queryKey: ['pos', 'cash-session-detail', sessionId],
    queryFn: () => getCashSessionDetail({ data: { sessionId } }),
  })

  const d = detailQuery.data
  const s = d?.session
  const cashierName =
    s ? [s.cashierFirstName, s.cashierLastName].filter(Boolean).join(' ') || '—' : ''
  const varianceNum =
    s?.variance != null ? parseFloat(s.variance) : null
  const isWarn =
    varianceNum != null && Math.abs(varianceNum) >= varianceThreshold

  return (
    <Sheet open onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('pos.cashSessions.detailTitle')}</SheetTitle>
        <SheetDescription>
          {s
            ? `${s.branchName} · ${cashierName} · ${formatDate(s.openedAt, 'dd MMM yyyy HH:mm')}${
                s.closedAt ? `–${formatDate(s.closedAt, 'HH:mm')}` : ''
              }`
            : '…'}
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!d ? (
            <p className="text-sm text-gray-500">{t('common.loading')}</p>
          ) : (
            <>
              <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {t('pos.cashSessions.detailRekap')}
                </h3>
                <RekapRow
                  label={t('pos.cash.tutup.openingRow')}
                  amount={parseFloat(s!.openingBalance)}
                />
                <RekapRow
                  label={t('pos.cashSessions.detailCashIn')}
                  amount={parseFloat(s!.cashInTotal)}
                  positive
                />
                <RekapRow
                  label={t('pos.cashSessions.detailCashOut')}
                  amount={-parseFloat(s!.cashOutTotal)}
                />
                {s!.expectedClosing != null && (
                  <div className="mt-1 border-t border-gray-200 pt-1 dark:border-gray-700">
                    <RekapRow
                      label={t('pos.cash.tutup.expectedRow')}
                      amount={parseFloat(s!.expectedClosing)}
                      bold
                    />
                  </div>
                )}
                {s!.actualClosing != null && (
                  <RekapRow
                    label={t('pos.cashSessions.detailActual')}
                    amount={parseFloat(s!.actualClosing)}
                    bold
                  />
                )}
                {varianceNum != null && (
                  <div
                    className={cn(
                      'mt-2 flex items-center justify-between rounded-md px-2 py-1 text-sm font-semibold',
                      isWarn
                        ? 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300'
                        : 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300',
                    )}
                  >
                    <span className="flex items-center gap-1">
                      {isWarn && <AlertTriangle className="h-4 w-4" />}
                      {t('pos.cash.tutup.varianceLabel')}
                    </span>
                    <span>
                      {varianceNum >= 0 ? '+' : ''}
                      {formatRupiah(varianceNum)}
                    </span>
                  </div>
                )}
                {s!.openingNotes && (
                  <p className="mt-3 text-xs text-gray-500">
                    {t('pos.cashSessions.detailOpeningNotes')}:{' '}
                    {s!.openingNotes}
                  </p>
                )}
                {s!.closingNotes && (
                  <p className="mt-1 text-xs text-gray-500">
                    {t('pos.cashSessions.detailClosingNotes')}:{' '}
                    {s!.closingNotes}
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {t('pos.cashSessions.detailMovements', {
                    count: d.movements.length,
                  })}
                </h3>
                {d.movements.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    {t('pos.cashSessions.detailNoMovements')}
                  </p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {d.movements.map((m) => {
                      const amt = parseFloat(m.amount)
                      // Sale + drop (Setor Tunai = cash into the drawer)
                      // are inflows; refund + payout are outflows.
                      const isOut = m.type === 'refund' || m.type === 'payout'
                      const signed = isOut ? -amt : amt
                      return (
                        <li
                          key={m.id}
                          className="flex items-start justify-between gap-2 rounded border border-gray-100 px-2 py-1.5 dark:border-gray-700"
                        >
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 text-xs text-gray-500">
                              <span>{formatDate(m.createdAt, 'dd MMM HH:mm')}</span>
                              <MovementBadge type={m.type as 'sale' | 'refund' | 'drop' | 'payout'} />
                            </p>
                            <p className="mt-0.5 truncate text-gray-700 dark:text-gray-300">
                              {m.reason ??
                                (m.referenceSaleNumber
                                  ? `Ref ${m.referenceSaleNumber}`
                                  : '—')}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'tabular-nums',
                              isOut
                                ? 'text-danger-700 dark:text-danger-400'
                                : 'text-success-700 dark:text-success-400',
                            )}
                          >
                            {signed >= 0 ? '+' : ''}
                            {formatRupiah(signed)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button variant="ghost" onClick={onClose}>
            <XIcon className="h-4 w-4" />
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

function MovementBadge({
  type,
}: {
  type: 'sale' | 'refund' | 'drop' | 'payout'
}) {
  const { t } = useTranslation()
  const cls: Record<typeof type, string> = {
    sale: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300',
    refund: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
    drop: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
    payout: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  }
  return (
    <span
      className={cn(
        'inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        cls[type],
      )}
    >
      {t(`pos.cashSessions.movement.${type}`)}
    </span>
  )
}

function RekapRow({
  label,
  amount,
  positive,
  bold,
}: {
  label: string
  amount: number
  positive?: boolean
  bold?: boolean
}) {
  const display =
    amount >= 0
      ? formatRupiah(amount)
      : `−${formatRupiah(Math.abs(amount))}`
  return (
    <div
      className={cn(
        'flex items-center justify-between py-0.5 text-sm',
        bold && 'font-bold text-gray-900 dark:text-gray-100',
      )}
    >
      <span
        className={cn(
          'text-gray-600 dark:text-gray-400',
          bold && 'text-gray-900 dark:text-gray-100',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'tabular-nums',
          positive && !bold && 'text-success-700 dark:text-success-400',
        )}
      >
        {display}
      </span>
    </div>
  )
}
