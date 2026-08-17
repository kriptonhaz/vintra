import { describe, expect, it } from 'bun:test'
import { computeHpp, type HppBomLine, type HppProductInput } from './hpp-engine'

const P = (
  id: string,
  sellingPrice: number,
  productionQty: number | null = 1,
): HppProductInput => ({ id, sellingPrice, productionQty })

const mat = (productId: string, materialId: string, quantity: number): HppBomLine => ({
  productId,
  materialId,
  sourceProductId: null,
  quantity,
})

const sub = (productId: string, sourceProductId: string, quantity: number): HppBomLine => ({
  productId,
  materialId: null,
  sourceProductId,
  quantity,
})

describe('computeHpp — material-only recipes', () => {
  it('sums quantity × price', () => {
    const r = computeHpp(
      [P('a', 5_000)],
      [mat('a', 'lemon', 1), mat('a', 'gula', 20)],
      new Map([
        ['lemon', 500],
        ['gula', 15],
      ]),
    )
    expect(r.values.get('a')!.hpp).toBe(800)
    expect(r.unresolved).toEqual([])
  })

  it('treats a missing material price as 0, like the calculator', () => {
    const r = computeHpp([P('a', 5_000)], [mat('a', 'ghost', 3)], new Map())
    expect(r.values.get('a')!.hpp).toBe(0)
  })

  it('a product with no recipe costs 0 rather than being unresolved', () => {
    const r = computeHpp([P('a', 5_000)], [], new Map())
    expect(r.values.get('a')!.hpp).toBe(0)
    expect(r.unresolved).toEqual([])
  })
})

describe('computeHpp — margin is per-unit, not per-batch', () => {
  // The bug this guards: `hpp` is a whole batch, `sellingPrice` is one unit.
  // 42 cookies costing Rp 13.308 against a Rp 5.000 unit price is a healthy
  // product, but comparing batch-to-unit reports -166%.
  it('a multi-yield recipe is not reported as a loss', () => {
    const r = computeHpp(
      [P('cookie', 5_000, 42)],
      [mat('cookie', 'adonan', 1)],
      new Map([['adonan', 13_308]]),
    )
    const v = r.values.get('cookie')!
    expect(v.hpp).toBe(13_308) // batch cost, as stored
    // per-unit = 13308/42 = 316.86 -> margin = (5000-316.86)/5000 = 93.66%
    expect(v.margin).toBeCloseTo(93.66, 1)
    expect(v.margin).toBeGreaterThan(0)
  })

  it('a single-yield recipe is unaffected', () => {
    const r = computeHpp(
      [P('x', 5_000, 1)],
      [mat('x', 'm', 1)],
      new Map([['m', 2_600]]),
    )
    expect(r.values.get('x')!.margin).toBe(48)
  })

  it('a null batch yield behaves as 1', () => {
    const r = computeHpp(
      [P('x', 5_000, null)],
      [mat('x', 'm', 1)],
      new Map([['m', 2_600]]),
    )
    expect(r.values.get('x')!.margin).toBe(48)
  })
})

