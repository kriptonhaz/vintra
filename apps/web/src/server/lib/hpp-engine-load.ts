/**
 * Database loader for the HPP engine.
 *
 * Kept separate from `hpp-engine.ts` so the computation stays a pure module
 * with no database import — its tests then need no driver, and nothing about
 * the formula can quietly come to depend on a query.
 *
 * This is the root-client convenience wrapper. Anything running inside a
 * transaction must call `computeTenantHppWith(tenantId, tx)` directly, so it
 * reads the prices its own transaction just wrote rather than the ones
 * committed before it.
 */
import { db } from '@vintra/db'
import { computeTenantHppWith } from './hpp-cascade'
import type { HppComputeResult } from './hpp-engine'

export async function computeTenantHpp(
  tenantId: string,
): Promise<HppComputeResult> {
  return computeTenantHppWith(tenantId, db)
}
