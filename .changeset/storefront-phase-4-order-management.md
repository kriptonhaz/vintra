---
"@vintra/web": minor
---

Toko Online (storefront) — Phase 4: admin order management. Adds the online order inbox under Situs (`/site/orders`, Komplit-gated) with a status filter and a slide-over detail panel. Owners can confirm payment (deducts fulfillment-branch stock via inventory movements, mirroring the POS sale path and skipping recipe-backed items), mark orders shipped (with courier + resi) or ready for pickup, complete them, or cancel (restocking if already confirmed). Server functions enforce the lifecycle and tenant scoping.
