import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { referralCodes, referralAttributions } from '@vintra/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { requireMarketingAgent } from '@/server/middleware/marketing-agent'

// Agent-owned referral codes for the internal marketing program. Mirrors
// the tenant code CRUD in `referrals.ts`, but ownership is per-agent
// (owner_type='agent', owner_agent_id) and the cap is the agent's code
// budget (head → capPct, staff → staffBudgetPct).

const CODE_REGEX = /^[A-Z0-9_-]{4,20}$/
const PCT_REGEX = /^\d+(\.\d{1,2})?$/

const codeSchema = z
  .string()
  .regex(CODE_REGEX, 'Format kode tidak valid (huruf besar/angka, 4-20 karakter)')
const pctSchema = z.string().regex(PCT_REGEX, 'Persentase tidak valid (maks 2 desimal)')
const labelSchema = z.string().max(100).optional().or(z.literal(''))
const maxClaimsSchema = z.number().int().min(1).max(1_000_000).nullable().optional()

function assertSumWithinBudget(
  discountPct: string,
  commissionPct: string,
  budget: number,
) {
  const sum = parseFloat(discountPct) + parseFloat(commissionPct)
  if (sum > budget + 1e-9) {
    throw new Error(
      `Total diskon + komisi (${sum.toFixed(2)}%) melebihi budget ${budget}%`,
    )
  }
}

export const getMyCodeBudget = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { agent, codeBudgetPct } = await requireMarketingAgent()
    return { budgetPct: codeBudgetPct, role: agent.role }
  },
)

export const listMyCodes = createServerFn({ method: 'GET' }).handler(async () => {
  const { agent } = await requireMarketingAgent()

  return db
    .select({
      id: referralCodes.id,
      code: referralCodes.code,
      label: referralCodes.label,
      discountPct: referralCodes.discountPct,
      commissionPct: referralCodes.commissionPct,
      maxClaims: referralCodes.maxClaims,
      isActive: referralCodes.isActive,
      createdAt: referralCodes.createdAt,
      attributionCount: sql<number>`count(${referralAttributions.id})::int`,
    })
    .from(referralCodes)
    .leftJoin(referralAttributions, eq(referralAttributions.codeId, referralCodes.id))
    .where(eq(referralCodes.ownerAgentId, agent.id))
    .groupBy(referralCodes.id)
    .orderBy(sql`${referralCodes.createdAt} desc`)
})

const createSchema = z.object({
  code: codeSchema,
  label: labelSchema,
  discountPct: pctSchema,
  commissionPct: pctSchema,
  maxClaims: maxClaimsSchema,
})

export const createMyCode = createServerFn({ method: 'POST' })
  .inputValidator(createSchema)
  .handler(async ({ data }) => {
    const { agent, codeBudgetPct } = await requireMarketingAgent()
    assertSumWithinBudget(data.discountPct, data.commissionPct, codeBudgetPct)

    try {
      const [row] = await db
        .insert(referralCodes)
        .values({
          // For agent codes, tenantId is the internal tenant; the real owner
          // is owner_agent_id.
          tenantId: agent.tenantId,
          ownerType: 'agent',
          ownerAgentId: agent.id,
          code: data.code,
          label: data.label || null,
          discountPct: data.discountPct,
          commissionPct: data.commissionPct,
          maxClaims: data.maxClaims ?? null,
        })
        .returning()
      return row
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new Error('Kode referral sudah dipakai')
      }
      throw err
    }
  })

const updateSchema = z.object({
  id: z.string().uuid(),
  label: labelSchema,
  discountPct: pctSchema,
  commissionPct: pctSchema,
  maxClaims: maxClaimsSchema,
})

export const updateMyCode = createServerFn({ method: 'POST' })
  .inputValidator(updateSchema)
  .handler(async ({ data }) => {
    const { agent, codeBudgetPct } = await requireMarketingAgent()
    assertSumWithinBudget(data.discountPct, data.commissionPct, codeBudgetPct)

    const [row] = await db
      .update(referralCodes)
      .set({
        label: data.label || null,
        discountPct: data.discountPct,
        commissionPct: data.commissionPct,
        maxClaims: data.maxClaims ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(referralCodes.id, data.id), eq(referralCodes.ownerAgentId, agent.id)))
      .returning()
    if (!row) throw new Error('Kode referral tidak ditemukan')
    return row
  })

export const toggleMyCode = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid(), isActive: z.boolean() }))
  .handler(async ({ data }) => {
    const { agent } = await requireMarketingAgent()
    const [row] = await db
      .update(referralCodes)
      .set({ isActive: data.isActive, updatedAt: new Date() })
      .where(and(eq(referralCodes.id, data.id), eq(referralCodes.ownerAgentId, agent.id)))
      .returning()
    if (!row) throw new Error('Kode referral tidak ditemukan')
    return row
  })
