import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Wallet } from 'lucide-react'
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
import { openCashSession } from '@/server/functions/pos-cash'

/**
 * JUR-141 Peti Kas — modal that demands a modal-awal count before the
 * cashier can sell. Renders over the cashier UI when
 * `getCurrentOpenSession` returns null AND the tenant has the drawer
 * enabled. Users who don't want to open the drawer right now can
 * bail to the dashboard instead of being forced to sign out.
 */
export function BukaKasModal({
  branchId,
  branchName,
  onOpened,
}: {
  branchId: string
  branchName: string
  onOpened: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [openingStr, setOpeningStr] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [error, setError] = React.useState('')

  const mutation = useMutation({
    mutationFn: () =>
      openCashSession({
        data: {
          branchId,
          openingBalance: parseInt(openingStr) || 0,
          openingNotes: notes.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      await onOpened()
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('pos.cash.buka.errorFallback'))
    },
  })

  function handleSubmit() {
    setError('')
    const opening = parseInt(openingStr) || 0
    if (opening < 0) {
      setError(t('pos.cash.buka.errorNegative'))
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open onClose={() => { /* blocking — no close */ }}>
      <DialogHeader>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-brand-600" />
            {t('pos.cash.buka.title')}
          </span>
        </DialogTitle>
        <DialogDescription>
          {t('pos.cash.buka.description', { branch: branchName })}
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-3">
          <CurrencyInput
            label={t('pos.cash.buka.modalAwalLabel')}
            value={openingStr}
            onChange={setOpeningStr}
            placeholder="Rp 0"
          />
          <Textarea
            label={t('pos.cash.buka.notesLabel')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('pos.cash.buka.notesPlaceholder')}
            rows={2}
          />
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button
          variant="secondary"
          onClick={() => navigate({ to: '/pos' })}
          disabled={mutation.isPending}
        >
          {t('pos.cash.buka.goToDashboard')}
        </Button>
        <Button
          variant="brand"
          onClick={handleSubmit}
          loading={mutation.isPending}
        >
          {t('pos.cash.buka.cta')}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
