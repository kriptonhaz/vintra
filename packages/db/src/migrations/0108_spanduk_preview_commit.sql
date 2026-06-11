-- Spanduk preview → commit flow.
--
-- Two new columns on `spanduks`:
--
--   * `seed`              — int32 Gemini reproducibility seed. Stored
--                           so a 1K preview's seed can be reused for
--                           the 4K commit, giving the user a final
--                           image visually close to the one they
--                           approved.
--
--   * `parent_spanduk_id` — when a row is a 4K commit, points at the
--                           1K preview it was generated from. NULL
--                           for previews themselves and for direct
--                           (skip-preview) 4K generations. NO foreign
--                           key — preview rows may be garbage-collected
--                           independently, and we don't want a parent
--                           cleanup to ripple into the commit row.
--
-- Rollback:
--   ALTER TABLE spanduks DROP COLUMN IF EXISTS parent_spanduk_id;
--   ALTER TABLE spanduks DROP COLUMN IF EXISTS seed;
ALTER TABLE spanduks
  ADD COLUMN IF NOT EXISTS seed integer,
  ADD COLUMN IF NOT EXISTS parent_spanduk_id uuid;
