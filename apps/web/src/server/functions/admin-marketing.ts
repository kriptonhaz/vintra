import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  marketingAgents,
  referralGlobalConfig,
  referralCodes,
  referralAttributions,
  referralCommissions,
  tenants,
  tenantMembers,
  platformAdminAuditLogs,
} from '@vintra/db/schema'
import { and, eq, sql, ilike } from 'drizzle-orm'
import { requirePlatformAdmin } from '@/server/middleware/platform-admin'

const PCT_REGEX = /^\d+(\.\d{1,2})?$/
const pctSchema = z.string().regex(PCT_REGEX, 'Persentase tidak valid (maks 2 desimal)')

// ── Global marketing config ─────────────────────────────────────────

export const getMarketingConfig = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requirePlatformAdmin()
    const [row] = await db.select().from(referralGlobalConfig).limit(1)
    return row ?? null
  },
)

const updateConfigSchema = z.object({ marketingCapPct: pctSchema })

export const updateMarketingConfig = createServerFn({ method: 'POST' })
  .inputValidator(updateConfigSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()
    const [before] = await db.select().from(referralGlobalConfig).limit(1)
    if (!before) throw new Error('referral_global_config row missing')

    await db
      .update(referralGlobalConfig)
      .set({
        marketingCapPct: data.marketingCapPct,
        updatedAt: new Date(),
        updatedBy: auth.userId,
      })
      .where(eq(referralGlobalConfig.id, before.id))

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'marketing_config_update',
      metadata: {
        before: { marketingCapPct: before.marketingCapPct },
        after: { marketingCapPct: data.marketingCapPct },
      },
    })
  })

// ── Internal tenant designation ─────────────────────────────────────

export const listInternalTenants = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requirePlatformAdmin()
    return db
      .select({
        id: tenants.id,
        businessName: tenants.businessName,
        slug: tenants.slug,
      })
      .from(tenants)
      .where(eq(tenants.isInternal, true))
      .orderBy(tenants.businessName)
  },
)

/**
 * Search tenants by business name so an admin can pick which one to mark
 * as the internal Vintra org. Returns the current internal flag so the UI
 * can render a toggle.
 */
export const searchTenantsForInternal = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ query: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    return db
      .select({
        id: tenants.id,
        businessName: tenants.businessName,
        slug: tenants.slug,
        isInternal: tenants.isInternal,
      })
      .from(tenants)
      .where(ilike(tenants.businessName, `%${data.query.trim()}%`))
      .orderBy(tenants.businessName)
      .limit(20)
  })

export const setTenantInternal = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid(), isInternal: z.boolean() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [row] = await db
      .update(tenants)
      .set({ isInternal: data.isInternal, updatedAt: new Date() })
      .where(eq(tenants.id, data.tenantId))
      .returning({ id: tenants.id, businessName: tenants.businessName })
    if (!row) throw new Error('Tenant tidak ditemukan')

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'marketing_tenant_internal_set',
      targetTenantId: data.tenantId,
      metadata: { isInternal: data.isInternal },
    })
    return row
  })

/**
 * Members of an internal tenant who are NOT yet enrolled as marketing
 * agents — the candidate pool for promoting a head. Used by the enroll-head
 * picker.
 */
export const listEnrollableHeadCandidates = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [tenant] = await db
      .select({ isInternal: tenants.isInternal })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant?.isInternal) {
      throw new Error('Tenant ini bukan organisasi internal.')
    }

    return db
      .select({
        userId: tenantMembers.userId,
        firstName: tenantMembers.firstName,
        lastName: tenantMembers.lastName,
        jobTitle: tenantMembers.jobTitle,
      })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, data.tenantId),
          // Exclude users already enrolled as an agent (any tenant).
          sql`NOT EXISTS (
            SELECT 1 FROM ${marketingAgents}
            WHERE ${marketingAgents.userId} = ${tenantMembers.userId}
          )`,
        ),
      )
      .orderBy(tenantMembers.firstName)
  })

// ── Head enrollment + management ────────────────────────────────────

const enrollHeadSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  capPct: pctSchema.optional(),
})

export const enrollHead = createServerFn({ method: 'POST' })
  .inputValidator(enrollHeadSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select({ isInternal: tenants.isInternal })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant?.isInternal) {
      throw new Error('Tenant ini bukan organisasi internal.')
    }

    // The candidate must be a member of the internal tenant (so they have a
    // login scoped to it).
    const [member] = await db
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, data.tenantId),
          eq(tenantMembers.userId, data.userId),
        ),
      )
      .limit(1)
    if (!member) {
      throw new Error('User bukan anggota tenant internal ini.')
    }

    const [cfg] = await db.select().from(referralGlobalConfig).limit(1)
    const globalCap = Number(cfg?.marketingCapPct ?? 10)
    const capPct = data.capPct ? Number(data.capPct) : globalCap
    if (capPct > globalCap + 1e-9) {
      throw new Error(`Cap kepala (${capPct}%) melebihi cap global ${globalCap}%`)
    }

    try {
      const [row] = await db
        .insert(marketingAgents)
        .values({
          tenantId: data.tenantId,
          userId: data.userId,
          role: 'head',
          parentAgentId: null,
          capPct: capPct.toFixed(2),
        })
        .returning()

      await db.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'marketing_head_enroll',
        targetTenantId: data.tenantId,
        targetUserId: data.userId,
        metadata: { capPct: capPct.toFixed(2) },
      })
      return row
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new Error('User sudah terdaftar sebagai agen marketing.')
      }
      throw err
    }
  })

