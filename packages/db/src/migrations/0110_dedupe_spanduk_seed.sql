-- Dedupe spanduk seed data + add unique constraints to prevent recurrence.
--
-- Background: the initial seed in migration 0106 used plain INSERTs (no
-- IF NOT EXISTS / ON CONFLICT) for both `spanduk_size_presets` and
-- `spanduk_prompt_field_options`. The migration journal got out of sync
-- at some point (or the seed ran twice via baseline + re-apply), so the
-- catalog ended up with every row duplicated — the size dropdown
-- showed "Spanduk 1×2 m" twice, the theme dropdown showed "Grand
-- Opening" twice, etc.
--
-- This migration:
--   1. Keeps the OLDEST row per (type, width_cm, height_cm) in sizes
--      and per (field_id, label) in options; deletes the rest.
--   2. Adds UNIQUE indexes so future seed mishaps or admin double-entry
--      can't reintroduce the duplicates.
--
-- Size deletions are safe — `spanduks.size_preset_id` is ON DELETE
-- SET NULL. Option deletions are safe — `spanduks.selections` is a
-- denormalized JSONB snapshot, no FK to the catalog row.
--
-- Rollback: no clean inverse. Restore from snapshot if needed.

DELETE FROM "spanduk_size_presets"
 WHERE "id" IN (
   SELECT "id" FROM (
     SELECT "id",
            ROW_NUMBER() OVER (
              PARTITION BY "type", "width_cm", "height_cm"
              ORDER BY "created_at"
            ) AS rn
       FROM "spanduk_size_presets"
   ) t
   WHERE t.rn > 1
 );

CREATE UNIQUE INDEX IF NOT EXISTS "spanduk_size_presets_type_dims_uniq"
  ON "spanduk_size_presets" ("type", "width_cm", "height_cm");

DELETE FROM "spanduk_prompt_field_options"
 WHERE "id" IN (
   SELECT "id" FROM (
     SELECT "id",
            ROW_NUMBER() OVER (
              PARTITION BY "field_id", "label"
              ORDER BY "created_at"
            ) AS rn
       FROM "spanduk_prompt_field_options"
   ) t
   WHERE t.rn > 1
 );

CREATE UNIQUE INDEX IF NOT EXISTS "spanduk_prompt_field_options_field_label_uniq"
  ON "spanduk_prompt_field_options" ("field_id", "label");
