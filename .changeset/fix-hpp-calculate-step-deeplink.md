---
"@vintra/web": patch
---

Fix the "Ubah harga jual di HPP" link landing on step 1 with the stepper dead.

The link from a recipe-linked inventory item passed `?edit=<id>`, but the route
reads `editProductId`. The page therefore never entered edit mode: it opened as
a blank "new calculation" on step 1, and the stepper numbers were disabled —
they are deliberately only clickable while editing, so both symptoms came from
the same wrong parameter name.

The link now passes `editProductId`, and the route accepts a `step` search
param so the deep link opens on step 3, where the selling price actually lives.
`step` is honoured only in edit mode and only for a real step number, for the
same reason the stepper is edit-only: a new product has nothing filled in yet,
so opening on step 3 would show empty fields and let the per-step validation be
skipped.

The wrong name survived review because the link carried an `as never` cast on
its search object, which silenced exactly the error that would have caught it.
The cast is gone; the route's search type now checks these call sites.
