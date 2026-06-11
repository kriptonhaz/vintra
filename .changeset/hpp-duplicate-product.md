---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Add "Duplikat" action to HPP product detail dialog.

Clicking the new button in the product detail modal clones the product header + every BOM row in a single transaction, names the clone with the next free "Copy N" suffix across the tenant's catalog ("Teh Original" → "Teh Original Copy 1" → "Teh Original Copy 2", and duplicating "Teh Original Copy 1" still yields "Teh Original Copy 2" — the suffix detector strips an existing "Copy N" tail before allocating the next number), and navigates the user straight into the calculator pre-filled with the clone so they can edit immediately. photoKey is shared with the original (S3 objects are immutable, both rows safely reference the same image).
