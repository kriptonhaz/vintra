import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  smallint,
  numeric,
  date,
  time,
  timestamp,
  unique,
  check,
  jsonb,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants, tenantMembers } from './auth'
import type { CashStaleConfig } from './pos'

/** Cabang / branch — physical locations where staff check in. */
export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  address: text('address'),
  latitude: numeric('latitude', { precision: 10, scale: 7 }).notNull(),
  longitude: numeric('longitude', { precision: 10, scale: 7 }).notNull(),
  radiusMeters: integer('radius_meters').notNull().default(100),
  /**
   * Per-branch receipt-footer override. NULL = inherit
   * `pos_settings.receipt_footer_text` (tenant default). Tenants with
   * a single branch never set this; multi-outlet tenants use it to
   * print branch-specific address / phone lines.
   */
  receiptFooterText: text('receipt_footer_text'),
  /** Same inheritance model as receiptFooterText — null inherits the tenant logo. */
  receiptLogoKey: text('receipt_logo_key'),
  /**
   * Per-branch stale cash-session override (#216). NULL = inherit
   * `pos_settings.cash_stale_config` (tenant default). Lets a
   * multi-outlet tenant give a 24h outlet a different cutoff than a
   * 08:00–22:00 one. See CashStaleConfig in schema/pos.ts.
   */
  cashStaleConfig: jsonb('cash_stale_config').$type<CashStaleConfig>(),
  /**
   * Cabang utama flag — at most one branch per tenant should be marked
   * main. Enforced by app code (the branch upsert flips others to false
   * inside the same transaction) backed by a partial unique index on
   * (tenant_id) WHERE is_main. Used as the default branch for the POS
   * cashier, the inventory free-tier "single allowed branch", and as a
   * fallback resolver elsewhere.
   */
  isMain: boolean('is_main').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  /**
   * How this branch is operated, chosen at branch creation:
   *   - `independent` — the tenant owner runs it directly (staff,
   *     hours, cashflow all owner-managed); stock arrives as a plain
   *     inter-branch transfer (no money).
   *   - `franchise` — a `outlet_owner` member runs it semi-autonomously
   *     (own staff, hours, cashflow); stock is *purchased* from HQ via
   *     a priced requisition that writes cashflow on both sides.
   * The main branch (`is_main`) is always HQ — the picker only appears
   * for additional branches. Drives affordances + the requisition
   * money flow; data isolation stays enforced by tenant_member_branches.
   */
  branchModel: text('branch_model').notNull().default('independent'),
  /**
   * Customer-facing store opening hours. Shape: [{day: 0-6, open: "08:00", close: "21:00"}]
   * where day 0=Sunday. NULL = not configured; RAG retriever returns empty snippet.
   * Distinct from branch_schedules which tracks staff attendance times.
   */
  businessHours: jsonb('business_hours').$type<
    Array<{ day: number; open: string; close: string }>
  >(),
  /**
   * Which modules treat this branch as one of their active locations.
   * Drives per-module additional-location billing on the
   * /master/branches cost preview and admin reconciliation: a Komplit
   * tenant with a "gudang" branch (only ['inventory']) pays the
   * Inventory à la carte extra-location fee for that branch, not the
   * full Komplit bundled extra-outlet rate.
   *
   * Default in the migration is ['pos','inventory','attendance'] so
   * existing rows are treated as full outlets — no behavior change
   * for tenants that haven't touched the new module toggles.
   */
  enabledModules: text('enabled_modules')
    .array()
    .notNull()
    .default(sql`ARRAY['pos','inventory','attendance']::text[]`),
  /**
   * Whether this branch runs attendance in "advanced" mode with a fixed
   * work schedule (true) or "simple" mode (false) where staff just clock
   * in/out freely with no lateness/absence scoring.
   *
   * Defaults to `true` so every pre-existing branch keeps its current
   * schedule-backed behavior — only branches created after this column
   * was added start in simple mode (createBranch sets it false). When
   * false, the branch has zero branch_schedules rows.
   */
  requiresSchedule: boolean('requires_schedule').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/** Weekly schedule — one row per (branch, dayOfWeek). dayOfWeek: 0=Sunday ... 6=Saturday. */
export const branchSchedules = pgTable(
  'branch_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id, { onDelete: 'cascade' })
      .notNull(),
    dayOfWeek: smallint('day_of_week').notNull(),
    isWorkDay: boolean('is_work_day').notNull().default(true),
    clockInTime: time('clock_in_time').notNull(),
    clockOutTime: time('clock_out_time').notNull(),
    lateGraceMinutes: integer('late_grace_minutes').notNull().default(10),
    earlyLeaveGraceMinutes: integer('early_leave_grace_minutes').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique('branch_schedules_branch_day_unique').on(t.branchId, t.dayOfWeek),
  }),
)

