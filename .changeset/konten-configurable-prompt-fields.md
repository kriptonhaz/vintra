---
"@vintra/web": minor
"@vintra/db": minor
---

Make Konten prompt building configurable. The hardcoded enhancement presets are replaced by admin-managed prompt fields and options (`konten_prompt_fields` / `konten_prompt_field_options`) plus an editable prompt template — managed from a new `/admin/konten` page. Fields can allow free-text custom values. The generate page renders the fields dynamically and adds a custom-prompt mode that bypasses the fields and template entirely. Each generation snapshots its selections onto `konten_images`, so the gallery shows the chosen options as chips even after the admin edits the fields. Migration 0099 seeds a starter Style / Target Market / Platform config.
