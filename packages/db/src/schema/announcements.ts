import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { tenants } from './auth'

/**
 * Pengumuman — tenant-level broadcasts authored by owners/admins for
 * their staff. One row = one canonical announcement (NOT per-recipient).
 *
 * Delivery + read-tracking ride the existing `notifications` table: on
 * publish we fan out one notification row per recipient
 * (type='announcement', source_key=announcement.id), so unread badges
 * and the bell list come for free and re-publishing is idempotent
 * against the notifications dedup index.
 *
 * `audience` is 'all' (every tenant member) in Phase 1; 'branch' (with
 * `branch_id`) is reserved for Phase 2 targeting — the column exists now
 * so the migration doesn't need revisiting. `status` likewise supports a
 * future draft workflow; Phase 1 creates rows already 'published'.
 */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    authorUserId: uuid('author_user_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** 'all' | 'branch' — Phase 1 only fans out 'all'. */
    audience: text('audience').notNull().default('all'),
    /** Set when audience='branch'; no FK yet (branch targeting is Phase 2). */
    branchId: uuid('branch_id'),
    pinned: boolean('pinned').notNull().default(false),
    /** 'draft' | 'published'. Phase 1 creates straight to 'published'. */
    status: text('status').notNull().default('draft'),
    publishedAt: timestamp('published_at'),
    /** Optional auto-hide; null = never expires. */
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    // Read hot path: published announcements for a tenant, newest first.
    tenantPublishedIdx: index('announcements_tenant_published_idx').on(
      t.tenantId,
      t.publishedAt,
    ),
  }),
)

/**
 * Per-user read state for announcements. Pengumuman is its own channel
 * (NOT the notification bell), so it tracks reads here rather than on a
 * fanned-out notification row. A row exists once the user has opened the
 * announcement; absence = unread. Cascades away when the announcement or
 * tenant is deleted.
 */
export const announcementReads = pgTable(
  'announcement_reads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    announcementId: uuid('announcement_id')
      .references(() => announcements.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id').notNull(),
    readAt: timestamp('read_at').defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('announcement_reads_uniq').on(
      t.announcementId,
      t.userId,
    ),
    userIdx: index('announcement_reads_user_idx').on(t.userId),
  }),
)
