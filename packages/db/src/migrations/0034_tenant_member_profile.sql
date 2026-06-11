-- HR profile fields on tenant_members. Until now the only data we
-- captured per member was email (via Supabase Auth) + role; the
-- "Anggota Tim" form is being expanded to mirror Qasir's richer
-- "Tambah Pegawai" — first name, last name, phone, job title, photo.
--
-- All columns nullable. Existing rows stay valid; the UI shows "—" for
-- missing fields and the inline edit prompts the owner to fill them in.
-- We deliberately do NOT mirror Qasir's PIN field (we use email +
-- password via Supabase Auth, not shared-device PIN) or the per-member
-- outlet picker (lives on staff_profiles.branchId for attendance; POS
-- per-cashier branch is a future scope).

ALTER TABLE "tenant_members"
  ADD COLUMN IF NOT EXISTS "first_name" text,
  ADD COLUMN IF NOT EXISTS "last_name" text,
  ADD COLUMN IF NOT EXISTS "phone" text,
  ADD COLUMN IF NOT EXISTS "job_title" text,
  ADD COLUMN IF NOT EXISTS "photo_key" text;
