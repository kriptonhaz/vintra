import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { waInstances } from './whatsapp'

/**
 * Platform-level RAG tool definitions. Managed by platform admins.
 * Each row describes one retrieval capability the AI can use.
 */
export const waRagTools = pgTable(
  'wa_rag_tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    /** One of the 8 built-in retrieval types. */
    retrievalType: text('retrieval_type').notNull(),
    /** Minimum WA subscription tier required. */
    minTier: text('min_tier').notNull().default('basic'),
    /** 'always' | 'on_keyword' | 'on_customer_match' */
    triggerMode: text('trigger_mode').notNull().default('always'),
    /** Keywords for on_keyword mode. Raw substring match against message body. */
    triggerKeywords: text('trigger_keywords')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    /** Lower = higher priority in prompt + retrieval order. */
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    retrievalTypeChk: check(
      'wa_rag_tools_retrieval_type_chk',
      sql`${t.retrievalType} IN ('inventory_price','inventory_stock','store_address','operating_hours','payment_methods','promotions','loyalty_points','loyalty_stamps','order_history','recipe_availability')`,
    ),
    minTierChk: check(
      'wa_rag_tools_min_tier_chk',
      sql`${t.minTier} IN ('basic','komplit','enterprise')`,
    ),
    triggerModeChk: check(
      'wa_rag_tools_trigger_mode_chk',
      sql`${t.triggerMode} IN ('always','on_keyword','on_customer_match')`,
    ),
  }),
)

/**
 * Per-instance RAG tool opt-in state.
 * Default is disabled (opt-in) — tenants must explicitly enable tools.
 */
export const waInstanceRagTools = pgTable(
  'wa_instance_rag_tools',
  {
    instanceId: uuid('instance_id')
      .references(() => waInstances.id, { onDelete: 'cascade' })
      .notNull(),
    ragToolId: uuid('rag_tool_id')
      .references(() => waRagTools.id, { onDelete: 'cascade' })
      .notNull(),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.instanceId, t.ragToolId] }),
  }),
)
