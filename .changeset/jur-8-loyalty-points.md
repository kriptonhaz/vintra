---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-8: Loyalty points (earn + redeem). Komplit-tier feature.

- **Schema**: `customer_loyalty_balances` + `customer_loyalty_movements` tables; `loyalty_enabled / earn_rate / redeem_rate` on `pos_settings`; `loyalty_points_earned / redeemed / redeem_amount` on `pos_sales`.
- **Feature flag**: `loyalty_points` added to `POSFeatureFlag`, included only in `POS_KOMPLIT_FEATURES`. Bisnis does not get loyalty — it's the Komplit headline.
- **createSale**: when loyalty active + customer attached, accepts `redeemPoints`. Validates balance + post-discount cap, applies redeem as a pre-tax discount distinct from `discount_amount` (so future P&L can split marketing vs loyalty burn-down). Earns on the post-redemption pre-tax base. Earn + redeem ledger rows + balance upsert all in the same transaction. Returns a loyalty echo (`{ priorBalance, pointsEarned, pointsRedeemed, redeemAmount, newBalance }`) for the success modal.
- **voidSale**: writes compensating `adjust` movements + reverses balance delta. `lifetime_earned` / `lifetime_redeemed` are NOT reversed (historical truth).
- **New server fns**: `getCustomerLoyaltySummary` (balance + last 50 movements) and `adjustLoyaltyPoints` (admin override; requires `pos.manage`).
- **POS Settings → Loyalty section** (Komplit-gated): enable toggle, earn-rate input, redeem-rate input, live preview ("belanja Rp 100.000 → 100 poin").
- **Cashier**: redeem affordance pinned under the customer slot — only visible when a customer is attached + tenant has loyalty on. Shows live balance ("Saldo poin: 1.250 (≈ Rp 12.500)"), points input with max-cap, "Tukar maks" quick-action, "Hapus" reset. Cart breakdown row "Tukar poin (X) -Rp Y" feeds the live total. Server is the source of truth on validation.
- **Sale-success modal**: new "Loyalty pelanggan" block listing redeemed / earned / new balance.
- **Receipt PDF**: thermal + A4 layouts now emit "Tukar poin" / "Dapat poin" / "Saldo" footer block.
- **Customer detail page**: new "Loyalty Poin" section (Komplit-gated) with balance + lifetime totals + last 50 movements (typed: earn / redeem / adjust / expire).
