---
"@vintra/web": minor
"@vintra/db": minor
---

Let an item be sold without carrying stock (konsinyasi).

Consignment is ordinary retail here — the supplier owns the goods, the merchant
pays only for what sells, and nobody counts a balance — but the model had no way
to say so. A plain item with no balance row reads as "0 in stock", and the
`createSale` stock guard refuses the line outright, so a consignment item could
be catalogued and priced yet never rung up. The only workaround was to invent a
stock figure and keep topping it up, putting a number in the ledger that was
never counted.

`inventory_items.track_stock` (default true, so nothing existing changes) now
marks these. When off: the POS guard skips the item, the sale writes no
stock-out movement, the cashier tile shows "Titipan" instead of a count and
never says "Habis", the inventory list shows "Titipan / stok pemasok" instead of
a quantity, low-stock warnings are suppressed, and the item drops out of the
stock-in and opname forms. Cost still rides on the sale line, so margin
reporting is unaffected.

This is deliberately separate from the existing no-balance case: recipe-backed
items are made to order from ingredients this business does own, consignment
items are stocked by someone else. Both bypass the guard; only one deducts
anything. Turning tracking off keeps any existing balance rows rather than
deleting them, so switching back on restores the old count.
