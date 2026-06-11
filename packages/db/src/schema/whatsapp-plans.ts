import { pgTable, text, integer, numeric, boolean, timestamp } from 'drizzle-orm/pg-core'

/**
 * Platform-level WhatsApp subscription plan definitions.
 * Managed by platform admins — no tenant_id.
 * plan_key values: 'basic' | 'komplit' | 'enterprise'
 */
export const waSubscriptionPlans = pgTable('wa_subscription_plans', {
  planKey: text('plan_key').primaryKey(),
  displayName: text('display_name').notNull(),
  priceIdr: numeric('price_idr', { precision: 15, scale: 0 }).notNull(),
  maxInstances: integer('max_instances').notNull(),
  maxMonthlyReplies: integer('max_monthly_replies').notNull(),
  ragScope: text('rag_scope').notNull().default('stock'), // TODO: deprecated — superseded by wa_rag_tools.min_tier; kept for backward compat
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
