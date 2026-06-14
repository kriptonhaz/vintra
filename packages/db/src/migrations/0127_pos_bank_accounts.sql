-- Bank accounts surfaced when a customer pays via Transfer Bank.
--
-- `pos_settings.bank_accounts` is a JSONB array of
--   {"bankName","accountNumber","accountHolder","active"}
-- replaced wholesale on each settings save (same edit model as the
-- `taxes` stack). Gated by the Toko+ `transfer` payment method — the
-- settings UI only shows the editor when Transfer Bank is active.
--
-- Default '[]' so existing tenants get an empty list, no behavior
-- change. Idempotent (IF NOT EXISTS) in case it was applied
-- out-of-band before the migrator caught up.

ALTER TABLE "pos_settings"
  ADD COLUMN IF NOT EXISTS "bank_accounts" jsonb NOT NULL
  DEFAULT '[]'::jsonb;
