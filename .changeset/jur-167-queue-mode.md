---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-167 — Queue mode for cuci motor / IGD klinik tenants.

**Why now.** A cuci motor client is waiting on this — they need a FIFO queue UI to run their day. Slot-mode bookings (Phase 1) don't fit: walk-ins, no reservation times, "first come first served" with an in-progress ticket per bay.

**Schema (migration 0064, applied to prod):**

```sql
ALTER TABLE bookings ADD COLUMN ticket_number text;             -- "#12" etc., null for slot mode
ALTER TABLE booking_resources ADD COLUMN is_paused boolean NOT NULL DEFAULT false;
CREATE INDEX bookings_resource_status_created_idx ON bookings (resource_id, status, created_at);
```

Both additive — slot-mode tenants unaffected. The new index supports the "fetch this resource's queue in arrival order" query that the QueueView fires on every render.

**Server fns (`apps/web/src/server/functions/booking.ts`):**

- `createQueueTicket({ branchId?, customerId?, publicName?, publicPhone?, resourceId?, serviceIds, note?, source })` — when `resourceId` is omitted, auto-routes to the resource with the shortest pending+in_progress queue (paused resources are skipped; falls back to first active if everything paused). Assigns a `ticket_number` via a per-tenant per-day sequence (`COALESCE(MAX(SUBSTRING(...) AS int), 0) + 1`, format `"#N"`). Sets `mode='queue'`, `status='confirmed'`, `startAt=now()`. Skips the slot-mode conflict check (queue mode doesn't overlap by time).
- `startQueueTicket({ id })` — pending/confirmed → in_progress. Guards via status condition so re-firing doesn't double-promote.
- `completeQueueTicket({ id })` — active → completed + stamps `endAt=now()` (for downstream wait-time analytics).
- `cancelQueueTicket({ id })` — active → cancelled. Guards against re-cancelling completed tickets.
- `toggleResourcePause({ id, isPaused })` — flips `booking_resources.is_paused`. The auto-router checks this on every `createQueueTicket` call.
- `getQueueSnapshot()` — returns all `pending / confirmed / in_progress` bookings for the tenant, ordered by `created_at ASC`. UI groups by `resourceId` client-side. Polled every 15s in the QueueView (server-side WebSocket push deferred to a later ticket).

**Drizzle schema.** `bookingResources.isPaused` (boolean default false), `bookings.ticketNumber` (text nullable), new `bookings_resource_status_created_idx` index.

**UI (`apps/web/src/routes/_authed/booking/queue.tsx` — new file).**

The QueueView replaces the day/week/month calendar entirely when `settings.mode='queue'`. Top-level layout: per-resource columns in a responsive grid (2 cols on sm, 3 on lg, 4 on xl). Each column has:

- **Header** with resource name, `{count} dalam antrian` chip, "Pause" / "Unpause" toggle button. Paused resources get an amber border + "Pause" badge.
- **In-progress slot** (green strip at the top of the column) when a ticket is currently being worked on. Shows the ticket number (large monospace), customer name, "Started at HH:MM" with a clock icon, and a big "Selesai" button.
- **Pending list** below (FIFO ordered by `created_at`). Each ticket: number + position chip + customer name. The first pending ticket gets a "Mulai" button (gated to only fire when no in-progress ticket on this resource, otherwise the operator finishes the current one first). Per-ticket × cancel button.
- **Footer "+ Tambah ke antrian ini"** button — disabled when resource is paused.

Top-level controls:
- `+ Tambah Tiket` header button — opens the CreateQueueTicketSheet with `resourceId=null`, auto-routing to the shortest queue.
- Each column's "+ Tambah ke antrian ini" — opens the same sheet but pinned to that specific resource.
- Total active count chip ("X tiket aktif") so the operator has a glance metric for the day.

**`CreateQueueTicketSheet`** is a slimmed CreateBookingSheet — no time picker (queue mode treats `startAt = now()`), customer search + walk-in name/phone, service multi-pick from the booking-flagged inventory items, optional note. On submit, calls `createQueueTicket` and toasts the assigned ticket number so the operator can call it verbally to the customer.

**`/booking/index.tsx` integration.** When `settings.mode === 'queue'`, bails before the calendar scaffolding and renders the QueueView inside a minimal layout (breadcrumb + branch picker for multi-branch tenants). Day/week/month switcher, navigation arrows, and CreateBookingSheet stay reserved for slot-mode.

**Polling.** QueueView uses `refetchInterval: 15_000` on `getQueueSnapshot`. WebSocket push is deferred to a follow-up — 15s polling is good enough for cuci motor where ticket completion takes minutes, not seconds.

**Out of scope (explicit defer):**

- **WA notifications** ("bersiap, giliran kamu") — needs cleaner WA infrastructure hookup; the ticket spec assumes it, but cuci motor can run without it for v1 (verbal calling works fine in a small shop).
- **Drag-reorder for VIP priority** — rare flow. Operator can cancel + recreate to reorder if needed.
- **Rolling 30-day wait-time estimates** — no historical data yet. v1 just shows queue length ("Antrian: 3"). Once `completed` rows accumulate, a follow-up ticket can compute avg durations.
- **Industry template seeds** — JUR-184 already dropped templates. Tenant picks queue mode in `/booking/settings` and adds their own resources + services via the existing flows.
- **Mode-switching guard** with active-booking confirmation — tenant locked to whatever mode they picked at setup for v1. Cross-mode switching is a v2 admin tool.

**Acceptance checklist (smoke-testable end-to-end):**

1. ✅ Tenant picks `Antrian` in `/booking/settings` mode picker + saves.
2. ✅ Adds 3 resources (Bay 1, Bay 2, Bay 3) via the Anggota Tim / Staf tanpa akun flow.
3. ✅ Marks 3 inventory items as bookable (Cuci Reguler, Premium, Salju).
4. ✅ Visits `/booking` — sees 3 columns instead of the calendar.
5. ✅ Clicks "+ Tambah Tiket", fills walk-in name + service → ticket appears in the shortest column with auto-assigned number (`#1`).
6. ✅ Clicks "Mulai" on the top ticket → it moves to the green in-progress strip.
7. ✅ Clicks "Selesai" → ticket disappears (status=completed). Next pending ticket gets its "Mulai" button enabled.
8. ✅ Clicks pause on a column → ribbon turns amber + new tickets bypass this resource.
9. ✅ Cancel button on a pending ticket → soft-delete via cancelled status.

**Typecheck green. Migration applied to prod.**
