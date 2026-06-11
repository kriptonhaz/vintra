---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-183 (2/2) — booking calendar polish: branch picker + Buat Booking button + out-of-hours greying + create-sheet branchId + HPP linkage hint.

**Why.** JUR-182 added `bookings.branch_id` + branch-scoped working-hours enforcement server-side, but the calendar UI had no way to pick a branch (multi-branch tenants got `"Pilih cabang dulu"` errors with no surface to resolve), no way to discover the "click empty slot → create" gesture, and no visual cue for when a slot was outside business hours. This commit closes those gaps.

**Server fn — `listBookingBranches`** (`apps/web/src/server/functions/booking.ts`):

- Returns `{ id, name, isMain, isActive, businessHours }` for the tenant's active branches, gated on `booking.read` (so booking-only tenants without the attendance module can still read their branches — `listBranches` in attendance-branches.ts gates on the attendance module).
- Also extended `getBookingServices` to project `linkedHppProductId` so the create-sheet can show the HPP-deduction hint.

**Calendar header (`/booking/index.tsx`)** gains two new controls in the top-right cluster:

- **Branch picker** — `<select>` populated from `listBookingBranches`. Auto-picks the tenant's main branch (or first available) on mount via a guarded `setState` during render; only rendered when `branches.length > 1`. Single-branch tenants see no picker. The selected branch drives both booking filtering and the greying.
- **`+ Buat Booking` button** — pre-selects the first active resource + the next hour rounded to `:00`. Opens the existing `CreateBookingSheet`. Disabled when `resources.length === 0` to avoid opening an unusable sheet.

**Booking filtering by branch.** `bookingList` now filters out any booking whose `branchId` doesn't match the selected branch. Legacy bookings with null `branchId` show in every branch view as a fallback (so existing test data doesn't disappear when the picker is added).

**Out-of-hours greying** (`DayColumnView`):

- New `businessHours` prop (`Array<{ day: 0-6, open, close }> | null`) from the selected branch.
- `isWithinHours(day, hour)` helper checks `business_hours[day_of_week]` against the slot's hour. Null business_hours = always allow (matches server null-gating).
- Out-of-hours slots get `cursor-not-allowed bg-gray-50` styling AND skip rendering the click-capture button (so the cell is truly non-interactive, not just visually disabled — matches the pattern shipped in JUR-182's POS cashier fix).

**`CreateBookingSheet`** extensions:

- Accepts the new `branchId` prop (from the header picker) and passes it through to `createBooking`. Single-branch tenants get the auto-resolved id (from `selectedBranchId` default) so the server's "Pilih cabang dulu" path never fires.
- New empty-state when `services.length === 0`: "Belum ada layanan. Buat item di Inventaris dan centang 'Bisa dipesan di booking'." — points the tenant directly at the JUR-183 1/2 toggle.
- New HPP linkage hint banner with a Sparkles icon when ANY picked service has `linkedHppProductId`: "Konsumsi inventaris (resep HPP) akan dihitung otomatis saat layanan selesai." Primes the tenant for the future POS-conversion flow even though Phase 1 doesn't auto-deduct yet — sets expectation without overpromising.

**No DB migration.** All schema in place from JUR-166/182.

**Typecheck green.**

**JUR-183 is now complete** (combined with the 1/2 commit). All seven items from the rewritten ticket spec shipped:
1. ✅ `is_bookable` toggle in `/inventory/items` (1/2)
2. ✅ Business hours editor in `/master/branches` (already existed pre-JUR-183)
3. ✅ Branch picker in calendar header (this commit)
4. ✅ `+Buat Booking` button (this commit)
5. ✅ Out-of-hours calendar greying (this commit)
6. ✅ Create-sheet branchId field + HPP hint (this commit)
7. ✅ Blackout dates editor (1/2)
