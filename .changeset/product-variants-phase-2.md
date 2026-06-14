---
"@vintra/web": minor
"@vintra/db": patch
---

Product variants — Phase 2 (storefront). Variant items now surface in the online store: the product card shows "mulai Rp …" (cheapest variant) and a "Pilih Variasi" button opens a picker (one chip group per dimension) that resolves the combo's price + per-variant stock. The cart keys lines by variant (so S/Merah and M/Biru are separate lines), checkout/`placeOrder` re-prices from the variant and soft-checks variant stock, and the order line records the variant id + label. Admin confirm now deducts per-variant stock (cancel restocks it), and the order inbox + customer order-tracking show the chosen variant. Adds `online_order_items.variant_id` + `variant_label`.
