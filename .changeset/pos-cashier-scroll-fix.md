---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix `/pos/cashier` product grid not scrolling when many items present.

The cashier page has a fixed outer height (`h-[calc(100vh-8rem)]`) and `CashierProductGrid` opens with `flex h-full flex-col` expecting that height to flow down. But the two intermediate wrappers (`<div className={'flex-1 lg:basis-[60%]'}>` and its child `<div className="flex w-full flex-col">`) lacked `min-h-0` and `h-full` / `flex-col`, so flexbox children defaulted to their content size instead of shrinking to fit. The grid grew taller than the viewport; the internal `overflow-y-auto` had no bounded parent, so no scrollbar appeared.

Added `min-h-0 flex-col` to both intermediate wrappers (and the matching cart wrapper for symmetry), and `h-full w-full min-h-0 flex-col` to the direct parents of `CashierProductGrid` and `CashierCart`. Same fix applied to the cart side so long line lists scroll independently of the product grid.

Pre-existing bug, surfaced after JUR-182 increased the typical item count in test tenants.
