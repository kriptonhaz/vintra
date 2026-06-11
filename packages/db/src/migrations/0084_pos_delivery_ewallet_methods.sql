-- Widen the pos_sales.payment_method CHECK to cover delivery e-wallets.
--
-- Adds 'gopay', 'shopeepay', and 'ovo' as distinct payment methods
-- alongside the generic 'ewallet', so per-method reconciliation can
-- tell a Shopee delivery payout apart from a Gojek one.
--
-- Existing rows all hold values from the old set (a subset of the new
-- set), so the re-added constraint validates instantly.
--
-- Rollback:
--   ALTER TABLE "pos_sales" DROP CONSTRAINT "pos_sales_payment_chk";
--   ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_payment_chk"
--     CHECK ("payment_method" IN ('cash','qris','transfer','card','ewallet'));

ALTER TABLE "pos_sales" DROP CONSTRAINT IF EXISTS "pos_sales_payment_chk";

ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_payment_chk"
  CHECK ("payment_method" IN ('cash', 'qris', 'transfer', 'card', 'ewallet', 'gopay', 'shopeepay', 'ovo'));
