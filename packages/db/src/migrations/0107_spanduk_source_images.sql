-- Spanduk multi-product upload — add a JSONB column on `spanduks` that
-- stores the S3 keys of the tenant-uploaded reference photos used as
-- input to Gemini. Capped at 4 by the server-side validator.
--
-- Also refresh the seeded prompt template so it explicitly tells Gemini
-- to incorporate the supplied product photos as the featured items
-- (when any are provided) while still leaving the bottom 25% empty for
-- the server-composited text strip.
--
-- Rollback:
--   ALTER TABLE "spanduks" DROP COLUMN "source_image_keys";

ALTER TABLE "spanduks" ADD COLUMN IF NOT EXISTS "source_image_keys" jsonb;
--> statement-breakpoint
-- Refresh the seeded prompt template (only if it still matches the
-- original wording — leaves admin edits alone).
UPDATE "spanduk_settings"
SET "prompt_template" = 'You are an expert print designer for Indonesian UMKM banners. Generate ONE wide outdoor banner BACKGROUND IMAGE only — do NOT render any text, letters, numbers, or logos. Leave the bottom 25% of the canvas mostly empty (a clean low-detail area or simple gradient) so a text strip can be overlaid later.

If product reference photos are attached, treat them as the featured items the business is promoting. Compose them into the banner naturally — arrange the products tastefully across the upper portion of the canvas, preserving their colors and shapes faithfully. Do not invent extra products that were not provided.

{theme}
{style}
{palette}
{mood}

The background should look professional, printable at large size, high resolution, no JPEG artifacts. Crisp edges and high contrast. Avoid any photographic text, watermarks, or signatures.'
WHERE "prompt_template" LIKE '%Generate ONE wide outdoor banner BACKGROUND IMAGE only%'
  AND "prompt_template" NOT LIKE '%product reference photos are attached%';
