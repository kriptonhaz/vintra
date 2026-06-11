---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-15 step 5: cashier UI for prep-mode items.

- `listPOSProducts` now returns `prepMode` + `siapInBase` (aggregated
  across open prep batches at the active branch).
- Cashier tile renders `Siap: N` instead of `Auto` for prep-mode items,
  and hard-disables when `siapInBase = 0` ("Habis prep" badge).
- New shared `PrepBatchSheet` component (used here + in step 6) — qty
  input, optional notes, recent-prep tail, invalidates `pos/products`
  cache on success so the Siap counter refreshes.
- Corner `+` action on prep-mode tiles opens the sheet. Hidden for
  callers without `inventory.write`.