const updateHeadCapSchema = z.object({
  agentId: z.string().uuid(),
  capPct: pctSchema,
})

export const updateHeadCap = createServerFn({ method: 'POST' })
  .inputValidator(updateHeadCapSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [cfg] = await db.select().from(referralGlobalConfig).limit(1)
    const globalCap = Number(cfg?.marketingCapPct ?? 10)
    const capPct = Number(data.capPct)
    if (capPct > globalCap + 1e-9) {
      throw new Error(`Cap kepala (${capPct}%) melebihi cap global ${globalCap}%`)
    }

    const [row] = await db
      .update(marketingAgents)
      .set({ capPct: capPct.toFixed(2), updatedAt: new Date() })
      .where(and(eq(marketingAgents.id, data.agentId), eq(marketingAgents.role, 'head')))
      .returning()
    if (!row) throw new Error('Kepala marketing tidak ditemukan')

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'marketing_head_cap_update',
      targetTenantId: row.tenantId,
      targetUserId: row.userId,
      metadata: { capPct: capPct.toFixed(2) },
    })
    return row
  })

export const setAgentActive = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ agentId: z.string().uuid(), isActive: z.boolean() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(marketingAgents)
        .set({ isActive: data.isActive, updatedAt: new Date() })
        .where(eq(marketingAgents.id, data.agentId))
        .returning()
      if (!row) throw new Error('Agen tidak ditemukan')

      // Freezing an agent freezes their codes (no new attributions). Existing
      // commissions stand — only future signups are affected.
      if (!data.isActive) {
        await tx
          .update(referralCodes)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(referralCodes.ownerAgentId, data.agentId))
      }

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'marketing_agent_active_set',
        targetTenantId: row.tenantId,
        targetUserId: row.userId,
        metadata: { isActive: data.isActive },
      })
      return row
    })
  })

/**
 * Program-wide roster: every agent with their role, head, the member's
 * name, and lifetime stats (referrals + commission). Powers the admin
 * marketing dashboard.
 */
export const listAgents = createServerFn({ method: 'GET' }).handler(async () => {
  await requirePlatformAdmin()

  const rows = await db.execute<{
    id: string
    tenant_id: string
    user_id: string
    role: string
    parent_agent_id: string | null
    cap_pct: string | null
    staff_budget_pct: string | null
    head_override_pct: string | null
    is_active: boolean
    first_name: string | null
    last_name: string | null
    parent_first_name: string | null
    parent_last_name: string | null
    referral_count: number
    total_commission: string
  }>(sql`
    SELECT
      a.id, a.tenant_id, a.user_id, a.role, a.parent_agent_id,
      a.cap_pct, a.staff_budget_pct, a.head_override_pct, a.is_active,
      m.first_name, m.last_name,
      pm.first_name AS parent_first_name, pm.last_name AS parent_last_name,
      COALESCE(att_agg.referral_count, 0) AS referral_count,
      COALESCE(comm_agg.total_commission, 0) AS total_commission
    FROM ${marketingAgents} a
    LEFT JOIN ${tenantMembers} m
      ON m.user_id = a.user_id AND m.tenant_id = a.tenant_id
    LEFT JOIN ${marketingAgents} pa ON pa.id = a.parent_agent_id
    LEFT JOIN ${tenantMembers} pm
      ON pm.user_id = pa.user_id AND pm.tenant_id = pa.tenant_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS referral_count
      FROM ${referralAttributions} ra
      WHERE ra.staff_agent_id = a.id OR ra.head_agent_id = a.id
    ) att_agg ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(amount_idr), 0) AS total_commission
      FROM ${referralCommissions} rc
      WHERE rc.beneficiary_agent_id = a.id AND rc.status != 'reversed'
    ) comm_agg ON true
    ORDER BY a.role DESC, a.created_at
  `)

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    role: r.role as 'head' | 'staff',
    parentAgentId: r.parent_agent_id,
    capPct: r.cap_pct,
    staffBudgetPct: r.staff_budget_pct,
    headOverridePct: r.head_override_pct,
    isActive: r.is_active,
    name:
      [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'Tanpa nama',
    parentName:
      [r.parent_first_name, r.parent_last_name].filter(Boolean).join(' ').trim() ||
      null,
    referralCount: Number(r.referral_count),
    totalCommission: r.total_commission,
  }))
})
