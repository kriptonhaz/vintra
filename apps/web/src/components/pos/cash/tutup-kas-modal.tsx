import * as React from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Textarea } from '@/components/ui/textarea'
import { formatRupiah } from '@/lib/currency'
import { cn } from '@/lib/utils'
import {
  getCashSessionDetail,
  closeCashSession,
} from '@/server/functions/pos-cash'

/**
 * JUR-141 Peti Kas — close-out reconciliation. Loads the session
 * detail to compute the rekap on the fly (so it includes every
 * movement that happened since the cashier opened, including
 * ones from concurrent admin tabs).
 *
 * Variance threshold from props (read by cashier.tsx out of
 * getPOSCashierMasters.cashDrawer.varianceThreshold). When
 * `|variance| >= threshold`, the variance row goes red and the
 * closing-notes field becomes required.
 */
export function TutupKasModal({
  sessionId,
  varianceThreshold,
  onClose,
  onClosed,
}: {
  sessionId: string
  varianceThreshold: number
  onClose: () => void
  onClosed: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [actualStr, setActualStr] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [error, setError] = React.useState('')

  const detailQuery = useQuery({
    queryKey: ['pos', 'cash-session-detail', sessionId],
    queryFn: () => getCashSessionDetail({ data: { sessionId } }),
    staleTime: 0,
  })

  const mutation = useMutation({
    mutationFn: () =>
      closeCashSession({
        data: {
          sessionId,
          actualClosing: parseInt(actualStr) || 0,
          closingNotes: notes.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      await onClosed()
      onClose()
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('pos.cash.tutup.errorFallback'))
    },
  })

  const detail = detailQuery.data
  // Derive rekap totals from the ledger so the on-screen numbers
  // are always live (cashier might have done a drop in another tab
  // since the query last refreshed).
  const rekap = React.useMemo(() => {
    if (!detail) return null
    const opening = parseFloat(detail.session.openingBalance)
    let cashSales = 0
    let refunds = 0
    let drops = 0
    let payouts = 0
    let dropCount = 0
    let payoutCount = 0
    let refundCount = 0
    let saleCount = 0
    for (const m of detail.movements) {
      const amt = parseFloat(m.amount)
      switch (m.type) {
        case 'sale':
          cashSales += amt
          saleCount += 1
          break
        case 'refund':
          refunds += amt
          refundCount += 1
          break
        case 'drop':
          drops += amt
          dropCount += 1
          break
        case 'payout':
          payouts += amt
          payoutCount += 1
          break
      }
    }
    // Setor (drop) = cash put INTO the drawer (topup / kembalian /
    // tambahan modal), so it ADDS to the expected balance. Tarik
    // (payout) and refund stay as outflows.
    const expected = opening + cashSales + drops - refunds - payouts
    return {
      opening,
      cashSales,
      refunds,
      drops,
      payouts,
      saleCount,
      refundCount,
      dropCount,
      payoutCount,
      expected,
    }
  }, [detail])

  // Live variance preview as the cashier types.
  const actualNum = parseInt(actualStr) || 0
  const variance = rekap ? actualNum - rekap.expected : 0
  const varianceOverThreshold =
    rekap && actualStr !== '' && Math.abs(variance) >= varianceThreshold
  const notesRequired = !!varianceOverThreshold

  function handleSubmit() {
    setError('')
    if (actualStr === '') {
      setError(t('pos.cash.tutup.errorActualRequired'))
      return
    }
    if (notesRequired && !notes.trim()) {
      setError(t('pos.cash.tutup.errorNotesRequired'))
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{t('pos.cash.tutup.title')}</DialogTitle>
        <DialogDescription>
          {detail
            ? t('pos.cash.tutup.subtitle', {
                branch: detail.session.branchName,
              })
            : '…'}
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        {!rekap ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800/50">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {t('pos.cash.tutup.summaryHeader')}
              </p>
              <RekapRow
                label={t('pos.cash.tutup.openingRow')}
                amount={rekap.opening}
              />
              <RekapRow
                label={t('pos.cash.tutup.cashSalesRow', { count: rekap.saleCount })}
                amount={rekap.cashSales}
                positive
              />
              {rekap.refundCount > 0 && (
                <RekapRow
                  label={t('pos.cash.tutup.refundsRow', { count: rekap.refundCount })}
                  amount={-rekap.refunds}
                />
              )}
              {rekap.dropCount > 0 && (
                <RekapRow
                  label={t('pos.cash.tutup.dropsRow', { count: rekap.dropCount })}
                  amount={rekap.drops}
                  positive
                />
              )}
              {rekap.payoutCount > 0 && (
                <RekapRow
                  label={t('pos.cash.tutup.payoutsRow', { count: rekap.payoutCount })}
                  amount={-rekap.payouts}
                />
              )}
              <div className="mt-2 border-t border-gray-300 pt-2 dark:border-gray-600">
                <RekapRow
                  label={t('pos.cash.tutup.expectedRow')}
                  amount={rekap.expected}
                  bold
                />
              </div>
            </div>

            <CurrencyInput
              label={t('pos.cash.tutup.actualLabel')}
              value={actualStr}
              onChange={setActualStr}
            />

            {actualStr !== '' && rekap && (
              <div
                className={cn(
                  'rounded-lg border p-3 text-sm',
                  varianceOverThreshold
                    ? 'border-danger-300 bg-danger-50 text-danger-700 dark:border-danger-700/40 dark:bg-danger-900/20 dark:text-danger-300'
                    : 'border-success-300 bg-success-50 text-success-700 dark:border-success-700/40 dark:bg-success-900/20 dark:text-success-300',
                )}
              >
                <p className="flex items-center justify-between font-semibold">
                  <span className="flex items-center gap-2">
                    {varianceOverThreshold ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {t('pos.cash.tutup.varianceLabel')}
                  </span>
                  <span>
                    {variance >= 0 ? '+' : ''}
                    {formatRupiah(variance)}
                  </span>
                </p>
                {varianceOverThreshold && (
                  <p className="mt-1 text-xs">
                    {t('pos.cash.tutup.varianceWarn', {
                      threshold: formatRupiah(varianceThreshold),
                    })}
                  </p>
                )}
              </div>
            )}

            <Textarea
              label={
                notesRequired
                  ? `${t('pos.cash.tutup.closingNotesLabel')} *`
                  : t('pos.cash.tutup.closingNotesLabel')
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('pos.cash.tutup.closingNotesPlaceholder')}
              rows={2}
            />

            {error && <p className="text-sm text-danger-600">{error}</p>}
          </div>
        )}
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="brand"
          onClick={handleSubmit}
          loading={mutation.isPending}
          disabled={!rekap}
        >
          {t('pos.cash.tutup.cta')}
        </Button>
      </DialogFooter>
    </Dialog>
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
      <span className={cn('text-gray-600 dark:text-gray-400', bold && 'text-gray-900 dark:text-gray-100')}>
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
