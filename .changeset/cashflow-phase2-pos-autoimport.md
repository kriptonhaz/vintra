---
"@vintra/web": minor
---

Cashflow Phase 2 — POS auto-import as income rows + backfill (JUR-156).

Every completed POS sale now mirrors into the cashflow ledger automatically, so Komplit tenants no longer re-enter sales by hand.

- `createSale` writes a `pos_sale` income entry in the same transaction (Komplit-gated); `voidSale` removes it so the ledger's net stays correct.
- New platform-admin `backfillPosCashflowEntries` server fn + a "Backfill Cashflow dari POS" action on the admin tenant detail page — imports historical sales, idempotent.
- `/cashflow` ledger: a "Sembunyikan baris POS" toggle to inspect manual entries on their own, and POS-sourced rows now link out to the underlying sale instead of being editable in place.
