-- JUR (UI/UX review) — add optional photo to HPP products.
--
-- Mirrors the inventory_items.photo_key pattern: stores a Supabase
-- Storage object key, signed URLs are minted on read. Nullable so
-- existing rows + new HPPs created without a photo Just Work.
--
-- Display fallback (read-time only, never copied at write time): when
-- products.photo_key IS NULL the /hpp table falls back to the photo_key
-- of the inventory_items row that links back via linked_hpp_product_id.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "photo_key" text;
