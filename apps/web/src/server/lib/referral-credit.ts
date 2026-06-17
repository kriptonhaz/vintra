// JUR-94: server-only helper that credits a referral commission when
// an admin records a paid invoice for a tenant who was attributed to
// a referrer (via JUR-91's signup capture).
//
// This is the "manual path" — when the real payment gateway lands
// (JUR-92), the gateway's webhook handler will end up calling the
// same record-payment server fns, so this helper carries over without
// changes.

import { db } from '@vintra/db'
import {
  referralAttributions,
  referralCommissions,
  referralGlobalConfig,
} from '@vintra/db/schema'
import { eq } from 'drizzle-orm'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

interface CreditInput {
  /** Active drizzle transaction — same one the caller is using to
   *  insert the financial_transactions row. A rollback there should
   *  also undo the commission credit. */
  tx: Tx
  /** The tenant being charged (the referee — they were attributed to
   *  someone else's referral code when they signed up). */
  refereeTenantId: string
  /** The invoice amount in IDR (numeric, stored as string by drizzle). */
  amountIdr: string
  /** The financial_transactions.id of the invoice that triggered this
   *  credit. Stored on the commission row so we can find + reverse
   *  the credit on refund. */
  invoiceId: string
}

/**
 * Best-effort: if anything is missing or unparseable, this no-ops
 * silently rather than failing the parent payment transaction. The
 * payment itself is the source of truth; a missed commission credit
 * can be backfilled later.
 *
 * No-op cases:
 *   - tenant has no `referral_attributions` row
 *   - attribution's `window_ends_at` has passed (12-month default
 *     window expired — no new credits past that point)
 *   - referrer == referee (defensive — JUR-91 prevents this at
 *     attribution time)
 *   - computed commission rounds to zero
 */
export async function creditReferralCommissionIfApplicable(
  input: CreditInput,
): Promise<void> {
  const { tx, refereeTenantId, amountIdr, invoiceId } = input
  try {
    const [att] = await tx
      .select()
      .from(referralAttributions)
      .where(eq(referralAttributions.refereeTenantId, refereeTenantId))
      .limit(1)
    if (!att) return

    const now = new Date()
    if (att.windowEndsAt && att.windowEndsAt <= now) {
      // Window expired — no new commissions.
      return
    }
    if (att.referrerTenantId === refereeTenantId) return // defensive

    const invoiceAmount = Number.parseFloat(amountIdr)
    if (!Number.isFinite(invoiceAmount) || invoiceAmount <= 0) return

    const [cfg] = await tx.select().from(referralGlobalConfig).limit(1)
    const clawbackDays = cfg?.clawbackDays ?? 14
    const pendingUntil = new Date(now)
    pendingUntil.setDate(pendingUntil.getDate() + clawbackDays)

    // Build the commission rows for this payment.
    //   - tenant referral → one row credited to the referrer tenant
    //   - agent referral  → the staff's commission, plus the head's override
    //     (when the referrer was a staff), as two independently-claimable rows
    // Each row uses the percentages SNAPSHOTTED on the attribution at signup,
    // so later re-allocation never changes historical credits.
    type Row = typeof referralCommissions.$inferInsert
    const base = {
      attributionId: att.id,
      referrerTenantId: att.referrerTenantId,
      sourceInvoiceId: invoiceId,
      status: 'pending' as const,
      pendingUntil,
    }
    const rows: Row[] = []
    const addRow = (
      pctRaw: string | null,
      beneficiaryType: 'tenant' | 'agent',
      beneficiaryAgentId: string | null,
    ) => {
      if (pctRaw === null) return
      const pct = Number.parseFloat(pctRaw)
      if (!Number.isFinite(pct)) return
      const amount = (invoiceAmount * pct) / 100
      if (amount <= 0) return
      rows.push({ ...base, beneficiaryType, beneficiaryAgentId, amountIdr: amount.toFixed(2) })
    }

    if (att.ownerType === 'agent') {
      // Staff's commission (or the head's own-code commission).
      addRow(att.commissionPctSnapshot, 'agent', att.staffAgentId)
      // Head's override on a staff's referral.
      if (att.headAgentId) {
        addRow(att.headOverridePctSnapshot, 'agent', att.headAgentId)
      }
    } else {
      addRow(att.commissionPctSnapshot, 'tenant', null)
    }

    if (rows.length === 0) return
    await tx.insert(referralCommissions).values(rows)
  } catch (err) {
    // Never throw — a glitch here must not roll back the financial
    // transaction. Log so we can investigate + backfill if it
    // happens in prod.
    console.error('[referral-credit] failed to credit commission', {
      refereeTenantId,
      invoiceId,
      err,
    })
  }
}

/**
 * Refund counterpart. Called from `recordRefund` after the new
 * `status='refund'` financial transaction row is inserted, with the
 * id of the ORIGINAL paid transaction.
 *
 * Behaviour per linked commission row:
 *   - status 'pending' OR ('claimable' AND no claim_request_id): flip
 *     to 'reversed'. No payout was made yet.
 *   - status 'claimable' AND linked to an in-flight claim_request: flip
 *     to 'reversed' AND unlink from the request. (If that empties the
 *     request, the admin will see a zero-amount request in the queue
 *     — they can reject it manually. We don't auto-reject because the
 *     amount could become non-zero again from other refunds racing
 *     in.)
 *   - status 'paid': can't auto-recover money already wired to the
 *     referrer. Insert an admin audit log entry flagging it; the
 *     commission row stays 'paid' so accounting reconciles.
 */
export async function reverseReferralCommissionsForInvoice(input: {
  tx: Tx
  originalInvoiceId: string
}): Promise<{ reversed: number; postPaidCount: number }> {
  const { tx, originalInvoiceId } = input
  try {
    const linked = await tx
      .select()
      .from(referralCommissions)
      .where(eq(referralCommissions.sourceInvoiceId, originalInvoiceId))

    if (linked.length === 0) return { reversed: 0, postPaidCount: 0 }

    let reversed = 0
    let postPaidCount = 0
    for (const row of linked) {
      if (row.status === 'reversed') continue
      if (row.status === 'paid') {
        // Money already wired to the referrer — can't auto-recover.
        // Leave the row at 'paid' so accounting reconciles; the
        // caller logs an admin alert.
        postPaidCount += 1
        continue
      }
      // pending or claimable (with or without in-flight claim) — flip
      // to reversed and unlink from any claim. If the unlink empties
      // the in-flight request, the admin will see a zero-amount entry
      // in the queue and can reject it manually.
      await tx
        .update(referralCommissions)
        .set({ status: 'reversed', claimRequestId: null })
        .where(eq(referralCommissions.id, row.id))
      reversed += 1
    }
    return { reversed, postPaidCount }
  } catch (err) {
    console.error('[referral-credit] reversal failed', {
      originalInvoiceId,
      err,
    })
    return { reversed: 0, postPaidCount: 0 }
  }
}
