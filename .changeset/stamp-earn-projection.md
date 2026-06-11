---
"@vintra/web": minor
---

Let customers redeem a stamp they earn on the same purchase.

The server has always processed earn-then-redeem inside one createSale transaction, so a card filled by the very sale on the till could be redeemed immediately. But the cashier UI gated the "Tukar gratis" button on the customer's stored balance only, so a customer whose card fills on this purchase would be told to come back next time — even though the engine would have allowed the redemption.

The cashier now projects per-program earn from the current cart (mirroring the server's precedence: product → product_set → category, floor of qty, skipping 100%-off reward lines) and gates the button on `currentStamps + projectedEarn >= stampsRequired`. The strip shows "+N dari belanja ini" alongside the progress so the cashier can see the projection. `getCustomerStampCards` now returns `setItemIds` per program so the client can resolve product_set matches without an extra round-trip. Server-side validation still backstops the math.
