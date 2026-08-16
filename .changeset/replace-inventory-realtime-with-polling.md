---
"@vintra/web": minor
"@vintra/db": minor
---

Replace the inventory Realtime websocket with a polled stock watermark.

`useInventoryRealtime` opened a Supabase Realtime socket from the root authed
layout — every signed-in user, on every page, subscribed to `postgres_changes`
for `inventory_movements` and `inventory_stock_balances`. `inventory_movements`
is written on every POS sale via BOM deduction, and migration 0137 had set
`REPLICA IDENTITY FULL` on both tables, so each UPDATE also shipped the whole
old row through the WAL. Egress therefore scaled with sales volume rather than
with how many people were actually looking at a stock screen.

`useInventorySync` polls a new `getStockWatermark` server function instead —
two indexed `max(timestamp)` aggregates returned as one opaque ~50-byte string,
every 20s, paused while the tab is hidden and caught up on window focus. When
the string changes, it invalidates exactly the same query keys the Realtime
handler did (`inventory.overview`, `inventory.items`, `inventory.movements`,
`pos`), still deliberately leaving `inventory.stock-adjust` alone so a cashier
mid-count keeps a stable baseline.

Cross-device staleness goes from ~instant to at most 20s, which is imperceptible
for "another till sold something, refresh the stock count".

Migration `0142` unwinds the 0137 setup: both tables leave the
`supabase_realtime` publication, `REPLICA IDENTITY` returns to `DEFAULT`, and
the read policies plus direct `authenticated` SELECT grants are dropped (all
reads go through server functions on the service role). RLS stays enabled, so
the tables are now deny-all for `authenticated`. The unreferenced
`auth_tenant_ids()` helper is dropped with them.
