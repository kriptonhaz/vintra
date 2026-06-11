import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  bookingSettings,
  bookingResources,
  bookings,
  customers,
  inventoryItems,
  tenantMembers,
  branches,
} from '@vintra/db/schema'
import { eq, and, gte, lte, or, ilike, sql, inArray, asc } from 'drizzle-orm'
import { requirePermission } from '../middleware/auth'

export interface IndustryTemplate {
  mode: 'slot'
  slotDurationMin: number
  resources: Array<{ name: string; kind: 'staff' | 'station' | 'room' }>
  services: Array<{ name: string; durationMin: number; price: string; color: string; requiresResourceKind: string }>
}

export const INDUSTRY_TEMPLATES: Record<string, IndustryTemplate> = {
  salon: {
    mode: 'slot',
    slotDurationMin: 30,
    resources: [
      { name: 'Stylist A', kind: 'staff' },
      { name: 'Stylist B', kind: 'staff' },
      { name: 'Stylist C', kind: 'staff' },
    ],
    services: [
      { name: 'Potong Rambut', durationMin: 30, price: '50000', color: '#3B82F6', requiresResourceKind: 'staff' },
      { name: 'Cat Rambut', durationMin: 90, price: '150000', color: '#8B5CF6', requiresResourceKind: 'staff' },
      { name: 'Smoothing', durationMin: 120, price: '200000', color: '#EC4899', requiresResourceKind: 'staff' },
      { name: 'Creambath', durationMin: 45, price: '75000', color: '#10B981', requiresResourceKind: 'staff' },
      { name: 'Blow Dry', durationMin: 20, price: '35000', color: '#F59E0B', requiresResourceKind: 'staff' },
    ],
  },
  barbershop: {
    mode: 'slot',
    slotDurationMin: 30,
    resources: [
      { name: 'Barber A', kind: 'staff' },
      { name: 'Barber B', kind: 'staff' },
    ],
    services: [
      { name: 'Cukur Rambut', durationMin: 30, price: '30000', color: '#3B82F6', requiresResourceKind: 'staff' },
      { name: 'Cuci Rambut', durationMin: 15, price: '15000', color: '#10B981', requiresResourceKind: 'staff' },
      { name: 'Pijat Kepala', durationMin: 30, price: '40000', color: '#8B5CF6', requiresResourceKind: 'staff' },
      { name: 'Cukur + Cuci', durationMin: 45, price: '40000', color: '#F59E0B', requiresResourceKind: 'staff' },
      { name: 'Styling', durationMin: 20, price: '25000', color: '#EC4899', requiresResourceKind: 'staff' },
    ],
  },
  klinik: {
    mode: 'slot',
    slotDurationMin: 15,
    resources: [
      { name: 'Dokter Umum', kind: 'staff' },
      { name: 'Dokter Gigi', kind: 'staff' },
    ],
    services: [
      { name: 'Konsultasi Umum', durationMin: 15, price: '50000', color: '#3B82F6', requiresResourceKind: 'staff' },
      { name: 'Vaksinasi', durationMin: 15, price: '100000', color: '#10B981', requiresResourceKind: 'staff' },
      { name: 'Cek Gula Darah', durationMin: 10, price: '25000', color: '#F59E0B', requiresResourceKind: 'staff' },
      { name: 'Cek Tensi', durationMin: 10, price: '20000', color: '#8B5CF6', requiresResourceKind: 'staff' },
      { name: 'Cabut Gigi', durationMin: 30, price: '150000', color: '#EC4899', requiresResourceKind: 'staff' },
    ],
  },
}

// ─── Queries ─────────────────────────────────────────────────────────

export const getBookingSettings = createServerFn().handler(async () => {
  const { tenantId } = await requirePermission('booking.read')
  const [settings] = await db
    .select()
    .from(bookingSettings)
    .where(eq(bookingSettings.tenantId, tenantId))
    .limit(1)
  return settings ?? null
})

export const getBookingResources = createServerFn().handler(async () => {
  const { tenantId } = await requirePermission('booking.read')
  return db
    .select()
    .from(bookingResources)
    .where(and(eq(bookingResources.tenantId, tenantId), eq(bookingResources.isActive, true)))
    .orderBy(bookingResources.name)
})

