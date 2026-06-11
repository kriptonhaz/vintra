// JUR-96: server-side referral discount application.
//
// Each record-payment server fn computes the full plan price first
// (via posTotal / inventoryTotal / attendanceTotal / WA plan const).
// Right after that, it calls this helper — if the buying tenant has
// an active referral attribution, the discount % is applied and the
// result becomes the `financial_transactions.amount_idr` that the
// invoice + commission credit both reference.
//
// Doing this server-side (instead of having the client send a pre-
// discounted number) keeps a single source of truth and prevents the
// "what if the admin types the wrong amount" failure mode. The client
// payment sheets only render the discount math for UX feedback.

import {
  referralAttributions,
} from '@vintra/db/schema'
import { db } from '@vintra/db'
import { eq, gt, and } from 'drizzle-orm'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

interface Input {
  /** Drizzle tx — passed so the discount lookup runs inside the same
   *  transaction as the payment insert (consistent read of the
   *  attribution row). */
  tx: Tx
  refereeTenantId: string
  /** Full plan price before any discount. */
  fullAmountIdr: number
}

interface Output {
  /** Amount to persist as the invoice + commission base. Equal to
   *  `fullAmountIdr` when no active attribution exists. */
  finalAmountIdr: number
  /** Convenience for callers that want to surface the discount line. */
  discountAmountIdr: number
}

export async function applyReferralDiscount(input: Input): Promise<Output> {
  const { tx, refereeTenantId, fullAmountIdr } = input

  try {
    const [att] = await tx
      .select()
      .from(referralAttributions)
      .where(
        and(
          eq(referralAttributions.refereeTenantId, refereeTenantId),
          gt(referralAttributions.windowEndsAt, new Date()),
        ),
      )
      .limit(1)
    if (!att) return { finalAmountIdr: fullAmountIdr, discountAmountIdr: 0 }
    if (att.referrerTenantId === refereeTenantId) {
      // Defensive — JUR-91 blocks this at attribution time but a
      // direct DB write could slip through. No discount on self-
      // referrals.
      return { finalAmountIdr: fullAmountIdr, discountAmountIdr: 0 }
    }

    const discountPct = parseFloat(att.discountPctSnapshot)
    if (!Number.isFinite(discountPct) || discountPct <= 0) {
      return { finalAmountIdr: fullAmountIdr, discountAmountIdr: 0 }
    }

    const discountAmountIdr = Math.round((fullAmountIdr * discountPct) / 100)
    const finalAmountIdr = fullAmountIdr - discountAmountIdr
    return { finalAmountIdr, discountAmountIdr }
  } catch (err) {
    // Best-effort — a glitch here must not break the payment flow.
    // The admin can re-record manually if discount silently fails.
    console.error('[referral-discount] failed', { refereeTenantId, err })
    return { finalAmountIdr: fullAmountIdr, discountAmountIdr: 0 }
  }
}
