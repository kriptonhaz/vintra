---
"@vintra/web": patch
---

Count nested recipes when calculating HPP.

A recipe row is either material-sourced or sub-product-sourced (the DB CHECK
enforces `materialId XOR sourceProductId`), but `calculateProductHpp`
`INNER JOIN`ed `materials` — dropping every sub-product row before the cost was
summed. A product built from another product was therefore costed as if its
nested recipe were free, understating HPP and overstating margin. The identical
bug was found and fixed in `getProductForEdit` some time ago; this call site was
missed, which is why the calculator screen and the stored `products.hpp` could
disagree about the same recipe.

The BOM query now `LEFT JOIN`s both sides and prices a sub-product row at
`sourceHpp / sourceProductionQty` — the convention `getProductForEdit` and the
calculator already use, so the server and the screen agree. The cost breakdown
reports sub-product rows under their own name instead of leaving a hole.

Pricing moved to `bomRowUnitPrice` in `lib/hpp-calculator.ts` and is covered by
tests, including a regression case where a Rp 2.100 nested recipe was costed at
zero and reported a 90% margin instead of 48%.

No production data was affected: Vintra currently has no sub-recipe rows, so the
fix is preventive rather than corrective.
