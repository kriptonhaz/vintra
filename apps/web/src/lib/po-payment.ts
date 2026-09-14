/**
 * Supplier payment state for purchase orders. Shared by the PO server
 * functions and the PO pages so both derive the same status.
 */
export const PO_PAYMENT_METHODS = ['cash', 'transfer', 'qris', 'other'] as const
export type PoPaymentMethod = (typeof PO_PAYMENT_METHODS)[number]
export type PoPaymentStatus = 'unpaid' | 'partial' | 'paid'

// Amounts are 2-decimal numerics; anything under half a sen is float noise.
const EPSILON = 0.005

/**
 * Derived, never stored. A cancelled PO is no longer a debt, so it has no
 * payment status (null) — its payment history stays on the detail page.
 * Keep in step with the SQL filter in `exportPurchaseOrders`.
 */
export function poPaymentStatus(po: {
  status: string
  subtotal: number
  paidAmount: number
}): PoPaymentStatus | null {
  if (po.status === 'cancelled') return null
  if (po.paidAmount >= po.subtotal - EPSILON) return 'paid'
  return po.paidAmount > EPSILON ? 'partial' : 'unpaid'
}

/** What is still owed to the supplier, never negative. */
export function poRemainingAmount(po: {
  subtotal: number
  paidAmount: number
}): number {
  return Math.max(Number((po.subtotal - po.paidAmount).toFixed(2)), 0)
}
