export interface MaterialCost {
  materialId: string
  materialName: string
  pricePerUnit: number
  quantity: number
  unit: string
  totalCost: number
}

export interface HppResult {
  productId: string
  productName: string
  materialCosts: MaterialCost[]
  totalMaterialCost: number
  hpp: number
  sellingPrice: number
  margin: number
  markup: number
}

export function calculateMaterialCost(pricePerUnit: number, quantity: number): number {
  return pricePerUnit * quantity
}

/**
 * Per-unit cost basis. The stored `hpp` is the cost to produce one
 * batch (productionQty units); margin/profit must always be computed
 * against the per-unit cost because the selling price is per unit.
 * Falls back to the batch cost when productionQty is missing/invalid.
 */
export function perUnitHpp(batchHpp: number, productionQty: number): number {
  const qty = productionQty > 0 ? productionQty : 1
  return batchHpp / qty
}

/** One row of a recipe: either a raw material, or a nested sub-product. */
export type BomRowPricing =
  | { kind: 'material'; pricePerUnit: number | string | null }
  | {
      kind: 'sub-product'
      /** The sub-product's stored HPP — the cost of one FULL batch. */
      sourceHpp: number | string | null
      /** How many units one batch of the sub-product yields. */
      sourceProductionQty: number | string | null
    }

/**
 * Per-unit price of a recipe row, whichever kind it is.
 *
 * A recipe row is EITHER material-sourced or sub-product-sourced (the DB
 * CHECK on `product_materials` enforces `materialId XOR sourceProductId`).
 * A sub-product's per-unit price is its batch cost divided by what one batch
 * yields.
 *
 * FAITHFUL REPLICATION OF THE CALCULATOR IS THE POINT. This mirrors
 * `calculate.tsx` exactly — the screen owners actually price their menu
 * from — rather than doing something arguably tidier:
 *
 *   const rawQty  = Number(sourceProductionQty ?? 1)
 *   const prodQty = rawQty > 0 ? rawQty : 1
 *   const perUnit = totalHpp / prodQty
 *
 * So a missing or zero batch yield divides by ONE, i.e. the row costs the
 * full batch — it does not price at zero. That looks like the unsafe choice
 * in isolation, but the alternative is a server number that disagrees with
 * the screen, which is the exact failure this function exists to prevent.
 * An unset yield is also the honest reading: "one batch makes one unit".
 *
 * A missing stored HPP still yields 0 — nothing is known about that cost yet,
 * and inventing one would be worse. The row stays visible in the breakdown
 * either way, so a gap is never silent.
 */
export function bomRowUnitPrice(row: BomRowPricing): number {
  if (row.kind === 'material') {
    const price = Number(row.pricePerUnit ?? 0)
    return Number.isFinite(price) ? price : 0
  }
  const batchCost = Number(row.sourceHpp ?? 0)
  if (!Number.isFinite(batchCost)) return 0
  const rawQty = Number(row.sourceProductionQty ?? 1)
  const yieldQty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1
  return batchCost / yieldQty
}

export function calculateMargin(sellingPrice: number, hpp: number): number {
  if (sellingPrice === 0) return 0
  return ((sellingPrice - hpp) / sellingPrice) * 100
}

export function calculateMarkup(sellingPrice: number, hpp: number): number {
  if (hpp === 0) return 0
  return ((sellingPrice - hpp) / hpp) * 100
}

export function suggestSellingPrice(hpp: number, targetMarginPercent: number): number {
  if (targetMarginPercent >= 100) return 0
  return hpp / (1 - targetMarginPercent / 100)
}

export function getMarginLevel(margin: number): 'danger' | 'warning' | 'good' {
  if (margin < 20) return 'danger'
  if (margin < 40) return 'warning'
  return 'good'
}
