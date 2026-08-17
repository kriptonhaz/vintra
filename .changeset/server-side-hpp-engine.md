---
"@vintra/web": minor
---

Move the HPP calculation to a single server-side engine.

The real formula lived in the calculator page while `calculateProductHpp`
computed its own weaker version, which is why the screen and the stored
`products.hpp` could disagree about the same recipe. `server/lib/hpp-engine.ts`
is that formula moved server-side and made total: it walks material and
sub-recipe rows together in topological order, so a parent is only costed once
every sub-recipe under it is final, and it reports circular recipes instead of
guessing a number.

It also removes a limitation the earlier fix could not. Summing a product's
rows locally has to price a sub-recipe from the sub-product's STORED `hpp`,
which may itself be stale — a parent then inherits a number nobody recomputed.
The engine rebuilds the whole tenant graph from live material prices in one
pass.

The engine reproduces the calculator's arithmetic deliberately rather than
tidying it, since that screen is what owners price their menu from — including
the divide-by-one fallback for a sub-recipe with no batch yield, and treating a
missing material price as 0. One deliberate divergence from JuraganQu's
equivalent engine: margin is computed against the PER-UNIT cost, because
`products.hpp` stores a full batch while `sellingPrice` is per unit, and
comparing them directly reports a multi-yield recipe as a heavy loss.

Verified against production with `bun run verify:hpp`: the engine reproduces
every stored HPP across all 7 tenants exactly, with no cycles. 16 unit tests
cover topological ordering, cycles, self-references, out-of-set edges, repeated
sub-product rows, precision and margin clamping.

The pure computation and its database loader are separate modules, so the
formula has no database import and its tests need no driver.