/**
 * JUR-182: returns "services" sourced from inventory_items where
 * is_sellable=true AND is_bookable=true. Maps the inventory shape into
 * the shape the calendar expects: { id, name, durationMin, price, color }.
 *
 * Price comes from the lowest-min_qty tier in inventory_item_unit_pricing
 * (any unit) — a v1 simplification. The full tier picker lives in POS.
 * Duration falls back to booking_settings.slot_duration_min, then 30 min.
 */
export const getBookingServices = createServerFn().handler(async () => {
  const { tenantId } = await requirePermission('booking.read')
  const rows = await db
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      color: inventoryItems.bookingColor,
      // JUR-183: surfaced so the create-sheet can show a "stock akan
      // dikurangi otomatis" hint when a service has a recipe link.
      linkedHppProductId: inventoryItems.linkedHppProductId,
      durationMin: sql<number>`COALESCE(
        ${inventoryItems.bookingDurationMin},
        (SELECT slot_duration_min FROM booking_settings WHERE tenant_id = ${tenantId}),
        30
      )::int`,
      price: sql<string>`COALESCE(
        (SELECT unit_price::text FROM inventory_item_unit_pricing
         WHERE item_id = ${inventoryItems.id}
         ORDER BY min_qty ASC, sort_order ASC
         LIMIT 1),
        '0'
      )`,
    })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.isSellable, true),
        eq(inventoryItems.isBookable, true),
        eq(inventoryItems.isActive, true),
      ),
    )
    .orderBy(inventoryItems.name)
  return rows
})

/**
 * JUR-183: tenant's branches for the calendar header picker + greying.
 * Returns id, name, isMain, businessHours, isActive. Gated on
 * booking.read so booking-only tenants (no attendance module) can
 * still see their branches in the calendar.
 */
export const listBookingBranches = createServerFn().handler(async () => {
  const { tenantId } = await requirePermission('booking.read')
  return db
    .select({
      id: branches.id,
      name: branches.name,
      isMain: branches.isMain,
      isActive: branches.isActive,
      businessHours: branches.businessHours,
    })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)))
    .orderBy(asc(branches.name))
})

const bookingsInput = z.object({
  startDate: z.string(),
  endDate: z.string(),
})

export const getBookings = createServerFn({ method: 'POST' })
  .inputValidator(bookingsInput)
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.read')
    const start = new Date(data.startDate)
    const end = new Date(data.endDate)
    return db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          or(
            and(gte(bookings.startAt, start), lte(bookings.startAt, end)),
            and(
              gte(sql`COALESCE(${bookings.endAt}, ${bookings.startAt})`, start),
              lte(sql`COALESCE(${bookings.endAt}, ${bookings.startAt})`, end),
            ),
          ),
          sql`${bookings.status} != 'cancelled'`,
        ),
      )
      .orderBy(bookings.startAt)
  })

export const getBookingDetail = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.read')
    const [row] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, data.id), eq(bookings.tenantId, tenantId)))
      .limit(1)
    if (!row) throw new Error('Booking tidak ditemukan')
    return row
  })

/**
 * JUR-182: returns tenant_members eligible to be linked to a staff-kind
 * booking_resource. v1 derives "bookable" from role (admin / owner /
 * staff / cashier / supervisor) rather than adding a dedicated column.
 */
export const getBookableMembers = createServerFn().handler(async () => {
  const { tenantId } = await requirePermission('booking.read')
  return db
    .select({
      id: tenantMembers.id,
      firstName: tenantMembers.firstName,
      lastName: tenantMembers.lastName,
      jobTitle: tenantMembers.jobTitle,
      photoKey: tenantMembers.photoKey,
      role: tenantMembers.role,
    })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        inArray(tenantMembers.role, ['owner', 'admin', 'supervisor', 'staff', 'cashier']),
      ),
    )
    .orderBy(tenantMembers.firstName)
})

// ─── JUR-184: Settings page state + save ─────────────────────────────

