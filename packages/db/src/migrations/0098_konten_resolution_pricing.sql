-- Konten resolution tiers — per-resolution credit cost + USD price.
--
-- Nano Banana charges more for higher resolutions, so a single
-- price_per_image_usd on the image capability is replaced by a JSONB map
-- keyed by tier: { "1k": {"credits":1,"priceUsd":"0.13"}, "2k": {...}, ... }.
-- Existing image capabilities are backfilled — their old single price
-- becomes the 1k tier, with default 1/2/4 credit costs.
--
-- konten_images gains a `resolution` column recording which tier each
-- generation used.
--
-- Rollback:
--   ALTER TABLE "konten_images" DROP COLUMN IF EXISTS "resolution";
--   ALTER TABLE "ai_provider_capabilities" ADD COLUMN "price_per_image_usd" numeric(12,6);
--   (re-derive from image_resolution_pricing->'1k'->>'priceUsd', then)
--   ALTER TABLE "ai_provider_capabilities" DROP COLUMN "image_resolution_pricing";

ALTER TABLE "ai_provider_capabilities" ADD COLUMN IF NOT EXISTS "image_resolution_pricing" jsonb;
--> statement-breakpoint
UPDATE "ai_provider_capabilities"
SET "image_resolution_pricing" = jsonb_build_object(
  '1k', jsonb_build_object('credits', 1, 'priceUsd', "price_per_image_usd"::text),
  '2k', jsonb_build_object('credits', 2, 'priceUsd', NULL),
  '4k', jsonb_build_object('credits', 4, 'priceUsd', NULL)
)
WHERE "capability" = 'image' AND "price_per_image_usd" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_provider_capabilities" DROP COLUMN IF EXISTS "price_per_image_usd";
--> statement-breakpoint
ALTER TABLE "konten_images" ADD COLUMN IF NOT EXISTS "resolution" text;
