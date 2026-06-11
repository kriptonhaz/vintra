ALTER TABLE "wa_instances"
  ADD COLUMN "ai_provider_config_id" uuid REFERENCES "ai_provider_configs"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "wa_instances_ai_provider_config_idx" ON "wa_instances" ("ai_provider_config_id");
