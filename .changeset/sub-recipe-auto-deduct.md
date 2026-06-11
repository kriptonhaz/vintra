---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Auto-deduct sub-recipe ingredients on sale (recursive BOM walk).

Recipes can contain sub-recipes — a BOM row referencing another HPP product instead of an atomic material. Previously both the display and the stock deduction stopped at the top level: the inventory item detail page showed a "fitur menyusul" placeholder, and a sale only deducted top-level materials.

Now:
- `deductBomIngredients` recurses into sub-recipe rows, scaling the consumed quantity by the sub-recipe's production batch size (`quantity / productionQty`). Cycle-guarded via an ancestor set and depth-capped at 8.
- A sub-recipe that can't be scaled — no `productionQty`, a recipe unit that doesn't match its `productionUnit`, or a recursion cycle — is skipped and surfaced as a one-time owner notification; the sale is never blocked over recipe config.
- The inventory item detail page now renders the full nested sub-recipe tree with each sub-recipe's ingredients (linked/unlinked status included), replacing the placeholder. Unscalable sub-recipes show an inline "set production qty" note.
