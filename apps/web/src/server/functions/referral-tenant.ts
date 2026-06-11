import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  referralCommissions,
  referralClaimRequests,
  referralAttributions,
  tenantPayoutMethods,
  tenants,
} from '@vintra/db/schema'
import { and, eq, sql, desc, inArray } from 'drizzle-orm'
import { requireReferralAccess } from '../middleware/referral-access'
import { sendEmail } from '../email'
import { formatRupiah as formatRupiahEmail } from '@/lib/currency'

// JUR-89: tenant-side commission dashboard + claim flow.
//
// Key concept: pending → claimable rollover is computed ON READ rather
// than by a cron. A row is treated as claimable when:
//   status = 'pending' AND pending_until <= now()
//   OR
//   status = 'claimable'
// This means we don't need a scheduled job; the next query naturally
// reflects the rollover.

/**
 * Returns the four headline stats the dashboard renders at the top.
 * All amounts are sums of `amount_idr` filtered by status + the
 * computed claimable rollover.
 */
export const getMyCommissionSummary = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { tenantId } = await requireReferralAccess()

    const [row] = await db
      .select({
        // Lifetime sum, ignoring 'reversed' (refund-clawed-back).
        totalEarned: sql<string>`COALESCE(SUM(CASE WHEN ${referralCommissions.status} != 'reversed' THEN ${referralCommissions.amountIdr} ELSE 0 END), 0)`,
        // Still in clawback window AND not yet claimed.
        pending: sql<string>`COALESCE(SUM(CASE WHEN ${referralCommissions.status} = 'pending' AND ${referralCommissions.pendingUntil} > now() THEN ${referralCommissions.amountIdr} ELSE 0 END), 0)`,
        // Eligible to be claimed: status flipped to claimable, OR
        // still 'pending' but past the clawback. Either way, exclude
        // rows already linked to a submitted/approved/paid request.
        claimable: sql<string>`COALESCE(SUM(CASE WHEN ((${referralCommissions.status} = 'pending' AND ${referralCommissions.pendingUntil} <= now()) OR ${referralCommissions.status} = 'claimable') AND ${referralCommissions.claimRequestId} IS NULL THEN ${referralCommissions.amountIdr} ELSE 0 END), 0)`,
        paid: sql<string>`COALESCE(SUM(CASE WHEN ${referralCommissions.status} = 'paid' THEN ${referralCommissions.amountIdr} ELSE 0 END), 0)`,
      })
      .from(referralCommissions)
      .where(eq(referralCommissions.referrerTenantId, tenantId))

    return {
      totalEarned: row?.totalEarned ?? '0',
      pending: row?.pending ?? '0',
      claimable: row?.claimable ?? '0',
      paid: row?.paid ?? '0',
    }
  },
)

const listFilters = z
  .object({
    status: z.enum(['pending', 'claimable', 'paid', 'reversed']).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .optional()
  .default({ limit: 50 })

/**
 * Per-row commission history. The 'effectiveStatus' field reflects
 * the on-read rollover (pending past clawback shows as claimable).
 * Joins the referee tenant's business name for display.
 */
export const listMyCommissions = createServerFn({ method: 'POST' })
  .inputValidator(listFilters)
  .handler(async ({ data }) => {
    const { tenantId } = await requireReferralAccess()

    const rows = await db
      .select({
        id: referralCommissions.id,
        amountIdr: referralCommissions.amountIdr,
        status: referralCommissions.status,
        pendingUntil: referralCommissions.pendingUntil,
        createdAt: referralCommissions.createdAt,
        claimRequestId: referralCommissions.claimRequestId,
        refereeTenantName: tenants.businessName,
      })
      .from(referralCommissions)
      .leftJoin(referralAttributions, eq(referralAttributions.id, referralCommissions.attributionId))
      .leftJoin(tenants, eq(tenants.id, referralAttributions.refereeTenantId))
      .where(eq(referralCommissions.referrerTenantId, tenantId))
      .orderBy(desc(referralCommissions.createdAt))
      .limit(data.limit)

    const now = new Date()
    return rows.map((r) => {
      // Derived "effective" status — what the UI should render the row
      // as, accounting for the pending→claimable rollover.
      let effectiveStatus: 'pending' | 'claimable' | 'paid' | 'reversed' | 'submitted' = r.status as
        | 'pending' | 'claimable' | 'paid' | 'reversed'
      if (effectiveStatus === 'pending' && r.pendingUntil && r.pendingUntil <= now) {
        effectiveStatus = 'claimable'
      }
      if (r.claimRequestId && effectiveStatus === 'claimable') {
        // Linked to an open claim request — show as 'submitted' so the
        // tenant doesn't think they can re-claim it.
        effectiveStatus = 'submitted'
      }
      return { ...r, effectiveStatus }
    })
  })

export const listMyClaimRequests = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional().default({ limit: 20 }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireReferralAccess()
    return db
      .select()
      .from(referralClaimRequests)
      .where(eq(referralClaimRequests.tenantId, tenantId))
      .orderBy(desc(referralClaimRequests.submittedAt))
      .limit(data.limit)
  })

export const getMyPayoutMethod = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { tenantId } = await requireReferralAccess()
    const [row] = await db
      .select()
      .from(tenantPayoutMethods)
      .where(eq(tenantPayoutMethods.tenantId, tenantId))
      .orderBy(desc(tenantPayoutMethods.isDefault), desc(tenantPayoutMethods.updatedAt))
      .limit(1)
    return row ?? null
  },
)

const payoutMethodSchema = z.object({
  bankName: z.string().min(1, 'Nama bank wajib diisi').max(60),
  accountNumber: z
    .string()
    .regex(/^\d{6,20}$/, 'Nomor rekening 6-20 digit'),
  accountHolderName: z.string().min(1, 'Nama pemilik rekening wajib diisi').max(120),
})

