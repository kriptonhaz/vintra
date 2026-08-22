import { describe, expect, it } from 'bun:test'
import { resolvePromoCodeFieldVisible } from './pos-promo-field'

describe('resolvePromoCodeFieldVisible', () => {
  it('shows the field for a tier that has promo codes and no preference set', () => {
    // The pre-setting behaviour. Anyone typing promo codes today must
    // still see the box the moment this ships.
    expect(
      resolvePromoCodeFieldVisible({
        tierHasPromoCodes: true,
        tenantSetting: null,
      }),
    ).toBe(true)
  })

  it('hides the field when the tenant turned it off', () => {
    expect(
      resolvePromoCodeFieldVisible({
        tierHasPromoCodes: true,
        tenantSetting: false,
      }),
    ).toBe(false)
  })

  it('the setting can never grant promo codes to a tier without them', () => {
    // A stale or hand-edited row saying `true` on a Toko tenant must not
    // put a field on screen that the server would then refuse to honour.
    expect(
      resolvePromoCodeFieldVisible({
        tierHasPromoCodes: false,
        tenantSetting: true,
      }),
    ).toBe(false)
  })

  it('stays hidden on a tier without promo codes, whatever the setting says', () => {
    for (const tenantSetting of [true, false, null, undefined]) {
      expect(
        resolvePromoCodeFieldVisible({
          tierHasPromoCodes: false,
          tenantSetting,
        }),
      ).toBe(false)
    }
  })

  it('treats undefined the same as null — both mean "never asked"', () => {
    expect(
      resolvePromoCodeFieldVisible({
        tierHasPromoCodes: true,
        tenantSetting: undefined,
      }),
    ).toBe(true)
  })
})
