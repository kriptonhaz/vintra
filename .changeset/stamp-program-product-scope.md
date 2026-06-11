---
"@vintra/web": minor
"@vintra/db": minor
---

Stamp / punch-card programs now support **product-level scope** in addition to the existing category scope. Tenants with a single product per scope (e.g. Usama Steam — "Cuci 5x Motor gratis 1x") can pin a program to that specific item instead of having to corral it into a one-product category. Both scopes coexist: the editor exposes a **Cakupan: Per kategori / Per produk spesifik** radio, and per-tenant uniqueness rules apply independently to each scope (one active program per category AND one active program per product).

Accrual at the POS uses **most-specific-wins**: if a line item is matched by both a product-scope program and a category-scope program (e.g. an item belongs to a tracked category AND has its own product program), only the product-scope program earns the stamp. This prevents double-stamping while keeping both program types useful.

Schema-wise this makes `loyalty_stamp_programs.category_id` nullable, adds a nullable `product_id` FK, and adds a CHECK constraint enforcing exactly one of the two is set. The old `(tenant, category)` partial unique index is replaced by two parallel indexes — one per scope — so each is independently unique among active rows.
