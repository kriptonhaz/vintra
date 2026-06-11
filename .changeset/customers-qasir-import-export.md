---
"@vintra/web": minor
---

Qasir-compatible customer import + export.

Tenants migrating from Qasir can now drop their `Pelanggan YYYY-MM-DD HH-MM-SS.xlsx` straight into `/master/customers` and have it backfill the database. Export round-trips the same shape so the file the user just imported looks identical to what they download next.

**Export** (`/master/customers` → Export button): writes the 6-column Qasir layout — `Subdomain` metadata row + blank padding + `Nama Pelanggan | Email | Nomor Telepon | Transaksi | Kasbon | Poin`. `Transaksi` reads `customers.visit_count`; `Kasbon` aggregates outstanding `ar_receivables` (sum of `amount - paid_amount` where status is `outstanding|partial`); `Poin` reads `customer_loyalty_balances.points_balance`.

**Import** (`/master/customers` → Import button → file picker → preview → confirm): two-pass — preview returns counts (new vs update, poin to seed, kasbon to insert, plus skipped-row breakdown) without writing anything; confirm replays inside a single transaction. Decisions baked in:

- **Dedup on (tenant, normalized phone)** via the existing `normalizePhone` helper. Phones in any format the export contains (`+62…` / `62…` / `0…` / no-prefix `8…`) all canonicalize. Garbage like `55893625471` is logged as skipped, not aborted.
- **`Transaksi` overwrites** `visit_count` on update. Qasir's value is the authoritative snapshot — incrementing would double on every re-import.
- **`Poin` only seeds NEW customers**, never overwrites a live balance. Re-importing a stale export can't erase recent earnings. Seeds both `points_balance` and `lifetime_earned` to the imported value.
- **`Kasbon` creates one `ar_receivables` row** per non-zero value with `note="Imported from Qasir YYYY-MM-DD"`. Idempotent: if any customer already has an "Imported from Qasir" AR row, kasbon for that row is skipped (re-uploading the same file won't double the debt).
- **Feature-gated silently**: loyalty-balance writes drop when the tenant lacks `loyalty_points` (Komplit feature). The preview reports the dropped count so the operator sees what's being skipped.

Both endpoints are gated on the existing `customer_db` POS feature (Toko or Komplit tier).
