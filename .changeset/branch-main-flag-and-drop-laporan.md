---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Drop the standalone Laporan menu (sidebar entry, /finance route, dashboard card, landing footer link) and fold its rows into the POS comparison block on /pricing. Also adds a `branches.is_main` flag with a "Tetapkan sebagai Cabang Utama" checkbox on the branch form, a "Utama" badge on the branch list, and a partial unique index that enforces at most one main branch per tenant. The legacy inventory main-branch concept is migrated and kept in sync.
