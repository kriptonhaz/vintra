-- Optional promo image — referenced by `tenant_promotions.image_key`
-- as an S3 object key. Uploaded by the POS promo CRUD form, displayed
-- in the admin list, and surfaced to the WhatsApp AI's promo RAG so
-- the api can attach the image to the AI's text reply on outbound.
--
-- Idempotent.

ALTER TABLE tenant_promotions
  ADD COLUMN IF NOT EXISTS image_key text;
