-- POS billing went from flat-per-tenant to base-price + per-outlet
-- add-on (matching the Qasir model). Each financial transaction now
-- needs to record HOW MANY OUTLETS the payment covered for that
-- billing period — same shape as the existing `billed_staff_count`
-- column attendance uses.
--
-- Nullable because non-POS rows (attendance, future modules) won't
-- populate it. Default null = "not applicable for this row".

ALTER TABLE "financial_transactions"
  ADD COLUMN IF NOT EXISTS "billed_outlet_count" integer;
