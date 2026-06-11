---
"@vintra/web": minor
---

Merge Konten Promosi and Logo AI under one "Konten & Branding" parent in the sidebar with three children: Galeri, Buat Konten Promosi, Buat Logo AI. The new combined gallery at `/studio` lists generations from both `konten_images` and `logos` with a kind badge on every card and a Semua / Konten / Logo filter. The lightbox auto-switches to a before/after toggle for Konten rows and stays single-image for Logo rows. Old `/konten` and `/logo` standalone galleries now redirect to `/studio`. Generate URLs (`/konten/generate`, `/logo/generate`) and the admin CMS pages (`/admin/konten`, `/admin/logo`) are untouched.
