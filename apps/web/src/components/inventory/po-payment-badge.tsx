import { useTranslation } from 'react-i18next'
import { poPaymentStatus, type PoPaymentStatus } from '@/lib/po-payment'
import { cn } from '@/lib/utils'

// Outlined, unlike the filled delivery-status pills, so the two statuses
// sitting side by side don't read as one.
const PAYMENT_STATUS_COLOR: Record<PoPaymentStatus, string> = {
  unpaid:
    'border-danger-300 text-danger-700 dark:border-danger-800 dark:text-danger-400',
  partial:
    'border-warning-300 text-warning-700 dark:border-warning-800 dark:text-warning-400',
  paid: 'border-success-300 text-success-700 dark:border-success-800 dark:text-success-400',
}

/** Payment status pill for a PO. Renders nothing for a cancelled PO. */
export function PoPaymentBadge({
  po,
  className,
}: {
  po: { status: string; subtotal: number; paidAmount: number }
  className?: string
}) {
  const { t } = useTranslation()
  const status = poPaymentStatus(po)
  if (!status) return null
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
        PAYMENT_STATUS_COLOR[status],
        className,
      )}
    >
      {t(`inventory.poPaymentStatus_${status}`)}
    </span>
  )
}
