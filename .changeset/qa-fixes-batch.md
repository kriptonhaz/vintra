---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

QA fixes from end-to-end Mantra Maker pass.

**`/help/$slug` showed help index, not the article.** `help.tsx` was a leaf route without `<Outlet />`, so the child slug route was unreachable. Renamed to `help.index.tsx` so the two route files become siblings under `/help/`.

**Cashier preview total ignored promo + loyalty redeem.** Cart breakdown showed correct numbers but the payment modal + success modal showed pre-promo, pre-redeem totals — cashier was over-collecting cash. Pulled the math into a shared `computeCartTotals` helper used by both the cart and the parent route, plus wired a debounced `validatePromoCode` query so the promo amount appears in the breakdown the moment the cashier types a valid code.

**Dashboard "Modul" cards showed Segera Hadir for shipped modules.** POS and Inventory cards were hardcoded as locked, even for tenants on Toko / Komplit. Now they read live tier from `moduleSubscriptions` and show Aktif / Trial / Free badges. Finance stays Segera Hadir until that module ships.

**`/pos/reports` Ringkasan was missing Promo total.** `getPOSReport` summary aggregated line discount, sale discount, tax and loyalty redeem but skipped `promo_amount`. Owners using promo codes had no way to see how much they were spending on promo discounts. Added `promoTotal` to the SQL aggregation, the JSON response, the Ringkasan card, and CSV + PDF exports.

**Sale counter started at JQU-YYYY-00000 instead of 00001.** First-ever sale per tenant got seq 0 because the upsert inserted `next_seq=1` without bumping, then read it back unchanged. Rewrote so the INSERT branch seeds `next_seq=2` (we use 1, next sale uses 2) and `RETURNING (next_seq - 1)` gives the just-used number for both INSERT and UPDATE branches. Existing tenants are unaffected — their counters keep incrementing forward correctly.
