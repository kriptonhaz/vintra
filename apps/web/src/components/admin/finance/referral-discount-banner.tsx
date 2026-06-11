// JUR-96: shared UI for the "this tenant has an active referral
// attribution → diskon X%" callout, reused by all four payment sheets
// (WA, POS, Inventory, Attendance).
//
// The math itself isn't sent to the server — the server applies the
// discount independently via applyReferralDiscount, so this component
// is purely visual feedback. Caller passes the full pre-discount
// amount; the helper here computes the same rounding the server uses
// (Math.round((full * pct) / 100)) so the displayed total matches
// what `financial_transactions.amount_idr` ends up being.

import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils' // JUR-137

export interface ReferralAttributionForSheet {
  code: string
  referrerName: string
  discountPct: number
  windowEndsAt: string
}

export function computeDiscount(
  fullAmount: number,
  attribution: ReferralAttributionForSheet | null | undefined,
): { discountAmount: number; finalAmount: number } {
  if (!attribution || attribution.discountPct <= 0) {
    return { discountAmount: 0, finalAmount: fullAmount }
  }
  const discountAmount = Math.round((fullAmount * attribution.discountPct) / 100)
  return { discountAmount, finalAmount: fullAmount - discountAmount }
}

export function ReferralDiscountBanner({
  attribution,
}: {
  attribution: ReferralAttributionForSheet | null | undefined
}) {
  if (!attribution) return null
  return (
    <div className="rounded-lg border border-success-200 bg-success-50 p-3 text-sm dark:border-success-900/40 dark:bg-success-900/20">
      <p className="font-medium text-success-700 dark:text-success-300">
        🎁 Diskon referral {attribution.discountPct}%
      </p>
      <p className="mt-0.5 text-xs text-success-700/80 dark:text-success-300/80">
        Pendaftar via kode <strong>{attribution.code}</strong> dari{' '}
        <strong>{attribution.referrerName}</strong>. Berlaku sampai{' '}
        {formatDate(attribution.windowEndsAt, 'dd MMM yyyy')}
        .
      </p>
    </div>
  )
}

/** Renders the "Total" tile (or its discounted form) inside the
 *  blue summary card every payment sheet has. Callers pass the full
 *  pre-discount amount and the helper picks the right layout. */
export function DiscountedTotal({
  fullAmount,
  attribution,
}: {
  fullAmount: number
  attribution: ReferralAttributionForSheet | null | undefined
}) {
  const { discountAmount, finalAmount } = computeDiscount(fullAmount, attribution)
  if (!attribution || discountAmount <= 0) {
    return (
      <p className="text-xl font-bold text-brand-700 dark:text-brand-300">
        {formatRupiah(fullAmount)}
      </p>
    )
  }
  return (
    <>
      <p className="text-xs text-gray-500 line-through">{formatRupiah(fullAmount)}</p>
      <p className="text-xl font-bold text-brand-700 dark:text-brand-300">
        {formatRupiah(finalAmount)}
      </p>
      <p className="mt-0.5 text-xs text-success-600 dark:text-success-400">
        Hemat {formatRupiah(discountAmount)} ({attribution.discountPct}%)
      </p>
    </>
  )
}
