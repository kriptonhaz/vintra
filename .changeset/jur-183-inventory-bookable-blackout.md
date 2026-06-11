---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-183 (1/2) — inventory `is_bookable` toggle + blackout dates editor.

**Why.** JUR-182 added the `is_bookable` / `booking_color` / `booking_duration_min` columns to `inventory_items` so services would live in the canonical inventory module. JUR-184 set up the per-service enforcement (working hours, blackout dates). What was missing: the UI surfaces to actually let tenants flag items as bookable and to manage the holiday list.

**`/inventory/items` changes.**

- **List row** gains a "Bisa Dipesan" blue badge next to the existing "Resep" badge whenever `is_bookable=true`. Scannable at a glance.
- **Toolbar filter** — new "Hanya bisa dipesan" checkbox alongside the existing "Hanya stok rendah", scoped to the current view (sellable / ingredients / all).
- **Create + edit forms** gain a new `BookingFields` component (exported from `items.index.tsx`, reused by `items.$itemId.tsx`). Pattern:
  - Toggle "Bisa dipesan di booking" — gates the inner section.
  - When ON: number input "Durasi booking (menit)" — nullable, falls back to `booking_settings.slot_duration_min`. Hint: "Kosongkan = pakai durasi slot default."
  - When ON: 8-swatch color picker (blue / purple / pink / green / amber / red / cyan / grey) + a "no color" × button. Drives the calendar bubble color.
- **Server fns** (`inventory.ts`):
  - `itemInput` Zod schema gains `isBookable`, `bookingColor`, `bookingDurationMin`.
  - `createInventoryItem` defaults `isBookable=false` (opt-in), passes through the other two.
  - `updateInventoryItem` uses the existing explicit-choice pattern (`...(updates.isBookable !== undefined ? { isBookable } : {})`) so partial updates don't clobber unrelated fields.
  - `listInventoryItems` SQL gets `i.is_bookable` in SELECT + GROUP BY; row mapper exposes it as `isBookable`.
  - `getInventoryItem` uses `select()` already, so the new columns flow through automatically.

**`/booking/settings` Section 3 (Hari Libur).**

The placeholder is replaced with a real editor:

- Date input (HTML5 `type=date` with `min=today`) + "+ Tambah" button.
- Inline pills list of saved dates with `×` to remove. Pills format dates as Indonesian long form ("17 Agu 2026") for scannability.
- Auto-save on add/remove via `saveBookingSettings({ blackoutDates: [...] })` (existing fn from JUR-184). Empty state when none.
- Duplicate guard with toast on attempted re-add of an existing date.
- Sorted ASC so the next holiday is leftmost.

Routes through `saveBookingSettings`, which means the section reads current mode/slot/cap state from the parent component to avoid clobbering them with stale defaults.

**Enforcement was already shipped** in JUR-184's `createBooking` (via `assertNotBlackoutDate` reading `booking_settings.blackout_dates`). This commit just adds the UI to populate that column.

**No DB migration.** All columns already exist from JUR-182's 0062.

**Out of scope (deferred to commit 2/2):** branch picker in calendar header, `+ Buat Booking` button, out-of-hours greying, create-sheet branchId field, HPP linkage hint.
