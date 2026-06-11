---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

POS surface now respects the per-branch POS toggle. Previously a branch toggled off for the POS module (e.g. a gudang / warehouse, or a tenant's "Pusat" used only for stok + HR) still appeared in the cashier branch picker, and once selected the tenant-level POS feature flags (promo, stamp, loyalty) lit up for it — because feature gating was driven by tenant `pos_tier`, not by the per-branch `enabled_modules` toggle. Sales recorded under such a branch flowed through `createSale` without complaint.

Two-layer fix:
1. `getPOSCashierMasters` now filters its branch list with `'pos' = ANY(enabled_modules)`, so the cashier picker only ever surfaces POS-enabled branches.
2. `assertBranchAllowedForTier` adds an unconditional POS-toggle check (runs on every tier including unlimited Komplit) plus filters the tier-cap "first N branches by createdAt" slice by the same predicate. `createSale` therefore rejects a sale addressed to a non-POS branch with *"Cabang ini belum mengaktifkan modul POS. Aktifkan dari Data Master → Cabang."*

`voidSale`, `listSales`, and the reports endpoints intentionally don't gain the check — they operate on already-created rows, so a tenant who previously rang sales against a non-POS branch (Es Teh Paus Pusat had 7 such sales before this fix landed) can still see them in history and void them if needed. Behaviour change: a tenant who forgets to tick POS on a new outlet now sees a clean error instead of silent sales going through; the fix is one click in `/master/branches`.