/**
 * Named shifts per branch (Pagi, Sore, Malam, etc.). Staff with a non-null
 * `branchShiftId` clock against `branchShiftSchedules` instead of the branch
 * default. Staff with null stay on the branch default schedule ("regular" worker).
 */
export const branchShifts = pgTable(
  'branch_shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique('branch_shifts_branch_name_unique').on(t.branchId, t.name),
  }),
)

/**
 * Weekly schedule for a shift — 7 rows per shift (one per dayOfWeek).
 * CHECK: isWorkDay=false OR clockOutTime > clockInTime — enforces same-day
 * shifts for v1. Cross-midnight shifts (e.g., 22:00 → 06:00) are deferred
 * and would require relaxing this + date-attribution logic in check-in.
 */
export const branchShiftSchedules = pgTable(
  'branch_shift_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    branchShiftId: uuid('branch_shift_id')
      .references(() => branchShifts.id, { onDelete: 'cascade' })
      .notNull(),
    dayOfWeek: smallint('day_of_week').notNull(),
    isWorkDay: boolean('is_work_day').notNull().default(false),
    clockInTime: time('clock_in_time'),
    clockOutTime: time('clock_out_time'),
    lateGraceMinutes: integer('late_grace_minutes').notNull().default(10),
    earlyLeaveGraceMinutes: integer('early_leave_grace_minutes').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique('branch_shift_schedules_shift_day_unique').on(
      t.branchShiftId,
      t.dayOfWeek,
    ),
    sameDay: check(
      'branch_shift_schedules_same_day',
      sql`${t.isWorkDay} = false OR (${t.clockInTime} IS NOT NULL AND ${t.clockOutTime} IS NOT NULL AND ${t.clockOutTime} > ${t.clockInTime})`,
    ),
  }),
)

