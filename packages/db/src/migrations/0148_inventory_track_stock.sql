-- Let an item be sold without carrying stock.
--
-- Consignment ("konsinyasi" / titip jual) is ordinary retail here: the
-- supplier owns the goods, the merchant pays only for what sells, and
-- nobody counts a balance. The model had no way to say that. A plain
-- item with no balance row reads as "0 in stock", and `createSale`'s
-- stock guard refuses the line outright — so a consignment item could
-- be catalogued and priced but never actually rung up.
--
-- The only workaround was to invent a stock number and top it up, which
-- puts a figure in the ledger that was never counted and was never true.
--
-- Defaults to TRUE so every existing item keeps being tracked exactly as
-- before; opting out is the new capability. Recipe-backed items already
-- skip stock by a different route (`linked_hpp_product_id`) — this is for
-- goods that are stocked by someone else, not made to order.
--
-- Hand-written to match every migration since 0006; see CLAUDE.md.
-- Additive + idempotent so it is safe to re-apply.

ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "track_stock" boolean NOT NULL DEFAULT true;
