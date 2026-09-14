-- Supplier payments against purchase orders.
--
-- Payment state (unpaid / partial / paid) is derived from
-- sum(amount) vs purchase_orders.subtotal and never stored, so deleting a
-- mistaken payment can't leave a stale status behind. It is tracked apart
-- from the receiving status: a PO can be fully received but half paid.
--
-- When the tenant's plan includes Cashflow, each payment is mirrored as a
-- cashflow expense with source 'po_payment' (source_ref = payment id),
-- posted to the new 'Pembelian dari Supplier' system category.
--
-- Ported from JuraganQu's 0130_po_payments. The source CHECK list is
-- Vintra's own (no 'gudang_order' — Vintra has no Gudang module).
--
-- Hand-written to match every migration since 0006; see CLAUDE.md.
-- Idempotent so it is safe to re-apply.
--
-- Rollback:
--   DROP TABLE "purchase_order_payments";
--   DELETE FROM "cashflow_entries" WHERE "source" = 'po_payment';
--   ALTER TABLE "cashflow_entries" DROP CONSTRAINT "cashflow_entries_source_chk";
--   ALTER TABLE "cashflow_entries" ADD CONSTRAINT "cashflow_entries_source_chk"
--     CHECK ("source" IN ('manual','pos_sale','bank_import','ar_payment','ap_payment','stock_requisition','pos_cash_payout'));
--   DELETE FROM "cashflow_categories" WHERE "is_system" = true
--     AND "name" = 'Pembelian dari Supplier' AND "kind" = 'expense';

CREATE TABLE IF NOT EXISTS "purchase_order_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "amount" numeric(15, 2) NOT NULL,
  "method" text NOT NULL,
  "paid_at" date NOT NULL,
  "note" text,
  "recorded_by_user_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_order_payments_method_chk"
    CHECK ("method" IN ('cash', 'transfer', 'qris', 'other')),
  CONSTRAINT "purchase_order_payments_amount_chk"
    CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_payments_po_idx"
  ON "purchase_order_payments" ("purchase_order_id");
--> statement-breakpoint
ALTER TABLE "cashflow_entries" DROP CONSTRAINT IF EXISTS "cashflow_entries_source_chk";
--> statement-breakpoint
ALTER TABLE "cashflow_entries" ADD CONSTRAINT "cashflow_entries_source_chk" CHECK ("source" IN ('manual', 'pos_sale', 'bank_import', 'ar_payment', 'ap_payment', 'stock_requisition', 'pos_cash_payout', 'po_payment'));
--> statement-breakpoint
INSERT INTO "cashflow_categories" ("tenant_id", "name", "kind", "is_system", "sort_order")
SELECT NULL, 'Pembelian dari Supplier', 'expense', true, 0
WHERE NOT EXISTS (
  SELECT 1 FROM "cashflow_categories"
  WHERE "name" = 'Pembelian dari Supplier' AND "kind" = 'expense' AND "is_system" = true
);
