import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  referralClaimRequests,
  referralCommissions,
  referralAttributions,
  referralCodes,
  tenantPayoutMethods,
  tenants,
  platformAdminAuditLogs,
} from '@vintra/db/schema'
import { and, eq, desc, sql, gt } from 'drizzle-orm'
import { createClient } from '@supabase/supabase-js'
import { requirePlatformAdmin } from '../middleware/platform-admin'
import { sendEmail } from '../email'
import { formatRupiah as formatRupiahEmail } from '@/lib/currency'

// Same local helper pattern used by server/functions/auth.ts. Keeps
// the supabase admin client import-local so this module doesn't depend
// on middleware internals that aren't part of the public API.
function getSupabaseAdmin() {
  return createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SECRET_KEY']!,
  )
}

// JUR-90: admin-side claim queue + payout marking.
//
// All endpoints here are gated by requirePlatformAdmin. The mutating
// endpoints (markClaimPaid, rejectClaim) write a platform_admin_audit_logs
// row alongside the state change so every payout decision is traceable.

const listFilters = z
  .object({
    status: z.enum(['submitted', 'approved', 'paid', 'rejected']).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .optional()
  .default({ limit: 50 })

export const adminListClaimRequests = createServerFn({ method: 'POST' })
  .inputValidator(listFilters)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const conditions = []
    if (data.status) {
      conditions.push(eq(referralClaimRequests.status, data.status))
    }
    const whereExpr = conditions.length ? and(...conditions) : undefined

    return db
      .select({
        id: referralClaimRequests.id,
        tenantId: referralClaimRequests.tenantId,
        tenantName: tenants.businessName,
        tenantSlug: tenants.slug,
        totalAmountIdr: referralClaimRequests.totalAmountIdr,
        status: referralClaimRequests.status,
        submittedAt: referralClaimRequests.submittedAt,
        processedAt: referralClaimRequests.processedAt,
        bankName: tenantPayoutMethods.bankName,
        accountNumber: tenantPayoutMethods.accountNumber,
        accountHolderName: tenantPayoutMethods.accountHolderName,
      })
      .from(referralClaimRequests)
      .leftJoin(tenants, eq(tenants.id, referralClaimRequests.tenantId))
      .leftJoin(tenantPayoutMethods, eq(tenantPayoutMethods.id, referralClaimRequests.payoutMethodId))
      .where(whereExpr)
      .orderBy(
        // Submitted (= action needed) bubbles to top, then newest first.
        sql`CASE WHEN ${referralClaimRequests.status} = 'submitted' THEN 0 ELSE 1 END`,
        desc(referralClaimRequests.submittedAt),
      )
      .limit(data.limit)
  })

export const adminGetClaimRequest = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [request] = await db
      .select({
        id: referralClaimRequests.id,
        tenantId: referralClaimRequests.tenantId,
        tenantName: tenants.businessName,
        tenantSlug: tenants.slug,
        totalAmountIdr: referralClaimRequests.totalAmountIdr,
        status: referralClaimRequests.status,
        submittedAt: referralClaimRequests.submittedAt,
        processedAt: referralClaimRequests.processedAt,
        processedBy: referralClaimRequests.processedBy,
        adminNotes: referralClaimRequests.adminNotes,
        transferProofKey: referralClaimRequests.transferProofKey,
        bankName: tenantPayoutMethods.bankName,
        accountNumber: tenantPayoutMethods.accountNumber,
        accountHolderName: tenantPayoutMethods.accountHolderName,
      })
      .from(referralClaimRequests)
      .leftJoin(tenants, eq(tenants.id, referralClaimRequests.tenantId))
      .leftJoin(tenantPayoutMethods, eq(tenantPayoutMethods.id, referralClaimRequests.payoutMethodId))
      .where(eq(referralClaimRequests.id, data.id))
      .limit(1)

    if (!request) throw new Error('Klaim tidak ditemukan')

    const commissions = await db
      .select({
        id: referralCommissions.id,
        amountIdr: referralCommissions.amountIdr,
        createdAt: referralCommissions.createdAt,
        status: referralCommissions.status,
      })
      .from(referralCommissions)
      .where(eq(referralCommissions.claimRequestId, data.id))
      .orderBy(desc(referralCommissions.createdAt))

    return { request, commissions }
  })

