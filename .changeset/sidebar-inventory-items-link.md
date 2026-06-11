---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add `/inventory/items` (Daftar Stok) as a child link under Inventaris in the sidebar. Previously this route was only reachable via the Produk section's filtered views (`?view=sellable` / `?view=ingredients`); the unfiltered all-items view had no nav entry.
