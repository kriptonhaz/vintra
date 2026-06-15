---
"@vintra/web": minor
"@vintra/db": patch
---

Live cross-device stock sync. A stock change on one device (sale, stock opname, PO receipt) now streams to every other authed tab and refetches the inventory overview, items list, movements ledger, and POS cashier without a manual refresh — via Supabase Realtime `postgres_changes` on `inventory_stock_balances` and `inventory_movements`, gated by RLS (migration 0137) so a socket only ever receives its own tenants' rows. Also hardens stock opname against concurrency: the count discrepancy is now applied as a delta against a frozen per-row baseline on top of the live balance, instead of overwriting with the counted quantity, so sales recorded on other devices during a count are no longer erased.
