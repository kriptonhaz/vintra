/**
 * POS permission helpers. The permission strings themselves are seeded
 * in `packages/db/src/seed-rbac.ts` and gate role-based access in the
 * shared `usePermissions()` hook. These helpers wrap the raw `has(perm)`
 * calls in domain-readable names so call sites read like business
 * intent rather than RBAC plumbing.
 */

export type POSPermission = 'pos.read' | 'pos.transact' | 'pos.manage'

/** Can the current user open the cashier and ring up a sale. */
export function canRingSale(has: (perm: string) => boolean): boolean {
  return has('pos.transact')
}

/**
 * Can the current user void a same-day sale. Originally collapsed
 * with pos.manage but split (JUR-207) so cashiers — who ring up the
 * sale and are the ones most likely to spot a payment-method mistake
 * mid-shift — can also cancel it. The same-day rule on the server
 * (voidSale rejects past-day voids) is the actual abuse guardrail;
 * past-day refunds still need admin intervention.
 */
export function canVoidSale(has: (perm: string) => boolean): boolean {
  return has('pos.transact')
}

export function canConfigurePOS(has: (perm: string) => boolean): boolean {
  return has('pos.manage')
}

/** Can the current user view sales history (read-only). */
export function canViewSalesHistory(has: (perm: string) => boolean): boolean {
  return has('pos.read')
}
