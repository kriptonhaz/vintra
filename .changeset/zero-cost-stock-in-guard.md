---
"@vintra/web": patch
---

Stop a zero-cost stock movement from wiping an ingredient's price.

`unitCost` is optional on a movement and validated as `min(0)`, so a stock
opname submitted with the cost field left at its default arrived as 0 —
indistinguishable from "this really was free". The HPP uplink took it as a real
price, overwrote the material's `pricePerUnit` with zero, and from there that
ingredient's cost silently vanished from every recipe using it. The item's own
`costPrice` was overwritten the same way, taking the margin figures with it.

A movement now only re-costs the ingredient and the item's cost basis when it
states a cost above zero. Keeping the previous cost when none is given is the
recoverable direction to be wrong in. The movement ledger still records exactly
what was entered, zero included.

Ported from JuraganQu, where this fired twice in production — "Susu Putih"
(Rp 9/ml) and "Sirup Jambu", the latter repaired by hand two days later. Vintra
runs the same code, so it had the same exposure.
