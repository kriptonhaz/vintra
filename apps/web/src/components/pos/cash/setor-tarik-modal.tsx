import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  recordCashDrop,
  recordCashPayout,
} from '@/server/functions/pos-cash'
import { listCashflowCategories } from '@/server/functions/cashflow'

/**
 * Shared modal for both Setor Tunai (drop — cash put INTO the drawer,
 * e.g. owner topup / kembalian) and Tarik Tunai (payout — cash spent
 * on a business expense). Same shape: amount + reason. The `kind`
 * prop picks the title/CTA labels and which server fn fires.
 *
 * Setor increases the running balance, Tarik decreases it. Payout
 * also books a matching cashflow expense; setor does not.
 */
export function SetorTarikModal({
  kind,
  sessionId,
  onClose,
  onSubmitted,
}: {
  kind: 'drop' | 'payout'
  sessionId: string
  onClose: () => void
  onSubmitted: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [amountStr, setAmountStr] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [categoryId, setCategoryId] = React.useState('')
  const [error, setError] = React.useState('')

  // Tarik Tunai books a cashflow expense, so let the cashier tag it with
  // an expense category (same list curated under Arus Kas → Kategori).
  // Setor (drop) isn't an expense, so it skips this entirely.
  const isPayout = kind === 'payout'
  const { data: expenseCategories = [] } = useQuery({
    queryKey: ['cashflow', 'categories', 'expense'],
    enabled: isPayout,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const all = await listCashflowCategories()
      return all.filter((c) => c.kind === 'expense')
    },
  })

  // Default to the "Pengeluaran Kas" system category once the list loads.
  React.useEffect(() => {
    if (!isPayout || categoryId || expenseCategories.length === 0) return
    const fallback =
      expenseCategories.find((c) => c.isSystem && c.name === 'Pengeluaran Kas') ??
      expenseCategories[0]
    if (fallback) setCategoryId(fallback.id)
  }, [isPayout, categoryId, expenseCategories])

  const mutation = useMutation({
    mutationFn: () => {
      if (kind === 'drop') {
        return recordCashDrop({
          data: {
            sessionId,
            amount: parseInt(amountStr) || 0,
            reason: reason.trim(),
          },
        })
      }
      return recordCashPayout({
        data: {
          sessionId,
          amount: parseInt(amountStr) || 0,
          reason: reason.trim(),
          categoryId: categoryId || undefined,
        },
      })
    },
    onSuccess: async () => {
      await onSubmitted()
      onClose()
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : t('pos.cash.setorTarik.errorFallback'),
      )
    },
  })

  function handleSubmit() {
    setError('')
    const amount = parseInt(amountStr) || 0
    if (amount <= 0) {
      setError(t('pos.cash.setorTarik.errorAmount'))
      return
    }
    if (!reason.trim()) {
      setError(t('pos.cash.setorTarik.errorReason'))
      return
    }
    mutation.mutate()
  }

  const tKey = kind === 'drop' ? 'setor' : 'tarik'

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{t(`pos.cash.${tKey}.title`)}</DialogTitle>
        <DialogDescription>
          {t(`pos.cash.${tKey}.description`)}
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-3">
          <CurrencyInput
            label={t(`pos.cash.${tKey}.amountLabel`)}
            value={amountStr}
            onChange={setAmountStr}
          />
          <Textarea
            label={t(`pos.cash.${tKey}.reasonLabel`)}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(`pos.cash.${tKey}.reasonPlaceholder`)}
            rows={2}
          />
          {isPayout && (
            <div>
              <Select
                label={t('pos.cash.tarik.categoryLabel')}
                placeholder={t('pos.cash.tarik.categoryPlaceholder')}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                options={expenseCategories.map((c) => ({
                  label: c.name,
                  value: c.id,
                }))}
              />
              <p className="mt-1.5 text-xs text-gray-500">
                {t('pos.cash.tarik.categoryHint')}
              </p>
            </div>
          )}
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="brand"
          onClick={handleSubmit}
          loading={mutation.isPending}
        >
          {t(`pos.cash.${tKey}.cta`)}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
