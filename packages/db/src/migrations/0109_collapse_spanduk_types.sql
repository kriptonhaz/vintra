-- Collapse the spanduk "type" enum from 3 values to 2.
--
-- Original split (xbanner / spanduk_kecil / spanduk_besar) was confusing
-- because the "kecil vs besar" distinction is already captured by the
-- per-type size presets (1×2 m through 3×8 m). The UI now only offers
-- two banner kinds — X-Banner and Spanduk — with the print size picked
-- from the same size dropdown regardless of how big it gets.
--
-- `type` is a free-form text column on both tables (no CHECK constraint),
-- so this is a pure data migration. spanduk_kecil + spanduk_besar both
-- collapse into `spanduk`; xbanner stays as-is.
--
-- Rollback:
--   No reliable way to split `spanduk` back into kecil/besar after the
--   merge. Restore from a prior snapshot if needed.

UPDATE "spanduks"
   SET "type" = 'spanduk'
 WHERE "type" IN ('spanduk_kecil', 'spanduk_besar');

UPDATE "spanduk_size_presets"
   SET "type" = 'spanduk'
 WHERE "type" IN ('spanduk_kecil', 'spanduk_besar');