/**
 * Single-round-trip loader for `/booking/settings`. Returns:
 *   - settings: the booking_settings row (or null)
 *   - members: every tenant_member eligible for booking (roles
 *     owner/admin/supervisor/staff/cashier), with a `resourceId` field
 *     indicating whether they're currently surfaced in the calendar.
 *     Null resourceId = toggle is OFF; set = toggle is ON.
 *   - resourceOnly: booking_resources rows that aren't linked to any
 *     member (kind='staff' with member_id=NULL — the "tanpa akun"
 *     list). Resources linked to members are surfaced via `members`
 *     to keep the UI from rendering the same person twice.
 */
export const getBookingSettingsState = createServerFn().handler(async () => {
  const { tenantId } = await requirePermission('booking.read')

  const [settings] = await db
    .select()
    .from(bookingSettings)
    .where(eq(bookingSettings.tenantId, tenantId))
    .limit(1)

  const members = await db
    .select({
      memberId: tenantMembers.id,
      firstName: tenantMembers.firstName,
      lastName: tenantMembers.lastName,
      phone: tenantMembers.phone,
      photoKey: tenantMembers.photoKey,
      role: tenantMembers.role,
      jobTitle: tenantMembers.jobTitle,
      resourceId: bookingResources.id,
      resourceIsActive: bookingResources.isActive,
    })
    .from(tenantMembers)
    .leftJoin(
      bookingResources,
      and(
        eq(bookingResources.memberId, tenantMembers.id),
        eq(bookingResources.tenantId, tenantId),
      ),
    )
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        inArray(tenantMembers.role, ['owner', 'admin', 'supervisor', 'staff', 'cashier']),
      ),
    )
    .orderBy(asc(tenantMembers.firstName))

  const resourceOnly = await db
    .select({
      id: bookingResources.id,
      name: bookingResources.name,
      kind: bookingResources.kind,
      isActive: bookingResources.isActive,
      createdAt: bookingResources.createdAt,
    })
    .from(bookingResources)
    .where(
      and(
        eq(bookingResources.tenantId, tenantId),
        sql`${bookingResources.memberId} IS NULL`,
      ),
    )
    .orderBy(asc(bookingResources.name))

  return { settings: settings ?? null, members, resourceOnly }
})

/**
 * JUR-184 follow-up: flip whether a tenant_member shows up as a
 * calendar column. enable=true creates a booking_resources row linked
 * to the member (auto-named from firstName+lastName, falling back to
 * 'Anggota' + a short id suffix on the rare same-name collision).
 * enable=false deletes the linked resource row (soft-blocked if any
 * active bookings reference it). tenant_members rows are never
 * touched — this is purely about calendar visibility.
 */
export const toggleMemberBookable = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ memberId: z.string().uuid(), enable: z.boolean() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')

    const [member] = await db
      .select({
        id: tenantMembers.id,
        firstName: tenantMembers.firstName,
        lastName: tenantMembers.lastName,
      })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.id, data.memberId), eq(tenantMembers.tenantId, tenantId)))
      .limit(1)
    if (!member) throw new Error('Anggota tim tidak ditemukan')

    const [existing] = await db
      .select({ id: bookingResources.id })
      .from(bookingResources)
      .where(
        and(
          eq(bookingResources.tenantId, tenantId),
          eq(bookingResources.memberId, data.memberId),
        ),
      )
      .limit(1)

    if (data.enable) {
      if (existing) return { resourceId: existing.id }

      const baseName =
        `${member.firstName ?? 'Anggota'}${member.lastName ? ' ' + member.lastName : ''}`.trim() ||
        'Anggota'

      // Unique (tenant_id, name) constraint — retry with id suffix if
      // a same-name resource already exists.
      try {
        const [created] = await db
          .insert(bookingResources)
          .values({
            tenantId,
            name: baseName,
            kind: 'staff',
            memberId: data.memberId,
          })
          .returning({ id: bookingResources.id })
        return { resourceId: created!.id }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!message.toLowerCase().includes('unique')) throw err
        const [created] = await db
          .insert(bookingResources)
          .values({
            tenantId,
            name: `${baseName} (${data.memberId.slice(0, 4)})`,
            kind: 'staff',
            memberId: data.memberId,
          })
          .returning({ id: bookingResources.id })
        return { resourceId: created!.id }
      }
    } else {
      if (!existing) return { resourceId: null }

      const activeBookings = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.tenantId, tenantId),
            eq(bookings.resourceId, existing.id),
            sql`${bookings.status} NOT IN ('cancelled', 'completed', 'no_show')`,
          ),
        )
        .limit(1)
      if (activeBookings.length > 0) {
        throw new Error(
          'Tidak bisa dinonaktifkan — masih ada booking aktif untuk anggota ini.',
        )
      }

      await db
        .delete(bookingResources)
        .where(
          and(
            eq(bookingResources.id, existing.id),
            eq(bookingResources.tenantId, tenantId),
          ),
        )
      return { resourceId: null }
    }
  })

