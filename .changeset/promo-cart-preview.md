---
"@vintra/web": minor
---

Preview auto-promos live in the Kasir cart.

The cashier UI previously only previewed code-promo discounts (typed at the input). Auto-applied promos (`auto_product` / `auto_products` / `auto_category`) only materialised when `createSale` ran — so the cart, the Bayar button, and the PaymentModal all showed the pre-discount total, and the cashier would over-collect cash before the success modal revealed the customer actually paid less.

The cart now fetches `listActivePromotions` and runs the same matching as the server inside `computeCartTotals` (per-line lookup over item + category targets, highest-discount tie-break). The Subtotal row reflects the gross, each applied promo renders its own "Promo · `<name>`" row, and the Bayar button / PaymentModal show the post-promo total. `CartLine` carries `categoryId` so category-scope promos resolve client-side too.
