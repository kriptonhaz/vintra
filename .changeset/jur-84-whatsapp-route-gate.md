---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Gate the entire `/whatsapp/*` route tree at the layout level (JUR-84
follow-up): users without `whatsapp.read` now bounce to `/dashboard`
on direct URL access instead of seeing an empty list with a working
"Tambah WhatsApp" button. Read-only viewers (supervisor role) keep
list access but no longer see the add/delete affordances.
