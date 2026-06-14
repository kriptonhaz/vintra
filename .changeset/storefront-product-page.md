---
"@vintra/web": minor
---

Storefront multi-page URLs — Phase 1: real product detail pages. Adds host-aware public route `<slug>.vintra.my.id/product/$id` (resolves the tenant from the Host header; redirects to the store root on the apex/unknown host), themed by the tenant's brand color with per-product SEO head + OG tags. The page shows the photo, description, variant picker, quantity, and add-to-cart (writes to the same per-slug cart the situs drawer uses). Storefront product cards now link to it on the live site. New server fns: `getStorefrontContext` (shared host resolver for upcoming /cart, /checkout, /track pages) and `getStorefrontProduct`.