const saveSettingsInput = z.object({
  mode: z.enum(['slot', 'queue', 'stay']),
  slotDurationMin: z.number().int().min(5).max(720),
  maxConcurrentSlots: z.number().int().min(1).max(99).nullable().optional(),
  blackoutDates: z.array(z.string()).optional(),
})

/**
 * Single upsert for the settings form. Flips setup_completed=true on
 * every save so first-time + ongoing flows hit the same code path.
 * Replaces the old completeBookingSetup template wizard.
 */
export const saveBookingSettings = createServerFn({ method: 'POST' })
  .inputValidator(saveSettingsInput)
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')

    const values = {
      tenantId,
      mode: data.mode,
      slotDurationMin: data.slotDurationMin,
      maxConcurrentSlots: data.maxConcurrentSlots ?? null,
      ...(data.blackoutDates !== undefined ? { blackoutDates: data.blackoutDates } : {}),
      setupCompleted: true,
    }

    await db
      .insert(bookingSettings)
      .values(values)
      .onConflictDoUpdate({
        target: bookingSettings.tenantId,
        set: {
          mode: data.mode,
          slotDurationMin: data.slotDurationMin,
          maxConcurrentSlots: data.maxConcurrentSlots ?? null,
          ...(data.blackoutDates !== undefined ? { blackoutDates: data.blackoutDates } : {}),
          setupCompleted: true,
          updatedAt: new Date(),
        },
      })

    return { success: true }
  })

// ─── JUR-184: Staff (resource + optional member sync) ────────────────

/**
 * JUR-184 follow-up: resource-only path. Adds a `booking_resources`
 * row with `member_id=NULL` — for stylists who appear in the calendar
 * but don't have a tenant_members login. Inviting a full team member
 * with email lives in `/settings/members` (canonical flow); we don't
 * duplicate it here. Existing team members are toggled into the
 * calendar via `toggleMemberBookable`, not this fn.
 */
export const addBookingStaff = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ name: z.string().min(1, 'Nama wajib diisi').max(120) }))
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')
    const [resource] = await db
      .insert(bookingResources)
      .values({
        tenantId,
        name: data.name.trim(),
        kind: 'staff',
      })
      .returning()
    return { resource }
  })

// ─── JUR-167: Queue mode ────────────────────────────────────────────────

/**
 * Auto-route a queue ticket to the resource with the shortest pending
 * queue. Skips paused resources. Falls back to the first active resource
 * when everything is paused (rare — admin should unpause before opening).
 */
async function pickResourceWithShortestQueue(
  tenantId: string,
  branchId: string | null,
): Promise<string | null> {
  const rows = await db
    .select({
      id: bookingResources.id,
      pending: sql<number>`(
        SELECT count(*)::int FROM bookings
        WHERE resource_id = ${bookingResources.id}
          AND status IN ('pending', 'confirmed', 'in_progress')
      )`,
    })
    .from(bookingResources)
    .where(
      and(
        eq(bookingResources.tenantId, tenantId),
        eq(bookingResources.isActive, true),
        eq(bookingResources.isPaused, false),
      ),
    )
    .orderBy(asc(sql`pending`), asc(bookingResources.name))
  if (rows.length === 0) {
    // All resources paused — fall back to the first active one regardless.
    const [fallback] = await db
      .select({ id: bookingResources.id })
      .from(bookingResources)
      .where(
        and(eq(bookingResources.tenantId, tenantId), eq(bookingResources.isActive, true)),
      )
      .orderBy(asc(bookingResources.name))
      .limit(1)
    return fallback?.id ?? null
  }
  void branchId // reserved for future per-branch routing
  return rows[0]!.id
}

