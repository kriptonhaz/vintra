---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

POS reports page (`/pos/reports`) gets three connected upgrades:

1. **Profit gating with a new `pos.report.profit` permission.** The page now requires `pos.read` at both the route-level `beforeLoad` and inside `getPOSReport` (closes a gap where a `pos.transact`-only cashier could hit the URL directly). HPP (modal) / Untung kotor / Margin % cards are sub-gated on a new `pos.report.profit` permission so a Supervisor with `pos.read` still sees revenue and transaction counts but not the cost-side numbers; Owner / Admin / Pemilik Outlet keep full visibility (they auto-receive the new perm via their `all` / `all-except-settings-manage` / explicit templates). CSV + PDF exports skip the cost rows when the caller lacks the perm, and the server zeros out the values as defense in depth so an API spelunker can't pull them.
2. **Configurable void categories per tenant.** New `pos_void_categories` table (system-default + tenant-custom rows) plus a nullable `void_category_id` on `pos_sales`. Five system defaults are seeded lazily per tenant on first read (Ganti metode bayar, Salah input, Pelanggan batal, Item tidak tersedia, Lainnya). The void modal on the sale detail page now requires a category pick above the existing free-text "Alasan" note, and a new "Kategori Pembatalan Transaksi" section under `/pos/settings` lets the owner add custom categories and archive (not delete) any unused row. The reports page renders an "Alasan Pembatalan" breakdown with per-category count + share of total voids; rows without a category bucket as "Tanpa kategori".
3. **Peti Kas at-a-glance tiles** (Sesi dibuka, Selisih, Setor tunai, Tarik tunai) on the report for the selected date range, with a "Lihat detail" link to `/pos/cash-sessions`. Hidden when zero sessions opened in the window so non-cash tenants don't see a strip of zeros.

Migrations: `0122_pos_void_categories.sql` (new table + nullable column on `pos_sales`). The new `pos.report.profit` permission row + its role mappings (Owner / Admin / Pemilik Outlet) have already been seeded directly on the prod database — the `seed-rbac` script has an unrelated pre-existing `ON CONFLICT` constraint issue that prevents a full re-run, so the mappings were inserted via idempotent SQL. Fresh environments that successfully run `seed:rbac` will pick the perm up via the standard flow.
