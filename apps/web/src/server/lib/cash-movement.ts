/**
 * JUR-141 Peti Kas — server-only helpers shared between pos.ts and
 * pos-cash.ts. Lives in /lib/ (not /functions/) so the TanStack Start
 * macro never lets these get bundled into the client.
 *
 * Background: pos-cash.ts exposes `createServerFn` exports that are
 * imported by /pos/cashier route. The macro strips .handler() bodies
 * from the client bundle, but NON-createServerFn exports (regular
 * functions, constants) stay in the bundle if they're exported. When
 * those touch `db` → `postgres` → Node Buffer → boom in the browser.
 *
 * Moving these helpers here means routes never transitively pull `db`.
 */

import { db } from '@vintra/db'
import { posCashMovements, posCashSessions } from '@vintra/db/schema'
import { and, eq, sql } from 'drizzle-orm'

export const CASH_DRAWER_OPEN_FIRST = 'Buka Kas dulu sebelum jualan tunai.' as const

/**
 * Atomic ledger insert helper — shared by both manual
 * (recordCashDrop / recordPayout) and auto (createSale / voidSale)
 * paths so the rolling totals always stay consistent.
 *
 * Direction:
 *   type = 'sale'   → bumps cash_in_total
 *   type = 'drop'   → bumps cash_in_total  (Setor Tunai = cash put INTO the drawer)
 *   type = 'refund' → bumps cash_out_total
 *   type = 'payout' → bumps cash_out_total
 *
 * `amount` MUST be positive (validated by callers / DB CHECK).
 *
 * Returns the inserted movement's id — the payout path uses it as the
 * `source_ref` of the linked cashflow entry (JUR-201). Callers that
 * don't need it (sale / refund / drop) can ignore the return.
 */
export async function insertCashMovement(
  tx: typeof db,
  args: {
    tenantId: string
    sessionId: string
    type: 'sale' | 'refund' | 'drop' | 'payout'
    amount: number
    reason?: string | null
    referenceSaleId?: string | null
    createdByUserId: string
  },
): Promise<{ id: string }> {
  const [movement] = await tx
    .insert(posCashMovements)
    .values({
      tenantId: args.tenantId,
      sessionId: args.sessionId,
      type: args.type,
      amount: args.amount.toString(),
      reason: args.reason ?? null,
      referenceSaleId: args.referenceSaleId ?? null,
      createdByUserId: args.createdByUserId,
    })
    .returning({ id: posCashMovements.id })

  // Drizzle's `.set({ [key]: ... })` requires the schema property
  // name, not the SQL column name — using 'cash_in_total' silently
  // dropped the increment. We pass the SQL-typed column ref via the
  // schema model so the UPDATE actually targets the right column.
  const amt = Number(args.amount)
  const isInflow = args.type === 'sale' || args.type === 'drop'
  if (isInflow) {
    await tx
      .update(posCashSessions)
      .set({
        cashInTotal: sql`${posCashSessions.cashInTotal} + ${amt}`,
        updatedAt: new Date(),
      })
      .where(eq(posCashSessions.id, args.sessionId))
  } else {
    await tx
      .update(posCashSessions)
      .set({
        cashOutTotal: sql`${posCashSessions.cashOutTotal} + ${amt}`,
        updatedAt: new Date(),
      })
      .where(eq(posCashSessions.id, args.sessionId))
  }

  return { id: movement!.id }
}

/**
 * Look up the current open session for (branch, cashier) — caller
 * must hold the cashier's auth context. Returns null when none.
 * Used by createSale to decide if a cash sale needs to fail-fast.
 */
export async function findOpenSession(
  tenantId: string,
  branchId: string,
  cashierUserId: string,
): Promise<{ id: string; openedAt: Date } | null> {
  const [row] = await db
    .select({ id: posCashSessions.id, openedAt: posCashSessions.openedAt })
    .from(posCashSessions)
    .where(
      and(
        eq(posCashSessions.tenantId, tenantId),
        eq(posCashSessions.branchId, branchId),
        eq(posCashSessions.cashierUserId, cashierUserId),
        eq(posCashSessions.status, 'open'),
      ),
    )
    .limit(1)
  return row ?? null
}
