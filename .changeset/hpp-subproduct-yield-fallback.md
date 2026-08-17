---
"@vintra/web": patch
---

Match the calculator when a sub-recipe has no batch yield.

The sub-recipe fix shipped earlier today priced a BOM row at 0 when the
sub-product's `productionQty` was missing or zero. `calculate.tsx` — the screen
owners actually price their menu from — divides by 1 in that case, so the row
costs a full batch. The server therefore disagreed with the screen, which is
the exact failure that fix existed to prevent.

`bomRowUnitPrice` now reproduces `calculate.tsx:266-269` verbatim. A missing
stored HPP still yields 0, because nothing is known about that cost yet. A test
runs the screen's own expression against the function over several inputs, so
the two can no longer drift apart silently.
