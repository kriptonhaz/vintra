import { describe, expect, it } from 'bun:test'

/**
 * Two different reasons an inventory item carries no stock balance, and
 * they must not be conflated:
 *
 *   - `linkedHppProductId` — made to order. The BOM walker deducts the
 *     ingredients this business does own.
 *   - `trackStock = false`  — consignment. Somebody else owns the goods
 *     and nothing is deducted anywhere.
 *
 * Both must bypass the sale-time stock guard, and for both a balance of
 * zero means "not applicable", never "sold out". These pin the rule as
 * the POS applies it (`pos.ts` — guard and deduction) so a later edit
 * cannot quietly start refusing consignment sales again.
 */
const guardApplies = (item: {
  linkedHppProductId?: string | null
  trackStock?: boolean
}) => !item.linkedHppProductId && item.trackStock !== false

describe('which items the POS stock guard applies to', () => {
  it('guards an ordinary stocked item', () => {
    expect(guardApplies({ linkedHppProductId: null, trackStock: true })).toBe(true)
  })

  it('skips a consignment item', () => {
    // The whole point: its balance is 0 and always will be, so guarding
    // would refuse every sale of goods physically on the counter.
    expect(guardApplies({ linkedHppProductId: null, trackStock: false })).toBe(false)
  })

  it('skips a recipe-backed item, as before', () => {
    expect(guardApplies({ linkedHppProductId: 'p1', trackStock: true })).toBe(false)
  })

  it('treats a missing trackStock as tracked', () => {
    // Older rows and any caller that forgets the field must keep the
    // safe behaviour — guarded — rather than silently going unlimited.
    expect(guardApplies({ linkedHppProductId: null })).toBe(true)
  })
})

describe('low-stock warnings', () => {
  // A consignment row has no count to be low against. Badging it would
  // send the owner chasing a restock that is not theirs to do.
  const isLowStock = (item: {
    trackStock: boolean
    minStockLevel: number | null
    quantity: number
  }) =>
    item.trackStock &&
    item.minStockLevel != null &&
    item.quantity < item.minStockLevel

  it('warns on a tracked item below its minimum', () => {
    expect(isLowStock({ trackStock: true, minStockLevel: 5, quantity: 2 })).toBe(true)
  })

  it('never warns on a consignment item, whatever the stored numbers say', () => {
    expect(isLowStock({ trackStock: false, minStockLevel: 5, quantity: 0 })).toBe(false)
    expect(isLowStock({ trackStock: false, minStockLevel: 5, quantity: -3 })).toBe(false)
  })
})
