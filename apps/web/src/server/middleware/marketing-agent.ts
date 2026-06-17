import { db } from '@vintra/db'
import { marketingAgents } from '@vintra/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireAuth, type AuthContext } from './auth'

/**
 * Marketing-agent resolver for the internal commission program (see
 * packages/db/src/schema/marketing.ts).
 *
 * An agent is a member of the internal Vintra org enrolled in
 * `marketing_agents`. The structure is scoped per `userId` — each agent
 * owns their own codes, commissions, and withdrawals even though all
 * agents share one internal tenant.
 *
 * `codeBudgetPct` is the cap each agent's OWN referral codes are checked
 * against (discountPct + commissionPct <= codeBudgetPct):
 *   - head  → their admin-assigned `capPct`
 *   - staff → the `staffBudgetPct` their head allocated them
 */
export interface MarketingAgent {
  id: string
  tenantId: string
  role: 'head' | 'staff'
  parentAgentId: string | null
  capPct: number | null
  staffBudgetPct: number | null
  headOverridePct: number | null
}

export interface MarketingAgentContext extends AuthContext {
  agent: MarketingAgent
  /** Cap for the agent's own codes (head → capPct, staff → staffBudgetPct). */
  codeBudgetPct: number
}

function toAgent(row: typeof marketingAgents.$inferSelect): MarketingAgent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    role: row.role as 'head' | 'staff',
    parentAgentId: row.parentAgentId,
    capPct: row.capPct === null ? null : Number(row.capPct),
    staffBudgetPct: row.staffBudgetPct === null ? null : Number(row.staffBudgetPct),
    headOverridePct:
      row.headOverridePct === null ? null : Number(row.headOverridePct),
  }
}

export async function requireMarketingAgent(): Promise<MarketingAgentContext> {
  const auth = await requireAuth()

  const [row] = await db
    .select()
    .from(marketingAgents)
    .where(
      and(
        eq(marketingAgents.userId, auth.userId),
        eq(marketingAgents.isActive, true),
      ),
    )
    .limit(1)

  if (!row) {
    throw new Error(
      'Akun ini belum terdaftar sebagai tim marketing. Hubungi admin.',
    )
  }

  const agent = toAgent(row)
  const codeBudgetPct =
    agent.role === 'head' ? (agent.capPct ?? 0) : (agent.staffBudgetPct ?? 0)

  return { ...auth, agent, codeBudgetPct }
}

export async function requireMarketingHead(): Promise<MarketingAgentContext> {
  const ctx = await requireMarketingAgent()
  if (ctx.agent.role !== 'head') {
    throw new Error('Hanya kepala marketing yang dapat mengakses halaman ini.')
  }
  return ctx
}
