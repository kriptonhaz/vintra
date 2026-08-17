import { describe, expect, it } from 'bun:test'
import {
  bomRowUnitPrice,
  calculateMaterialCost,
  calculateMargin,
  perUnitHpp,
} from './hpp-calculator'
import { statedUnitCost } from '../server/lib/stock-cost'

describe('bomRowUnitPrice — material rows', () => {
  it('uses the material price as-is', () => {
    expect(bomRowUnitPrice({ kind: 'material', pricePerUnit: 9 })).toBe(9)
  })

  it('accepts the numeric strings Drizzle returns for numeric columns', () => {
    expect(bomRowUnitPrice({ kind: 'material', pricePerUnit: '1250.50' })).toBe(1250.5)
  })

  it('prices a missing material at 0 rather than NaN', () => {
    expect(bomRowUnitPrice({ kind: 'material', pricePerUnit: null })).toBe(0)
  })
})

describe('bomRowUnitPrice — sub-product rows', () => {
  it('divides the batch cost by the batch yield', () => {
    // A batch of "Biang Teh" costs Rp 42.000 and yields 40 servings.
    expect(
      bomRowUnitPrice({
        kind: 'sub-product',
        sourceHpp: 42_000,
        sourceProductionQty: 40,
      }),
    ).toBe(1050)
  })

  it('accepts numeric strings on both fields', () => {
    expect(
      bomRowUnitPrice({
        kind: 'sub-product',
        sourceHpp: '42000.00',
        sourceProductionQty: '40.0000',
      }),
    ).toBe(1050)
  })

  it('prices at 0 when the sub-product has no stored HPP yet', () => {
    expect(
      bomRowUnitPrice({ kind: 'sub-product', sourceHpp: null, sourceProductionQty: 40 }),
    ).toBe(0)
  })

  // These pin the calculator's own fallback (calculate.tsx:266-269): a
  // missing or zero batch yield divides by ONE, so the row costs a full
  // batch. Pricing it at 0 would be tidier in isolation and WRONG here —
  // the server would then disagree with the screen the owner prices from.
  it('divides by one when the batch yield is zero or missing', () => {
    expect(
      bomRowUnitPrice({ kind: 'sub-product', sourceHpp: 42_000, sourceProductionQty: 0 }),
    ).toBe(42_000)
    expect(
      bomRowUnitPrice({
        kind: 'sub-product',
        sourceHpp: 42_000,
        sourceProductionQty: null,
      }),
    ).toBe(42_000)
  })

  it('matches calculate.tsx arithmetic exactly', () => {
    // Same inputs through the screen's own expression.
    const asScreenDoes = (hpp: unknown, qty: unknown) => {
      const totalHpp = Number(hpp ?? 0)
      const rawQty = Number(qty ?? 1)
      const prodQty = rawQty > 0 ? rawQty : 1
      return prodQty > 0 ? totalHpp / prodQty : totalHpp
    }
    for (const [hpp, qty] of [
      [42_000, 40],
      [42_000, 0],
      [42_000, null],
      [0, 40],
      [1_337, 7],
    ] as const) {
      expect(
        bomRowUnitPrice({
          kind: 'sub-product',
          sourceHpp: hpp,
          sourceProductionQty: qty,
        }),
      ).toBe(asScreenDoes(hpp, qty))
    }
  })
})

describe('regression: a nested recipe must not be costed as free', () => {
  // The bug: calculateProductHpp INNER JOINed `materials`, so every row whose
  // materialId was NULL — i.e. every sub-product row — was dropped from the
  // BOM entirely. The product was then costed as if its nested recipe cost
  // nothing, understating HPP and overstating margin.
  //
  // "Lemon Tea" = 200ml Biang Teh (a sub-product) + 1 slice of lemon.
  const biangTehPerMl = bomRowUnitPrice({
    kind: 'sub-product',
    sourceHpp: 42_000, // one batch
    sourceProductionQty: 4_000, // yields 4000 ml
  })
  const lemonPerSlice = bomRowUnitPrice({ kind: 'material', pricePerUnit: 500 })

  const subProductCost = calculateMaterialCost(biangTehPerMl, 200)
  const materialCost = calculateMaterialCost(lemonPerSlice, 1)

  it('prices the sub-product row above zero', () => {
    expect(biangTehPerMl).toBe(10.5)
    expect(subProductCost).toBe(2100)
  })

  it('total cost includes BOTH row kinds', () => {
    const buggyTotal = materialCost // what the INNER JOIN produced
    const correctTotal = subProductCost + materialCost

    expect(buggyTotal).toBe(500)
    expect(correctTotal).toBe(2600)
    expect(correctTotal).toBeGreaterThan(buggyTotal)
  })

  it('the dropped cost inflated the reported margin', () => {
    const sellingPrice = 5_000
    const buggyMargin = calculateMargin(sellingPrice, perUnitHpp(500, 1))
    const correctMargin = calculateMargin(sellingPrice, perUnitHpp(2600, 1))

    expect(buggyMargin).toBe(90) // "90% margin!" — not real
    expect(correctMargin).toBe(48)
  })
})

describe('zero-cost stock movement guard', () => {
  // Bug 1: `unitCost` is optional and validated min(0), so an opname with the
  // cost field left alone arrives as 0 — indistinguishable from "free". Using
  // it to re-cost the ingredient zeroed a real price, and from there the
  // ingredient vanished from the cost of every recipe using it.

  it('treats a stated positive cost as a real re-cost', () => {
    expect(statedUnitCost(9)).toBe(9)
    expect(statedUnitCost(0.5)).toBe(0.5)
  })

  it('refuses to re-cost from zero or a missing cost', () => {
    expect(statedUnitCost(0)).toBeNull()
    expect(statedUnitCost(null)).toBeNull()
  })

  it('refuses a nonsensical cost rather than writing NaN', () => {
    expect(statedUnitCost(Number.NaN)).toBeNull()
    expect(statedUnitCost(-5)).toBeNull()
  })

  it('keeps the recipe cost intact when an opname states no cost', () => {
    const priceBefore = 9 // Rp 9/ml — the real "Susu Putih" price
    const priceAfter = statedUnitCost(0) ?? priceBefore
    expect(priceAfter).toBe(9)
    // 20 ml of it in a recipe still costs what it did before, instead of 0.
    expect(calculateMaterialCost(priceAfter, 20)).toBe(180)
  })
})
