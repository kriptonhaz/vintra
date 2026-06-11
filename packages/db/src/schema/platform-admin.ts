import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './auth'

export const platformAdmins = pgTable('platform_admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique(),
  /**
   * JUR-194: the founder. Only a founder can approve comp grants (Rp 0
   * free-access activations) — a non-founder admin's comp request waits
   * for founder sign-off.
   */
  isFounder: boolean('is_founder').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: uuid('created_by'),
})

/**
 * Comp grants (JUR-194) — free-access activations. A comp activates a
 * module at Rp 0 with a mandatory reason and is NEVER recorded as a
 * financial transaction, so it can't pollute revenue. The founder can
 * apply one directly; a non-founder admin's request waits as `pending`
 * for the founder to approve.
 */
export const compGrants = pgTable(
  'comp_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    moduleKey: text('module_key').notNull(),
    /** Tier the comp grants — e.g. 'komplit', 'toko', 'basic'. */
    planKey: text('plan_key').notNull(),
    durationMonths: integer('duration_months').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pending'),
    requestedByUserId: uuid('requested_by_user_id').notNull(),
    reviewedByUserId: uuid('reviewed_by_user_id'),
    reviewedAt: timestamp('reviewed_at'),
    appliedAt: timestamp('applied_at'),
    /** Subscription expiry the comp set, once applied. */
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    moduleChk: check(
      'comp_grants_module_chk',
      sql`${t.moduleKey} IN ('pos', 'inventory', 'attendance', 'whatsapp')`,
    ),
    statusChk: check(
      'comp_grants_status_chk',
      sql`${t.status} IN ('pending', 'applied', 'rejected')`,
    ),
    tenantStatusIdx: index('comp_grants_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
  }),
)

/**
 * Tracks which tenant a platform admin is currently impersonating.
 * One row per admin (unique user_id) — starting a new impersonation upserts.
 * Cleared on endImpersonation or when the admin's access is revoked.
 */
export const activeImpersonations = pgTable('active_impersonations', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminUserId: uuid('admin_user_id').notNull().unique(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  startedAt: timestamp('started_at').defaultNow().notNull(),
})

/**
 * Append-only audit log of platform-admin actions: impersonation start/end,
 * grant/revoke admin, etc. Never edited; only inserted.
 */
export const platformAdminAuditLogs = pgTable('platform_admin_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminUserId: uuid('admin_user_id').notNull(),
  action: text('action').notNull(),
  targetTenantId: uuid('target_tenant_id'),
  targetUserId: uuid('target_user_id'),
  metadata: jsonb('metadata').$type<Record<string, {} | null> | null>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
