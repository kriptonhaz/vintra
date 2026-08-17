-- Append-only ledger of automatic HPP movements.
--
-- When an ingredient price or a recipe changes, every affected product is
-- recalculated. Without a record of that, "kenapa HPP naik bulan ini?" has no
-- answer: the previous number is simply gone. One row per product whose HPP
-- actually moved, carrying what triggered it and which material, if any.
--
-- Rows are never updated or deleted — a correction is a new row.
--
-- Hand-written to match every migration since 0006; see CLAUDE.md.
-- Additive + idempotent (IF NOT EXISTS) so it is safe to re-apply.

CREATE TABLE IF NOT EXISTS "hpp_price_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "old_hpp" numeric(15, 2),
  "new_hpp" numeric(15, 2) NOT NULL,
  "reason" text NOT NULL,
  "triggered_by_material_id" uuid REFERENCES "materials"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- "what moved recently for this tenant" — the report view.
CREATE INDEX IF NOT EXISTS "hpp_price_history_tenant_created_idx"
  ON "hpp_price_history" ("tenant_id", "created_at");--> statement-breakpoint

-- "why did THIS product's cost change" — the per-product drill-down.
CREATE INDEX IF NOT EXISTS "hpp_price_history_product_created_idx"
  ON "hpp_price_history" ("product_id", "created_at");
