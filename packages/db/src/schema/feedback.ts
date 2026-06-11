import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { tenants } from './auth'

export const feedbackThreads = pgTable(
  'feedback_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    source: text('source').notNull().default('in_app'), // 'in_app' | 'public'
    subject: text('subject').notNull(),
    status: text('status').notNull().default('open'), // 'open' | 'replied' | 'resolved'
    publicEmail: text('public_email'),
    publicName: text('public_name'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
    tenantLastViewedAt: timestamp('tenant_last_viewed_at'),
    // JUR-148: client IP of the submitter for public threads. Used by
    // the per-IP rate limiter on the /contact form (5 submissions per
    // rolling hour) and as diagnostic data in the admin inbox so spam
    // patterns are visible.
    submitterIp: text('submitter_ip'),
  },
  (t) => [
    index('feedback_threads_tenant_status_idx').on(t.tenantId, t.status),
    index('feedback_threads_source_status_last_idx').on(t.source, t.status, t.lastMessageAt),
    index('feedback_threads_submitter_ip_created_idx').on(t.submitterIp, t.createdAt),
  ],
)

export const feedbackMessages = pgTable(
  'feedback_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .references(() => feedbackThreads.id, { onDelete: 'cascade' })
      .notNull(),
    senderType: text('sender_type').notNull(), // 'tenant' | 'admin' | 'public'
    senderUserId: uuid('sender_user_id'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    emailSentAt: timestamp('email_sent_at'),
  },
  (t) => [index('feedback_messages_thread_idx').on(t.threadId, t.createdAt)],
)
