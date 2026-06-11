-- Optional usage cap on referral codes. Null = unlimited (the existing
-- behavior for every row pre-migration). When set, the attribution
-- writer stops creating new attributions once the count reaches this
-- number, and the public validator returns the code as exhausted so
-- the register form can show "kode sudah penuh" to a would-be referee.
--
-- Index on (code_id) over referral_attributions already exists via
-- the FK; the count check that gates attribution reads that index.

ALTER TABLE "referral_codes"
  ADD COLUMN IF NOT EXISTS "max_claims" integer;
