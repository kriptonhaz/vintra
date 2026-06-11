-- Konten Promosi — one row per AI image generation.
--
-- Created with status 'pending', then flipped to 'success' (with
-- result_image_key) or 'error'. Credits are charged only on success;
-- credits_charged records how many were spent for refund/audit.
--
-- Rollback:
--   DROP TABLE "konten_images";

CREATE TABLE IF NOT EXISTS "konten_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source_image_key" text,
	"result_image_key" text,
	"product_id" uuid,
	"prompt" text NOT NULL,
	"preset" text,
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
  ALTER TABLE "konten_images" ADD CONSTRAINT "konten_images_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "konten_images_tenant_time_idx" ON "konten_images" ("tenant_id","created_at");
