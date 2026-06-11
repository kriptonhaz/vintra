import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getPurchaseOrder,
  receivePurchaseOrder,
} from '@/server/functions/inventory-po'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { cn, formatNumberID } from '@/lib/utils' // JUR-137

type Po = Awaited<ReturnType<typeof getPurchaseOrder>>

/**
 * Per-line receiving sheet. The user inputs **this-batch** quantity
 * (what arrived today), not cumulative totals — that's the natural
 * mental model when goods are showing up at the warung. We compute
 * the cumulative value at submit time before calling the server,
 * which still uses the replace semantics under the hood.
 *
 * Why this matters:
 * - PO ordered 10 kg, line has receivedQty=5 already. Today another
 *   5 kg arrives. With the old "cumulative" UX the user typed 5 and
 *   the system saw "5 cumulative", treated as no change (or worse,
 *   went backwards). With "this batch" the user types 5, we send
 *   5+5=10 cumulative, stock bumps by exactly 5, status flips to
 *   `received`. Matches what the user expected.
 * - "Sisa" (remaining) is shown per line and used as the upper bound
 *   for client-side validation — you can't enter more than the PO's
 *   open quantity. Server clamps too as defence in depth, but doing
 *   it here surfaces the error immediately instead of silently
 *   accepting a wrong-feeling input.
 */
