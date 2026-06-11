---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix inventory items past the 50th being unreachable on the Katalog Produk / Bahan Baku page.

The list loader fetched only the first 50 items (alphabetical), while search and the view / low-stock / bookable filters all run client-side over the loaded set. A tenant with more than 50 items couldn't see — or search for — anything past #50, including freshly-created items. The loader now fetches the full catalog (500, the input schema's ceiling), so every item renders and is searchable.