/** Per-tenant per-day sequence for ticket numbers. v1 races are rare
 *  (one operator at the counter); a counter table can promote to atomic
 *  if real-world collisions show up. */
async function nextTicketNumber(tenantId: string): Promise<string> {
  const [row] = await db
    .select({
      maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${bookings.ticketNumber} FROM '[0-9]+$') AS integer)), 0)::int`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        sql`${bookings.ticketNumber} IS NOT NULL`,
        sql`DATE(${bookings.createdAt}) = CURRENT_DATE`,
      ),
    )
  return `#${(row?.maxNum ?? 0) + 1}`
}

const createQueueTicketInput = z.object({
  branchId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().optional(),
  publicName: z.string().max(200).optional(),
  publicPhone: z.string().max(40).optional(),
  // Optional — when omitted, auto-route to the shortest queue.
  resourceId: z.string().uuid().optional(),
  serviceIds: z.array(z.string()).default([]),
  note: z.string().max(500).optional(),
  source: z.enum(['walk_in', 'public_page', 'wa', 'manual']).default('walk_in'),
})

export const createQueueTicket = createServerFn({ method: 'POST' })
  .inputValidator(createQueueTicketInput)
  .handler(async ({ data }) => {
    const { tenantId, userId } = await requirePermission('booking.write')

    if (!data.customerId && !data.publicName?.trim()) {
      throw new Error('Nama pelanggan wajib diisi')
    }

    const branchId = await resolveBookingBranch(tenantId, data.branchId)

    let resourceId = data.resourceId
    if (!resourceId) {
      const routed = await pickResourceWithShortestQueue(tenantId, branchId)
      if (!routed) throw new Error('Belum ada sumber daya — tambah di Pengaturan Booking dulu')
      resourceId = routed
    }

    const ticketNumber = await nextTicketNumber(tenantId)
    const now = new Date()

    const [booking] = await db
      .insert(bookings)
      .values({
        tenantId,
        branchId,
        customerId: data.customerId ?? null,
        publicName: data.publicName?.trim() ?? null,
        publicPhone: data.publicPhone?.trim() ?? null,
        mode: 'queue',
        startAt: now,
        // endAt set on Selesai. Conflict check in createBooking is bypassed
        // because queue mode doesn't use time-based overlap.
        status: 'confirmed',
        resourceId,
        serviceIds: data.serviceIds,
        note: data.note ?? null,
        ticketNumber,
        source: data.source,
        createdByUserId: userId,
      })
      .returning()

    return booking
  })

/** Promote a queued ticket to in_progress (operator clicked "Mulai"). */
export const startQueueTicket = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')
    const [updated] = await db
      .update(bookings)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(
        and(
          eq(bookings.id, data.id),
          eq(bookings.tenantId, tenantId),
          sql`${bookings.status} IN ('pending', 'confirmed')`,
        ),
      )
      .returning()
    if (!updated) throw new Error('Tiket sudah berjalan atau tidak ditemukan')
    return updated
  })

/** Mark ticket completed + stamp endAt (operator clicked "Selesai"). */
export const completeQueueTicket = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')
    const now = new Date()
    const [updated] = await db
      .update(bookings)
      .set({ status: 'completed', endAt: now, updatedAt: now })
      .where(
        and(
          eq(bookings.id, data.id),
          eq(bookings.tenantId, tenantId),
          sql`${bookings.status} IN ('pending', 'confirmed', 'in_progress')`,
        ),
      )
      .returning()
    if (!updated) throw new Error('Tiket sudah selesai atau tidak ditemukan')
    return updated
  })

/** Cancel a queued ticket (no-show or operator-cancelled). */
export const cancelQueueTicket = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')
    const [updated] = await db
      .update(bookings)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(bookings.id, data.id),
          eq(bookings.tenantId, tenantId),
          sql`${bookings.status} NOT IN ('completed', 'cancelled')`,
        ),
      )
      .returning()
    if (!updated) throw new Error('Tiket tidak bisa dibatalkan')
    return updated
  })

