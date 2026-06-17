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
import { requireMarketingAgent } from '@/server/middleware/marketing-agent'
import { sendEmail } from '../email'
import { formatRupiah as formatRupiahEmail } from '@/lib/currency'

// Agent-side commission dashboard + claim flow. Mirrors referral-tenant.ts
// but scoped per marketing agent: commissions filter on beneficiary_agent_id,
// payout methods + claims on owner_type='agent' + owner_agent_id.
//
// Same on-read rollover as the tenant flow: a row is claimable when
//   (status='pending' AND pending_until <= now()) OR status='claimable'.

export const getMyCommissionSummary = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { agent } = await requireMarketingAgent()

    const [row] = await db
      .select({
        totalEarned: sql<string>`COALESCE(SUM(CASE WHEN ${referralCommissions.status} != 'reversed' THEN ${referralCommissions.amountIdr} ELSE 0 END), 0)`,
        pending: sql<string>`COALESCE(SUM(CASE WHEN ${referralCommissions.status} = 'pending' AND ${referralCommissions.pendingUntil} > now() THEN ${referralCommissions.amountIdr} ELSE 0 END), 0)`,
        claimable: sql<string>`COALESCE(SUM(CASE WHEN ((${referralCommissions.status} = 'pending' AND ${referralCommissions.pendingUntil} <= now()) OR ${referralCommissions.status} = 'claimable') AND ${referralCommissions.claimRequestId} IS NULL THEN ${referralCommissions.amountIdr} ELSE 0 END), 0)`,
        paid: sql<string>`COALESCE(SUM(CASE WHEN ${referralCommissions.status} = 'paid' THEN ${referralCommissions.amountIdr} ELSE 0 END), 0)`,
      })
      .from(referralCommissions)
      .where(eq(referralCommissions.beneficiaryAgentId, agent.id))

    // Direct referrals (tenants this agent personally signed up via their own
    // code). For a head this excludes their staff's referrals.
    const [refs] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(referralAttributions)
      .where(eq(referralAttributions.staffAgentId, agent.id))

    return {
      totalEarned: row?.totalEarned ?? '0',
      pending: row?.pending ?? '0',
      claimable: row?.claimable ?? '0',
      paid: row?.paid ?? '0',
      referralCount: refs?.count ?? 0,
      role: agent.role,
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

export const listMyCommissions = createServerFn({ method: 'POST' })
  .inputValidator(listFilters)
  .handler(async ({ data }) => {
    const { agent } = await requireMarketingAgent()

    const rows = await db
      .select({
        id: referralCommissions.id,
        amountIdr: referralCommissions.amountIdr,
        status: referralCommissions.status,
        pendingUntil: referralCommissions.pendingUntil,
        createdAt: referralCommissions.createdAt,
        claimRequestId: referralCommissions.claimRequestId,
        refereeTenantName: tenants.businessName,
        // Whether this row is the agent's own-code commission or an override
        // earned on a staff's referral.
        staffAgentId: referralAttributions.staffAgentId,
      })
      .from(referralCommissions)
      .leftJoin(referralAttributions, eq(referralAttributions.id, referralCommissions.attributionId))
      .leftJoin(tenants, eq(tenants.id, referralAttributions.refereeTenantId))
      .where(eq(referralCommissions.beneficiaryAgentId, agent.id))
      .orderBy(desc(referralCommissions.createdAt))
      .limit(data.limit)

    const now = new Date()
    return rows.map((r) => {
      let effectiveStatus:
        | 'pending'
        | 'claimable'
        | 'paid'
        | 'reversed'
        | 'submitted' = r.status as 'pending' | 'claimable' | 'paid' | 'reversed'
      if (effectiveStatus === 'pending' && r.pendingUntil && r.pendingUntil <= now) {
        effectiveStatus = 'claimable'
      }
      if (r.claimRequestId && effectiveStatus === 'claimable') {
        effectiveStatus = 'submitted'
      }
      // kind: 'direct' when the agent is the referrer (own code), 'override'
      // when earned as head on a staff's referral.
      const kind = r.staffAgentId === agent.id ? 'direct' : 'override'
      return { ...r, effectiveStatus, kind }
    })
  })

/**
 * Tenants this agent personally referred (their own code), with payment +
 * commission totals. Powers the agent's "Referral" tab.
 */
export const listMyReferrals = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional().default({ limit: 50 }),
  )
  .handler(async ({ data }) => {
    const { agent } = await requireMarketingAgent()

    const rows = await db.execute<{
      attribution_id: string
      attributed_at: Date
      window_ends_at: Date
      referee_name: string | null
      active_modules: string[] | null
      invoice_count: number
      total_paid: string
      my_commission: string
    }>(sql`
      SELECT
        a.id AS attribution_id,
        a.attributed_at,
        a.window_ends_at,
        t.business_name AS referee_name,
        t.active_modules AS active_modules,
        COALESCE(ft_agg.invoice_count, 0) AS invoice_count,
        COALESCE(ft_agg.total_paid, 0) AS total_paid,
        COALESCE(comm_agg.my_commission, 0) AS my_commission
      FROM ${referralAttributions} a
      JOIN ${tenants} t ON t.id = a.referee_tenant_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS invoice_count, COALESCE(SUM(amount_idr), 0) AS total_paid
        FROM financial_transactions
        WHERE tenant_id = a.referee_tenant_id AND status = 'paid'
      ) ft_agg ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(amount_idr), 0) AS my_commission
        FROM ${referralCommissions}
        WHERE attribution_id = a.id
          AND beneficiary_agent_id = ${agent.id}
          AND status != 'reversed'
      ) comm_agg ON true
      WHERE a.staff_agent_id = ${agent.id}
      ORDER BY a.attributed_at DESC
      LIMIT ${data.limit}
    `)

    return rows.map((r) => ({
      attributionId: r.attribution_id,
      attributedAt: r.attributed_at,
      windowEndsAt: r.window_ends_at,
      refereeName: r.referee_name ?? 'Tenant',
      activeModules: (r.active_modules ?? []).filter((m) => m !== 'hpp'),
      invoiceCount: Number(r.invoice_count),
      totalPaid: r.total_paid,
      myCommission: r.my_commission,
    }))
  })

