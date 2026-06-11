-- JUR-14: Migrate HPP unit text columns to master_hpp_units FK.
--
-- Today materials.unit + product_materials.unit are text ('gram', 'ml',
-- 'pcs', etc.). Every value across all tenants happens to match a
-- master_hpp_units.value (verified pre-migration: 28 total rows, 0
-- mismatches). Migrating to FK gives us:
--
--   - JUR-10's runtime "WHERE value = lower(unit)" lookup goes away
--   - Unit conversion in createSale uses unit_id directly
--   - Typo / drift impossible — DB enforces referential integrity
--
-- Strategy: add nullable unit_id column → backfill from text → assert
-- no nulls → drop text column → mark NOT NULL. Same SQL pattern works
-- for both tables.

ALTER TABLE "materials"
  ADD COLUMN "unit_id" uuid REFERENCES "master_hpp_units"("id");
--> statement-breakpoint

ALTER TABLE "product_materials"
  ADD COLUMN "unit_id" uuid REFERENCES "master_hpp_units"("id");
--> statement-breakpoint

UPDATE "materials"
SET "unit_id" = (
  SELECT "id" FROM "master_hpp_units" WHERE "value" = lower(trim("materials"."unit"))
);
--> statement-breakpoint

UPDATE "product_materials"
SET "unit_id" = (
  SELECT "id" FROM "master_hpp_units" WHERE "value" = lower(trim("product_materials"."unit"))
);
--> statement-breakpoint

-- Sanity check: refuse to proceed if any row didn't backfill. Catches
-- a tenant that adds a stray unit value between the data check and the
-- migration apply.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "materials" WHERE "unit_id" IS NULL) THEN
    RAISE EXCEPTION 'materials backfill incomplete — % rows still NULL',
      (SELECT count(*) FROM "materials" WHERE "unit_id" IS NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM "product_materials" WHERE "unit_id" IS NULL) THEN
    RAISE EXCEPTION 'product_materials backfill incomplete — % rows still NULL',
      (SELECT count(*) FROM "product_materials" WHERE "unit_id" IS NULL);
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "materials" DROP COLUMN "unit";
--> statement-breakpoint

ALTER TABLE "product_materials" DROP COLUMN "unit";
--> statement-breakpoint

ALTER TABLE "materials" ALTER COLUMN "unit_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "product_materials" ALTER COLUMN "unit_id" SET NOT NULL;