export function ReceivePoSheet({
  open,
  po,
  onClose,
  onReceived,
}: {
  open: boolean
  po: Po
  onClose: () => void
  onReceived: (allReceived: boolean) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()

  // Holds the **this-batch** qty per line. Pre-fills with each line's
  // remaining (most common: "the rest of the order arrived"); user
  // can dial down for true partials.
  const [batchValues, setBatchValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      const next: Record<string, string> = {}
      for (const l of po.lines) {
        const remaining = Math.max(0, l.orderedQty - l.receivedQty)
        next[l.id] = remaining > 0 ? String(remaining) : '0'
      }
      setBatchValues(next)
      setError(null)
      setSubmitting(false)
    }
  }, [open, po])

  function setLineBatch(lineId: string, v: string) {
    setBatchValues((prev) => ({ ...prev, [lineId]: v }))
  }

  /** Snap a single line to its remaining amount — common one-click path. */
  function fillLineFull(lineId: string, remaining: number) {
    setBatchValues((prev) => ({ ...prev, [lineId]: String(Math.max(0, remaining)) }))
  }

  /** Snap every still-open line to its remaining. Lines already at
   *  full stay at 0 (no extra batch). */
  function fillAllFull() {
    const next = { ...batchValues }
    for (const l of po.lines) {
      const remaining = Math.max(0, l.orderedQty - l.receivedQty)
      next[l.id] = String(remaining)
    }
    setBatchValues(next)
  }

  async function submit() {
    setError(null)

    // Validate every batch input before firing the server fn.
    for (const l of po.lines) {
      const batch = Number(batchValues[l.id] ?? 0)
      const remaining = Math.max(0, l.orderedQty - l.receivedQty)
      if (Number.isNaN(batch) || batch < 0) {
        setError(
          t('inventory.poReceiveBatchInvalid', { item: l.itemName }),
        )
        return
      }
      if (batch > remaining) {
        setError(
          t('inventory.poReceiveBatchOverRemaining', {
            item: l.itemName,
            remaining,
            unit: l.unitLabel,
          }),
        )
        return
      }
    }

    // Translate batch → cumulative (server contract is replace, not
    // increment). If today's batch is 0 we still send the existing
    // cumulative so the no-op guard below catches it.
    const lines = po.lines.map((l) => {
      const batch = Math.max(0, Number(batchValues[l.id] ?? 0))
      return {
        poItemId: l.id,
        receivedQty: l.receivedQty + batch,
      }
    })

    // No-op guard: every line's batch was 0 → nothing to record.
    const anyBatched = po.lines.some(
      (l) => Number(batchValues[l.id] ?? 0) > 0,
    )
    if (!anyBatched) {
      setError(t('inventory.poReceiveNoChange'))
      return
    }

    setSubmitting(true)
    try {
      await receivePurchaseOrder({ data: { id: po.id, lines } })
      const allReceived = po.lines.every(
        (l, i) => lines[i]!.receivedQty >= l.orderedQty,
      )
      await onReceived(allReceived)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menerima PO'
      setError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Preview after-submit cumulative state per line (for the green
  // "all done" banner).
  const allFullPreview = po.lines.every((l) => {
    const batch = Number(batchValues[l.id] ?? 0) || 0
    return l.receivedQty + batch >= l.orderedQty
  })

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('inventory.poReceiveTitle')}</SheetTitle>
        <SheetDescription>
          {t('inventory.poReceiveDesc', { poNumber: po.poNumber })}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={fillAllFull}
              className="h-8 px-3 text-xs"
            >
              {t('inventory.poReceiveFillAll')}
            </Button>
          </div>

          {po.lines.map((line) => {
            const remaining = Math.max(0, line.orderedQty - line.receivedQty)
            const lineDone = remaining === 0
            const batchStr = batchValues[line.id] ?? ''
            const batchNum = Number(batchStr) || 0
            const overRemaining = batchNum > remaining
            const afterTotal = line.receivedQty + batchNum
            const fullyAfter = afterTotal >= line.orderedQty
            return (
              <div
                key={line.id}
                className={cn(
                  'rounded-lg border p-3',
                  lineDone
                    ? 'border-success-200 bg-success-50/40 dark:border-success-900/40 dark:bg-success-900/10'
                    : overRemaining
                      ? 'border-danger-300 bg-danger-50/40 dark:border-danger-900/40 dark:bg-danger-900/10'
                      : fullyAfter
                        ? 'border-brand-200 bg-brand-50/40 dark:border-brand-900/40 dark:bg-brand-900/10'
                        : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
                )}
              >
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {line.itemName}
                </p>

                {/* Order math at a glance: ordered / already in /
                    remaining. Removes any ambiguity about what the
                    input field below means. */}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                  <span className="text-gray-600 dark:text-gray-400">
                    {t('inventory.poLineOrdered')}:{' '}
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      {formatNumberID(line.orderedQty)}{' '}
                      {line.unitLabel}
                    </span>
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">
                    {t('inventory.poReceiveAlready')}:{' '}
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      {formatNumberID(line.receivedQty)}{' '}
                      {line.unitLabel}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'font-medium',
                      lineDone
                        ? 'text-success-700 dark:text-success-400'
                        : 'text-warning-700 dark:text-warning-400',
                    )}
                  >
                    {t('inventory.poReceiveRemaining')}:{' '}
                    <span className="font-semibold">
                      {formatNumberID(remaining)}{' '}
                      {line.unitLabel}
                    </span>
                  </span>
                </div>

                {lineDone ? (
                  <p className="mt-2 text-xs text-success-700 dark:text-success-400">
                    {t('inventory.poReceiveLineDone')}
                  </p>
                ) : (
                  <>
                    <label className="mt-3 mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                      {t('inventory.poReceiveBatchLabel')}
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Input
                          type="number"
                          min={0}
                          max={remaining}
                          step={0.01}
                          value={batchStr}
                          onChange={(e) =>
                            setLineBatch(line.id, e.target.value)
                          }
                          placeholder="0"
                          error={
                            overRemaining
                              ? t('inventory.poReceiveBatchOverInline', {
                                  remaining,
                                  unit: line.unitLabel,
                                })
                              : undefined
                          }
                        />
                      </div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {line.unitLabel}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => fillLineFull(line.id, remaining)}
                        className="h-9 px-2 text-xs"
                      >
                        {t('inventory.poReceiveFillLine')}
                      </Button>
                    </div>
                    {batchNum > 0 && !overRemaining && (
                      <p
                        className={cn(
                          'mt-1.5 text-xs',
                          fullyAfter
                            ? 'text-brand-700 dark:text-brand-300'
                            : 'text-gray-600 dark:text-gray-400',
                        )}
                      >
                        {t('inventory.poReceiveAfterPreview', {
                          after: formatNumberID(afterTotal),
                          ordered: formatNumberID(line.orderedQty),
                          unit: line.unitLabel,
                        })}
                        {fullyAfter && (
                          <span className="ml-1 font-semibold">
                            ({t('inventory.poReceiveAfterFull')})
                          </span>
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
            )
          })}

          <div
            className={cn(
              'rounded-lg border-2 px-4 py-2.5',
              allFullPreview
                ? 'border-success-300 bg-success-50 dark:border-success-900/40 dark:bg-success-900/10'
                : 'border-warning-200 bg-warning-50 dark:border-warning-900/40 dark:bg-warning-900/10',
            )}
          >
            <p
              className={cn(
                'text-xs font-medium',
                allFullPreview
                  ? 'text-success-800 dark:text-success-300'
                  : 'text-warning-800 dark:text-warning-300',
              )}
            >
              {allFullPreview
                ? t('inventory.poReceiveAllPreview')
                : t('inventory.poReceivePartialPreview')}
            </p>
          </div>

          {error && (
            <p className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={submitting}>
            {t('inventory.poReceiveBtn')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
