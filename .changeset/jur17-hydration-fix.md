---
"@vintra/web": patch
---

Fix React #418 hydration error on /pos/settings and /pos/promos (JUR-17).

Root cause was a Bun/V8 divergence in `Intl.NumberFormat` when used with `style: 'currency', currency: 'IDR'`: Bun's JavaScriptCore drops the NBSP between "Rp" and the digits ("Rp1.000"), while Node V8 + browsers keep it ("Rp 1.000") — so SSR and CSR produced different DOM. `formatRupiah` is now built on `style: 'decimal'` (which both runtimes format identically) with a literal "Rp " prefix; the loyalty preview's raw `.toLocaleString('id-ID')` calls move to a new `formatNumberId` helper that goes through the same deterministic formatter.

Promo dates additionally suffered a timezone mismatch (`toLocaleDateString('id-ID')` without `timeZone` renders one day off near UTC midnight on the EC2 server). Replaced with a new `formatDateJakarta(input, style)` helper that pins `timeZone: 'Asia/Jakarta'` so SSR and CSR agree.
