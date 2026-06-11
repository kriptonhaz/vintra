-- Spanduk AI — print-ready banner generator (X-Banner / Spanduk Kecil /
-- Spanduk Besar). AI generates the background only; the headline,
-- subhead, phone, and address are composited server-side via an SVG/
-- font overlay so they print sharp at large sizes.
--
-- Schema:
--   spanduk_size_presets         — admin catalog of standard print sizes
--   spanduk_prompt_fields        — admin-configurable selectors
--   spanduk_prompt_field_options — options + optional per-option text inputs
--   spanduk_settings             — singleton prompt template + layout JSON
--   spanduks                     — tenant generations (png + pdf + raw bg)
--
-- Credits come from the shared Konten credit pool (default cost = 6/banner).
--
-- Rollback:
--   DROP TABLE "spanduks";
--   DROP TABLE "spanduk_prompt_field_options";
--   DROP TABLE "spanduk_prompt_fields";
--   DROP TABLE "spanduk_size_presets";
--   DROP TABLE "spanduk_settings";

CREATE TABLE IF NOT EXISTS "spanduk_size_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"width_cm" integer NOT NULL,
	"height_cm" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spanduk_prompt_fields" (
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
CREATE TABLE IF NOT EXISTS "spanduk_prompt_field_options" (
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
CREATE TABLE IF NOT EXISTS "spanduk_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_template" text DEFAULT '' NOT NULL,
	"default_credit_cost" integer DEFAULT 6 NOT NULL,
	"text_layout" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spanduks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"type" text NOT NULL,
	"size_preset_id" uuid,
	"width_cm" integer NOT NULL,
	"height_cm" integer NOT NULL,
	"headline" text,
	"subheadline" text,
	"phone" text,
	"address" text,
	"cta_text" text,
	"bg_image_key" text,
	"png_image_key" text,
	"pdf_image_key" text,
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
  ALTER TABLE "spanduk_prompt_field_options" ADD CONSTRAINT "spanduk_prompt_field_options_field_id_spanduk_prompt_fields_id_fk"
    FOREIGN KEY ("field_id") REFERENCES "spanduk_prompt_fields"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "spanduks" ADD CONSTRAINT "spanduks_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "spanduks" ADD CONSTRAINT "spanduks_size_preset_id_spanduk_size_presets_id_fk"
    FOREIGN KEY ("size_preset_id") REFERENCES "spanduk_size_presets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spanduk_size_presets_type_idx" ON "spanduk_size_presets" ("type","sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "spanduk_prompt_fields_key_uniq" ON "spanduk_prompt_fields" ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spanduk_prompt_field_options_field_idx" ON "spanduk_prompt_field_options" ("field_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spanduks_tenant_time_idx" ON "spanduks" ("tenant_id","created_at");
--> statement-breakpoint
-- ── Seed: standard sizes ─────────────────────────────────────────────
INSERT INTO "spanduk_size_presets" ("type", "label", "width_cm", "height_cm", "sort_order")
VALUES
  ('xbanner',        'X-Banner 60×160 cm',     60,  160, 0),
  ('xbanner',        'X-Banner 80×180 cm',     80,  180, 1),
  ('spanduk_kecil',  'Spanduk 1×2 m',         200,  100, 0),
  ('spanduk_kecil',  'Spanduk 1×3 m',         300,  100, 1),
  ('spanduk_kecil',  'Spanduk 1×4 m',         400,  100, 2),
  ('spanduk_kecil',  'Spanduk 1,5×3 m',       300,  150, 3),
  ('spanduk_besar',  'Spanduk 2×4 m',         400,  200, 0),
  ('spanduk_besar',  'Spanduk 2×6 m',         600,  200, 1),
  ('spanduk_besar',  'Spanduk 3×6 m',         600,  300, 2),
  ('spanduk_besar',  'Spanduk 3×8 m',         800,  300, 3);
--> statement-breakpoint
-- ── Seed: prompt fields ───────────────────────────────────────────────
INSERT INTO "spanduk_prompt_fields" ("key", "label", "help_text", "field_type", "allows_custom", "required", "sort_order")
VALUES
  ('theme',    'Tema Spanduk', 'Tema acara atau jenis promosi.', 'select', true,  true,  0),
  ('style',    'Gaya Visual',  NULL,                              'select', false, true,  1),
  ('palette',  'Palet Warna',  NULL,                              'select', true,  false, 2),
  ('mood',     'Mood',         NULL,                              'select', false, false, 3)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "spanduk_prompt_field_options" ("field_id", "label", "prompt_fragment", "sort_order")
SELECT id, 'Grand Opening',         'Theme: a grand opening / ribbon-cutting celebration for a new business.', 0 FROM "spanduk_prompt_fields" WHERE "key" = 'theme'
UNION ALL SELECT id, 'Promo Diskon',         'Theme: a discount / promo campaign — big sale, eye-catching offer.', 1 FROM "spanduk_prompt_fields" WHERE "key" = 'theme'
UNION ALL SELECT id, 'Ramadan / Idul Fitri', 'Theme: Ramadan / Idul Fitri greetings and seasonal promo.', 2 FROM "spanduk_prompt_fields" WHERE "key" = 'theme'
UNION ALL SELECT id, 'HUT RI / 17 Agustus',  'Theme: Indonesian Independence Day celebration — red & white festive.', 3 FROM "spanduk_prompt_fields" WHERE "key" = 'theme'
UNION ALL SELECT id, 'Menu / Daftar Harga',  'Theme: a restaurant or store menu / price-list banner.', 4 FROM "spanduk_prompt_fields" WHERE "key" = 'theme'
UNION ALL SELECT id, 'Selamat Datang',       'Theme: a welcome banner for an event, store, or venue.', 5 FROM "spanduk_prompt_fields" WHERE "key" = 'theme'
UNION ALL SELECT id, 'Modern / Minimalis',   'Style: modern minimalist — clean lines, lots of negative space.', 0 FROM "spanduk_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Bold / Eye-catching',  'Style: bold and eye-catching — high contrast, big shapes.', 1 FROM "spanduk_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Festive / Meriah',     'Style: festive, lively — decorative motifs, celebratory vibe.', 2 FROM "spanduk_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Vintage / Klasik',     'Style: vintage classic — retro feel, warm tones, hand-feel.', 3 FROM "spanduk_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Elegan',               'Style: elegant — sophisticated, premium-feeling.', 4 FROM "spanduk_prompt_fields" WHERE "key" = 'style'
UNION ALL SELECT id, 'Hangat (oranye/merah/kuning)', 'Color palette: warm tones — oranges, reds, golden yellows.', 0 FROM "spanduk_prompt_fields" WHERE "key" = 'palette'
UNION ALL SELECT id, 'Dingin (biru/hijau)',           'Color palette: cool tones — blues and greens.',            1 FROM "spanduk_prompt_fields" WHERE "key" = 'palette'
UNION ALL SELECT id, 'Merah Putih',                   'Color palette: red and white — Indonesian national colors.', 2 FROM "spanduk_prompt_fields" WHERE "key" = 'palette'
UNION ALL SELECT id, 'Pastel',                        'Color palette: soft pastels — gentle, calming tones.',      3 FROM "spanduk_prompt_fields" WHERE "key" = 'palette'
UNION ALL SELECT id, 'Berani (kontras tinggi)',        'Color palette: bold high-contrast colors.',                4 FROM "spanduk_prompt_fields" WHERE "key" = 'palette'
UNION ALL SELECT id, 'Profesional',  'Mood: professional and trustworthy.',  0 FROM "spanduk_prompt_fields" WHERE "key" = 'mood'
UNION ALL SELECT id, 'Ramah',        'Mood: friendly and welcoming.',         1 FROM "spanduk_prompt_fields" WHERE "key" = 'mood'
UNION ALL SELECT id, 'Energik',      'Mood: energetic and dynamic.',          2 FROM "spanduk_prompt_fields" WHERE "key" = 'mood'
UNION ALL SELECT id, 'Mewah',        'Mood: luxurious and premium.',          3 FROM "spanduk_prompt_fields" WHERE "key" = 'mood';
--> statement-breakpoint
-- ── Seed: settings (singleton) ────────────────────────────────────────
INSERT INTO "spanduk_settings" ("prompt_template", "default_credit_cost", "text_layout")
SELECT 'You are an expert print designer for Indonesian UMKM banners. Generate ONE wide outdoor banner BACKGROUND IMAGE only — do NOT render any text, letters, numbers, or logos. Leave the bottom 25% of the canvas mostly empty (a clean low-detail area or simple gradient) so a text strip can be overlaid later.

{theme}
{style}
{palette}
{mood}

The background should look professional, printable at large size, high resolution, no JPEG artifacts. Centered visual subject with copy-safe margins on the bottom. Crisp edges and high contrast. Avoid any photographic text, watermarks, or signatures.',
       6,
       '{"stripHeightPct": 0.25, "stripBgColor": "#0F172A", "stripOpacity": 0.78, "headlineFont": "Poppins-Bold", "headlineColor": "#FFFFFF", "subheadFont": "Poppins-Regular", "subheadColor": "#FDE68A", "contactFont": "Poppins-Regular", "contactColor": "#E5E7EB"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "spanduk_settings");
