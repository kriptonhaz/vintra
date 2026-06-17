import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  marketingAgents,
  referralAttributions,
  referralCommissions,
  tenantMembers,
} from '@vintra/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { requireMarketingHead } from '@/server/middleware/marketing-agent'

const PCT_REGEX = /^\d+(\.\d{1,2})?$/
const pctSchema = z.string().regex(PCT_REGEX, 'Persentase tidak valid (maks 2 desimal)')

/**
 * Validate a head's per-staff allocation against the head's cap:
 *   headOverridePct + staffBudgetPct <= head.capPct
 */
function assertAllocationWithinCap(
  headOverridePct: string,
  staffBudgetPct: string,
  capPct: number,
) {
  const sum = parseFloat(headOverridePct) + parseFloat(staffBudgetPct)
  if (sum > capPct + 1e-9) {
    throw new Error(
      `Total komisi kepala + budget staf (${sum.toFixed(2)}%) melebihi cap kepala ${capPct}%`,
    )
  }
}

// ── Roster ──────────────────────────────────────────────────────────

export const listMyStaff = createServerFn({ method: 'GET' }).handler(async () => {
  const { agent } = await requireMarketingHead()

  const rows = await db.execute<{
    id: string
    user_id: string
    staff_budget_pct: string | null
    head_override_pct: string | null
    is_active: boolean
    first_name: string | null
    last_name: string | null
    job_title: string | null
    referral_count: number
    staff_commission: string
    head_override_commission: string
  }>(sql`
    SELECT
      a.id, a.user_id, a.staff_budget_pct, a.head_override_pct, a.is_active,
      m.first_name, m.last_name, m.job_title,
      COALESCE(att_agg.referral_count, 0) AS referral_count,
      COALESCE(staff_agg.total, 0) AS staff_commission,
      COALESCE(head_agg.total, 0) AS head_override_commission
    FROM ${marketingAgents} a
    LEFT JOIN ${tenantMembers} m
      ON m.user_id = a.user_id AND m.tenant_id = a.tenant_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS referral_count
      FROM ${referralAttributions} ra
      WHERE ra.staff_agent_id = a.id
    ) att_agg ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(amount_idr), 0) AS total
      FROM ${referralCommissions} rc
      WHERE rc.beneficiary_agent_id = a.id AND rc.status != 'reversed'
    ) staff_agg ON true
    LEFT JOIN LATERAL (
      -- Override the head earned specifically on THIS staff's referrals.
      SELECT COALESCE(SUM(rc.amount_idr), 0) AS total
      FROM ${referralCommissions} rc
      JOIN ${referralAttributions} ra ON ra.id = rc.attribution_id
      WHERE ra.staff_agent_id = a.id
        AND rc.beneficiary_agent_id = ${agent.id}
        AND rc.status != 'reversed'
    ) head_agg ON true
    WHERE a.parent_agent_id = ${agent.id}
    ORDER BY a.created_at
  `)

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    staffBudgetPct: r.staff_budget_pct,
    headOverridePct: r.head_override_pct,
    isActive: r.is_active,
    name:
      [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'Tanpa nama',
    jobTitle: r.job_title,
    referralCount: Number(r.referral_count),
    staffCommission: r.staff_commission,
    headOverrideCommission: r.head_override_commission,
  }))
})

/**
 * Members of the head's internal tenant not yet enrolled as agents — the
 * candidate pool for adding staff.
 */
export const listStaffCandidates = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { agent } = await requireMarketingHead()
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
          eq(tenantMembers.tenantId, agent.tenantId),
          sql`NOT EXISTS (
            SELECT 1 FROM ${marketingAgents}
            WHERE ${marketingAgents.userId} = ${tenantMembers.userId}
          )`,
        ),
      )
      .orderBy(tenantMembers.firstName)
  },
)

// ── Mutations ───────────────────────────────────────────────────────

const addStaffSchema = z.object({
  userId: z.string().uuid(),
  staffBudgetPct: pctSchema,
  headOverridePct: pctSchema,
})

