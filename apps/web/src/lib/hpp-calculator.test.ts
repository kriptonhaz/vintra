import { describe, expect, it } from 'bun:test'
import {
  bomRowUnitPrice,
  calculateMaterialCost,
  calculateMargin,
  inventoryMargin,
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

describe('regression: an HPP product\'s cost reaching inventory and POS', () => {
  // Reported from the HaRa Cookies tenant. "Cookies Alpukat": a batch costs
  // Rp 25.308,57 and yields 40 pieces, so a piece costs Rp 632,71 against a
  // Rp 4.000 selling price — an 84% margin.
  //
  // The batch figure was copied straight into the inventory item's costPrice
  // and into the POS cost snapshot, both of which are PER UNIT. The item then
  // displayed "Modal Rp 25.308,57 / Pieces" and a red "Rugi" badge on a
  // product that earns Rp 3.367 per piece.
  const BATCH_HPP = 25_308.57
  const YIELD = 40
  const SELLING = 4_000

  it('a piece costs the batch divided by the yield', () => {
    expect(perUnitHpp(BATCH_HPP, YIELD)).toBeCloseTo(632.71, 2)
  })

  it('the product is profitable, not a loss', () => {
    const unitCost = perUnitHpp(BATCH_HPP, YIELD)
    expect(SELLING - unitCost).toBeGreaterThan(0)
    expect(calculateMargin(SELLING, unitCost)).toBeCloseTo(84.2, 1)
  })

  it('using the batch cost per unit is what produced the false loss', () => {
    // What the buggy path stored, kept as the thing NOT to do.
    expect(SELLING - BATCH_HPP).toBeLessThan(0)
    expect(calculateMargin(SELLING, BATCH_HPP)).toBeLessThan(0)
  })

  it('a single-yield recipe is unaffected either way', () => {
    expect(perUnitHpp(5_000, 1)).toBe(5_000)
  })
})

describe('inventoryMargin', () => {
  // Resale goods never reach HPP, so this is the only place their cost and
  // price ever meet. Getting it wrong misprices a whole category silently.

  it('computes margin against the SELLING price, like everywhere else', () => {
    // Teh Pucuk: buy 2.700, sell 4.000 → 32,5% of revenue, not 48% markup.
    expect(inventoryMargin(2700, 4000)).toBeCloseTo(32.5, 1)
  })

  it('reports a loss as a negative number rather than clamping to zero', () => {
    // The item detail page shows "Rugi" here; the list must agree, and a
    // clamped 0% would read as "breaking even" on a losing item.
    expect(inventoryMargin(5000, 4000)).toBeCloseTo(-25, 1)
  })

  it('returns null when no selling price has been set yet', () => {
    expect(inventoryMargin(2700, null)).toBeNull()
  })

  it('returns null on a zero cost instead of claiming a perfect margin', () => {
    // (4000 - 0) / 4000 = 100%. Arithmetically right, and the exact
    // opposite of the truth: a 0 cost means the buy price was never
    // entered, so this is the row we know LEAST about.
    expect(inventoryMargin(0, 4000)).toBeNull()
  })

  it('returns null rather than Infinity or NaN on junk input', () => {
    expect(inventoryMargin(Number.NaN, 4000)).toBeNull()
    expect(inventoryMargin(2700, 0)).toBeNull()
    expect(inventoryMargin(2700, Number.NaN)).toBeNull()
  })

  it('agrees with the tier editor about what counts as a loss', () => {
    // items.$itemId.tsx flags a tier when `unitPrice < costPerUnit`. A
    // margin below zero must mean the same thing, or one screen says
    // "Rugi" while the other shows a healthy-looking percentage.
    const cost = 900
    for (const price of [1, 450, 899]) {
      expect(inventoryMargin(cost, price)!).toBeLessThan(0)
    }
    expect(inventoryMargin(cost, 901)!).toBeGreaterThan(0)
  })
})
