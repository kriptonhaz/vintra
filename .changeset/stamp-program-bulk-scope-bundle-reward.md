---
"@vintra/web": minor
"@vintra/db": minor
---

Stamp programs gain **multi-product scope** and **bundle rewards**:

- **Cakupan: Per beberapa produk** — a single program can now count purchases of N specific items (e.g. "buy Teh Mangga OR Teh Leci"). Both rejected the previous "make a category for it" workaround when the tenant didn't want to reshape inventory.
- **Hadiah bundle** — instead of one free item, a program can grant N free items with quantities (e.g. "1 Teh Original + 1 Candy"). Cashier "Tukar gratis" finds and discounts one cart line per bundle item; server validates the bundle is complete before accepting.

Existing **per kategori** and **per produk spesifik** programs keep working unchanged. Most-specific-wins precedence now reads single-product > product_set > category, so an item covered by multiple scopes earns exactly one stamp per qualifying line.

Schema adds two join tables (`loyalty_stamp_program_items`, `loyalty_stamp_program_rewards`) plus `scope` and `reward_mode` discriminator columns on `loyalty_stamp_programs`. The old XOR CHECK is dropped because product_set rows legitimately have both `category_id` and `product_id` NULL.