/**
 * Look up the tenant owner's email so we can notify them when the
 * claim is processed. Done via Supabase admin (auth.users) because
 * the email column lives in the auth schema, outside Drizzle.
 */
async function getTenantOwnerEmail(tenantId: string): Promise<{ email: string; name: string } | null> {
  const [row] = await db
    .select({ ownerId: tenants.ownerId, businessName: tenants.businessName })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  if (!row?.ownerId) return null
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.admin.getUserById(row.ownerId)
  if (error || !data.user?.email) return null
  return {
    email: data.user.email,
    name: (data.user.user_metadata?.full_name as string | undefined) ?? row.businessName ?? '',
  }
}

export const adminMarkClaimPaid = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      adminNotes: z.string().max(2000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    return db.transaction(async (tx) => {
      // Lock the claim + check it's still submittable. Treat 'paid'
      // re-submission as a no-op (idempotent), but block on 'rejected'.
      const [request] = await tx
        .select()
        .from(referralClaimRequests)
        .where(eq(referralClaimRequests.id, data.id))
        .for('update')
        .limit(1)
      if (!request) throw new Error('Klaim tidak ditemukan')
      if (request.status === 'paid') return { id: request.id, alreadyPaid: true }
      if (request.status === 'rejected') {
        throw new Error('Klaim sudah ditolak — tidak bisa diubah jadi paid.')
      }

      await tx
        .update(referralClaimRequests)
        .set({
          status: 'paid',
          processedAt: new Date(),
          processedBy: auth.userId,
          adminNotes: data.adminNotes ?? null,
        })
        .where(eq(referralClaimRequests.id, data.id))

      // Propagate to linked commissions.
      await tx
        .update(referralCommissions)
        .set({ status: 'paid' })
        .where(eq(referralCommissions.claimRequestId, data.id))

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'referral_claim_mark_paid',
        targetTenantId: request.tenantId,
        targetUserId: null,
        metadata: { claimRequestId: data.id, totalAmountIdr: request.totalAmountIdr },
      })

      // Notify the tenant outside the tx (best-effort).
      void notifyTenantClaimUpdate(request.tenantId, 'paid', request.totalAmountIdr)

      return { id: request.id, alreadyPaid: false }
    })
  })

export const adminRejectClaim = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      adminNotes: z.string().min(1, 'Alasan penolakan wajib diisi').max(2000),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    return db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(referralClaimRequests)
        .where(eq(referralClaimRequests.id, data.id))
        .for('update')
        .limit(1)
      if (!request) throw new Error('Klaim tidak ditemukan')
      if (request.status === 'paid') {
        throw new Error('Klaim sudah dibayar — tidak bisa ditolak.')
      }
      if (request.status === 'rejected') return { id: request.id, alreadyRejected: true }

      await tx
        .update(referralClaimRequests)
        .set({
          status: 'rejected',
          processedAt: new Date(),
          processedBy: auth.userId,
          adminNotes: data.adminNotes,
        })
        .where(eq(referralClaimRequests.id, data.id))

      // Release the linked commissions back to the claimable bucket so
      // the tenant can re-submit (typically after fixing the bank info
      // or some other admin-flagged issue).
      await tx
        .update(referralCommissions)
        .set({ claimRequestId: null, status: 'claimable' })
        .where(eq(referralCommissions.claimRequestId, data.id))

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'referral_claim_reject',
        targetTenantId: request.tenantId,
        targetUserId: null,
        metadata: {
          claimRequestId: data.id,
          totalAmountIdr: request.totalAmountIdr,
          reason: data.adminNotes,
        },
      })

      void notifyTenantClaimUpdate(request.tenantId, 'rejected', request.totalAmountIdr, data.adminNotes)

      return { id: request.id, alreadyRejected: false }
    })
  })

