---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-15 step 6: inventory item form toggle + prep panel.

- `PrepModeToggle` component on the item edit Sheet, visible only when
  the recipe link is on. Persisted via `updateInventoryItem` (which
  silently clears prep_mode if the recipe link is removed in the same
  edit, sidestepping the DB CHECK).
- New `PrepBatchPanel` on the item detail page for prep-mode items —
  shows current Siap counter per branch + "Prep batch" CTA that opens
  the shared sheet. Tells the operator clearly when stock is empty
  so the cashier rejection makes sense.
