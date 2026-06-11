ALTER TABLE "wa_contacts" ADD COLUMN IF NOT EXISTS "lid_jid" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_contacts_instance_lid_idx"
  ON "wa_contacts" USING btree ("instance_id", "lid_jid")
  WHERE "lid_jid" IS NOT NULL;
