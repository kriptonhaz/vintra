-- Tenant-configurable void categories for /pos/reports breakdown
-- (JUR-204). Five system rows seed lazily per-tenant on first read.
CREATE TABLE "pos_void_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_system" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "pos_void_categories_tenant_idx"
  ON "pos_void_categories" ("tenant_id");

-- Optional structured category on each voided sale. Nullable so existing
-- voids — and any new void where the cashier insists on free-text only —
-- bucket as "Tanpa kategori" on the breakdown chart.
ALTER TABLE "pos_sales"
  ADD COLUMN "void_category_id" uuid;
