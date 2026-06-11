-- Franchise cashflow posting. When a franchise outlet's stock
-- requisition is fulfilled, the system writes a paired cashflow entry
-- (expense on the outlet, income on HQ). This needs:
--   1. a new cashflow_entries.source value 'stock_requisition'
--   2. two system categories the auto-poster resolves by name
--
-- Rollback:
--   ALTER TABLE "cashflow_entries" DROP CONSTRAINT "cashflow_entries_source_chk";
--   ALTER TABLE "cashflow_entries" ADD CONSTRAINT "cashflow_entries_source_chk"
--     CHECK ("source" IN ('manual','pos_sale','bank_import','ar_payment','ap_payment'));
--   DELETE FROM "cashflow_categories" WHERE is_system = true
--     AND name IN ('Pembelian Stok dari Pusat', 'Penjualan Stok ke Outlet');

ALTER TABLE "cashflow_entries" DROP CONSTRAINT IF EXISTS "cashflow_entries_source_chk";
--> statement-breakpoint
ALTER TABLE "cashflow_entries" ADD CONSTRAINT "cashflow_entries_source_chk" CHECK ("source" IN ('manual', 'pos_sale', 'bank_import', 'ar_payment', 'ap_payment', 'stock_requisition'));
--> statement-breakpoint
INSERT INTO "cashflow_categories" ("tenant_id", "name", "kind", "is_system", "sort_order")
SELECT NULL, 'Pembelian Stok dari Pusat', 'expense', true, 0
WHERE NOT EXISTS (
  SELECT 1 FROM "cashflow_categories"
  WHERE "name" = 'Pembelian Stok dari Pusat' AND "kind" = 'expense' AND "is_system" = true
);
--> statement-breakpoint
INSERT INTO "cashflow_categories" ("tenant_id", "name", "kind", "is_system", "sort_order")
SELECT NULL, 'Penjualan Stok ke Outlet', 'income', true, 0
WHERE NOT EXISTS (
  SELECT 1 FROM "cashflow_categories"
  WHERE "name" = 'Penjualan Stok ke Outlet' AND "kind" = 'income' AND "is_system" = true
);
