-- Per-item HPP price sync toggle. Default true so existing items
-- keep the current behaviour (always sync) — the column gates both
-- the stock-in uplink and the future "apply HPP price" downlink so
-- power users can opt out per item.
ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "auto_sync_hpp_cost" boolean NOT NULL DEFAULT true;
