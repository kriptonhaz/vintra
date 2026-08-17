---
"@vintra/web": minor
"@vintra/db": minor
---

Cascade HPP automatically when a stock-in changes an ingredient's cost.

`products.hpp` is derived data — only ever the sum of what a recipe costs at
today's ingredient prices. Letting it drift is not a missing feature, it is
wrong data: the owner prices a menu against a cost that no longer exists.
Receiving stock at a new cost now recalculates every affected product in the
same transaction.

The cascade is deliberately SILENT on this path. The crew receiving goods are
not the people who set menu prices, and stopping them with a "17 products
affected, 3 below 20% margin" dialog asks a question they cannot answer in the
middle of an unrelated task. The owner is told afterwards by a new
`hpp_cascaded` notification carrying the count, the average movement, and how
many products fell below a healthy margin. Selling prices are never touched.

Adds `hpp_price_history` (migration 0144), an append-only ledger of every
automatic movement with its reason and triggering material, so "kenapa HPP naik
bulan ini?" stays answerable. Only products whose HPP actually moved are
written, so the ledger records movements rather than form saves.

The cascade takes the caller's transaction, which is a correctness requirement
rather than a detail: reading through the root client would see the ingredient
price as it was BEFORE the enclosing transaction's update and write a
confidently wrong number. Verified against production inside a rolled-back
transaction — doubling a material's price mid-transaction moved the computed
HPP from 25.308,57 to 27.558,57 while the root client still saw the old price.

Products inside a recipe cycle are left untouched and reported, not guessed.
