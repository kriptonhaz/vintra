-- Tarik Tunai (cash payout) now posts a linked cashflow expense so the
-- drawer ledger and the books stay consistent. This needs:
--   1. a new cashflow_entries.source value 'pos_cash_payout'
--   2. a system expense category the payout poster resolves by name
--      (used as the default when the cashier doesn't pick one)
--
-- Rollback:
--   ALTER TABLE "cashflow_entries" DROP CONSTRAINT "cashflow_entries_source_chk";
--   ALTER TABLE "cashflow_entries" ADD CONSTRAINT "cashflow_entries_source_chk"
--     CHECK ("source" IN ('manual','pos_sale','bank_import','ar_payment','ap_payment','stock_requisition'));
--   DELETE FROM "cashflow_categories" WHERE is_system = true AND name = 'Pengeluaran Kas';

ALTER TABLE "cashflow_entries" DROP CONSTRAINT IF EXISTS "cashflow_entries_source_chk";
--> statement-breakpoint
ALTER TABLE "cashflow_entries" ADD CONSTRAINT "cashflow_entries_source_chk" CHECK ("source" IN ('manual', 'pos_sale', 'bank_import', 'ar_payment', 'ap_payment', 'stock_requisition', 'pos_cash_payout'));
--> statement-breakpoint
INSERT INTO "cashflow_categories" ("tenant_id", "name", "kind", "is_system", "sort_order")
SELECT NULL, 'Pengeluaran Kas', 'expense', true, 0
WHERE NOT EXISTS (
  SELECT 1 FROM "cashflow_categories"
  WHERE "name" = 'Pengeluaran Kas' AND "kind" = 'expense' AND "is_system" = true
);
