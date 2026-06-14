---
"@vintra/web": minor
---

Storefront multi-page URLs — Phase 3: real order tracking page. The situs "Lacak pesanan" link now routes to `<slug>.vintra.my.id/track` (host-resolved, themed) instead of opening an in-situs modal. Customers look up an order by number + WhatsApp; the result view (status, items, total, courier/resi, cancel reason) is shared with the former modal via the extracted `TrackResultView`. Completes the multi-page storefront: product → cart → checkout → track.
