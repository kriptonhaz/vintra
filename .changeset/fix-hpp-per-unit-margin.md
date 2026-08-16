---
"@vintra/web": patch
---

Fix HPP margin/profit for multi-yield recipes. The stored `hpp` is the cost
to produce one full batch (`productionQty` units), but margin and profit were
compared against the per-unit selling price, making any recipe that yields more
than one unit read as a heavy loss (e.g. 42 cookies costing Rp 13.308 vs a
Rp 5.000 unit price → −166% margin). Margin/profit now use the per-unit cost
(batch cost ÷ production output) consistently across the calculator (steps 3 &
4), the product list, the detail dialog, and the server-side HPP calculation.
