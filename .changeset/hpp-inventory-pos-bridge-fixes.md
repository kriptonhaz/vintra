---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Three connective fixes between HPP, Inventory, and POS.

**Case 1 — "Jual di POS" shortcut on HPP products.** Bridging an HPP product to a sellable POS item used to mean: HPP → manually create matching inventory item → manually find + link the HPP product. Two screens, easy to forget the link. New shopping-bag icon on each HPP products row deeplinks to `/inventory/items?createFromHpp=<productId>` — the create sheet auto-opens with name copied + `linkedHppProductId` set + the HPP-link picker pre-positioned on "Produk jadi". Cashier just picks the unit, sets the price, saves.

**Case 2 — `is_sellable` flag stops ingredients leaking into POS.** Until now `listPOSProducts` returned every inventory item with at least one priced unit, so raw ingredients (Teh Tubruk, Air Mineral) showed up in the cashier grid the moment someone gave them a price for tracking purposes. New `inventory_items.is_sellable` boolean defaults `false` for items linked to an HPP material (with no recipe link) and `true` everywhere else. Inventory form gets a "Tampilkan di POS Kasir" toggle that auto-flips when the user picks the link source, with manual override for the bahan-baku-store edge case.

**Case 3 — pack calculator on the Modal field.** Entering "Modal Rp 0,316 per ml" forces the user to do the gallon-to-ml division by hand — the most common HPP-setup mistake (typing Rp 6.000 because that's the gallon price, not the per-ml). New "Hitung dari kemasan" expand on the Modal field accepts pack price + pack size in base units, derives the per-base price, and fills the field on confirm. Pack metadata isn't persisted — alt-units stay a post-create concern; this is just a math-helper at create time.

Migration `0032_inventory_is_sellable.sql` adds the new column, defaults to `true`, then backfills `false` for ingredient items that don't have explicit pricing rows. Production migration applied via MCP, hash registered.
