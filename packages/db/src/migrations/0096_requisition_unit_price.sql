-- Franchise / Independent — Phase C. Add unit_price to
-- stock_requisition_items so a franchise branch's requisition is a
-- priced purchase (captured from inventory_items.franchise_price at
-- requisition time). NULL for an independent branch — that's a plain
-- stock transfer with no money.
--
-- Rollback:
--   ALTER TABLE "stock_requisition_items" DROP COLUMN IF EXISTS "unit_price";

ALTER TABLE "stock_requisition_items" ADD COLUMN IF NOT EXISTS "unit_price" numeric(15, 2);
