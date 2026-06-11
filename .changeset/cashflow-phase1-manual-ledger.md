---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Add Cashflow Monitoring Phase 1 — manual income/expense ledger (JUR-155).

Komplit-tier tenants get a new "Cashflow" module to record money in and out of the business by hand — the foundation for later phases (POS auto-import, AR/AP, dashboard).

- New `cashflow_categories` (shared system rows + tenant-custom rows) and `cashflow_entries` tables, migration `0077`, with 12 seeded system categories (Modal, Penjualan, Gaji, Sewa, Listrik, …).
- New `/cashflow` ledger page: paginated table, date-range + category + type filters (defaults to the current month), and an income / expense / net summary.
- New `/cashflow/kategori` page: CRUD for tenant-custom categories. System categories can't be edited or deleted; a category still referenced by entries can't be deleted.
- New "Cashflow" sidebar entry, gated on the Komplit-bundled `cashflow` feature flag — non-Komplit tenants see a "Pro" lock and an upgrade gate.
- Server functions enforce Komplit + `pos.read`; mutations refuse to touch non-manual rows so future POS-imported entries stay read-only.