/**
 * Upsert the tenant's bank info. v1 is single-method per tenant so
 * each call replaces the existing default row.
 */
export const upsertPayoutMethod = createServerFn({ method: 'POST' })
  .inputValidator(payoutMethodSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireReferralAccess()

    const [existing] = await db
      .select({ id: tenantPayoutMethods.id })
      .from(tenantPayoutMethods)
      .where(eq(tenantPayoutMethods.tenantId, tenantId))
      .limit(1)

    if (existing) {
      const [row] = await db
        .update(tenantPayoutMethods)
        .set({
          bankName: data.bankName,
          accountNumber: data.accountNumber,
          accountHolderName: data.accountHolderName,
          isDefault: true,
          updatedAt: new Date(),
        })
        .where(eq(tenantPayoutMethods.id, existing.id))
        .returning()
      return row
    }

    const [row] = await db
      .insert(tenantPayoutMethods)
      .values({
        tenantId,
        bankName: data.bankName,
        accountNumber: data.accountNumber,
        accountHolderName: data.accountHolderName,
        isDefault: true,
      })
      .returning()
    return row
  })

/**
 * Submit a claim for all currently-claimable commission rows.
 *
 * The transaction:
 *   1. lock the candidate rows with FOR UPDATE so two concurrent
 *      submits can't both claim the same commissions
 *   2. compute total
 *   3. create the request row (status=submitted)
 *   4. link the commissions to the request (claim_request_id =
 *      request.id, status flips to 'claimable' so the rollover stops
 *      double-counting them)
 *
 * Reject if: claimable balance is 0, no payout method on file, OR a
 * prior request is still 'submitted' (one in flight at a time).
 */
export const submitClaimRequest = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { tenantId } = await requireReferralAccess()

    // Pre-flight: payout method must exist.
    const [payout] = await db
      .select()
      .from(tenantPayoutMethods)
      .where(eq(tenantPayoutMethods.tenantId, tenantId))
      .limit(1)
    if (!payout) {
      throw new Error('Info bank belum diisi. Lengkapi tab Info Bank dulu.')
    }

    // Pre-flight: no in-flight claim.
    const [inFlight] = await db
      .select({ id: referralClaimRequests.id })
      .from(referralClaimRequests)
      .where(
        and(
          eq(referralClaimRequests.tenantId, tenantId),
          eq(referralClaimRequests.status, 'submitted'),
        ),
      )
      .limit(1)
    if (inFlight) {
      throw new Error('Klaim sebelumnya masih diproses admin. Tunggu sampai selesai sebelum mengajukan klaim baru.')
    }

    return db.transaction(async (tx) => {
      // Lock candidate rows. Same rollover logic as
      // getMyCommissionSummary: pending past clawback OR explicit
      // claimable, AND not yet linked to any request.
      const candidates = await tx.execute<{
        id: string
        amount_idr: string
      }>(sql`
        SELECT id, amount_idr
        FROM ${referralCommissions}
        WHERE referrer_tenant_id = ${tenantId}
          AND claim_request_id IS NULL
          AND ((status = 'pending' AND pending_until <= now()) OR status = 'claimable')
        FOR UPDATE
      `)

      if (candidates.length === 0) {
        throw new Error('Tidak ada komisi yang siap diklaim.')
      }

      const total = candidates.reduce((acc, r) => acc + parseFloat(r.amount_idr), 0)

      const [request] = await tx
        .insert(referralClaimRequests)
        .values({
          tenantId,
          payoutMethodId: payout.id,
          totalAmountIdr: total.toFixed(2),
          status: 'submitted',
        })
        .returning()

      // drizzle's sql`` template doesn't auto-cast a JS array to a
      // Postgres uuid[] when bound via $N parameters — the row arrives
      // server-side as the literal string "id1,id2" and chokes with
      // `malformed array literal`. inArray() generates a parameterised
      // IN (...) clause that postgres-js handles correctly.
      const ids = candidates.map((c) => c.id)
      await tx
        .update(referralCommissions)
        .set({ claimRequestId: request!.id, status: 'claimable' })
        .where(inArray(referralCommissions.id, ids))

      // Admin notification email (best-effort). Looks up the
      // PLATFORM_ADMIN_EMAIL env var; if absent or Brevo is down, the
      // admin still sees the request in /admin/referrals/claims, so
      // this is purely a heads-up channel, never load-bearing.
      const adminEmail = process.env['PLATFORM_ADMIN_EMAIL']
      if (adminEmail) {
        const [tenantRow] = await tx
          .select({ businessName: tenants.businessName })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1)
        const subject = `[Vintra] Klaim komisi baru — ${formatRupiahEmail(total)}`
        const tenantName = tenantRow?.businessName ?? 'Tenant'
        const html = `<p>Halo admin,</p><p><strong>${tenantName}</strong> mengajukan klaim komisi referral senilai <strong>${formatRupiahEmail(total)}</strong> (${candidates.length} transaksi).</p><p>Proses di <a href="https://vintra.my.id/admin/referrals/claims">/admin/referrals/claims</a>.</p>`
        const text = `${tenantName} mengajukan klaim komisi referral ${formatRupiahEmail(total)} (${candidates.length} transaksi). Proses di /admin/referrals/claims`
        // Don't await inside the tx return path's hot loop, but it's
        // fine — sendEmail is just fetch and never throws.
        void sendEmail({
          to: adminEmail,
          subject,
          htmlContent: html,
          textContent: text,
          tag: 'referral-claim-submitted',
        })
      }

      return { requestId: request!.id, total: total.toFixed(2), count: candidates.length }
    })
  },
)
