---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-6: Customer database (per-tenant) — foundation for loyalty + promo codes.

Promotes the per-sale `customer_name + customer_phone` snapshot into a real `customers` table scoped per tenant. Toko + Komplit tenants get a full database UI (`/pos/customers`); Free tenants keep the existing per-sale snapshot behaviour.

**Schema (migration 0022)**:
- `customers` table: tenant-scoped, with name, normalised phone (`62...` form), email, notes, plus aggregates (`total_spent`, `visit_count`, `last_visit_at`).
- Partial unique index on `(tenant_id, phone) WHERE phone IS NOT NULL` so anonymous walk-ins don't collide while real customers dedup on phone.
- `pos_sales.customer_id` FK added; backfilled by grouping existing rows on a SQL phone-normalisation CTE.

**Server**:
- `listCustomers`, `searchCustomersByPhone`, `getCustomer` (with recent 20 sales + per-sale item count), `upsertCustomer`, `deleteCustomer` — all gated behind the new `customer_db` feature flag (Toko + Komplit).
- `createSale` automatically upserts a customer row when name+phone are provided AND the tier has `customer_db`. Aggregates (`total_spent` += sale total, `visit_count` += 1, `last_visit_at` = now) are bumped atomically inside the same transaction.
- `voidSale` reverses the aggregates (`GREATEST(0, total_spent - sale.total)`, same for visit count). `last_visit_at` left as-is — captures "when the customer last walked in" which a void doesn't undo.
- Phone normalisation helper (`normalizePhone`) shared between cashier upsert + customer admin form so all phone variants ("08123", "+62 8123", "08-1-2-3") map to the same canonical "62..." form.

**UI (mobile-responsive throughout)**:
- New `/pos/customers` route — searchable list with tap-to-detail. Card layout that flows naturally on phone (full-width, stacked rows with avatar + aggregates) and tablet (same shape, more horizontal space).
- New `/pos/customers/$customerId` detail — profile card with WhatsApp deep-link on the phone, three-stat grid (total spent, visit count, last visit), notes block, recent-sales timeline (links into `/pos/sales/$saleId`). Stats reflow 2-col on mobile, 3-col on tablet+.
- New `CustomerFormSheet` — sheet-based create/edit form with proper validation, phone helper text explaining auto-normalisation.
- Cashier customer-capture block (Toko+) gains debounced autocomplete: as the cashier types in the phone field, we surface up to 8 matching customers; tap to pre-fill name. Free tier renders the same fields without the autocomplete dropdown.
- POS subnav adds "Pelanggan" link gated behind the `customer_db` feature flag.
- i18n keys added for the new nav label (en + id).

**Tier gate**:
- `customer_db` added to `POS_TOKO_FEATURES` constant.
- Server functions throw "Database pelanggan hanya tersedia di paket Toko atau Komplit" for Free callers.
- Subnav link hides when feature absent.

**What's next** (per the parity-push milestone plan):
- W2: loyalty points (earn + redeem, blocked by this customer table)
- W3: promo codes (per-customer cap blocked by this customer table)
- W4: ingredient consumption wiring
- W5: P&L report + thermal printer
- W6: polish + onboarding + Komplit launch