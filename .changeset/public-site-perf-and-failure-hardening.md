---
"@vintra/web": patch
---

JUR-189 / #199 — Public site perf + failure-handling hardening:

- **Failure handling parity for `/q/$slug`.** The Host-aware index route already caught downstream failures and rendered a branded "Situs sedang gangguan" page; the parallel `/q/$slug` route still threw a raw 500 because its loader had no try/catch. Extracted the error component into a shared `PublicSiteError` module and wired it into both routes — a Supabase blip or asset-signing hiccup now degrades to the same calm fallback regardless of which entry point visitors hit, with `robots: noindex,nofollow` so search engines don't cache the failure state.
- **`decoding="async"` on every situs image.** Hero already had it; gallery / promos / stamps / services grid were missing it. Parallel image decoding shaves render-blocking off slower devices without changing layout (every image already sits in an `aspect-*` container, so CLS is already 0).
- **Bundle audit (informational, no change).** Public route chunks are properly code-split per-route; Leaflet is dynamically imported only on the Maps section; POS / inventory / admin chunks never load on the public site. The remaining 1.28 MB shared `main` chunk (React + Router + react-query) is the cap on further wins without restructuring the vendor split — out of scope here.
