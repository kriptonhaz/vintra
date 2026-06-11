---
"@vintra/web": minor
"@vintra/db": minor
---

Scaffold the Logo AI module: new `logo_prompt_fields` / `logo_prompt_field_options` / `logo_settings` / `logos` tables, migration 0101 seeding 7 default fields (Nama Bisnis, Jenis Usaha, Gaya Logo, Jenis Logo, Palet Warna, Mood, Tagline) with 27 starter options and a default prompt template, plus a "Logo AI" sidebar entry and placeholder routes at `/logo` and `/logo/generate`. `logo_prompt_fields` introduces a `field_type` discriminator (`select` or `text`) so name and tagline render as plain inputs instead of dropdowns.
