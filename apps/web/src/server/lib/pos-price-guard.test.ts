import { describe, expect, it } from 'bun:test'
import { isPriceChanged } from './pos-price-guard'

describe('isPriceChanged — refuses a genuine price edit', () => {
  it('same tier, different price', () => {
    expect(
      isPriceChanged(
        { unitPrice: 17_000, quotedTierMinQty: 1 },
        { minQty: 1, unitPrice: 20_000 },
      ),
    ).toBe(true)
  })

  it('catches a price cut too — the receipt still contradicts the quote', () => {
    expect(
      isPriceChanged(
        { unitPrice: 20_000, quotedTierMinQty: 1 },
        { minQty: 1, unitPrice: 17_000 },
      ),
    ).toBe(true)
  })

  it('same tier, same price passes', () => {
    expect(
      isPriceChanged(
        { unitPrice: 17_000, quotedTierMinQty: 1 },
        { minQty: 1, unitPrice: 17_000 },
      ),
    ).toBe(false)
  })

  it('ignores sub-cent float noise', () => {
    expect(
      isPriceChanged(
        { unitPrice: 17_000.001, quotedTierMinQty: 1 },
        { minQty: 1, unitPrice: 17_000 },
      ),
    ).toBe(false)
  })
})

describe('isPriceChanged — must never block a legitimate sale', () => {
  // THE FATAL CASE. The mobile cart holds no tiers, so a line's unitPrice
  // stays frozen at the tier that applied when it was created. Bump the qty
  // past a bulk threshold and the client still quotes retail while the server
  // resolves bulk. Refusing here would block every mobile bulk sale.
  it('does not refuse when the server resolved a DIFFERENT tier', () => {
    expect(
      isPriceChanged(
        { unitPrice: 5_000, quotedTierMinQty: 1 }, // quoted retail at qty 1
        { minQty: 10, unitPrice: 4_500 }, // server resolved the bulk tier
      ),
    ).toBe(false)
  })

  // A client that does not name its tier is not subject to the guard at all,
  // so its behaviour is exactly what it was before the guard existed.
  it('does not refuse when the client sent no tier marker', () => {
    expect(
      isPriceChanged({ unitPrice: 5_000 }, { minQty: 10, unitPrice: 4_500 }),
    ).toBe(false)
    expect(
      isPriceChanged(
        { unitPrice: 5_000, quotedTierMinQty: null },
        { minQty: 1, unitPrice: 9_999 },
      ),
    ).toBe(false)
  })

  it('a mobile-shaped line never triggers the guard, whatever the price', () => {
    for (const resolved of [
      { minQty: 1, unitPrice: 1 },
      { minQty: 1, unitPrice: 999_999 },
      { minQty: 12, unitPrice: 4_500 },
    ]) {
      expect(isPriceChanged({ unitPrice: 5_000 }, resolved)).toBe(false)
    }
  })
})