describe('computeHpp — nested recipes', () => {
  it('costs a sub-recipe at batch cost ÷ batch yield', () => {
    // Biang Teh: one batch costs 42.000 and yields 4.000 ml -> 10.5/ml
    // Lemon Tea uses 200ml (2.100) + 1 lemon (500) = 2.600
    const r = computeHpp(
      [P('biang', 0, 4_000), P('lemon-tea', 5_000, 1)],
      [
        mat('biang', 'teh', 1),
        sub('lemon-tea', 'biang', 200),
        mat('lemon-tea', 'lemon', 1),
      ],
      new Map([
        ['teh', 42_000],
        ['lemon', 500],
      ]),
    )
    expect(r.values.get('biang')!.hpp).toBe(42_000)
    expect(r.values.get('lemon-tea')!.hpp).toBe(2_600)
    expect(r.values.get('lemon-tea')!.depth).toBe(1)
  })

  it('resolves a 3-level chain regardless of input order', () => {
    // c depends on b depends on a. Feed them in the WORST order.
    const build = (order: HppProductInput[]) =>
      computeHpp(
        order,
        [mat('a', 'm', 10), sub('b', 'a', 1), sub('c', 'b', 1)],
        new Map([['m', 100]]),
      )
    const reversed = build([P('c', 0), P('b', 0), P('a', 0)])
    const forward = build([P('a', 0), P('b', 0), P('c', 0)])

    expect(reversed.values.get('c')!.hpp).toBe(1_000)
    expect(reversed.values.get('c')!.hpp).toBe(forward.values.get('c')!.hpp)
    expect(reversed.maxDepth).toBe(2)
    expect(reversed.unresolved).toEqual([])
  })

  it('does not inflate in-degree when the same sub-product is used twice', () => {
    // Two rows referencing the same sub-product must not strand the parent
    // as a false cycle.
    const r = computeHpp(
      [P('base', 0, 1), P('combo', 0, 1)],
      [mat('base', 'm', 1), sub('combo', 'base', 1), sub('combo', 'base', 2)],
      new Map([['m', 100]]),
    )
    expect(r.unresolved).toEqual([])
    expect(r.values.get('combo')!.hpp).toBe(300)
  })
})

describe('computeHpp — cycles and bad edges', () => {
  it('reports a 2-product cycle instead of guessing', () => {
    const r = computeHpp(
      [P('a', 0), P('b', 0)],
      [sub('a', 'b', 1), sub('b', 'a', 1)],
      new Map(),
    )
    expect(r.unresolved.sort()).toEqual(['a', 'b'])
    expect(r.values.size).toBe(0)
  })

  it('a cycle does not strand unrelated products', () => {
    const r = computeHpp(
      [P('a', 0), P('b', 0), P('safe', 5_000)],
      [sub('a', 'b', 1), sub('b', 'a', 1), mat('safe', 'm', 2)],
      new Map([['m', 250]]),
    )
    expect(r.unresolved.sort()).toEqual(['a', 'b'])
    expect(r.values.get('safe')!.hpp).toBe(500)
  })

  it('drops a self-referencing row rather than deadlocking', () => {
    const r = computeHpp(
      [P('a', 5_000)],
      [sub('a', 'a', 1), mat('a', 'm', 1)],
      new Map([['m', 700]]),
    )
    expect(r.unresolved).toEqual([])
    expect(r.values.get('a')!.hpp).toBe(700)
  })

  it('ignores an edge to a product outside the set', () => {
    const r = computeHpp(
      [P('a', 5_000)],
      [sub('a', 'deleted-or-other-tenant', 5), mat('a', 'm', 1)],
      new Map([['m', 700]]),
    )
    expect(r.unresolved).toEqual([])
    expect(r.values.get('a')!.hpp).toBe(700)
  })
})

describe('computeHpp — sub-recipe with no batch yield', () => {
  it('divides by one, matching calculate.tsx', () => {
    const r = computeHpp(
      [P('biang', 0, 0), P('parent', 0, 1)],
      [mat('biang', 'm', 1), sub('parent', 'biang', 2)],
      new Map([['m', 500]]),
    )
    expect(r.values.get('biang')!.hpp).toBe(500)
    // 2 × (500 / 1) — a full batch each, not zero.
    expect(r.values.get('parent')!.hpp).toBe(1_000)
  })
})

describe('computeHpp — storage precision', () => {
  it('rounds hpp to 2 decimals', () => {
    const r = computeHpp(
      [P('a', 0)],
      [mat('a', 'm', 3)],
      new Map([['m', 10 / 3]]),
    )
    expect(r.values.get('a')!.hpp).toBe(10)
  })

  it('clamps margin into numeric(5,2)', () => {
    // A near-zero cost against a huge price would overflow the column.
    const r = computeHpp([P('a', 1_000_000, 1)], [mat('a', 'm', 1)], new Map([['m', 0.01]]))
    expect(r.values.get('a')!.margin).toBeLessThanOrEqual(999.99)
  })
})
