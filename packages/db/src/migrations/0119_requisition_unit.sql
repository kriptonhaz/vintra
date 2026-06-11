-- Per-line ordered unit on requisitions, mirroring purchase_order_items.
-- The chosen unit drives qty display and form parity with Buat PO; the
-- snapshot ratio lets fulfill convert qty back to base units for the
-- actual stock movement without re-reading inventory_item_units (which
-- may have been edited between request and fulfilment).
--
-- Existing rows: unit_id = NULL = base unit, unit_ratio = NULL = 1.

ALTER TABLE "stock_requisition_items"
  ADD COLUMN "unit_id" uuid REFERENCES "master_hpp_units"("id");
--> statement-breakpoint
ALTER TABLE "stock_requisition_items"
  ADD COLUMN "unit_ratio" numeric(15, 4);
