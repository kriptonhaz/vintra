import { describe, expect, it } from 'bun:test'
import { summarizeImpact, DANGER_MARGIN, type RecalcResult } from './hpp-cascade'

const result = (
  changed: RecalcResult['changed'],
  extra: Partial<RecalcResult> = {},
): RecalcResult => ({
  changed,
  unchanged: 0,
  unresolved: [],
  maxDepth: 0,
  costSyncedItems: 0,
  ...extra,
})

describe('summarizeImpact', () => {
  it('counts affected products and averages the movement', () => {
    const i = summarizeImpact(
      result([
        { productId: 'a', oldHpp: 1_000, newHpp: 1_200, oldMargin: 80, newMargin: 76 },
        { productId: 'b', oldHpp: 2_000, newHpp: 2_400, oldMargin: 60, newMargin: 52 },
      ]),
    )
    expect(i.affected).toBe(2)
    expect(i.averageMove).toBe(300) // (200 + 400) / 2
    expect(i.belowDanger).toEqual([])
  })

  it('reports a downward move as negative', () => {
    const i = summarizeImpact(
      result([{ productId: 'a', oldHpp: 1_000, newHpp: 800, oldMargin: 50, newMargin: 60 }]),
    )
    expect(i.averageMove).toBe(-200)
  })

  it('flags products landing under the danger margin', () => {
    const i = summarizeImpact(
      result([
        { productId: 'ok', oldHpp: 100, newHpp: 200, oldMargin: 90, newMargin: 60 },
        { productId: 'thin', oldHpp: 100, newHpp: 900, oldMargin: 90, newMargin: 9 },
      ]),
    )
    expect(i.belowDanger).toEqual([{ productId: 'thin', margin: 9 }])
  })

  it('treats exactly the danger margin as safe', () => {
    const i = summarizeImpact(
      result([
        { productId: 'edge', oldHpp: 1, newHpp: 2, oldMargin: 50, newMargin: DANGER_MARGIN },
      ]),
    )
    expect(i.belowDanger).toEqual([])
  })

  // A product costed for the very first time has no previous number. Treating
  // the absent value as 0 would report the entire cost as a "movement", which
  // is the honest reading — but it must not crash or produce NaN.
  it('handles a product that had no stored HPP yet', () => {
    const i = summarizeImpact(
      result([{ productId: 'new', oldHpp: null, newHpp: 500, oldMargin: null, newMargin: 40 }]),
    )
    expect(i.averageMove).toBe(500)
    expect(Number.isFinite(i.averageMove)).toBe(true)
  })

  it('averages to zero rather than NaN when nothing changed', () => {
    const i = summarizeImpact(result([]))
    expect(i.affected).toBe(0)
    expect(i.averageMove).toBe(0)
    expect(Number.isNaN(i.averageMove)).toBe(false)
  })

  it('carries the unresolved count through', () => {
    const i = summarizeImpact(result([], { unresolved: ['x', 'y'], unchanged: 5 }))
    expect(i.unresolved).toBe(2)
    expect(i.unchanged).toBe(5)
  })
})