/** 1:1 HR extension on tenant_members. One row per staff user. */
export const staffProfiles = pgTable('staff_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id').notNull().unique(),
  tenantMemberId: uuid('tenant_member_id')
    .references(() => tenantMembers.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  // Name lives on tenant_members.{firstName,lastName} now — a staff
  // profile derives its display name via the join. The legacy
  // `full_name` column was dropped in migration 0035.
  phone: text('phone'),
  nik: text('nik'),
  employeeNumber: text('employee_number'),
  // Free-text job title / role description (e.g. "Kasir", "Cleaning
  // Service", "Customer Service"). Distinct from the RBAC `role`
  // (owner/admin/staff) on tenant_members — that one controls access;
  // this one is purely descriptive HR metadata for the owner.
  position: text('position'),
  joinedDate: date('joined_date').notNull(),
  baseSalary: numeric('base_salary', { precision: 15, scale: 2 }),
  branchId: uuid('branch_id').references(() => branches.id),
  // Optional shift assignment. NULL = regular worker, uses branch_schedules.
  // Non-null = shift worker, uses the shift's branch_shift_schedules rows.
  branchShiftId: uuid('branch_shift_id').references(() => branchShifts.id, {
    onDelete: 'set null',
  }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Per-tenant attendance configuration. One row per tenant.
 * Each of `modeGpsEnabled`, `modePhotoEnabled`, `modeQrEnabled` can be toggled
 * independently — when multiple are on, the staff must satisfy ALL enabled
 * modes at check-in (e.g., be within GPS radius AND upload a selfie).
 * At least one must remain enabled (enforced at the app layer).
 */
export const attendanceSettings = pgTable('attendance_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  modeGpsEnabled: boolean('mode_gps_enabled').notNull().default(true),
  modePhotoEnabled: boolean('mode_photo_enabled').notNull().default(false),
  modeQrEnabled: boolean('mode_qr_enabled').notNull().default(false),
  qrRotationSeconds: integer('qr_rotation_seconds').notNull().default(30),
  subscriptionActive: boolean('subscription_active').notNull().default(false),
  subscriptionStartedAt: timestamp('subscription_started_at'),
  subscriptionExpiresAt: timestamp('subscription_expires_at'),
  billedStaffCount: integer('billed_staff_count').notNull().default(0),
  // Trial state — distinct from the paid subscription so they can
  // compose (e.g., admin starts trial then converts to paid). `trialUsed`
  // is the one-time gate; set true at first trial start, never reset
  // programmatically. A platform admin can reset manually via DB if
  // needed (rare escape hatch).
  trialStartedAt: timestamp('trial_started_at'),
  trialEndsAt: timestamp('trial_ends_at'),
  trialStaffCap: integer('trial_staff_cap'),
  trialUsed: boolean('trial_used').notNull().default(false),
  // Clock-in/out reminder settings. Tenant-wide. Direction lets the
  // owner choose whether the reminder fires N minutes BEFORE the
  // scheduled clock time ("don't forget to clock in") or N minutes
  // AFTER ("you may have forgotten to clock out"). Same minutes
  // value either way; sign comes from the direction column.
  clockinReminderEnabled: boolean('clockin_reminder_enabled').notNull().default(false),
  clockinReminderMinutes: integer('clockin_reminder_minutes').notNull().default(10),
  clockinReminderDirection: text('clockin_reminder_direction').notNull().default('before'),
  clockoutReminderEnabled: boolean('clockout_reminder_enabled').notNull().default(false),
  clockoutReminderMinutes: integer('clockout_reminder_minutes').notNull().default(10),
  clockoutReminderDirection: text('clockout_reminder_direction').notNull().default('before'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Daily attendance record — one row per (staff, date-in-Jakarta).
 * clockIn* and clockOut* are both nullable and populated as events happen.
 * `clockInModes` + `clockOutModes` snapshot which modes were required at the time
 * of the check-in so reports know what was verified.
 */
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    staffProfileId: uuid('staff_profile_id')
      .references(() => staffProfiles.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id, { onDelete: 'set null' }),
    // Snapshot of which shift the staff was on at clock-in time. Null = regular
    // worker. Preserved even if the staff is later reassigned or the shift is
    // renamed, so historical reports remain attributable.
    branchShiftId: uuid('branch_shift_id').references(() => branchShifts.id, {
      onDelete: 'set null',
    }),
    date: date('date').notNull(),
    scheduledIn: time('scheduled_in'),
    scheduledOut: time('scheduled_out'),

    clockInAt: timestamp('clock_in_at'),
    clockOutAt: timestamp('clock_out_at'),
    clockInModes: text('clock_in_modes').array(),
    clockOutModes: text('clock_out_modes').array(),
    clockInLat: numeric('clock_in_lat', { precision: 10, scale: 7 }),
    clockInLng: numeric('clock_in_lng', { precision: 10, scale: 7 }),
    clockOutLat: numeric('clock_out_lat', { precision: 10, scale: 7 }),
    clockOutLng: numeric('clock_out_lng', { precision: 10, scale: 7 }),
    clockInPhotoKey: text('clock_in_photo_key'),
    clockOutPhotoKey: text('clock_out_photo_key'),
    clockInStatus: text('clock_in_status'),
    clockOutStatus: text('clock_out_status'),
    clockInNotes: text('clock_in_notes'),
    clockOutNotes: text('clock_out_notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    // One record per (staff, branch, day): supervisors assigned to
    // multiple outlets clock in/out independently at each. NULL
    // branch_id (set when a branch is later deleted) is treated as
    // distinct by Postgres unique semantics, so legacy rows from
    // deleted branches stay valid.
    uniq: unique('attendance_records_staff_branch_date_unique').on(
      t.staffProfileId,
      t.branchId,
      t.date,
    ),
  }),
)

/**
 * Active QR host session — one per (owner/admin user). Re-entering the host
 * page upserts. The actual rotating token is NOT stored; it's HMAC-signed
 * per-request and validated stateless-ly on the staff scan.
 */
export const qrHostSessions = pgTable('qr_host_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  branchId: uuid('branch_id')
    .references(() => branches.id, { onDelete: 'cascade' })
    .notNull(),
  hostUserId: uuid('host_user_id').notNull().unique(),
  lastTokenIssuedAt: timestamp('last_token_issued_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * One-shot nonce tracking — prevents replay of a scanned QR.
 * Rows are cleaned up opportunistically on each insert (older than 5 min).
 */
export const qrConsumedNonces = pgTable('qr_consumed_nonces', {
  id: uuid('id').primaryKey().defaultRandom(),
  nonce: text('nonce').notNull().unique(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  staffProfileId: uuid('staff_profile_id')
    .references(() => staffProfiles.id, { onDelete: 'cascade' })
    .notNull(),
  consumedAt: timestamp('consumed_at').defaultNow().notNull(),
})