/** Pause / unpause a resource (lunch break, bay out of service). */
export const toggleResourcePause = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid(), isPaused: z.boolean() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')
    const [updated] = await db
      .update(bookingResources)
      .set({ isPaused: data.isPaused })
      .where(
        and(eq(bookingResources.id, data.id), eq(bookingResources.tenantId, tenantId)),
      )
      .returning()
    if (!updated) throw new Error('Sumber daya tidak ditemukan')
    return updated
  })

/**
 * JUR-167: queue snapshot for the QueueView. Returns active tickets
 * (pending / confirmed / in_progress) grouped by resource so the UI
 * renders per-bay columns without N+1 round trips. Ordered by
 * created_at ASC so FIFO arrival order is implicit.
 */
export const getQueueSnapshot = createServerFn().handler(async () => {
  const { tenantId } = await requirePermission('booking.read')
  return db
    .select({
      id: bookings.id,
      resourceId: bookings.resourceId,
      ticketNumber: bookings.ticketNumber,
      publicName: bookings.publicName,
      publicPhone: bookings.publicPhone,
      customerId: bookings.customerId,
      serviceIds: bookings.serviceIds,
      status: bookings.status,
      note: bookings.note,
      startAt: bookings.startAt,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        sql`${bookings.status} IN ('pending', 'confirmed', 'in_progress')`,
      ),
    )
    .orderBy(asc(bookings.createdAt))
})

/**
 * JUR-184: drop a booking_resources row. Does NOT touch tenant_members
 * (the staff stays in /settings/members; you can re-add them to the
 * calendar later). Soft-blocked when active bookings reference the
 * resource — admin must cancel or complete those first.
 */
export const deleteBookingResource = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')

    const activeBookings = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.resourceId, data.id),
          sql`${bookings.status} NOT IN ('cancelled', 'completed', 'no_show')`,
        ),
      )
      .limit(1)
    if (activeBookings.length > 0) {
      throw new Error(
        'Tidak bisa hapus — masih ada booking aktif. Selesaikan atau batalkan dulu.',
      )
    }

    await db
      .delete(bookingResources)
      .where(and(eq(bookingResources.id, data.id), eq(bookingResources.tenantId, tenantId)))
    return { success: true }
  })

// ─── Mutations ────────────────────────────────────────────────────────

const customerLookupSchema = z.object({
  search: z.string().min(1),
})

export const searchBookingCustomers = createServerFn({ method: 'POST' })
  .inputValidator(customerLookupSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.read')
    const raw = data.search.trim()
    const q = `%${raw}%`
    const rows = await db
      .select({ id: customers.id, name: customers.name, phone: customers.phone })
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, tenantId),
          or(ilike(customers.name, q), ilike(customers.phone, q)),
        ),
      )
      .orderBy(customers.name)
      .limit(10)
    return rows
  })

/**
 * JUR-182: resolves the branch a booking applies to.
 *   - explicit branchId → use as-is
 *   - null + tenant has exactly one branch → auto-pick that branch
 *   - null + tenant has 0 branches → return null (validation skipped downstream)
 *   - null + tenant has 2+ branches → throw "Pilih cabang dulu"
 */
async function resolveBookingBranch(tenantId: string, explicitBranchId: string | null | undefined): Promise<string | null> {
  if (explicitBranchId) return explicitBranchId
  const tenantBranches = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)))
  if (tenantBranches.length === 1) return tenantBranches[0]!.id
  if (tenantBranches.length === 0) return null
  throw new Error('Pilih cabang dulu')
}

/**
 * JUR-182: working-hours validation reads from branches.business_hours
 * (shape: [{day: 0-6, open, close}], day 0 = Sunday). Throws a friendly
 * Indonesian error if the start time falls outside the branch's hours
 * for the booking's day-of-week.
 */
