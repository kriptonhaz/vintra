/**
 * JUR-135 PR 2 — branch-scope helpers.
 *
 * Every POS / Inventory / report server fn that reads or writes a
 * branch-keyed row routes through one of these:
 *
 *   - `assertBranchAllowed(auth, branchId)` — for writes / single-row
 *     reads. Throws when the member's pin set doesn't include
 *     branchId. No-op when allowedBranchIds is null (owner /
 *     impersonation / pre-JUR-135 unrestricted members).
 *
 *   - `filterBranchesByAccess(auth, list)` — for the cashier-masters
 *     style "give me the picker options" reads. Returns the input
 *     unchanged when unrestricted.
 *
 *   - `branchScopeWhere(auth, column)` — Drizzle SQL helper for list
 *     queries (sales, movements, stock). Returns `undefined` when
 *     unrestricted so callers can spread it into an `and(...)`
 *     without adding a tautology.
 *
 * Centralising the rule means every call site has a single semantic:
 * "if I forgot to call assertBranchAllowed, the worst case is a leak
 * — that's a bug; if I call it twice the second is a no-op". Avoids
 * scattered `if (auth.allowedBranchIds === null) ...` checks.
 */

import { inArray, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { AuthContext } from '../middleware/auth'

export function assertBranchAllowed(
  auth: AuthContext,
  branchId: string,
): void {
  if (auth.allowedBranchIds === null) return
  if (!auth.allowedBranchIds.includes(branchId)) {
    throw new Error('Cabang ini tidak termasuk dalam akses Anda.')
  }
}

export function filterBranchesByAccess<T extends { id: string }>(
  auth: AuthContext,
  branches: T[],
): T[] {
  if (auth.allowedBranchIds === null) return branches
  const allowed = new Set(auth.allowedBranchIds)
  return branches.filter((b) => allowed.has(b.id))
}

/**
 * Drizzle clause that scopes a list query to the caller's allowed
 * branches. Returns `undefined` for unrestricted callers so the
 * idiom `and(eq(table.tenantId, ...), branchScopeWhere(auth, table.branchId))`
 * stays clean — drizzle's `and` filters out undefined arguments.
 *
 * For restricted callers with zero branches (shouldn't happen — UI
 * enforces ≥1 — but defensive), returns a contradiction so the
 * query returns no rows rather than silently leaking everything.
 */
export function branchScopeWhere(
  auth: AuthContext,
  branchColumn: PgColumn,
): SQL | undefined {
  if (auth.allowedBranchIds === null) return undefined
  if (auth.allowedBranchIds.length === 0) {
    // Defensive: an empty allowed list should never reach here, but
    // if it does we must NOT return undefined (would unfilter the
    // query). Use IN (NULL) which matches nothing.
    return inArray(branchColumn, [
      '00000000-0000-0000-0000-000000000000',
    ])
  }
  return inArray(branchColumn, auth.allowedBranchIds)
}
