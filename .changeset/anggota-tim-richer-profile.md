---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Anggota Tim now collects a richer Qasir-style profile: first name, last name, phone, job title (jabatan), and member photo. The list shows an avatar + name + jabatan + phone + role. The form is split into "Data Anggota / Foto Anggota / Hak Akses" sections. PIN-based login + per-cashier outlet picker are intentionally omitted — Vintra uses Supabase email/password auth, and per-staff branch lives on staff_profiles. Hak Akses still uses the existing role dropdown, kept simple per request.
