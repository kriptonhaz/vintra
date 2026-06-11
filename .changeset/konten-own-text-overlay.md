---
"@vintra/web": minor
"@vintra/db": minor
---

Add the "Pakai teks saya" option to Konten's Teks pada Gambar field. When picked, the generate page reveals three free-text inputs — Judul, Sub-judul, and CTA — whose values are substituted into the prompt fragment so the AI renders exactly the user's copy (placement is decided by the model). Each generation snapshots the typed values so the gallery lightbox shows them too.

The underlying mechanism is generic: `konten_prompt_field_options` now has a `text_inputs` JSONB column declaring per-option free-text inputs (key, label, placeholder, multiline, maxLength), and the option's `prompt_fragment` may reference them with `{key}` tokens. Migration 0100 adds the column and seeds the new option.
