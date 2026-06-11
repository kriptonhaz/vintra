-- JUR-141 / JUR-145 — flip the Peti Kas default to ON for Komplit
-- tenants now that the full feature (PRs 2 + 3) has shipped.
--
-- Migration 0055 set the column default to FALSE so PR 1 (schema +
-- server fns only) could deploy without breaking cash sales for
-- Komplit tenants who hadn't yet been given the UI to open
-- sessions. With PRs 2–3 live, the BukaKasModal handles the
-- "no session yet" state, and tier-gating in createSale (per
-- application code) restricts enforcement to posTier='komplit'.
--
-- Default flips so future new tenants start with the right value;
-- Komplit rows are backfilled to true. Free + legacy tier rows
-- stay false (their UI never surfaces the feature anyway).

UPDATE pos_settings
SET cash_drawer_enabled = true
WHERE tier = 'komplit'
  AND cash_drawer_enabled = false;

ALTER TABLE pos_settings
  ALTER COLUMN cash_drawer_enabled SET DEFAULT true;
