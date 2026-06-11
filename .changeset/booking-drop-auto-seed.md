---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-182 follow-up — drop auto-seed of resources and services in `completeBookingSetup`.

Smoke-testing JUR-182 in local dev surfaced two problems with the seeded data:

1. **Seeded services appeared as "habis" in `/pos/cashier`.** The setup wizard wrote `inventory_items` rows with `is_sellable=true` but no `inventory_stock_balances` row (services aren't stock-tracked). The POS product grid showed them as out-of-stock items the cashier couldn't select — broken-looking from the tenant's POV.

2. **Placeholder data was misleading.** "Stylist A / B / C" resources and 5 templated services (with `cost_price=0`, no HPP linkage, no real units) forced tenants to delete + recreate everything anyway. Tenants need to set up services properly — name, price, HPP product linkage for BOM-driven stock deduction — which the setup wizard can't do correctly without the tenant's input.

**Fix:** `completeBookingSetup` now writes only the `booking_settings` row (mode, industry_template, slot_duration_min, setup_completed=true). Resources and services come from the tenant's existing flows:

- **Resources** (staff / station / room): added via the upcoming `/booking/settings` page (JUR-183).
- **Services**: created as `inventory_items` in `/inventory/items` with the normal HPP / pricing / unit setup, then flagged `is_bookable=true` via the JUR-183 toggle.

The dropped seeding logic was the 3-inserts-per-service transaction added in the JUR-182 commit (inventory_items + inventory_item_units + inventory_item_unit_pricing). The `INDUSTRY_TEMPLATES` constant stays — only `template.slotDurationMin` is read at setup time; the `services` and `resources` arrays in the templates are no longer applied to the DB but kept for the JUR-183 UI which may surface them as suggestions ("Need ideas? Salon usually has: Potong / Cat / Smoothing"). They're guidance, not auto-applied state.

Migration not needed — the schema additions from migration 0062 (`is_bookable`, `booking_color`, `booking_duration_min`, `member_id`, `branch_id`) all stay in place; only the seeding behavior changed.

**Tenant-visible behavior change.** A fresh `/booking/setup` now lands on `/booking` with:
- Empty resource columns ("Tanpa Staf" fallback already renders this case).
- Empty service picker in the create-booking sheet.

Both gaps get proper empty-state CTAs in JUR-183.
