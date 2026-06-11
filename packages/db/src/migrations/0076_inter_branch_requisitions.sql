-- Inter-branch stock requisitions (JUR-190).
--
-- An outlet branch requests stock from another branch (the main branch
-- in v1). The source branch approves, then fulfills — fulfillment moves
-- stock via paired transfer_out / transfer_in inventory_movements.
-- Status: pending -> approved -> fulfilled, with rejected / cancelled
-- as terminal off-ramps. No change to inventory_movements (transfer_in
-- / transfer_out are already in its CHECK constraint) or to
-- inventory_stock_balances.
--
-- Rollback: DROP TABLE "stock_requisition_items", "stock_requisition_counters", "stock_requisitions";

CREATE TABLE IF NOT EXISTS "stock_requisitions" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"            uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "requisition_number"   text NOT NULL,
  "requesting_branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "source_branch_id"     uuid NOT NULL REFERENCES "branches"("id"),
  "status"               text NOT NULL DEFAULT 'pending',
  "notes"                text,
  "requested_by"         uuid NOT NULL,
  "approved_by"          uuid,
  "approved_at"          timestamp,
  "fulfilled_at"         timestamp,
  "created_at"           timestamp NOT NULL DEFAULT now(),
  "updated_at"           timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "stock_requisitions_tenant_number_unique" UNIQUE ("tenant_id", "requisition_number"),
  CONSTRAINT "stock_requisitions_status_chk" CHECK ("status" IN ('pending', 'approved', 'fulfilled', 'rejected', 'cancelled')),
  CONSTRAINT "stock_requisitions_branches_distinct_chk" CHECK ("requesting_branch_id" <> "source_branch_id")
);

CREATE INDEX IF NOT EXISTS "stock_requisitions_tenant_status_idx"
  ON "stock_requisitions" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "stock_requisition_items" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requisition_id" uuid NOT NULL REFERENCES "stock_requisitions"("id") ON DELETE CASCADE,
  "item_id"        uuid NOT NULL REFERENCES "inventory_items"("id"),
  "requested_qty"  numeric(15, 4) NOT NULL,
  "fulfilled_qty"  numeric(15, 4) NOT NULL DEFAULT '0',
  "notes"          text
);

CREATE INDEX IF NOT EXISTS "stock_requisition_items_requisition_idx"
  ON "stock_requisition_items" ("requisition_id");

CREATE TABLE IF NOT EXISTS "stock_requisition_counters" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "year"      integer NOT NULL,
  "next_seq"  integer NOT NULL DEFAULT 1
);
