import {
  pgTable,
  uuid,
  text,
  boolean,
  numeric,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { tenants } from './auth'

/**
 * Internal marketing commission program.
 *
 * Unlike the tenant-to-tenant referral system (see `./referrals`), the
 * referrer here is one of Vintra's own people — a member of an internal
 * tenant (`tenants.is_internal = true`). Agents form a two-level tree:
 *
 *   head  ── manages ──▶  staff (parent_agent_id points at the head)
 *
 * Multiple heads are supported, each with their own group of staff. The
 * marketing structure is scoped per `userId` (each agent gets their own
 * codes, commissions, and withdrawals), even though every agent belongs to
 * the same internal tenant.
 *
 * Cap-allocation tree (percentages of each paid payment by a referred tenant):
 *
 *   global cap (referral_global_config.cap_pct)        e.g. 20%
 *     └─ head.cap_pct (admin sets, ≤ global)           e.g. 20%
 *          └─ per staff (head allocates):
 *               ├─ staff.head_override_pct             e.g. 5%  → head earns
 *               └─ staff.staff_budget_pct              e.g. 15% → staff's budget
 *                    └─ staff's code: discount_pct + commission_pct ≤ budget
 *
 * Invariant per payment: discount + staffCommission + headOverride ≤ cap.
 * Vintra funds all three slices separately — the head's override is NOT
 * deducted from the staff's commission.
 */
export const marketingAgents = pgTable('marketing_agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  // The internal tenant this agent belongs to (tenants.is_internal = true).
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  // Supabase auth user id. One agent enrollment per user.
  userId: uuid('user_id').notNull().unique(),
  // 'head' | 'staff'
  role: text('role').notNull(),
  // Staff → their head's agent id. Head → null.
  parentAgentId: uuid('parent_agent_id').references(
    (): AnyPgColumn => marketingAgents.id,
  ),
  // HEAD ONLY: ceiling assigned by the platform admin. The head allocates
  // head_override_pct + staff_budget_pct within this for each staff.
  // Must be ≤ referral_global_config.cap_pct. Null for staff.
  capPct: numeric('cap_pct', { precision: 5, scale: 2 }),
  // STAFF ONLY: set by their head. The staff's own code's
  // discount_pct + commission_pct must be ≤ staff_budget_pct. Null for head.
  staffBudgetPct: numeric('staff_budget_pct', { precision: 5, scale: 2 }),
  // STAFF ONLY: the head's override slice earned on this staff's sales.
  // head_override_pct + staff_budget_pct must be ≤ head.cap_pct. Null for head.
  headOverridePct: numeric('head_override_pct', { precision: 5, scale: 2 }),
  // Soft-disable an agent without deleting history. When false, their codes
  // are frozen (no new attributions) but existing commissions stand.
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
