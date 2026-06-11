---
"@vintra/web": minor
---

Add the Spanduk AI generation pipeline. `generateSpanduk` server function deducts 6 credits from the shared Konten pool, calls Gemini at the closest supported aspect ratio at 4K (no text in the AI prompt — text is composited server-side for print quality), resizes/crops with `sharp` to the exact print W×H, composites a semi-transparent strip + headline/subhead/phone/address using a bundled Poppins font embedded via SVG `@font-face`, and emits both a high-DPI PNG and a print-ready PDF whose page size matches the spanduk's physical dimensions in centimeters. Adds two new dependencies (`sharp@^0.34`, `pdf-lib@^1.17`) and bundles `Poppins-Bold` + `Poppins-Regular` under `apps/web/src/server/assets/fonts/`.

**Ops note:** New S3 objects are tagged `kind=spanduk`. Existing lifecycle policies are scoped to other tags so spanduks won't be auto-deleted; if a retention policy is desired, add a rule for the `kind=spanduk` tag.
