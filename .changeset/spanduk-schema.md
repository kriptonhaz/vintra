---
"@vintra/db": minor
"@vintra/web": patch
---

Add the schema for the Spanduk AI generator: `spanduk_size_presets` (admin-managed catalog seeded with X-banner / spanduk kecil / spanduk besar standard sizes), `spanduk_prompt_fields` + `spanduk_prompt_field_options` (admin-configurable selectors mirroring the Konten/Logo pattern), `spanduk_settings` (singleton prompt template + default 6-credit cost + text-overlay layout JSON), and `spanduks` (tenant generations with both PNG and PDF S3 keys plus the raw AI background). No code paths read these yet — schema-only.
