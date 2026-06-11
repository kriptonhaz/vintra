---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

De-dupe the staff/member name field. `tenant_members.{firstName,lastName}` is now the single source of truth — `staff_profiles.full_name` is dropped (migration 0035 splits the legacy value at the first space and backfills the member side first). The Pegawai Absensi list, attendance records, daily summaries, and current-user displayName all derive `fullName` via the join. Anggota Tim grows a "Staf Absensi" badge for members with a profile, and a "Buat profil staf →" CTA for those without; clicking it deep-links into /attendance/staff?newForMember=… which pre-fills the create sheet and skips the Supabase invite. Sidebar label renamed "Staf" → "Pegawai Absensi" so the distinction from /settings/members is obvious.
