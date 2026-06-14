---
"@vintra/web": minor
"@vintra/db": patch
---

Product variants — Phase 3 (POS cashier). Variant items are now sellable at the cashier: tapping one opens a variant picker (each combo shows its price + remaining per-branch stock), and the chosen variant rings up at its own price. `listPOSProducts` surfaces variant items (with "mulai Rp …" pricing) even without unit tiers; `createSale` re-prices from the variant, guards + deducts per-variant stock, and snapshots the variant on the sale line; `voidSale` restocks the correct combo. Cart + receipts show the variant label. Adds `pos_sale_items.variant_id` + `variant_label`. This closes the loop — variants now work consistently online and in-store.
