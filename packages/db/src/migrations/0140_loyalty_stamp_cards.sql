-- Digital loyalty stamp cards — pre-rendered per-state card images.
--
-- Merchants upload a base card design + a stamp mark and align a grid
-- overlay. At save time the Go API composites every fill state (0..N
-- stamps) once and stores each as a permanent S3 object. Sending a
-- card at runtime is then a single lookup by (program, stamp_count) —
-- no compositing in the WhatsApp hot path.
--
-- All additive + idempotent (IF NOT EXISTS) so it is safe to re-apply.

-- ── loyalty_stamp_programs: card design + render lifecycle ───────────
ALTER TABLE "loyalty_stamp_programs"
  ADD COLUMN IF NOT EXISTS "card_design_key" text;
--> statement-breakpoint
ALTER TABLE "loyalty_stamp_programs"
  ADD COLUMN IF NOT EXISTS "stamp_mark_key" text;
--> statement-breakpoint
ALTER TABLE "loyalty_stamp_programs"
  ADD COLUMN IF NOT EXISTS "card_layout" jsonb;
--> statement-breakpoint
ALTER TABLE "loyalty_stamp_programs"
  ADD COLUMN IF NOT EXISTS "card_render_status" text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE "loyalty_stamp_programs"
  ADD COLUMN IF NOT EXISTS "card_rendered_at" timestamp;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'loyalty_stamp_programs_card_render_status_chk'
  ) THEN
    ALTER TABLE "loyalty_stamp_programs"
      ADD CONSTRAINT "loyalty_stamp_programs_card_render_status_chk"
      CHECK ("card_render_status" IN ('none', 'pending', 'ready', 'failed'));
  END IF;
END $$;
--> statement-breakpoint

-- ── loyalty_stamp_program_cards: one image per fill state ────────────
CREATE TABLE IF NOT EXISTS "loyalty_stamp_program_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "program_id" uuid NOT NULL REFERENCES "loyalty_stamp_programs"("id") ON DELETE cascade,
  "stamp_count" integer NOT NULL,
  "image_key" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "loyalty_stamp_program_cards_program_count_unique" UNIQUE("program_id", "stamp_count"),
  CONSTRAINT "loyalty_stamp_program_cards_stamp_count_chk" CHECK ("stamp_count" >= 0)
);
