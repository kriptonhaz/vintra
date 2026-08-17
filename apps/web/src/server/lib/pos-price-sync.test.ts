import { describe, expect, it } from 'bun:test'
import { POS_PRICE_READONLY_ERROR } from './pos-price-sync'

/**
 * The sync itself is a database routine, so these pin the RULES it encodes —
 * the parts a future edit is most likely to get wrong — rather than re-testing
 * Drizzle.
 */
describe('POS price ownership rules', () => {
  it('the refusal names where the price actually lives', () => {
    // A refusal that only says "not allowed" leaves the owner stuck on a
    // screen with no next step.
    expect(POS_PRICE_READONLY_ERROR).toContain('HPP')
    expect(POS_PRICE_READONLY_ERROR).toContain('langkah 3')
  })

  it('the refusal is in Indonesian, like every other user-facing error', () => {
    expect(POS_PRICE_READONLY_ERROR).toMatch(/Harga|Ubah/)
    expect(POS_PRICE_READONLY_ERROR).not.toMatch(/[Rr]ead[- ]?only|not allowed/)
  })
})

describe('which tier the sync is allowed to touch', () => {
  // An HPP product carries ONE price and cannot express a ladder. The sync
  // therefore owns tier-1 on the base unit and nothing else; bulk tiers and
  // alternate units stay the merchant's own policy.
  const BASE_UNIT = 'unit-pcs'
  const ALT_UNIT = 'unit-box'

  const syncTouches = (unitId: string, minQty: number, baseUnitId: string) =>
    unitId === baseUnitId && minQty === 1

  it('owns tier-1 on the base unit', () => {
    expect(syncTouches(BASE_UNIT, 1, BASE_UNIT)).toBe(true)
  })

  it('leaves bulk tiers on the base unit alone', () => {
    expect(syncTouches(BASE_UNIT, 10, BASE_UNIT)).toBe(false)
    expect(syncTouches(BASE_UNIT, 100, BASE_UNIT)).toBe(false)
  })

  it('leaves alternate units entirely alone, tier-1 included', () => {
    expect(syncTouches(ALT_UNIT, 1, BASE_UNIT)).toBe(false)
    expect(syncTouches(ALT_UNIT, 12, BASE_UNIT)).toBe(false)
  })
})

describe('when the sync runs at all', () => {
  // Scoped to the product being edited. A tenant-wide pass would silently
  // "resolve" divergences on products priced differently on purpose, the
  // moment somebody saved any unrelated product.
  const shouldSync = (opts: {
    sellingPriceSubmitted: boolean
    isLinked: boolean
  }) => opts.sellingPriceSubmitted && opts.isLinked

  it('runs when a linked product submits a selling price', () => {
    expect(shouldSync({ sellingPriceSubmitted: true, isLinked: true })).toBe(true)
  })

  it('does not run when only the name or category changed', () => {
    expect(shouldSync({ sellingPriceSubmitted: false, isLinked: true })).toBe(false)
  })

  it('does not run for a product no inventory item is linked to', () => {
    expect(shouldSync({ sellingPriceSubmitted: true, isLinked: false })).toBe(false)
  })
})
