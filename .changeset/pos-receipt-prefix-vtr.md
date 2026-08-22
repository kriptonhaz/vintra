---
"@vintra/web": patch
---

Number receipts `VTR-`, not `JQU-`.

The sale-number generator carried the prefix of JuraganQu, the codebase Vintra
was forked from, so every Vintra merchant handed their customers a receipt
branded with another product's name. Pulled out into a named constant with the
history written down, so the next reader knows it is a brand and not an opaque
three-letter code.

Renumbers nothing: `pos_sale_counters` keeps the sequence, so receipts already
issued keep their old prefix and only new sales carry `VTR`.
