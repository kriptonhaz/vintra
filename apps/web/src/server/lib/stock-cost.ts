/**
 * Cost rules for stock movements.
 *
 * Kept out of `functions/inventory.ts` so the rule is testable on its own —
 * it decides whether a real price gets overwritten, which is worth asserting
 * directly rather than through a server function.
 */

/**
 * The cost this movement is willing to RE-COST an ingredient with, or `null`
 * when it states none.
 *
 * A zero is not a cost. `unitCost` on a movement is optional and validated as
 * `min(0)`, so a stock opname submitted with the cost field left at its
 * default arrives as 0 — indistinguishable from "this really was free".
 * Treating that as a real price overwrites the material's `pricePerUnit` with
 * zero, and the ingredient's cost then silently disappears from every recipe
 * that uses it.
 *
 * This is not hypothetical. The same code on JuraganQu zeroed "Susu Putih"
 * (Rp 9/ml) and "Sirup Jambu" in production; the second was only noticed and
 * repaired by hand two days later.
 *
 * Keeping the previous cost when none is stated is the recoverable direction
 * to be wrong in — zeroing it is not. The movement ledger still records
 * exactly what was entered, zero included; only the re-costing is gated.
 */
export function statedUnitCost(unitCostInBase: number | null): number | null {
  if (unitCostInBase == null) return null
  if (!Number.isFinite(unitCostInBase)) return null
  return unitCostInBase > 0 ? unitCostInBase : null
}
