import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  unique,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './auth'

/**
 * RBAC roles. Two flavours coexist in this table:
 *   - **System roles** — `tenant_id IS NULL`, `is_system = true`. Six
 *     seeded baselines (owner / admin / outlet_owner / supervisor /
 *     staff / kasir) visible to every tenant. Edited only by platform
 *     admins via /admin/permissions.
 *   - **Tenant-custom roles** — `tenant_id` set, `is_system = false`.
 *     Created by the tenant owner from /settings/roles to express
 *     combinations the system roles don't cover (e.g. "Kasir + Stok").
 *
 * Partial unique indexes enforce uniqueness per scope:
 *   - one `kasir` system row (NULL tenant), and
 *   - one `kasir` row per tenant.
 * Postgres unique constraints treat NULLs as distinct, so a plain
 * UNIQUE(tenant_id, key) would let two NULL-tenant rows with the same
 * key coexist — hence the split.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL for system roles, set for tenant-custom roles. */
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    systemKeyUnique: uniqueIndex('roles_system_key_unique')
      .on(t.key)
      .where(sql`${t.tenantId} IS NULL`),
    tenantKeyUnique: uniqueIndex('roles_tenant_key_unique')
      .on(t.tenantId, t.key)
      .where(sql`${t.tenantId} IS NOT NULL`),
    tenantIdx: index('roles_tenant_idx')
      .on(t.tenantId)
      .where(sql`${t.tenantId} IS NOT NULL`),
  }),
)

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  module: text('module').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    permissionId: uuid('permission_id')
      .references(() => permissions.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique('role_permissions_role_permission_unique').on(
      t.roleId,
      t.permissionId,
    ),
  }),
)
