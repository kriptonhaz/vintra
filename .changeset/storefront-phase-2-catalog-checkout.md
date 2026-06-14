---
"@vintra/web": minor
---

Toko Online (storefront) — Phase 2/3: public catalog, cart & checkout. Adds a new "Toko Online" situs section that renders the online-curated product catalog with a floating cart drawer (cart → checkout → confirmation), backed by public server functions: `getStorefront` (catalog + payment/shipping/tax config), `validateStorefrontPromo` (code promos), and `placeOrder` (server-authoritative re-pricing, soft stock check, manual ongkir per zone/flat, tax mirrored from POS, customer upsert, `ORD-YYYY-#####` order numbering). Checkout supports delivery (address + zone ongkir) or pickup, code promos, and produces a wa.me confirmation deep link plus bank-transfer instructions. Stock is not deducted yet (happens on admin confirmation, Phase 4). Cart persists client-side per slug.
