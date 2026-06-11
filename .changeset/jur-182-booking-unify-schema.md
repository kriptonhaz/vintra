---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-182 Booking schema refactor — unify with members + inventory + branches.

**Why.** JUR-166 (Phase 1) shipped three tables that duplicated existing systems: `booking_resources` (vs `tenant_members`), `booking_services` (vs `inventory_items` where `is_sellable=true`), and `booking_settings.working_hours` (vs `branches.business_hours` already consumed by the WhatsApp RAG `operating_hours` retriever). `bookings` also had no `branch_id` column, so per-branch hours couldn't have been enforced anyway. Building UI on top of those would have locked in "rename Mas Budi in two places" UX forever and thrown away the entire HPP / BOM / stock-deduction / POS-integration stack for services. JUR-181 (the original Phase 1.5) was superseded once this was identified.

**Migration 0062 (`booking_unify`, applied to prod).** Safe — `booking_*` tables had no real prod data yet.

- `DROP TABLE booking_services CASCADE` — services live in `inventory_items` from now on.
- `ALTER TABLE booking_settings DROP COLUMN working_hours` — hours live per-branch.
- `ALTER TABLE inventory_items ADD is_bookable boolean NOT NULL DEFAULT false` — gates which sellable items surface in the booking service picker. Default false so existing inventory doesn't pollute the picker until tenants opt in.
- `ALTER TABLE inventory_items ADD booking_color text` — optional hex for calendar bubbles. Mirrors the dropped `booking_services.color`.
- `ALTER TABLE inventory_items ADD booking_duration_min integer` — how long the service takes when booked. Nullable; falls back to `booking_settings.slot_duration_min` then 30 min.
- `ALTER TABLE booking_resources ADD member_id uuid REFERENCES tenant_members(id) ON DELETE SET NULL` — staff-kind resources can link to a real member. NULL is fine for non-staff (station, room) or for seeded "Stylist A" rows that haven't been linked yet.
- `ALTER TABLE bookings ADD branch_id uuid REFERENCES branches(id) ON DELETE SET NULL` + index `(branch_id, start_at)`.
- Seed `master_hpp_units ('jasa', 'Jasa / Layanan')` so the setup wizard has a unit to assign service-type inventory items to.
- `DELETE FROM bookings / booking_resources / booking_settings` — wipe seeded test rows from JUR-166.

**Server fns (`apps/web/src/server/functions/booking.ts`).**

- **Dropped**: `getAllBookingServices`, `createService`, `updateService`, `deleteService` — table no longer exists.
- **Rewired** `getBookingServices` reads `inventory_items WHERE is_sellable=true AND is_bookable=true AND is_active=true` and projects the inventory shape into the calendar's expected `{id, name, durationMin, price, color}` shape via correlated subqueries. Duration: `COALESCE(booking_duration_min, slot_duration_min, 30)`. Price: lowest-min_qty tier from `inventory_item_unit_pricing` (any unit) — v1 simplification; the full tier picker lives in POS.
- **Added** `getBookableMembers` returns `tenant_members WHERE role IN ('owner', 'admin', 'supervisor', 'staff', 'cashier')`. v1 derives "bookable" from role; promote to a dedicated column on `tenant_members` if real-world demand surfaces.
- **Rewrote** `completeBookingSetup`: seeds the industry-template services as `inventory_items` rows (3 inserts per service: `inventory_items` + `inventory_item_units` (default unit = 'jasa') + `inventory_item_unit_pricing` (tier-1 price)). Each row is marked `is_sellable=true AND is_bookable=true` so the new `getBookingServices` query picks them up. Seeded `booking_resources` rows keep `member_id=NULL` — admin links real members via the JUR-183 UI.
- **Extended** `createBooking`:
  - New `branchId` input field. Resolved via `resolveBookingBranch`: explicit → as-is; null + single-branch tenant → auto-pick; null + multi-branch → throws `"Pilih cabang dulu"`.
  - New `assertWithinBranchHours` reads `branches.business_hours` shape `[{day: 0-6, open, close}]` (day 0 = Sunday, matches JS `Date.getDay()`). Throws friendly Indonesian errors when the start time falls outside the branch's hours (or the branch is closed that day). Null-gated — when `branches.business_hours` isn't configured, the check skips entirely.
  - New `assertNotBlackoutDate` reads `booking_settings.blackout_dates` (still tenant-wide; per-tenant holidays make sense for all branches).
- **Extended** `updateResource` accepts optional `memberId` (set to a member ID to link, null to unlink, undefined leaves existing). Also made `name` optional so callers can update only `isActive` or only `memberId`.
- **Extended** `updateBooking` accepts optional `branchId`.

**Drizzle schema updates.**

- `packages/db/src/schema/booking.ts`: dropped `bookingServices` export, dropped `workingHours` column, added `memberId` to `bookingResources`, added `branchId` to `bookings`, added `bookings_branch_start_idx` index.
- `packages/db/src/schema/inventory.ts`: added `isBookable`, `bookingColor`, `bookingDurationMin` columns to `inventoryItems`.

**Out of scope (lives in JUR-183).** All UI surfaces — `is_bookable` toggle in `/inventory/items`, member picker in `/booking/settings`, business-hours editor in `/master/branches`, branch picker in `/booking` calendar header. Also the calendar greying that reads from `branches.business_hours` instead of the (now-dropped) `booking_settings.working_hours`. And the keepers from superseded JUR-181: `+Buat Booking` button, first-run banner, empty-state, out-of-hours greying.

**Behavior changes a user could notice today.** With JUR-182 alone (without JUR-183):

- Tenants who set up booking from `/booking/setup` after this ships get an empty service picker — no inventory item is `is_bookable` by default. They have to manually flag items in `/inventory/items` (no UI yet — needs JUR-183). **Workaround until JUR-183 ships**: `UPDATE inventory_items SET is_bookable=true WHERE name IN ('Potong Rambut', ...)` via SQL, or re-run `/booking/setup` to seed.
- Multi-branch tenants creating a booking without specifying `branch_id` get the `"Pilih cabang dulu"` error. The calendar create-sheet currently doesn't have a branch picker (JUR-183 adds it). Single-branch tenants are unaffected.
- Working-hours enforcement is now real — booking outside `branches.business_hours` throws. Most branches haven't configured `business_hours` yet, so the check no-ops for them. Branches that have configured it (via the WhatsApp RAG flow or direct SQL) start enforcing.

Typecheck green. Migration applied to prod.