async function assertWithinBranchHours(branchId: string | null, startAt: Date): Promise<void> {
  if (!branchId) return
  const [branch] = await db
    .select({ businessHours: branches.businessHours })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1)
  if (!branch?.businessHours) return
  const dayOfWeek = startAt.getDay()
  const timeStr = `${startAt.getHours().toString().padStart(2, '0')}:${startAt.getMinutes().toString().padStart(2, '0')}`
  const dayHours = branch.businessHours.find((h) => h.day === dayOfWeek)
  if (!dayHours) {
    throw new Error(
      JSON.stringify({
        code: 'OUTSIDE_HOURS',
        message: `Jam ${timeStr} di luar jam operasional cabang (libur hari ini)`,
      }),
    )
  }
  if (timeStr < dayHours.open || timeStr >= dayHours.close) {
    throw new Error(
      JSON.stringify({
        code: 'OUTSIDE_HOURS',
        message: `Jam ${timeStr} di luar jam operasional cabang (buka ${dayHours.open}-${dayHours.close})`,
      }),
    )
  }
}

async function assertNotBlackoutDate(tenantId: string, startAt: Date): Promise<void> {
  const [settings] = await db
    .select({ blackoutDates: bookingSettings.blackoutDates })
    .from(bookingSettings)
    .where(eq(bookingSettings.tenantId, tenantId))
    .limit(1)
  if (!settings?.blackoutDates) return
  const dateStr = startAt.toISOString().split('T')[0]!
  if (settings.blackoutDates.includes(dateStr)) {
    throw new Error(
      JSON.stringify({
        code: 'BLACKOUT',
        message: `Tanggal ${startAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} adalah hari libur`,
      }),
    )
  }
}

const createBookingSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().optional(),
  publicName: z.string().max(200).optional(),
  publicPhone: z.string().max(40).optional(),
  startAt: z.string(),
  resourceId: z.string().uuid(),
  serviceIds: z.array(z.string()).default([]),
  note: z.string().max(500).optional(),
  source: z.enum(['walk_in', 'public_page', 'wa', 'manual']).default('manual'),
})

export const createBooking = createServerFn({ method: 'POST' })
  .inputValidator(createBookingSchema)
  .handler(async ({ data }) => {
    const { tenantId, userId } = await requirePermission('booking.write')
    const startAt = new Date(data.startAt)

    const branchId = await resolveBookingBranch(tenantId, data.branchId)
    await assertWithinBranchHours(branchId, startAt)
    await assertNotBlackoutDate(tenantId, startAt)

    const [settings] = await db
      .select({
        slotDurationMin: bookingSettings.slotDurationMin,
        mode: bookingSettings.mode,
        maxConcurrentSlots: bookingSettings.maxConcurrentSlots,
      })
      .from(bookingSettings)
      .where(eq(bookingSettings.tenantId, tenantId))
      .limit(1)

    const slotMin = settings?.slotDurationMin ?? 30
    const endAt = new Date(startAt.getTime() + slotMin * 60000)

    const conflicting = await db
      .select({ id: bookings.id, publicName: bookings.publicName, startAt: bookings.startAt })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.resourceId, data.resourceId),
          sql`${bookings.status} IN ('confirmed', 'in_progress')`,
          lte(bookings.startAt, endAt),
          gte(sql`COALESCE(${bookings.endAt}, ${bookings.startAt})`, startAt),
        ),
      )
      .limit(1)

    if (conflicting.length > 0) {
      const b = conflicting[0]!
      throw new Error(
        JSON.stringify({
          code: 'CONFLICT',
          message: `Bentrok dengan janji ${b.publicName ?? 'Pelanggan'} jam ${new Date(b.startAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`,
        }),
      )
    }

    // JUR-184: tenant-wide concurrency cap. Counts overlapping
    // confirmed/in-progress bookings across ALL resources for this
    // branch (or tenant-wide when branch_id is null). Null cap = no
    // limit beyond the per-resource overlap check above.
    if (settings?.maxConcurrentSlots && settings.maxConcurrentSlots > 0) {
      const branchScope = branchId
        ? sql`AND ${bookings.branchId} = ${branchId}`
        : sql``
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(
          and(
            eq(bookings.tenantId, tenantId),
            sql`${bookings.status} IN ('confirmed', 'in_progress')`,
            lte(bookings.startAt, endAt),
            gte(sql`COALESCE(${bookings.endAt}, ${bookings.startAt})`, startAt),
            sql`true ${branchScope}`,
          ),
        )
      const overlap = row?.count ?? 0
      if (overlap >= settings.maxConcurrentSlots) {
        throw new Error(
          JSON.stringify({
            code: 'CAPACITY_FULL',
            message: `Slot penuh — kapasitas ${settings.maxConcurrentSlots} sedang dipakai.`,
          }),
        )
      }
    }

    const [booking] = await db
      .insert(bookings)
      .values({
        tenantId,
        branchId,
        customerId: data.customerId ?? null,
        publicName: data.publicName ?? null,
        publicPhone: data.publicPhone ?? null,
        mode: settings?.mode ?? 'slot',
        startAt,
        endAt,
        status: 'confirmed',
        resourceId: data.resourceId,
        serviceIds: data.serviceIds,
        note: data.note ?? null,
        source: data.source,
        createdByUserId: userId,
      })
      .returning()

    return booking
  })

const updateBookingStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']),
})

export const updateBookingStatus = createServerFn({ method: 'POST' })
  .inputValidator(updateBookingStatusSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')
    const [updated] = await db
      .update(bookings)
      .set({ status: data.status, updatedAt: new Date() })
      .where(and(eq(bookings.id, data.id), eq(bookings.tenantId, tenantId)))
      .returning()
    if (!updated) throw new Error('Booking tidak ditemukan')
    return updated
  })

const updateBookingSchema = z.object({
  id: z.string().uuid(),
  startAt: z.string().optional(),
  resourceId: z.string().uuid().optional(),
  branchId: z.string().uuid().nullable().optional(),
  serviceIds: z.array(z.string()).optional(),
  note: z.string().max(500).optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  publicName: z.string().max(200).optional().nullable(),
  publicPhone: z.string().max(40).optional().nullable(),
})

export const updateBooking = createServerFn({ method: 'POST' })
  .inputValidator(updateBookingSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')
    const { id, ...fields } = data

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (fields.startAt !== undefined) {
      const startAt = new Date(fields.startAt)
      updates.startAt = startAt
      const [settings] = await db
        .select({ slotDurationMin: bookingSettings.slotDurationMin })
        .from(bookingSettings)
        .where(eq(bookingSettings.tenantId, tenantId))
        .limit(1)
      const slotMin = settings?.slotDurationMin ?? 30
      updates.endAt = new Date(startAt.getTime() + slotMin * 60000)
    }
    if (fields.resourceId !== undefined) updates.resourceId = fields.resourceId
    if (fields.branchId !== undefined) updates.branchId = fields.branchId
    if (fields.serviceIds !== undefined) updates.serviceIds = fields.serviceIds
    if (fields.note !== undefined) updates.note = fields.note || null
    if (fields.customerId !== undefined) updates.customerId = fields.customerId
    if (fields.publicName !== undefined) updates.publicName = fields.publicName
    if (fields.publicPhone !== undefined) updates.publicPhone = fields.publicPhone

    const [updated] = await db
      .update(bookings)
      .set(updates)
      .where(and(eq(bookings.id, id), eq(bookings.tenantId, tenantId)))
      .returning()
    if (!updated) throw new Error('Booking tidak ditemukan')
    return updated
  })

export const deleteBooking = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')
    await db
      .delete(bookings)
      .where(and(eq(bookings.id, data.id), eq(bookings.tenantId, tenantId)))
    return { success: true }
  })

/**
 * JUR-182: updateResource now also accepts an optional memberId so the
 * JUR-183 settings UI can link/unlink a tenant_member to a staff-kind
 * resource. memberId=null unlinks; undefined leaves the existing link.
 */
export const updateResource = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1, 'Nama wajib diisi').optional(),
      isActive: z.boolean().optional(),
      memberId: z.string().uuid().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission('booking.write')
    const updates: Record<string, unknown> = {}
    if (data.name !== undefined) updates.name = data.name
    if (data.isActive !== undefined) updates.isActive = data.isActive
    if (data.memberId !== undefined) updates.memberId = data.memberId
    if (Object.keys(updates).length === 0) {
      throw new Error('Tidak ada perubahan')
    }
    const [updated] = await db
      .update(bookingResources)
      .set(updates)
      .where(and(eq(bookingResources.id, data.id), eq(bookingResources.tenantId, tenantId)))
      .returning()
    if (!updated) throw new Error('Resource tidak ditemukan')
    return updated
  })
