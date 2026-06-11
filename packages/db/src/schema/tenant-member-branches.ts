import { pgTable, uuid, timestamp, unique, index } from 'drizzle-orm/pg-core'
import { tenantMembers } from './auth'
import { branches } from './attendance'

/**
 * JUR-135: per-member branch scoping. A member assigned 0 rows here
 * is treated as having access to ALL branches (backward-compatible
 * with pre-JUR-135 data). One or more rows narrows access to that set.
 *
 * Owner role bypasses this check entirely — owners always see all
 * branches regardless of junction state.
 *
 * The junction lives in its own file (not in `auth.ts` or
 * `attendance.ts`) to avoid the circular import: `auth.ts` would need
 * `branches`, but `attendance.ts` already imports `tenantMembers` from
 * `auth.ts`.
 */
export const tenantMemberBranches = pgTable(
  'tenant_member_branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantMemberId: uuid('tenant_member_id')
      .references(() => tenantMembers.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    // Each (member, branch) pair can only exist once — toggling a
    // branch off-then-on must INSERT a new row but never violate this.
    uniqueMemberBranch: unique().on(t.tenantMemberId, t.branchId),
    // Hot path: requireAuth() reads this by tenant_member_id on every
    // authenticated request.
    memberIdx: index('tenant_member_branches_member_idx').on(t.tenantMemberId),
    branchIdx: index('tenant_member_branches_branch_idx').on(t.branchId),
  }),
)
