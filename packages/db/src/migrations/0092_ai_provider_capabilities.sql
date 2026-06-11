-- Split ai_provider_configs into a connection record + per-capability rows.
--
-- Before: one ai_provider_configs row carried the model, the API key AND
-- a single set of per-1M-token prices + one global is_default flag — so a
-- model that does both text and image generation (at different prices)
-- could not be represented without duplicating the whole connection.
--
-- After: ai_provider_configs is the connection only. ai_provider_capabilities
-- holds one row per (config x capability) — 'text' | 'image' | 'video' —
-- each with its own pricing and a per-capability default.
--
-- Backfill: every pre-split config was text-only, so each becomes exactly
-- one text-capability row carrying its existing pricing + default flag.
--
-- Rollback:
--   ALTER TABLE "ai_provider_configs" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;
--   ALTER TABLE "ai_provider_configs" ADD COLUMN "input_price_per_1m_usd" numeric(12,6);
--   ALTER TABLE "ai_provider_configs" ADD COLUMN "input_cache_hit_price_per_1m_usd" numeric(12,6);
--   ALTER TABLE "ai_provider_configs" ADD COLUMN "output_price_per_1m_usd" numeric(12,6);
--   (backfill from ai_provider_capabilities WHERE capability='text', then)
--   DROP TABLE "ai_provider_capabilities";

CREATE TABLE IF NOT EXISTS "ai_provider_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"input_price_per_1m_usd" numeric(12, 6),
	"input_cache_hit_price_per_1m_usd" numeric(12, 6),
	"output_price_per_1m_usd" numeric(12, 6),
	"price_per_image_usd" numeric(12, 6),
	"price_per_second_usd" numeric(12, 6),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_provider_capabilities" ADD CONSTRAINT "ai_provider_capabilities_config_id_ai_provider_configs_id_fk"
    FOREIGN KEY ("config_id") REFERENCES "ai_provider_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_capabilities_config_cap_uniq" ON "ai_provider_capabilities" ("config_id","capability");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_capabilities_default_uniq" ON "ai_provider_capabilities" ("capability") WHERE "is_default" = true;
--> statement-breakpoint
INSERT INTO "ai_provider_capabilities"
  ("config_id", "capability", "is_default", "is_active",
   "input_price_per_1m_usd", "input_cache_hit_price_per_1m_usd", "output_price_per_1m_usd")
SELECT "id", 'text', "is_default", true,
       "input_price_per_1m_usd", "input_cache_hit_price_per_1m_usd", "output_price_per_1m_usd"
FROM "ai_provider_configs";
--> statement-breakpoint
DROP INDEX IF EXISTS "ai_provider_configs_default_uniq";
--> statement-breakpoint
ALTER TABLE "ai_provider_configs" DROP COLUMN IF EXISTS "is_default";
--> statement-breakpoint
ALTER TABLE "ai_provider_configs" DROP COLUMN IF EXISTS "input_price_per_1m_usd";
--> statement-breakpoint
ALTER TABLE "ai_provider_configs" DROP COLUMN IF EXISTS "input_cache_hit_price_per_1m_usd";
--> statement-breakpoint
ALTER TABLE "ai_provider_configs" DROP COLUMN IF EXISTS "output_price_per_1m_usd";