export const addStaff = createServerFn({ method: 'POST' })
  .inputValidator(addStaffSchema)
  .handler(async ({ data }) => {
    const { agent } = await requireMarketingHead()
    const cap = agent.capPct ?? 0
    assertAllocationWithinCap(data.headOverridePct, data.staffBudgetPct, cap)

    // Candidate must be a member of the head's internal tenant.
    const [member] = await db
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, agent.tenantId),
          eq(tenantMembers.userId, data.userId),
        ),
      )
      .limit(1)
    if (!member) throw new Error('User bukan anggota tim internal Anda.')

    try {
      const [row] = await db
        .insert(marketingAgents)
        .values({
          tenantId: agent.tenantId,
          userId: data.userId,
          role: 'staff',
          parentAgentId: agent.id,
          staffBudgetPct: data.staffBudgetPct,
          headOverridePct: data.headOverridePct,
        })
        .returning()
      return row
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new Error('User sudah terdaftar sebagai agen marketing.')
      }
      throw err
    }
  })

const updateAllocationSchema = z.object({
  staffAgentId: z.string().uuid(),
  staffBudgetPct: pctSchema,
  headOverridePct: pctSchema,
})

export const updateStaffAllocation = createServerFn({ method: 'POST' })
  .inputValidator(updateAllocationSchema)
  .handler(async ({ data }) => {
    const { agent } = await requireMarketingHead()
    const cap = agent.capPct ?? 0
    assertAllocationWithinCap(data.headOverridePct, data.staffBudgetPct, cap)

    // Re-allocation only changes FUTURE earnings — attributions snapshot the
    // rates at signup, so historical commissions are untouched.
    const [row] = await db
      .update(marketingAgents)
      .set({
        staffBudgetPct: data.staffBudgetPct,
        headOverridePct: data.headOverridePct,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(marketingAgents.id, data.staffAgentId),
          eq(marketingAgents.parentAgentId, agent.id),
        ),
      )
      .returning()
    if (!row) throw new Error('Staf tidak ditemukan di tim Anda.')
    return row
  })

export const setStaffActive = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ staffAgentId: z.string().uuid(), isActive: z.boolean() }))
  .handler(async ({ data }) => {
    const { agent } = await requireMarketingHead()
    const [row] = await db
      .update(marketingAgents)
      .set({ isActive: data.isActive, updatedAt: new Date() })
      .where(
        and(
          eq(marketingAgents.id, data.staffAgentId),
          eq(marketingAgents.parentAgentId, agent.id),
        ),
      )
      .returning()
    if (!row) throw new Error('Staf tidak ditemukan di tim Anda.')
    return row
  })

/**
 * Team-wide rollup for the head's dashboard: number of staff, total team
 * referrals, total commission earned by all staff, and the head's own
 * override earnings from the team.
 */
export const getTeamSummary = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { agent } = await requireMarketingHead()

    const [staffStats] = await db
      .select({
        staffCount: sql<number>`count(*)::int`,
        activeStaffCount: sql<number>`count(*) FILTER (WHERE ${marketingAgents.isActive})::int`,
      })
      .from(marketingAgents)
      .where(eq(marketingAgents.parentAgentId, agent.id))

    // Total commission earned by all staff under this head.
    const [staffCommission] = await db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(rc.amount_idr), 0) AS total
      FROM ${referralCommissions} rc
      JOIN ${marketingAgents} sa ON sa.id = rc.beneficiary_agent_id
      WHERE sa.parent_agent_id = ${agent.id}
        AND rc.status != 'reversed'
    `)

    // Head's override earnings ONLY — rows where the head is the beneficiary
    // via the override path (attribution.head_agent_id = head). Excludes the
    // head's own-code direct commissions (those have staff_agent_id = head).
    const [headOverride] = await db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(rc.amount_idr), 0) AS total
      FROM ${referralCommissions} rc
      JOIN ${referralAttributions} ra ON ra.id = rc.attribution_id
      WHERE rc.beneficiary_agent_id = ${agent.id}
        AND ra.head_agent_id = ${agent.id}
        AND rc.status != 'reversed'
    `)

    // Total tenants referred across the whole team (staff referrals).
    const [teamReferrals] = await db.execute<{ cnt: number }>(sql`
      SELECT COUNT(*) AS cnt
      FROM ${referralAttributions} ra
      JOIN ${marketingAgents} sa ON sa.id = ra.staff_agent_id
      WHERE sa.parent_agent_id = ${agent.id}
    `)

    return {
      staffCount: staffStats?.staffCount ?? 0,
      activeStaffCount: staffStats?.activeStaffCount ?? 0,
      teamReferralCount: Number(teamReferrals?.cnt ?? 0),
      teamStaffCommission: staffCommission?.total ?? '0',
      headOverrideTotal: headOverride?.total ?? '0',
    }
  },
)
