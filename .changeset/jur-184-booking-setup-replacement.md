---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-184 Booking setup replacement — unified `/booking/settings` + staff sync + concurrency cap.

**Why.** The JUR-166 setup wizard was a 3-card industry picker. JUR-182 dropped the service seeding it did, and the JUR-182 follow-up dropped the resource seeding. What was left was a UI that did nothing but write `industry_template` (cosmetic) and `slot_duration_min` (which a tenant should just type). Smoke testing surfaced the template framing as confusing — the tenant's mental model isn't "what industry am I", it's "tell me my slot duration, my staff, and my chair capacity, done."

**Migration 0063 (`booking_max_concurrent`, applied to prod).**

```sql
ALTER TABLE booking_settings
  ADD COLUMN max_concurrent_slots integer;  -- nullable
```

Use case: a barbershop with 3 stylists but only 2 chairs sets this to 2. The calendar still allows 3 staff columns, but `createBooking` rejects a 3rd overlapping confirmed/in-progress booking with `"Slot penuh — kapasitas 2 sedang dipakai."` Null = no cap (existing per-resource overlap rule still applies).

**Server fns (`apps/web/src/server/functions/booking.ts`).**

- **NEW** `getBookingSettingsState()` — single round-trip loader for `/booking/settings`. Returns settings + every resource joined to its linked `tenant_members` row (avoids N+1 in the UI).
- **NEW** `saveBookingSettings({ mode, slotDurationMin, maxConcurrentSlots, blackoutDates? })` — single upsert. Flips `setup_completed=true`. Replaces the template-driven `completeBookingSetup`.
- **NEW** `addBookingStaff({ name, email?, phone? })` — two paths:
  - Email empty: writes only `booking_resources` (name, kind='staff', member_id=NULL). Requires `booking.write`. For stylists who don't need a login.
  - Email present: also calls Supabase `auth.admin.inviteUserByEmail` + inserts `tenant_members` (role='staff', pinned to the tenant's main branch via `tenant_member_branches`) + links via `booking_resources.member_id`. Requires both `booking.write` AND `members.manage` so a supervisor can't escalate privileges via this path. Idempotent — re-adding a tenant member that already exists reuses the existing row instead of throwing.
- **NEW** `deleteBookingResource({ id })` — drops the `booking_resources` row only. Does NOT touch `tenant_members`. Soft-blocks when active bookings (status NOT IN cancelled/completed/no_show) reference the resource.
- **EXTEND** `createBooking` — after the existing per-resource overlap check, adds a tenant-wide concurrency check when `max_concurrent_slots IS NOT NULL`. Scoped to the booking's branch when set, tenant-wide when null. Throws `CAPACITY_FULL` with the Indonesian friendly message.
- **DROP** `completeBookingSetup` (replaced by `saveBookingSettings` + `addBookingStaff`).

**Routes.**

- **NEW** `/booking/settings` — single-page form, three sections (Konfigurasi Slot, Staf, Hari Libur). Gated on `booking.write`; redirects to `/booking` otherwise. First-time setup AND ongoing edits use the same surface — when `setup_completed=false`, a hint banner appears at the top; saving any field flips it to true.
- **DELETE** `/booking/setup` template picker (file replaced with a `redirect({ to: '/booking/settings' })` shim so old sidebar bookmarks and the existing index empty-state CTA keep working until JUR-183 ships its newer CTAs).
- **UPDATE** `/booking/index.tsx` — empty-state CTA points to `/booking/settings` instead of `/booking/setup`.

**Sidebar (`apps/web/src/lib/constants.ts`).**

- `booking.navSetup → booking.navSettings` (label "Pengaturan" / "Settings"); `href` `/booking/setup → /booking/settings`.
- `ROUTE_TITLE_KEYS` updated to match.

**Drizzle schema.** `bookingSettings` gains `maxConcurrentSlots: integer('max_concurrent_slots')` (nullable). No other schema changes.

**i18n.** Booking namespace expanded with ~30 new keys (id + en) for the settings form: mode picker copy, slot/concurrency labels + hints, staff CRUD copy, email-invite hint variants based on `members.manage` permission, etc. Dropped: `setupDesc`, `templateSalon/Barbershop/Klinik`, `templateXxxDesc`, `setupSuccess`. Renamed: `navSetup → navSettings`, `setupTitle → settingsTitle`.

**Staff sync model (per Mantra Maker's ask).**

- Add staff from `/booking/settings` with email → also lands in `/settings/members` (bidirectional convenience).
- Delete staff from `/settings/members` → `booking_resources.member_id` auto-SET-NULL via the FK added in JUR-182. The calendar keeps showing the resource name; history stays intact.
- Delete staff from `/booking/settings` → only the `booking_resources` row drops; tenant_members untouched. Soft-blocked if active bookings exist.

**Workstation concurrency deferred** (per the (a) decision in the design check-in). Simple tenant-wide cap ships in v1; promote to `kind='station'` resources only if a real tenant complains.

**Out of scope (still JUR-183):** `is_bookable` toggle in `/inventory/items`, business-hours editor in `/master/branches`, branch picker in the calendar header for multi-branch tenants, the `+Buat Booking` button + first-run banner + calendar greying for out-of-hours slots.

**Acceptance verified by typecheck + spec walkthrough.** Manual smoke recommended before deploy:
1. `/booking` for a fresh tenant → empty-state CTA → lands on `/booking/settings`.
2. Fill mode + slot duration + max concurrent → save → `setup_completed` flips → calendar renders.
3. Add staff without email → resource-only badge; calendar column appears.
4. Add staff with email → Brevo invite email lands; check `/settings/members`; "Tim" badge in `/booking/settings`.
5. Set `max_concurrent_slots=2`, create 2 overlapping bookings, try a 3rd → friendly Indonesian error.
6. Visit old `/booking/setup` URL → redirected.
