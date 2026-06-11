---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix sub-recipe BOM rows silently disappearing from HPP product edit/detail views.

`getProductForEdit` previously used `INNER JOIN materials` which filtered out every BOM row where `material_id IS NULL` — i.e. every nested sub-product row added via the calculator's product picker. Symptoms in production (Es Teh Paus): owner added "Master Teh (5 Liter)" as a sub-recipe inside "Lemon Tea", then later it appeared to vanish from the recipe (looked like changing a category had deleted it). The rows were never actually deleted — the response query was hiding them.

Three coordinated fixes:

- Server `getProductForEdit` now LEFT JOINs `materials` and LEFT JOINs an aliased `products` table on `source_product_id`, returning sub-product rows with `sourceName`, `sourceHpp`, `sourceProductionQty`, and `sourceProductionUnit` populated. Material-sourced rows keep all their existing fields. The DB CHECK already enforces XOR between the two sides so callers can branch cleanly.
- Calculator edit-mode `form.reset` now branches on `item.sourceProductId`: sub-product rows populate `productId` + derived `pricePerUnit` (`sourceHpp / sourceProductionQty`, same math as `productOptions`), and material rows keep the original mapping. This means re-opening a recipe with sub-recipes now round-trips them through `replaceProductMaterials` instead of dropping them on save.
- Product detail dialog cost breakdown now renders sub-product rows with the source product's name and a "Sub-resep" badge, deriving the per-unit price the same way as the calculator. Mobile and desktop layouts both updated via a shared `resolveBomRowView` helper.
