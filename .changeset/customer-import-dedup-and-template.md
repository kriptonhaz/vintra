---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Two related improvements to `/master/customers` → Import:

1. **In-file phone dedup.** `importCustomers` already deduped against existing DB customers but didn't dedup within the file itself. Qasir exports sometimes carry the same customer twice (e.g. cashier rang up a regular under two slightly different names — "kak Novi jts 2 (hh)" vs "Kak Novi jts 2 (an)" — both pointing at the same phone). The DB has a partial unique index on `(tenant_id, phone)` so the second INSERT used to crash the whole transaction with `Failed query: insert into "customers"...`. Now after parsing, rows are deduped by normalized phone — first occurrence wins, subsequent rows surface in the skipped list with `"Duplikat nomor HP di file (cocok dengan baris N)"` so the operator can see exactly which rows collided.

2. **Downloadable Qasir-format template.** New `getCustomerImportTemplate` server fn builds the exact 6-column layout the parser expects (sheet `Pelanggan`, row 0 = `Subdomain | <tenant-slug>`, rows 1-2 blank padding, row 3 = headers, row 4 = one greyed-out example with `Budi Santoso / 081234567890 / 0 / 0 / 0` so first-timers see the expected types — phone forced to text so Excel doesn't strip the leading zero). The Import dialog gains an "Unduh Template" button in the file-picker step so users don't have to reverse-engineer the format from the docs.

Tested against a real 5,751-row export: pre-fix the import crashed on the first duplicate; post-fix 5,633 unique customers go through, 118 duplicates land in the skipped panel with their line-number cross-references.
