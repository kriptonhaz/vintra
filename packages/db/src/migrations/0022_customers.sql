-- Customer database (per-tenant). Promotes the per-sale
-- customer_name + customer_phone snapshot into a real customers
-- table. Foundation for loyalty + promo codes (W2-W3).
--
-- Phone is normalised to "62..." form on insert/upsert (server-side
-- helper) so multiple input variants ("08123", "08-123", "+62 8123")
-- map to one row. The unique constraint is partial (tenant_id, phone)
-- — applies only when phone is non-null so anonymous walk-ins don't
-- collide.
--
-- See JUR-6 for full spec.

CREATE TABLE "customers" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  "phone"         text,
  "email"         text,
  "notes"         text,
  -- Aggregates kept up-to-date by createSale + voidSale.
  "total_spent"   numeric(15, 2) NOT NULL DEFAULT 0,
  "visit_count"   integer NOT NULL DEFAULT 0,
  "last_visit_at" timestamp,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  "updated_at"    timestamp NOT NULL DEFAULT now()
);

-- Unique by (tenant_id, phone) — but only when phone is non-null,
-- because anonymous walk-ins (no phone provided) shouldn't collide.
CREATE UNIQUE INDEX "customers_tenant_phone_unique"
  ON "customers" ("tenant_id", "phone")
  WHERE "phone" IS NOT NULL;

-- Search lookups (cashier autocomplete + admin list page).
CREATE INDEX "customers_tenant_name_idx" ON "customers" ("tenant_id", "name");
CREATE INDEX "customers_tenant_phone_idx" ON "customers" ("tenant_id", "phone");

-- Add customer_id to pos_sales. Nullable — ad-hoc walk-ins (no phone)
-- stay null. Existing rows get backfilled below.
ALTER TABLE "pos_sales"
  ADD COLUMN "customer_id" uuid REFERENCES "customers"("id");

CREATE INDEX "pos_sales_customer_idx" ON "pos_sales" ("customer_id")
  WHERE "customer_id" IS NOT NULL;

-- Backfill: insert distinct (tenant, normalised-phone) groups from
-- pos_sales into customers, then update pos_sales.customer_id by
-- joining back on the same normalised-phone match.
--
-- Phone normalisation: strip non-digits, strip leading "0" or "62",
-- prepend "62". Mirrors the Node-side helper used by server functions.
WITH normalised AS (
  SELECT
    s.tenant_id,
    s.id AS sale_id,
    s.created_at,
    s.total,
    s.status,
    s.customer_name AS name,
    '62' || regexp_replace(
      regexp_replace(s.customer_phone, '[^0-9]', '', 'g'),
      '^(0|62)',
      ''
    ) AS norm_phone
  FROM "pos_sales" s
  WHERE s.customer_phone IS NOT NULL
    AND length(regexp_replace(s.customer_phone, '[^0-9]', '', 'g')) >= 8
    AND s.customer_name IS NOT NULL
    AND s.customer_name <> ''
),
aggregated AS (
  SELECT
    tenant_id,
    norm_phone,
    -- Use the most recently captured name (sale order rep + name + phone).
    (array_agg(name ORDER BY created_at DESC))[1] AS latest_name,
    MIN(created_at) AS first_seen,
    MAX(created_at) AS last_seen,
    COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
    COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0::numeric) AS spent
  FROM normalised
  GROUP BY tenant_id, norm_phone
),
inserted AS (
  INSERT INTO "customers" (
    tenant_id, name, phone, total_spent, visit_count, last_visit_at, created_at
  )
  SELECT
    tenant_id, latest_name, norm_phone, spent,
    completed_count::int, last_seen, first_seen
  FROM aggregated
  ON CONFLICT (tenant_id, phone) WHERE phone IS NOT NULL DO NOTHING
  RETURNING id, tenant_id, phone
)
UPDATE "pos_sales" s
SET customer_id = c.id
FROM "customers" c, normalised n
WHERE s.id = n.sale_id
  AND c.tenant_id = n.tenant_id
  AND c.phone = n.norm_phone;
