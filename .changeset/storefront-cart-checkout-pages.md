---
"@vintra/web": minor
---

Storefront multi-page URLs — Phase 2: real cart & checkout pages. The situs floating cart is now a **mini-cart** that links out to `<slug>.vintra.my.id/cart` (full cart page) and `/checkout` (focused checkout: customer/shipping/payment/promo → places the order and shows the confirmation with bank instructions + WhatsApp deep link). Both are host-resolved (redirect to the store root on the apex), themed, and reuse the existing cart/checkout components (extracted as `CartLineList`, `CheckoutView`, `DoneView`, `TotalsRows`, `computeCheckoutTotals`). Product pages now link to `/cart`. The per-slug localStorage cart is shared across the drawer and all pages.
