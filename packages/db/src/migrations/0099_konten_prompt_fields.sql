-- Konten configurable prompt fields — folds the hardcoded "gaya" presets
-- into an admin-managed field/option system, adds a prompt template, and
-- snapshots the chosen selections onto each generation.
--
-- konten_prompt_fields    — admin-defined selectors (style, target market…)
-- konten_prompt_field_options — predefined choices, each with a prompt fragment
-- konten_settings         — single-row platform settings (the prompt template)
--
-- konten_images: `preset` is replaced by `selections` (a frozen JSONB
-- snapshot) + `prompt_mode` ('guided' | 'custom').
--
-- Seeds a starter config: a required Style field (the four old presets),
-- plus optional Target Market / Platform fields that allow custom input.
--
-- Rollback:
--   ALTER TABLE "konten_images" ADD COLUMN "preset" text;
--   ALTER TABLE "konten_images" DROP COLUMN "selections";
--   ALTER TABLE "konten_images" DROP COLUMN "prompt_mode";
--   DROP TABLE "konten_prompt_field_options";
--   DROP TABLE "konten_prompt_fields";
--   DROP TABLE "konten_settings";

CREATE TABLE IF NOT EXISTS "konten_prompt_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"allows_custom" boolean DEFAULT false NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "konten_prompt_field_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"label" text NOT NULL,
	"prompt_fragment" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "konten_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_template" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "konten_prompt_field_options" ADD CONSTRAINT "konten_prompt_field_options_field_id_konten_prompt_fields_id_fk"
    FOREIGN KEY ("field_id") REFERENCES "konten_prompt_fields"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "konten_prompt_fields_key_uniq" ON "konten_prompt_fields" ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "konten_prompt_field_options_field_idx" ON "konten_prompt_field_options" ("field_id");
--> statement-breakpoint
ALTER TABLE "konten_images" ADD COLUMN IF NOT EXISTS "prompt_mode" text DEFAULT 'guided' NOT NULL;
--> statement-breakpoint
ALTER TABLE "konten_images" ADD COLUMN IF NOT EXISTS "selections" jsonb;
--> statement-breakpoint
ALTER TABLE "konten_images" DROP COLUMN IF EXISTS "preset";
--> statement-breakpoint
-- ── Seed: prompt fields ───────────────────────────────────────────────
INSERT INTO "konten_prompt_fields" ("key", "label", "help_text", "allows_custom", "required", "sort_order")
VALUES
  ('style', 'Gaya Penyempurnaan', 'Cara utama AI menyempurnakan foto produk.', false, true, 0),
  ('target_market', 'Target Pasar', 'Audiens yang ingin kamu sasar.', true, false, 1),
  ('target_platform', 'Platform', 'Platform tempat konten akan dipakai.', true, false, 2)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "konten_prompt_field_options" ("field_id", "label", "prompt_fragment", "sort_order")
SELECT id, 'Background Putih',
  'Place this exact product on a clean, seamless pure white studio background. Professional e-commerce product photography, soft even lighting, sharp focus, subtle natural shadow under the product. Do not alter the product itself.',
  0 FROM "konten_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Pencahayaan Studio',
  'Relight this product photo with professional studio lighting — a soft key light, gentle fill, and subtle highlights. Improve clarity, white balance and sharpness. Keep the product and composition unchanged.',
  1 FROM "konten_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Suasana Lifestyle',
  'Place this exact product into a warm, inviting lifestyle scene with natural light and tasteful, relevant props. Photorealistic and appetizing. Keep the product itself unchanged.',
  2 FROM "konten_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Hapus Background',
  'Cleanly cut out the product and place it on a pure white background. Remove all original background clutter. Keep only the product, with crisp edges and a subtle shadow.',
  3 FROM "konten_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Anak Muda / Gen Z',
  'Sesuaikan gaya visual agar menarik bagi konsumen anak muda dan Gen Z yang aktif di media sosial.',
  0 FROM "konten_prompt_fields" WHERE "key" = 'target_market'
UNION ALL SELECT id, 'Pekerja Kantoran',
  'Sesuaikan gaya visual agar terasa rapi dan profesional untuk kalangan pekerja kantoran.',
  1 FROM "konten_prompt_fields" WHERE "key" = 'target_market'
UNION ALL SELECT id, 'Keluarga & Rumah Tangga',
  'Sesuaikan gaya visual agar hangat dan ramah untuk keluarga dan ibu rumah tangga.',
  2 FROM "konten_prompt_fields" WHERE "key" = 'target_market'
UNION ALL SELECT id, 'Pelanggan Premium',
  'Sesuaikan gaya visual agar terasa mewah dan eksklusif untuk pelanggan premium.',
  3 FROM "konten_prompt_fields" WHERE "key" = 'target_market'
UNION ALL SELECT id, 'Instagram Post',
  'Optimalkan komposisi untuk dipajang sebagai post feed Instagram.',
  0 FROM "konten_prompt_fields" WHERE "key" = 'target_platform'
UNION ALL SELECT id, 'Instagram Story / Reel',
  'Optimalkan komposisi untuk Instagram Story atau Reel dengan ruang kosong yang cukup.',
  1 FROM "konten_prompt_fields" WHERE "key" = 'target_platform'
UNION ALL SELECT id, 'WhatsApp',
  'Optimalkan komposisi agar jelas terlihat sebagai gambar katalog WhatsApp.',
  2 FROM "konten_prompt_fields" WHERE "key" = 'target_platform'
UNION ALL SELECT id, 'Facebook / Marketplace',
  'Optimalkan komposisi untuk listing di Facebook atau Marketplace.',
  3 FROM "konten_prompt_fields" WHERE "key" = 'target_platform';
--> statement-breakpoint
INSERT INTO "konten_settings" ("prompt_template")
SELECT '{style}

{target_market}
{target_platform}'
WHERE NOT EXISTS (SELECT 1 FROM "konten_settings");
