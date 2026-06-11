---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

POS multi-tax: each tenant configures any number of tax lines.

Until now Pengaturan Kasir had a single tax row labeled PPN. Restaurant tenants (PB1 + service charge) and shops outside the standard PPN model had no way to express their actual tax stack — they'd either lose tax on the receipt or hand-do the math.

Replace the single `(tax_enabled, tax_percent, tax_label)` triplet on `pos_settings` with a `taxes JSONB` array of `{label, percent, active}` rows:

- **Settings page** swaps the single Pajak section for a list editor: Tambah baris, label + percent + active toggle, hapus
- **Cashier breakdown** renders one row per active tax line ("PPN 11%" + "PB1 10%")
- **Receipt** (thermal + A4) renders each tax line separately — pre-multi-tax sales fall back to the legacy single label
- **Per-sale snapshot**: new `pos_sales.tax_lines` JSONB stores `{label, percent, amount}` per row at sale time so retro tax-rate edits don't rewrite history. Singular `tax_amount` column stays as the SUM (back-compat with reports + receipt total).
- **Math**: each tax applies independently to the post-discount, post-promo, post-redeem subtotal. No cumulative stacking (PB1-on-top-of-service-charge); if you need that model say the word and I'll add it.

Migration `0029_pos_multi_tax.sql` seeds the new array from each tenant's existing single-tax columns and adds the `tax_lines` snapshot column to `pos_sales`. Old scalar columns kept for one release as a fallback in case we need to revert.
