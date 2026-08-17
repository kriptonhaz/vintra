---
"@vintra/web": patch
"@vintra/db": patch
---

Stop copying a recipe's FULL BATCH cost into per-unit fields, which made
profitable products display as losses.

`products.hpp` is the cost of one batch (`production_qty` units), but the paths
that link an HPP product to inventory copied it straight into
`inventory_items.cost_price` — which is per base unit — and into the POS cost
snapshot. On the HaRa Cookies tenant, "Cookies Alpukat" costs Rp 25.308,57 per
40-piece batch, i.e. Rp 632,71 a piece against a Rp 4.000 price. The HPP screen
showed that correctly at an 84,2% margin while the inventory item read "Modal
Rp 25.308,57 / Pieces" with a red "Rugi" badge, and every POS sale recorded a
40x cost against its revenue.

Fixed at every site that turns a linked product into a per-unit cost: the "Jual
di POS" bulk create, the POS `hppAtSale` snapshot, and the two queries feeding
the item form. Those queries now ship a precomputed `hppPerUnit` alongside the
raw batch `hpp`, so no caller has to remember to divide — forgetting is exactly
what caused this. The web and mobile import pickers show the per-unit figure
too, since that is what becomes the item's Modal; they previously showed the
batch cost, so the number changed the moment a product was imported.

Migration 0145 repairs rows already written. It is deliberately narrow: only
items whose stored cost still equals the product's batch HPP are touched, since
that equality is the signature of the bug — anyone who has since typed their own
cost is left alone. Single-yield recipes are excluded, having nothing to repair.
Applied to production, correcting 6 items from Rp 25.308,57 to Rp 632,71.
