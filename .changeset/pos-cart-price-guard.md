---
"@vintra/web": minor
"@vintra/shared": minor
---

Refuse to ring a POS sale at a price the cashier never saw.

`createSale` resolves each line's price from the price list at checkout and has
always ignored whatever the client sent — right for tamper-resistance, but it
means a price edited mid-shift silently reprices a cart that is already open.
The cashier says "tujuh belas ribu" out loud and the receipt prints something
else.

`createSale` now compares the price the cart displayed against the one it
resolves and refuses the sale — before the stock check and before any write, so
there is nothing to unwind — naming each item with its old and new price.
Ad-hoc lines are exempt: their price is the cashier's own figure.

The cashier re-prices its lines in place rather than clearing the cart or
reloading, so nothing already rung up is lost and the next Bayar press is a
deliberate confirmation of what is now on screen. Item ids are chunked against
the server's 50-id cap, because truncating would leave exactly the stale prices
this is meant to fix and loop the cashier on the same refusal.

Both sides import `POS_PRICE_CHANGED_ERROR_PREFIX` from `@vintra/shared`, so
they can only drift apart deliberately, not by someone rewording a sentence.

Ported from JuraganQu (da4e695).
