---
"@vintra/web": patch
---

Scope the POS price-changed guard to the tier the client actually quoted, and
recompute HPP once per tenant instead of once per product.

Two defects found reviewing the same day's work:

**The price guard would have blocked every mobile bulk sale.** It compared the
client's `unitPrice` against the tier the server resolved. The mobile cart
stores no tiers, so a line's price stays frozen at the tier that applied when
it was created — raise the quantity past a bulk threshold and the client still
quotes retail while the server resolves bulk. That is not a price change, but
the guard refused it, and mobile has no way to re-price. The guard now applies
only when the client names the tier it quoted (`quotedTierMinQty`) AND the
server resolved that same tier, which is the only case that unambiguously
means the price list was edited. A client that sends no tier marker behaves
exactly as before the guard existed. The rule moved to `isPriceChanged` in
`server/lib/pos-price-guard.ts` and is covered by tests, including the mobile
shape.

**`recalculateAllHpp` became quadratic.** It loops over products calling
`calculateProductHpp`, which was fine when that ran one BOM query but now
builds the whole tenant graph — so the loop rebuilt it per product: three
round trips and a full traversal each, roughly 372 queries at 124 products,
into server-function timeout territory. It now computes the graph once and
writes every product from that single pass, and reports products left
untouched because they sit in a recipe cycle.
