/**
 * POS daily Z-Report hook.
 *
 * Mirrors `getDailyZReport` on the web. Returns the end-of-day rollup
 * for the given Jakarta date + optional branch filter:
 *   - sales/voided counts + revenue total
 *   - payment-method breakdown
 *   - top 5 items by quantity sold
 *   - cash-session reconciliation (JUR-141 Peti Kas)
 *
 * Tier-gated server-side (`daily_zreport` POS feature, Toko+ only). The
 * mobile screen surfaces the upgrade page in a friendly state when the
 * gate throws.
 */
import { useQuery } from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

export type POSPaymentMethod =
  | 'cash'
  | 'qris'
  | 'transfer'
  | 'card'
  | 'ewallet'
  | 'gopay'
  | 'shopeepay'
  | 'ovo'

export interface CashSessionRow {
  id: string
  branchName: string
  cashierName: string | null
  status: 'open' | 'closed'
  openingBalance: number
  expectedClosing: number
  actualClosing: number | null
  variance: number | null
  forceClosed: boolean
}

export interface DailyZReport {
  date: string
  branchId: string | null
  salesCount: number
  voidedCount: number
  totalRevenue: number
  byPaymentMethod: Array<{
    method: POSPaymentMethod
    count: number
    total: number
  }>
  topItems: Array<{
    name: string
    qtySold: number
    revenue: number
  }>
  cashReconciliation: {
    sessions: CashSessionRow[]
    totalVariance: number
  }
}

export function useDailyZReport(opts: {
  date: string // YYYY-MM-DD (Jakarta wall-clock)
  branchId?: string | null
  enabled?: boolean
}) {
  const { tenantId } = useTenant()
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(opts.date)
  return useQuery({
    queryKey: [
      'pos',
      'z-report',
      tenantId,
      opts.date,
      opts.branchId ?? null,
    ],
    enabled: opts.enabled !== false && !!tenantId && isValidDate,
    queryFn: () =>
      callServerFn<DailyZReport>('getDailyZReport', {
        date: opts.date,
        branchId: opts.branchId ?? undefined,
      }),
  })
}
