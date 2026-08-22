import { describe, expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { branchScopeSql } from './branch-scope'

const dialect = new PgDialect()
const render = (frag: ReturnType<typeof branchScopeSql>) =>
  dialect.sqlToQuery(frag)

describe('branchScopeSql', () => {
  it('binds one parameter PER branch id, not one for the whole list', () => {
    // The bug this replaces bound the array as a single parameter, so
    // Postgres got a bare uuid where an array literal belonged and threw
    // `malformed array literal`. Parameter COUNT is what tells the two
    // apart, so that is what this asserts.
    const q = render(
      branchScopeSql(
        { allowedBranchIds: ['11111111-1111-1111-1111-111111111111'] },
        sql`b.branch_id`,
      ),
    )
    expect(q.params).toHaveLength(1)
    expect(q.sql).toContain('b.branch_id IN (')
    expect(q.sql.toLowerCase()).not.toContain('any(')
  })

  it('binds every id when the member is pinned to several branches', () => {
    const q = render(
      branchScopeSql(
        {
          allowedBranchIds: [
            '11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222',
            '33333333-3333-3333-3333-333333333333',
          ],
        },
        sql`s.branch_id`,
      ),
    )
    expect(q.params).toHaveLength(3)
  })

  it('casts each id to uuid so the comparison type-checks in Postgres', () => {
    const q = render(
      branchScopeSql(
        { allowedBranchIds: ['11111111-1111-1111-1111-111111111111'] },
        sql`b.branch_id`,
      ),
    )
    expect(q.sql).toContain('::uuid')
  })

  it('is a no-op predicate for an unrestricted member', () => {
    // Owners have null here. They must not be filtered — and the result
    // still has to be droppable into `AND ${...}` without a null check.
    const q = render(branchScopeSql({ allowedBranchIds: null }, sql`b.branch_id`))
    expect(q.sql.trim()).toBe('true')
    expect(q.params).toHaveLength(0)
  })

  it('matches nothing — never everything — on an empty allowed list', () => {
    // Shouldn't happen (0 pins means "all branches", encoded as null),
    // but if it ever did, the safe failure is an empty result, not a
    // silent leak of every branch.
    const q = render(branchScopeSql({ allowedBranchIds: [] }, sql`b.branch_id`))
    expect(q.sql.trim()).not.toBe('true')
    expect(q.params).toHaveLength(1)
    expect(q.params[0]).toBe('00000000-0000-0000-0000-000000000000')
  })

  it('uses whichever column alias the caller passes', () => {
    // Raw-SQL call sites scope `b.`, `s.` and `s2.` aliases; a helper
    // that hardcoded one would silently filter the wrong table.
    const q = render(
      branchScopeSql(
        { allowedBranchIds: ['11111111-1111-1111-1111-111111111111'] },
        sql`s2.branch_id`,
      ),
    )
    expect(q.sql).toContain('s2.branch_id IN (')
  })
})
