/**
 * Whether the cashier renders the promo-code box.
 *
 * Two independent facts decide this and they are easy to conflate:
 *
 *   - the TIER decides whether the tenant has promo codes at all
 *   - the SETTING decides whether a tenant who has them wants the box
 *     on screen
 *
 * The setting can only ever narrow the tier, never widen it. Kept as a
 * function — rather than an `&&` inlined at the one call site — because
 * the null case below is a judgement call that deserves somewhere to be
 * written down and tested, not a `?? true` a later reader has to decode.
 */
export function resolvePromoCodeFieldVisible(opts: {
  /** Does the tenant's POS tier include the `promo_codes` feature? */
  tierHasPromoCodes: boolean
  /**
   * The tenant's own preference. Null when they have no `pos_settings`
   * row yet — a tenant who has never opened the settings page, not one
   * who chose to hide the field.
   */
  tenantSetting: boolean | null | undefined
}): boolean {
  if (!opts.tierHasPromoCodes) return false
  // No stored preference means "not yet asked", and the answer for that
  // is the behaviour that existed before this setting did: show it.
  // Defaulting to hidden would silently remove a working field from
  // every tenant currently typing promo codes.
  return opts.tenantSetting ?? true
}
