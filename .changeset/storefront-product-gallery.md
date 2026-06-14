---
"@vintra/web": minor
"@vintra/db": minor
---

Storefront product photo gallery — products can now have multiple images. A new `inventory_item_photos` table holds extra storefront photos per item (the existing cover `photoKey` stays the catalog/POS thumbnail). Admins add/remove gallery photos from the item edit form's "Jual online" section (compressed client-side, 500 KB each, capped at 6). The public product detail page shows a swipeable gallery (cover + extras with thumbnail strip). Item-level — shared across all variants.
