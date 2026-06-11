import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  check,
  unique,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants, tenantMembers } from './auth'
import { customers } from './pos'
import { branches } from './attendance'

export const bookingSettings = pgTable(
  'booking_settings',
  {
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull()
      .primaryKey(),
    mode: text('mode').notNull().default('slot'),
    industryTemplate: text('industry_template'),
    slotDurationMin: integer('slot_duration_min'),
    // workingHours dropped in 0062 — branches.business_hours is the source of truth.
    blackoutDates: jsonb('blackout_dates').$type<string[]>().default([]),
    bufferMinBetweenSlots: integer('buffer_min_between_slots'),
    /**
     * JUR-184: tenant-wide cap on simultaneous bookings. NULL = no cap
     * (only the per-resource "1 booking per slot" rule applies). Use
     * case: a barbershop with 3 stylists but only 2 chairs sets this
     * to 2 — calendar permits 3 columns of staff but no more than 2
     * overlapping confirmed/in-progress bookings at once.
     * Enforced in createBooking after the per-resource overlap check.
     */
    maxConcurrentSlots: integer('max_concurrent_slots'),
    setupCompleted: boolean('setup_completed').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    modeChk: check('booking_settings_mode_chk', sql`${t.mode} IN ('slot', 'queue', 'stay')`),
  }),
)

export const bookingResources = pgTable(
  'booking_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    // JUR-182: optional link to a tenant_members row. NULL = synthetic
    // resource (e.g. seeded "Stylist A" before admin links a real member),
    // or non-staff kind (station/room). When set, the calendar header
    // shows the linked member's name + photo instead of the resource name.
    memberId: uuid('member_id').references(() => tenantMembers.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    // JUR-167: when true, the queue auto-router skips this resource
    // (operator on a break, bay out of service). Existing queued
    // tickets stay; only new ticket routing is affected.
    isPaused: boolean('is_paused').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    kindChk: check('booking_resources_kind_chk', sql`${t.kind} IN ('staff', 'station', 'room')`),
    tenantNameUnique: unique('booking_resources_tenant_name_uniq').on(t.tenantId, t.name),
  }),
)

// bookingServices dropped in 0062 — services now live in `inventory_items`
// with `is_sellable = true AND is_bookable = true`. Duration + color stored
// as `booking_duration_min` + `booking_color` columns on inventory_items.

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    // JUR-182: which branch this booking belongs to. Nullable for legacy /
    // single-branch tenants — the createBooking server fn auto-resolves to
    // the tenant's only branch when null. Multi-branch tenants must provide.
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    publicName: text('public_name'),
    publicPhone: text('public_phone'),
    mode: text('mode').notNull(),
    startAt: timestamp('start_at').notNull(),
    endAt: timestamp('end_at'),
    status: text('status').notNull().default('pending'),
    resourceId: uuid('resource_id').references(() => bookingResources.id, { onDelete: 'set null' }),
    // Each entry is an inventory_items.id (post-JUR-182). Old booking_services
    // FK semantics dropped — type stays text[] for migration compatibility.
    serviceIds: text('service_ids').array().notNull().default([]),
    note: text('note'),
    // JUR-167: short verbal-calling ticket number for queue-mode
    // bookings (e.g. "#12"). NULL for slot-mode (where start_at is
    // the identifier). Server fn assigns at creation from a per-
    // tenant per-day sequence.
    ticketNumber: text('ticket_number'),
    source: text('source').notNull().default('manual'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    modeChk: check('bookings_mode_chk', sql`${t.mode} IN ('slot', 'queue', 'stay')`),
    statusChk: check(
      'bookings_status_chk',
      sql`${t.status} IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')`,
    ),
    sourceChk: check(
      'bookings_source_chk',
      sql`${t.source} IN ('walk_in', 'public_page', 'wa', 'manual')`,
    ),
    resourceStartIdx: index('bookings_resource_start_idx').on(t.resourceId, t.startAt),
    tenantStartIdx: index('bookings_tenant_start_idx').on(t.tenantId, t.startAt),
    branchStartIdx: index('bookings_branch_start_idx').on(t.branchId, t.startAt),
    // JUR-167: supports "fetch this resource's queue in arrival order"
    resourceStatusCreatedIdx: index('bookings_resource_status_created_idx').on(
      t.resourceId,
      t.status,
      t.createdAt,
    ),
  }),
)
