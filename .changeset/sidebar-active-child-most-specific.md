---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix the sidebar highlighting two menu items at once.

Katalog Produk, Bahan Baku, and Daftar Stok all point at `/inventory/items`, distinguished only by `?view=`. Daftar Stok has no `?view=` pin, and the old per-child matching treated a no-search child as a match for any URL on that pathname — so navigating to Bahan Baku (`?view=ingredients`) also lit up Daftar Stok. Active-child resolution now runs once across the whole nav tree and picks the most specific match, so a no-search child only highlights when no search-pinned cousin matches.
