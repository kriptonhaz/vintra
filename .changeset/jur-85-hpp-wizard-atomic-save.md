---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-85: HPP wizard save no longer wipes the recipe on partial failure.

Two layers:

- New `replaceProductMaterials` server fn — DELETE existing rows +
  INSERT new ones in a single Drizzle transaction. If any insert fails
  the whole rewrite rolls back, so a recipe is never left half-empty.
- Wizard `handleSaveCalculation` is restructured to do all fail-fast
  validation (resolving unitIds for every row, auto-creating any new
  materials) BEFORE the destructive replace. If a unit can't be
  resolved or a material create fails, the DB is untouched.

Verified via Playwright on Mantra Maker: the resolveUnitId error
still surfaces on certain Vite-HMR states (filed as a follow-up),
but the recipe now survives intact through the failure — meeting
the JUR-85 acceptance criterion.
