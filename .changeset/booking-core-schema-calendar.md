---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-166: Booking Phase 1 — Core schema + slot mode (salon / barber / klinik MVP)

**Schema (4 new tables):**
- `booking_settings` — tenant-level config: mode, industry_template, slot_duration, working_hours jsonb, blackout_dates jsonb
- `booking_resources` — staff/station/room resources with unique (tenant_id, name)
- `booking_services` — services with duration, price, color; unique (tenant_id, name)
- `bookings` — polymorphic booking rows with status lifecycle (pending→confirmed→in_progress→completed / cancelled / no_show), conflict prevention via COALESCE(end_at, start_at) overlap check

**Industry templates:** Salon (3 staff, 30min slots), Barbershop (2 staff, 30min), Klinik (2 dokter, 15min). Hard-coded presets seeded on setup.

**Routes:**
- `/booking/setup` — one-time onboarding wizard, pick template → seeds resources + services
- `/booking` — calendar with week / day / month views. Resources as columns, time slots as rows. Click-empty → create-booking sheet; click-existing → edit sheet with status transitions.

**Permissions:** `booking.read` (view) + `booking.write` (mutate). Granted to owner/admin/supervisor. Free-tier module (no subscription gate).

**Deferred to later phases:** Queue mode, stay mode, public booking page, WA reminders, recurring appointments, group bookings, drag-and-drop reschedule, working-hours / blackout-date enforcement.
