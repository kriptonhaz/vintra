---
"@vintra/web": minor
"@vintra/db": minor
---

Add a POS setting to hide the cashier's promo-code box.

The box appeared for every tenant whose tier includes `promo_codes`, whether or
not they run promotions — a permanently empty field between the cart and the
discount control, on every sale. Pengaturan Kasir now carries a switch for it.

Defaults to on, so no tenant currently typing promo codes loses the field when
this ships; opting out is the new capability. The switch only appears on tiers
that actually have promo codes, and the stored value can only narrow the tier,
never widen it — `resolvePromoCodeFieldVisible` owns that rule and is tested.

Automatic promotions (per product, category, or cart total) keep applying when
the box is hidden; only the typed-code input goes away. `createSale` also still
honours a valid code sent with a sale — this is decluttering, not an anti-fraud
gate like ad-hoc lines, and refusing a real discount over a display preference
would cost the customer money.

Also extracts the switch card shared by this and the "Item Lain" setting into
one `SettingToggleSection`, so their save and revert-on-failure behaviour
cannot drift apart.
