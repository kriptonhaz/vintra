---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Hide the cart discount card when the cart is empty. It's only actionable once items are in the cart, and rendering an editable form with no math behind it just adds visual noise to the empty state.
