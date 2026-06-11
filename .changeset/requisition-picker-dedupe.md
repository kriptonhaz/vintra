---
"@vintra/web": patch
---

Stop the Permintaan Stok picker from looking like it has duplicates.

For tenants that ran the HPP → inventory material import, every recipe product ended up with a sellable "POS" twin sharing its name (e.g. "Green Tea" the cup next to "Green Tea" the leaves). The requisition dropdown showed both, even though shipping the recipe-backed product between branches is meaningless (sales deduct ingredients, the product carries no own stock).

- `listItemsForRequisition` excludes items with `linked_hpp_product_id` set (the recipe-backed POS twin) and returns `categoryName` + `baseUnitLabel` so the picker can render a disambiguating sublabel.
- The picker label now stays clean (`name`) with `SKU · base unit · category` as the sublabel, so legitimately same-named raw items stay distinguishable.

Net effect for the reporter's tenant: picker drops from 185 → 76 rows; every duplicate name collapses to its single canonical entry.
