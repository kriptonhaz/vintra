/**
 * Should a sale be refused because this line's price moved after it was rung
 * up?
 *
 * Extracted from `createSale` so the rule can be asserted directly. A false
 * positive here blocks a cashier from completing any sale, which is far worse
 * than the mismatch the guard exists to prevent — so the conditions are
 * deliberately narrow.
 *
 * We refuse ONLY when all three hold:
 *
 *   1. The client told us which tier it quoted (`quotedTierMinQty`).
 *   2. The server resolved that SAME tier.
 *   3. Its price differs from what the client displayed.
 *
 * Condition 2 is the important one. A different tier does not mean the price
 * list changed — it usually means the client picked a different tier than the
 * server. The mobile cart does exactly that: it stores no tiers, so a line's
 * `unitPrice` stays frozen at the tier that applied when it was created, and a
 * quantity later crossing a bulk threshold leaves the client quoting the
 * retail price while the server resolves the bulk one. Refusing there would
 * block every mobile bulk sale.
 *
 * Condition 1 keeps that client's behaviour exactly as it was: a client that
 * does not name its tier is not subject to the guard at all, and the server
 * silently resolves the price as it always did.
 */
export interface QuotedLine {
  /** What the cart displayed when the item was rung up. */
  unitPrice: number
  /** `minQty` of the tier that price came from, when the client knows it. */
  quotedTierMinQty?: number | null
}

export interface ResolvedTier {
  minQty: number
  unitPrice: number
}

/** Prices are rupiah; anything under a cent is float noise, not a change. */
const PRICE_EPSILON = 0.01

export function isPriceChanged(line: QuotedLine, tier: ResolvedTier): boolean {
  if (line.quotedTierMinQty == null) return false
  if (line.quotedTierMinQty !== tier.minQty) return false
  return Math.abs(line.unitPrice - tier.unitPrice) >= PRICE_EPSILON
}
