---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

POS cashier: clicking "Tukar" on an eligible stamp card now auto-adds the reward item(s) into the cart at 100% off, instead of requiring the cashier to first ring them up manually. Works for both single rewards (qty 1) and bundle rewards (qty per bundle entry). Auto-added rows are tracked separately so that cancelling the redemption removes them from the cart entirely — pre-existing lines the cashier had already rung are left in place with their discount cleared, matching the previous behaviour. `listPOSProducts` gained an optional `itemIds` filter so the cashier can fetch reward items outside the current category/search view.