export const listMyClaimRequests = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional().default({ limit: 20 }))
  .handler(async ({ data }) => {
    const { agent } = await requireMarketingAgent()
    return db
      .select()
      .from(referralClaimRequests)
      .where(
        and(
          eq(referralClaimRequests.ownerType, 'agent'),
          eq(referralClaimRequests.ownerAgentId, agent.id),
        ),
      )
      .orderBy(desc(referralClaimRequests.submittedAt))
      .limit(data.limit)
  })

export const getMyPayoutMethod = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { agent } = await requireMarketingAgent()
    const [row] = await db
      .select()
      .from(tenantPayoutMethods)
      .where(
        and(
          eq(tenantPayoutMethods.ownerType, 'agent'),
          eq(tenantPayoutMethods.ownerAgentId, agent.id),
        ),
      )
      .orderBy(desc(tenantPayoutMethods.updatedAt))
      .limit(1)
    return row ?? null
  },
)

const payoutMethodSchema = z.object({
  bankName: z.string().min(1, 'Nama bank wajib diisi').max(60),
  accountNumber: z.string().regex(/^\d{6,20}$/, 'Nomor rekening 6-20 digit'),
  accountHolderName: z.string().min(1, 'Nama pemilik rekening wajib diisi').max(120),
})

export const upsertPayoutMethod = createServerFn({ method: 'POST' })
  .inputValidator(payoutMethodSchema)
  .handler(async ({ data }) => {
    const { agent } = await requireMarketingAgent()

    const [existing] = await db
      .select({ id: tenantPayoutMethods.id })
      .from(tenantPayoutMethods)
      .where(
        and(
          eq(tenantPayoutMethods.ownerType, 'agent'),
          eq(tenantPayoutMethods.ownerAgentId, agent.id),
        ),
      )
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
        tenantId: agent.tenantId,
        ownerType: 'agent',
        ownerAgentId: agent.id,
        bankName: data.bankName,
        accountNumber: data.accountNumber,
        accountHolderName: data.accountHolderName,
        isDefault: true,
      })
      .returning()
    return row
  })

/**
 * Submit a claim for all currently-claimable commission rows beneficiary'd to
 * this agent. Same transaction shape + locking as the tenant flow.
 */
export const submitClaimRequest = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { agent } = await requireMarketingAgent()

    const [payout] = await db
      .select()
      .from(tenantPayoutMethods)
      .where(
        and(
          eq(tenantPayoutMethods.ownerType, 'agent'),
          eq(tenantPayoutMethods.ownerAgentId, agent.id),
        ),
      )
      .limit(1)
    if (!payout) {
      throw new Error('Info bank belum diisi. Lengkapi tab Info Bank dulu.')
    }

    const [inFlight] = await db
      .select({ id: referralClaimRequests.id })
      .from(referralClaimRequests)
      .where(
        and(
          eq(referralClaimRequests.ownerType, 'agent'),
          eq(referralClaimRequests.ownerAgentId, agent.id),
          eq(referralClaimRequests.status, 'submitted'),
        ),
      )
      .limit(1)
    if (inFlight) {
      throw new Error(
        'Klaim sebelumnya masih diproses admin. Tunggu sampai selesai sebelum mengajukan klaim baru.',
      )
    }

    return db.transaction(async (tx) => {
      const candidates = await tx.execute<{ id: string; amount_idr: string }>(sql`
        SELECT id, amount_idr
        FROM ${referralCommissions}
        WHERE beneficiary_agent_id = ${agent.id}
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
          tenantId: agent.tenantId,
          ownerType: 'agent',
          ownerAgentId: agent.id,
          payoutMethodId: payout.id,
          totalAmountIdr: total.toFixed(2),
          status: 'submitted',
        })
        .returning()

      const ids = candidates.map((c) => c.id)
      await tx
        .update(referralCommissions)
        .set({ claimRequestId: request!.id, status: 'claimable' })
        .where(inArray(referralCommissions.id, ids))

      const adminEmail = process.env['PLATFORM_ADMIN_EMAIL']
      if (adminEmail) {
        const subject = `[Vintra] Klaim komisi marketing baru — ${formatRupiahEmail(total)}`
        const html = `<p>Halo admin,</p><p>Seorang agen marketing mengajukan klaim komisi senilai <strong>${formatRupiahEmail(total)}</strong> (${candidates.length} transaksi).</p><p>Proses di <a href="https://vintra.my.id/admin/referrals/claims">/admin/referrals/claims</a>.</p>`
        const text = `Agen marketing mengajukan klaim komisi ${formatRupiahEmail(total)} (${candidates.length} transaksi). Proses di /admin/referrals/claims`
        void sendEmail({
          to: adminEmail,
          subject,
          htmlContent: html,
          textContent: text,
          tag: 'marketing-claim-submitted',
        })
      }

      return { requestId: request!.id, total: total.toFixed(2), count: candidates.length }
    })
  },
)
