---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-10 service-mode: recipe-backed inventory items have no own stock balance.

Closing the loop on the JUR-10 entry-point landed earlier — once a tenant linked an inventory item to an HPP product, the model still treated it like a stocked item. Selling 5 cups of "Teh Original" wrote 5 stock-out movements against the item's own balance (pushing it negative), even though the BOM walker was already deducting Gula / Air / Teh Tubruk from the ingredient items. Cashier grid showed "Stok: 0 / Habis" for items that should have been "Auto".

This pass treats any inventory item with `linkedHppProductId` as **service-mode**:

- **`createSale`** skips the item-level out movement for service items (BOM walker still runs).
- **`voidSale`** correspondingly skips the compensating in movement (no out → no in).
- **`listPOSProducts`** surfaces a `recipeBacked` flag.
- **Cashier grid** shows "Auto" badge instead of "Stok: N", drops the out-of-stock disable, drops the qty cap.
- **`recordMovement`** rejects manual stock-in/out/adjust for service items with a friendly Indonesian error pointing the cashier at the bahan instead. POS-driven movements with `referenceType='pos_sale'` still allowed.
- **Stock-movement form** filters service items out of the picker upstream so the user never gets the rejection toast.
- **Inventory items list** shows a "Resep" pill + "Auto dari bahan" right-rail instead of a stock count.

Filed [JUR-15](https://linear.app/vintra/issue/JUR-15) for batch-prep mode (the alternative model where ingredients are deducted at prep time and the cashier sees "Siap: N"). Service-mode is correct for the dominant cafe/warung flow; batch-prep is for kitchens that bulk-produce in the morning.