async function notifyTenantClaimUpdate(
  tenantId: string,
  outcome: 'paid' | 'rejected',
  totalAmountIdr: string,
  reason?: string,
) {
  try {
    const owner = await getTenantOwnerEmail(tenantId)
    if (!owner) return

    const amount = formatRupiahEmail(parseFloat(totalAmountIdr))
    if (outcome === 'paid') {
      await sendEmail({
        to: owner.email,
        toName: owner.name,
        subject: `[Vintra] Komisi referral ${amount} sudah dibayar`,
        htmlContent: `<p>Halo ${owner.name || 'rekan'},</p><p>Klaim komisi referral Anda senilai <strong>${amount}</strong> sudah dibayarkan ke rekening yang terdaftar. Mohon dicek di rekening Anda.</p><p>Terima kasih telah membantu mengembangkan Vintra!</p>`,
        textContent: `Klaim komisi Anda senilai ${amount} sudah dibayarkan. Mohon dicek di rekening yang terdaftar.`,
        tag: 'referral-claim-paid',
      })
    } else {
      await sendEmail({
        to: owner.email,
        toName: owner.name,
        subject: `[Vintra] Klaim komisi ${amount} ditolak`,
        htmlContent: `<p>Halo ${owner.name || 'rekan'},</p><p>Klaim komisi senilai <strong>${amount}</strong> ditolak admin dengan alasan:</p><blockquote>${reason ?? '-'}</blockquote><p>Komisi sudah dikembalikan ke status siap diklaim. Silakan ajukan ulang setelah memperbaiki yang diminta admin.</p>`,
        textContent: `Klaim komisi ${amount} ditolak. Alasan: ${reason ?? '-'}. Komisi tersedia kembali untuk diklaim setelah Anda memperbaiki masalah.`,
        tag: 'referral-claim-rejected',
      })
    }
  } catch (err) {
    console.error('[referral-admin] notifyTenant failed', err)
  }
}

/**
 * JUR-94 follow-up: look up the active referral attribution for a
 * tenant so the admin tenant-detail page + payment-record sheets can
 * surface it ("this tenant has a 15% discount, pre-fill amount").
 *
 * Returns null when:
 *   - the tenant didn't sign up via a referral code
 *   - the attribution's 12-month window has expired (no more discount,
 *     no more commission — referral terminated naturally)
 *   - the code has since been deactivated by the referrer
 */
export const adminGetTenantReferralAttribution = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [row] = await db
      .select({
        code: referralCodes.code,
        discountPctSnapshot: referralAttributions.discountPctSnapshot,
        commissionPctSnapshot: referralAttributions.commissionPctSnapshot,
        windowEndsAt: referralAttributions.windowEndsAt,
        referrerName: tenants.businessName,
        referrerTenantId: referralAttributions.referrerTenantId,
        isActive: referralCodes.isActive,
      })
      .from(referralAttributions)
      .leftJoin(referralCodes, eq(referralCodes.id, referralAttributions.codeId))
      .leftJoin(tenants, eq(tenants.id, referralAttributions.referrerTenantId))
      .where(
        and(
          eq(referralAttributions.refereeTenantId, data.tenantId),
          gt(referralAttributions.windowEndsAt, new Date()),
        ),
      )
      .limit(1)

    if (!row || !row.isActive) return null
    return {
      code: row.code ?? '',
      referrerName: row.referrerName ?? '',
      discountPct: parseFloat(row.discountPctSnapshot),
      commissionPct: parseFloat(row.commissionPctSnapshot),
      windowEndsAt: row.windowEndsAt.toISOString(),
    }
  })
