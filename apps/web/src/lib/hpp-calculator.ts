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
