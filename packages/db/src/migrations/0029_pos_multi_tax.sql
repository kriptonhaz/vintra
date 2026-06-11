-- Multi-tax support on POS settings.
--
-- Earlier the cashier could only configure one tax line (PPN). Real
-- Indonesian F&B / hospitality businesses often stack PB1 (restaurant
-- tax) on top, plus the occasional service charge — and there's no
-- one-size-fits-all set we can hardcode. Move tax from three scalar
-- columns (`tax_enabled`, `tax_percent`, `tax_label`) to a JSONB
-- array of `{label, percent, active}` rows so each tenant can shape
-- their own stack.
--
-- Per-sale snapshot picks up `tax_lines JSONB` so receipts + reports
-- can render each tax line separately. The existing scalar
-- `tax_amount` column on `pos_sales` stays as the SUM (unchanged
-- semantics for downstream reports / aggregations).
--
-- Old scalar columns on `pos_settings` stay for one release as a
-- fallback in case we need to revert. Code reads exclusively from
-- `taxes` going forward.

-- IF NOT EXISTS guards make this re-runnable so the prod-side hot
-- application (already executed via the MCP path) can be tracked by
-- drizzle's migrator on the next bun run db:migrate without erroring
-- on duplicate column.

-- 1. Add the new JSONB column on pos_settings (default = empty array
--    so a fresh tenant has no tax lines).
ALTER TABLE "pos_settings"
  ADD COLUMN IF NOT EXISTS "taxes" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Migrate existing single-tax data into the JSONB shape. Only seed
--    rows that actually had a tax configured — tenants who left tax
--    off get an empty array. The taxes='[]' guard makes the UPDATE
--    a no-op when re-run after a prior live application.
UPDATE "pos_settings"
SET "taxes" = jsonb_build_array(
  jsonb_build_object(
    'label', COALESCE(NULLIF(tax_label, ''), 'PPN'),
    'percent', tax_percent::numeric,
    'active', tax_enabled
  )
)
WHERE (tax_enabled = true OR tax_percent::numeric > 0)
  AND (taxes IS NULL OR taxes::text = '[]');

-- 3. Per-sale tax breakdown. Same JSONB shape (label/percent/amount)
--    so the receipt + reports can render each line. `amount` is the
--    snapshot Rp at sale time — never re-derived from percent later
--    so retro tax-rate edits don't rewrite history.
ALTER TABLE "pos_sales"
  ADD COLUMN IF NOT EXISTS "tax_lines" jsonb;
