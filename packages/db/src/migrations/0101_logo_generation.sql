-- Logo AI — admin-configurable text-to-image logo generator.
--
-- Mirrors the Konten configurable-fields system (fields, options,
-- template) but with a `field_type` discriminator so business name and
-- tagline can be plain free-text inputs instead of dropdowns. Generated
-- logos go into the `logos` table (no source image — text-to-image only)
-- and consume the shared Konten credit pool.
--
-- Seeds a starter config: business_name (text, required), business_type,
-- style, logo_type, palette, mood, tagline + a default prompt template.
--
-- Rollback:
--   DROP TABLE "logos";
--   DROP TABLE "logo_prompt_field_options";
--   DROP TABLE "logo_prompt_fields";
--   DROP TABLE "logo_settings";

CREATE TABLE IF NOT EXISTS "logo_prompt_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"field_type" text DEFAULT 'select' NOT NULL,
	"allows_custom" boolean DEFAULT false NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "logo_prompt_field_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"label" text NOT NULL,
	"prompt_fragment" text DEFAULT '' NOT NULL,
	"text_inputs" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "logo_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_template" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "logos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_image_key" text,
	"prompt" text NOT NULL,
	"selections" jsonb,
	"resolution" text,
	"provider_config_id" uuid,
	"model" text,
	"error_message" text,
	"cost_usd" numeric(12, 6),
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "logo_prompt_field_options" ADD CONSTRAINT "logo_prompt_field_options_field_id_logo_prompt_fields_id_fk"
    FOREIGN KEY ("field_id") REFERENCES "logo_prompt_fields"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "logos" ADD CONSTRAINT "logos_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "logo_prompt_fields_key_uniq" ON "logo_prompt_fields" ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logo_prompt_field_options_field_idx" ON "logo_prompt_field_options" ("field_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logos_tenant_time_idx" ON "logos" ("tenant_id","created_at");
--> statement-breakpoint
-- ── Seed: prompt fields ───────────────────────────────────────────────
INSERT INTO "logo_prompt_fields" ("key", "label", "help_text", "field_type", "allows_custom", "required", "sort_order")
VALUES
  ('business_name', 'Nama Bisnis', 'Teks yang akan dirender pada logo.', 'text', false, true, 0),
  ('business_type', 'Jenis Usaha', NULL, 'select', true, false, 1),
  ('style', 'Gaya Logo', NULL, 'select', false, true, 2),
  ('logo_type', 'Jenis Logo', 'Bentuk dasar logo.', 'select', false, true, 3),
  ('palette', 'Palet Warna', NULL, 'select', true, false, 4),
  ('mood', 'Mood', 'Kesan yang ingin disampaikan logo.', 'select', false, false, 5),
  ('tagline', 'Tagline (opsional)', 'Teks pendek di bawah nama bisnis.', 'text', false, false, 6)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "logo_prompt_field_options" ("field_id", "label", "prompt_fragment", "sort_order")
SELECT id, 'Café / Coffee Shop', 'For a café or coffee shop business.', 0 FROM "logo_prompt_fields" WHERE "key" = 'business_type'
UNION ALL SELECT id, 'Fashion / Pakaian', 'For a fashion or apparel brand.', 1 FROM "logo_prompt_fields" WHERE "key" = 'business_type'
UNION ALL SELECT id, 'F&B / Kuliner', 'For a food and beverage business.', 2 FROM "logo_prompt_fields" WHERE "key" = 'business_type'
UNION ALL SELECT id, 'Klinik / Kesehatan', 'For a health clinic or wellness brand.', 3 FROM "logo_prompt_fields" WHERE "key" = 'business_type'
UNION ALL SELECT id, 'Bengkel / Otomotif', 'For an automotive workshop or auto service.', 4 FROM "logo_prompt_fields" WHERE "key" = 'business_type'
UNION ALL SELECT id, 'Kecantikan / Beauty', 'For a beauty or cosmetics brand.', 5 FROM "logo_prompt_fields" WHERE "key" = 'business_type'
UNION ALL SELECT id, 'Minimalis', 'Style: minimalist — clean lines, generous whitespace, simple geometry.', 0 FROM "logo_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Modern', 'Style: modern and contemporary — sleek and trend-forward.', 1 FROM "logo_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Playful / Ceria', 'Style: playful, bright, fun and approachable.', 2 FROM "logo_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Elegan / Mewah', 'Style: elegant and sophisticated — premium feel.', 3 FROM "logo_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Vintage / Klasik', 'Style: vintage classic — nostalgic, hand-feel.', 4 FROM "logo_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Maskot', 'Style: mascot character — expressive face, friendly personality.', 5 FROM "logo_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Wordmark (teks saja)', 'Type: wordmark — typography only, no icon.', 0 FROM "logo_prompt_fields" WHERE "key" = 'logo_type'
UNION ALL SELECT id, 'Monogram (inisial)', 'Type: monogram — stylized initials only.', 1 FROM "logo_prompt_fields" WHERE "key" = 'logo_type'
UNION ALL SELECT id, 'Icon + Teks', 'Type: combination mark — an icon next to the brand name.', 2 FROM "logo_prompt_fields" WHERE "key" = 'logo_type'
UNION ALL SELECT id, 'Simbol Abstrak', 'Type: abstract symbol — a unique mark with no recognizable object.', 3 FROM "logo_prompt_fields" WHERE "key" = 'logo_type'
UNION ALL SELECT id, 'Maskot', 'Type: mascot logo — a character representing the brand.', 4 FROM "logo_prompt_fields" WHERE "key" = 'logo_type'
UNION ALL SELECT id, 'Hangat (oranye, merah, kuning)', 'Color palette: warm tones — oranges, reds, golden yellows.', 0 FROM "logo_prompt_fields" WHERE "key" = 'palette'
UNION ALL SELECT id, 'Dingin (biru, hijau, ungu)', 'Color palette: cool tones — blues, greens, purples.', 1 FROM "logo_prompt_fields" WHERE "key" = 'palette'
UNION ALL SELECT id, 'Monokrom (hitam putih)', 'Color palette: monochrome — black and white only.', 2 FROM "logo_prompt_fields" WHERE "key" = 'palette'
UNION ALL SELECT id, 'Dua Warna', 'Color palette: two-tone — two complementary colors.', 3 FROM "logo_prompt_fields" WHERE "key" = 'palette'
UNION ALL SELECT id, 'Earthy / Alami', 'Color palette: earthy natural tones — browns, beiges, muted greens.', 4 FROM "logo_prompt_fields" WHERE "key" = 'palette'
UNION ALL SELECT id, 'Profesional', 'Mood: professional, reliable, trustworthy.', 0 FROM "logo_prompt_fields" WHERE "key" = 'mood'
UNION ALL SELECT id, 'Ramah', 'Mood: friendly, approachable, warm.', 1 FROM "logo_prompt_fields" WHERE "key" = 'mood'
UNION ALL SELECT id, 'Energik', 'Mood: energetic, bold, dynamic.', 2 FROM "logo_prompt_fields" WHERE "key" = 'mood'
UNION ALL SELECT id, 'Mewah', 'Mood: luxurious, premium, exclusive.', 3 FROM "logo_prompt_fields" WHERE "key" = 'mood'
UNION ALL SELECT id, 'Kasual', 'Mood: casual, relaxed, everyday.', 4 FROM "logo_prompt_fields" WHERE "key" = 'mood';
--> statement-breakpoint
INSERT INTO "logo_settings" ("prompt_template")
SELECT 'You are an expert logo designer for Indonesian UMKM brands. Design ONE clean, professional logo from scratch — not a photo and not a product shot.

Brand name to render: "{business_name}"
Tagline to render below the name: "{tagline}"

{business_type}
{style}
{logo_type}
{palette}
{mood}

Render the logo centered on a clean white background with generous negative space. Crisp typography, simple shapes, balanced proportions. Output a 1:1 square that reads clearly at small sizes. Do not invent any extra brand elements, taglines, or text beyond what is asked.'
WHERE NOT EXISTS (SELECT 1 FROM "logo_settings");
