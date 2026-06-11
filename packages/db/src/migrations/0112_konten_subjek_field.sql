-- Konten "Subjek Utama" field — controls whether people appear in the
-- generated content, and how prominently. Lets tenants produce UGC-
-- style content (person + product in the same scene) without forcing
-- Gemini to invent a face: the four tiers escalate from product-only
-- to full-UGC, and the generate form lets the user optionally upload
-- a real person photo (their own, their staff's) that gets fused into
-- the scene alongside the product.
--
-- Why a real-person upload matters: invented AI faces look identical
-- across multiple generations (model bias) and carry deepfake risk.
-- Letting the user supply the face removes both — Pak Budi drinking
-- his own kopi in three different scenes is real UGC; an AI-invented
-- "ramah ibu" face repeated across all posts looks like stock photos
-- pretending to be a real person.
--
-- Schema change: konten_images.person_image_key tracks the optional
-- second source photo so the gallery + delete flow can clean it up.
--
-- Rollback:
--   ALTER TABLE konten_images DROP COLUMN IF EXISTS person_image_key;
--   DELETE FROM konten_prompt_field_options
--    WHERE field_id IN (SELECT id FROM konten_prompt_fields WHERE key = 'subjek');
--   DELETE FROM konten_prompt_fields WHERE key = 'subjek';

ALTER TABLE "konten_images"
  ADD COLUMN IF NOT EXISTS "person_image_key" text;

INSERT INTO "konten_prompt_fields"
  ("key", "label", "help_text", "allows_custom", "required", "sort_order")
VALUES
  ('subjek', 'Subjek Utama',
   'Apakah ingin menampilkan orang dalam konten? Pilih level tampilan wajah.',
   false, false, 8)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "konten_prompt_field_options" ("field_id", "label", "prompt_fragment", "sort_order")
SELECT id, 'Produk Saja',
  'Show only the product in the scene — no people, no hands, no figures of any kind.',
  0 FROM "konten_prompt_fields" WHERE "key" = 'subjek'
UNION ALL SELECT id, 'Tangan / Siluet',
  'Include only hands holding or preparing the product, OR a silhouette of a person from behind. Do NOT show any facial features — keep the focus on the product itself.',
  1 FROM "konten_prompt_fields" WHERE "key" = 'subjek'
UNION ALL SELECT id, 'Suasana Santai',
  'Include people in the scene to add warmth, but keep their faces blurred, out-of-focus, or cropped at the shoulders — the product remains the focal point.',
  2 FROM "konten_prompt_fields" WHERE "key" = 'subjek'
UNION ALL SELECT id, 'Fokus Orang (UGC)',
  'Feature a person prominently enjoying or using the product in an authentic UGC (user-generated content) lifestyle style — the person and product share visual weight.',
  3 FROM "konten_prompt_fields" WHERE "key" = 'subjek'
ON CONFLICT ("field_id", "label") DO NOTHING;
