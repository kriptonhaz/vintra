---
"@vintra/web": patch
---

Two JUR-6 fixes:

**1. "Tambah Pelanggan" failed with `ON CONFLICT` error.**

The `customers_tenant_phone_unique` index is PARTIAL (`WHERE phone IS NOT NULL` — anonymous walk-ins don't collide). Postgres requires `ON CONFLICT (...)` to declare the same predicate when targeting a partial index, otherwise it can't match and throws "there is no unique or exclusion constraint matching the ON CONFLICT specification".

Drizzle's `onConflictDoUpdate` accepts a `targetWhere: SQL` parameter for exactly this case. Added `targetWhere: sql\`${customers.phone} IS NOT NULL\`` to both upsert sites:
- `upsertCustomer` (admin manual create + cashier "Pelanggan baru" path)
- `createSale`'s auto-customer-attach (when ringing a sale with name + phone provided)

**2. Cart panel layout — line content was being clipped by the customer-capture + discount blocks.**

The cart panel had a fixed-bottom block holding customer + discount + subtotal + total + Bayar button. With Komplit's customer-capture + sale-discount features both active, that bottom block consumed ~370px of vertical space. The `flex-1 overflow-y-auto` lines area was squeezed to whatever was left — on shorter cart panels, this clipped the cart-line's qty stepper + price detail rows, making the customer card appear to "overlap" the line above (it was actually rendering fully but the line content was hidden behind the lines-area's hard scroll boundary).

Restructured: header sticks to top, **everything else scrolls** (lines + customer + discount + subtotal + tax breakdown), and only the **TOTAL + Bayar button** stay sticky at the footer. The cashier always sees the headline number + the action button regardless of scroll position. Customer + discount blocks come into view naturally as the cashier scrolls past the items.

Also added `min-h-0` to the cart's outer flex column — required for the inner `flex-1 overflow-y-auto` to actually trigger scrolling (without it, flex items refuse to shrink below content height and overflow escapes the container).