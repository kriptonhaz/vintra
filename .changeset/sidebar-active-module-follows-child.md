---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix the wrong sidebar parent menu auto-expanding.

On `/inventory/items?view=ingredients` the Inventaris menu auto-expanded instead of Produk. `moduleScore` picks the active module by URL prefix, and the Produk parent pins `?view=sellable` as its default — so on the `ingredients` view Produk failed to match and Inventaris (`/inventory`, a loose prefix of `/inventory/items`) won. Module selection now follows the resolved active child: whichever parent owns the active child wins, so Produk activates and expands when Bahan Baku is open. The prefix-based scoring stays as a fallback for URLs that don't land on a declared child.
