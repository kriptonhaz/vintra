import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './auth'

/**
 * Recipient-keyed notification rows. One row = one delivery to one
 * user. Broadcasts are fanned out at insert time (one row per
 * recipient) so the read path is uniform regardless of source.
 *
 * `tenant_id` is nullable so platform-wide announcements (not scoped
 * to a single tenant) are still representable.
 *
 * `source_key` is an optional idempotency key. The scheduler uses it
 * with `ON CONFLICT DO NOTHING` (against the partial unique index
 * `notifications_dedup_idx`) to ensure the same reminder for the
 * same (user, type, source) tuple is never inserted twice — even if
 * the cron tick fires more than once per window.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    url: text('url'),
    // `Record<string, {} | null>` (not `unknown`) so TanStack Start's
    // server-fn serialization narrowing accepts it without complaint.
    // Concrete payload shapes are still type-checked at the call site
    // by callers that cast to a specific notification-type interface.
    data: jsonb('data').$type<Record<string, {} | null> | null>(),
    sourceKey: text('source_key'),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index('notifications_user_created_idx').on(
      t.userId,
      t.createdAt,
    ),
    // Unread-count badge hot path. Postgres partial index keeps it
    // tiny — only rows where read_at IS NULL are stored.
    userUnreadIdx: index('notifications_user_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
    // Idempotency target for ON CONFLICT DO NOTHING in the scheduler.
    // Partial index — only rows where source_key IS NOT NULL count.
    dedupIdx: uniqueIndex('notifications_dedup_idx')
      .on(t.userId, t.type, t.sourceKey)
      .where(sql`${t.sourceKey} IS NOT NULL`),
  }),
)

/**
 * Per-(user, browser) Web Push subscription. A user can have multiple
 * (laptop + phone, etc.). The `endpoint` URL is unique per device per
 * browser per VAPID key; we also store the encryption keys (`p256dh`,
 * `auth`) needed to encrypt push payloads for that subscription.
 *
 * Cleanup: when web-push reports 410 GONE / 404 for a row, we delete
 * it (the browser has unsubscribed).
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('push_subscriptions_user_idx').on(t.userId),
  }),
)
