---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-15 post-test fix: the prep-batch sheet was only invalidating
`['prep-batches', ...]` after a successful record, but the inventory
page's `PrepBatchPanel` reads from `['prep-status', ...]` — different
key prefix — so its inline "Siap dijual" counter stayed at 0 until a
manual refresh. Found via Playwright smoke test on Mantra Maker.

Invalidating both prefixes plus `['pos', 'products']` now so every
Siap surface refreshes the moment a prep batch lands.
