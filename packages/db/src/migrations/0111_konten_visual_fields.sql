-- Add three "visual composition" fields to the Konten generator so
-- results actually look different from one another.
--
-- Existing fields (target_market, target_platform, objective,
-- text_overlay) describe WHO + WHY + WHERE the image is for. They
-- don't tell Gemini HOW to compose the shot, so every output defaults
-- to the same baseline "studio product photo." Adding camera angle,
-- lighting, and background scene gives the user the three biggest
-- single levers for visual variety.
--
-- All three are optional (required=false) and accept custom values
-- so power users can write their own.
--
-- Also adds a UNIQUE index on options (field_id, label) — same
-- pattern as spanduk_prompt_field_options got in migration 0110.
-- Prevents the seed-running-twice incident from recurring.
--
-- Rollback:
--   DELETE FROM konten_prompt_field_options
--    WHERE field_id IN (
--      SELECT id FROM konten_prompt_fields
--       WHERE key IN ('camera_angle', 'lighting', 'background_scene')
--    );
--   DELETE FROM konten_prompt_fields
--    WHERE key IN ('camera_angle', 'lighting', 'background_scene');
--   DROP INDEX IF EXISTS konten_prompt_field_options_field_label_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS "konten_prompt_field_options_field_label_uniq"
  ON "konten_prompt_field_options" ("field_id", "label");

INSERT INTO "konten_prompt_fields"
  ("key", "label", "help_text", "allows_custom", "required", "sort_order")
VALUES
  ('camera_angle',     'Sudut Pengambilan',  'Posisi kamera saat memotret produk.',   true, false, 5),
  ('lighting',         'Suasana Cahaya',     'Mood pencahayaan untuk foto produk.',   true, false, 6),
  ('background_scene', 'Latar Belakang',     'Latar tempat produk diletakkan.',       true, false, 7)
ON CONFLICT ("key") DO NOTHING;

-- ── camera_angle options ─────────────────────────────────────────────
INSERT INTO "konten_prompt_field_options" ("field_id", "label", "prompt_fragment", "sort_order")
SELECT id, 'Close-up Detail',
  'Use an extreme close-up shot showing the product''s texture and detail with a shallow depth of field, foreground in sharp focus and background softly blurred.',
  0 FROM "konten_prompt_fields" WHERE "key" = 'camera_angle'
UNION ALL SELECT id, 'Flat Lay (dari atas)',
  'Use a top-down flat-lay composition photographed from directly above, the product centered on the surface with tasteful surrounding props.',
  1 FROM "konten_prompt_fields" WHERE "key" = 'camera_angle'
UNION ALL SELECT id, 'Hero Angle 45°',
  'Shoot from a 45-degree hero angle — classic e-commerce product photography that shows both the top and side of the product clearly.',
  2 FROM "konten_prompt_fields" WHERE "key" = 'camera_angle'
UNION ALL SELECT id, 'Sejajar Mata',
  'Use an eye-level perspective, as if the customer is looking straight at the product on a counter.',
  3 FROM "konten_prompt_fields" WHERE "key" = 'camera_angle'
UNION ALL SELECT id, 'Wide / Suasana',
  'Use a wider environmental shot showing the product within its setting, giving room for context around it.',
  4 FROM "konten_prompt_fields" WHERE "key" = 'camera_angle'
ON CONFLICT ("field_id", "label") DO NOTHING;

-- ── lighting options ─────────────────────────────────────────────────
INSERT INTO "konten_prompt_field_options" ("field_id", "label", "prompt_fragment", "sort_order")
SELECT id, 'Cahaya Natural Siang',
  'Light the scene with bright, soft natural daylight as if coming through a large window — clean shadows, true colors.',
  0 FROM "konten_prompt_fields" WHERE "key" = 'lighting'
UNION ALL SELECT id, 'Sore Keemasan',
  'Use warm golden-hour lighting with long soft shadows and a touch of orange-amber tint, evoking a late-afternoon mood.',
  1 FROM "konten_prompt_fields" WHERE "key" = 'lighting'
UNION ALL SELECT id, 'Studio Bersih',
  'Apply clean, even studio lighting with a soft key light and gentle fill — no harsh shadows, balanced exposure.',
  2 FROM "konten_prompt_fields" WHERE "key" = 'lighting'
UNION ALL SELECT id, 'Dramatis Gelap',
  'Use dramatic moody lighting — a single directional key light against a dark background, strong contrast, deep shadows.',
  3 FROM "konten_prompt_fields" WHERE "key" = 'lighting'
UNION ALL SELECT id, 'Neon Modern',
  'Light the scene with vibrant modern neon accents in pink, cyan and purple — contemporary urban aesthetic.',
  4 FROM "konten_prompt_fields" WHERE "key" = 'lighting'
ON CONFLICT ("field_id", "label") DO NOTHING;

-- ── background_scene options ────────────────────────────────────────
INSERT INTO "konten_prompt_field_options" ("field_id", "label", "prompt_fragment", "sort_order")
SELECT id, 'Polos Minimalis',
  'Use a clean minimalist solid-color background with lots of negative space around the product.',
  0 FROM "konten_prompt_fields" WHERE "key" = 'background_scene'
UNION ALL SELECT id, 'Meja Kayu / Marmer',
  'Place the product on a natural wooden or marble surface styled like a modern café tabletop.',
  1 FROM "konten_prompt_fields" WHERE "key" = 'background_scene'
UNION ALL SELECT id, 'Suasana Asli (Kafe / Toko)',
  'Place the product in a realistic in-context scene — a café table, kitchen counter or store shelf — that feels like the natural environment for the product.',
  2 FROM "konten_prompt_fields" WHERE "key" = 'background_scene'
UNION ALL SELECT id, 'Outdoor / Alam',
  'Place the product in an outdoor natural setting with greenery, warm sunlight and a sense of open air.',
  3 FROM "konten_prompt_fields" WHERE "key" = 'background_scene'
UNION ALL SELECT id, 'Warna Brand Solid',
  'Use a solid bold-colored background from a vibrant brand palette (red, orange, yellow or teal) — strong, eye-catching, social-media ready.',
  4 FROM "konten_prompt_fields" WHERE "key" = 'background_scene'
ON CONFLICT ("field_id", "label") DO NOTHING;
