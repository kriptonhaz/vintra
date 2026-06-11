-- Optional banner image per stamp program. Stored under
-- `<tenantId>/stamps/<programId>.<ext>` with S3 tag `kind=stamp` so
-- the wa-media 24h lifecycle doesn't sweep it. Surfaced in admin
-- + cashier + the situs Stamp section.
ALTER TABLE loyalty_stamp_programs
  ADD COLUMN IF NOT EXISTS image_key text;
