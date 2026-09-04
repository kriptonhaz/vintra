import { describe, expect, it } from 'bun:test'
import { planCostUpdates, type CostSyncCandidate } from './hpp-cost-sync'

const row = (over: Partial<CostSyncCandidate> = {}): CostSyncCandidate => ({
  itemId: 'i1',
  itemName: 'Kopi Susu',
  currentCost: '1000.00',
  targetCost: '1200.00',
  ...over,
})

describe('planCostUpdates', () => {
  it('moves an item whose cost drifted from its HPP', () => {
    const { updated } = planCostUpdates([row()])
    expect(updated).toEqual([
      { itemId: 'i1', itemName: 'Kopi Susu', oldCost: 1_000, newCost: 1_200 },
    ])
  })

  it('leaves an item already at its target alone', () => {
    // Not merely an optimisation: an UPDATE here would bump updated_at
    // on every linked item on every recalculation, which is what makes
    // "what changed today" unreadable.
    const { updated } = planCostUpdates([
      row({ currentCost: '1200.00', targetCost: '1200.00' }),
    ])
    expect(updated).toEqual([])
  })

  it('treats differing trailing zeros as the same money', () => {
    const { updated } = planCostUpdates([
      row({ currentCost: '1200', targetCost: '1200.0000' }),
    ])
    expect(updated).toEqual([])
  })

  it('leaves the owner cost in place when the product has no HPP yet', () => {
    // An empty recipe, or a product the engine left unresolved inside a
    // cycle. Writing 0 there would report a 100% margin on a product
    // nobody has costed.
    const { updated } = planCostUpdates([row({ targetCost: null })])
    expect(updated).toEqual([])
  })

  it('ignores a target that is not a number', () => {
    const { updated } = planCostUpdates([row({ targetCost: 'NaN' })])
    expect(updated).toEqual([])
  })

  it('groups items landing on the same cost into one update', () => {
    // The common shape: one ingredient moves, several recipes that use
    // it settle on the same new cost.
    const { byTarget } = planCostUpdates([
      row({ itemId: 'a', targetCost: '1200.00' }),
      row({ itemId: 'b', targetCost: '1200.00' }),
      row({ itemId: 'c', targetCost: '1500.00' }),
    ])
    expect([...byTarget.entries()]).toEqual([
      ['1200.00', ['a', 'b']],
      ['1500.00', ['c']],
    ])
  })

  it('reports a cost that went down as readily as one that went up', () => {
    const { updated } = planCostUpdates([
      row({ currentCost: '1500.00', targetCost: '900.00' }),
    ])
    expect(updated[0]).toMatchObject({ oldCost: 1_500, newCost: 900 })
  })
})
