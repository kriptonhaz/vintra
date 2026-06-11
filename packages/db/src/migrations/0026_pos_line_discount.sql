-- JUR-7: Line-level discount for cashier.
--
-- Today the cashier supports sale-level discount only. This adds
-- per-line discount columns so the "tukang lapak" use case works (one
-- item gets 10% off, others stay full price).
--
-- `subtotal` semantics on pos_sale_items now equal
-- `qty × unit_price - line_discount_amount`. Old rows have
-- `line_discount_amount = 0` so their subtotal stays unchanged.

ALTER TABLE "pos_sale_items"
  ADD COLUMN "line_discount_type" text,
  ADD COLUMN "line_discount_value" numeric(15, 2),
  ADD COLUMN "line_discount_amount" numeric(15, 2) NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Same constraint pattern as pos_sales.discount_type — null means "no
-- line discount", otherwise one of fixed/percent.
ALTER TABLE "pos_sale_items"
  ADD CONSTRAINT "pos_sale_items_line_discount_type_chk"
  CHECK (
    "line_discount_type" IS NULL
    OR "line_discount_type" IN ('fixed', 'percent')
  );
