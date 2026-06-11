import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'
import { closeCashSession } from '@/server/functions/pos-cash'

/**
 * JUR-141 Peti Kas — appears when getCurrentOpenSession returns a
 * session opened >14h ago. Force-close path skips the physical
 * count, records `force_closed=true` + a zero variance, and
 * re-prompts BukaKasModal so the cashier can start a fresh shift.
 *
 * No "edit physical count" option here — the assumption is the
 * cashier wasn't around for the prior shift's close and can't
 * reliably count what's in the till relative to a 14+ hour-old
 * snapshot. The owner can correct after the fact via the report
 * page.
 */
export function StaleSessionModal({
  sessionId,
  openedAt,
  onForceClosed,
}: {
  sessionId: string
  openedAt: Date | string
  onForceClosed: () => void | Promise<void>
}) {
  const { t } = useTranslation()

  const mutation = useMutation({
    mutationFn: () =>
      closeCashSession({
        data: {
          sessionId,
          // Setting actualClosing to 0 forces variance =
          // -expected_closing — the report flag (force_closed=true)
          // tells the owner this number isn't meaningful.
          actualClosing: 0,
          forceClosed: true,
          closingNotes: t('pos.cash.stale.autoNote'),
        },
      }),
    onSuccess: async () => {
      await onForceClosed()
    },
  })

  return (
    <Dialog open onClose={() => { /* blocking */ }}>
      <DialogHeader>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-warning-700" />
            {t('pos.cash.stale.title')}
          </span>
        </DialogTitle>
        <DialogDescription>
          {t('pos.cash.stale.subtitle', {
            opened: formatDate(openedAt, 'dd MMM yyyy HH:mm'),
          })}
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-900 dark:border-warning-800/40 dark:bg-warning-900/20 dark:text-warning-300">
          {t('pos.cash.stale.body')}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button
          variant="brand"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {t('pos.cash.stale.forceCloseCta')}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
