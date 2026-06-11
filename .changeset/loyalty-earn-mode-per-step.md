---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Loyalty earn mode: linear (current) + per_step (new).

Until now the only earn shape was linear: N points per Rp spent. Tenants who run loyalty-card-stamp programs ("750 pt for every full Rp 15.000 spent") had no way to model that — they'd either lose precision (set rate=0.05 and have it diverge from the stamp count) or skip loyalty entirely.

Add a `per_step` mode that earns `step_points` for every full multiple of `step_amount` spent:

- linear   → `floor(spend × earnRate)`
- per_step → `floor(spend / stepAmount) × stepPoints`

Both modes floor — Rp 14.999 on a "750 per Rp 15.000" config gives 0 pts; Rp 30.000 gives 1500.

Schema: three new columns on `pos_settings` — `loyalty_earn_mode` (default `linear`), `loyalty_earn_step_amount`, `loyalty_earn_step_points` — plus a CHECK constraint on the mode. Existing tenants stay on linear with zero behaviour change.

Settings page gets a Linear / Per kelipatan toggle that swaps the editable fields, with a live preview ("Belanja Rp 30.000 → 1500 poin (2 kelipatan)") so the owner sanity-checks before saving. Server's `computeLoyaltyEarn` helper dispatches the math from a single place — both the cold path in `createSale` and the redeem-aware re-compute under tx call into it.
