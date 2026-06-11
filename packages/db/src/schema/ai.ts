import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Per-resolution pricing for an `image` capability. Keyed by resolution
 * tier ('1k' | '2k' | '4k'); `credits` is how many Konten credits a
 * generation at that tier costs, `priceUsd` the platform's USD cost
 * (numeric-string, null = untracked).
 */
export type ImageResolutionPricing = Record<
  string,
  { credits: number; priceUsd: string | null }
>
import { tenants } from './auth'

/**
 * One row per AI provider call. Lets us bill, alert on cost spikes,
 * and surface a "Pemakaian AI Bulan Ini" widget on the dashboard.
 *
 * `cost_usd` is `numeric(12,6)` rather than float — six decimals is
 * enough to capture per-1k-token pricing for any model we'd plausibly
 * use without rounding noise.
 *
 * `feature` is freeform text (e.g. `wa_reply`, `content_gen`,
 * `summary`) so we can add new use cases without a migration.
 */
export const aiUsageLogs = pgTable(
  'ai_usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    feature: text('feature').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    latencyMs: integer('latency_ms'),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantTimeIdx: index('ai_usage_logs_tenant_time_idx').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
)

/**
 * Platform-level AI provider configurations. Managed by platform admins
 * only — no tenant_id. This row is the *connection* only: how to reach a
 * model (base URL + API key + adapter type). What the model is *used for*
 * — and how it's priced — lives in `ai_provider_capabilities`, one child
 * row per capability (text / image / video).
 *
 * A single model can carry several capabilities (e.g. Gemini does both
 * text and image generation) at different price points, so capability +
 * pricing must NOT live on this row — they'd force a duplicate connection
 * record per capability.
 *
 * `api_key` is stored in plaintext. Treat this table as sensitive;
 * never expose api_key to tenant users or in list responses.
 */
export const aiProviderConfigs = pgTable('ai_provider_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  providerType: text('provider_type').notNull(),
  model: text('model').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * One row per (provider config × capability). A capability describes what
 * a config is *used to produce* — `text`, `image`, or `video` — and
 * carries the pricing relevant to that modality.
 *
 * Pricing columns are all nullable; only the set relevant to `capability`
 * is populated:
 *   - text:  input/output/cache-hit per-1M-token rates
 *   - image: pricePerImageUsd
 *   - video: pricePerSecondUsd
 *
 * `isDefault` is scoped per capability via a partial unique index, so the
 * platform has exactly one default text provider, one default image
 * provider, etc. For `text`, NULL price columns mean "fall back to the
 * hardcoded ai/pricing.go table".
 */
export const aiProviderCapabilities = pgTable(
  'ai_provider_capabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    configId: uuid('config_id')
      .references(() => aiProviderConfigs.id, { onDelete: 'cascade' })
      .notNull(),
    // 'text' | 'image' | 'video'
    capability: text('capability').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    // ── text pricing — USD per 1M tokens ───────────────────────────
    // For DeepSeek-style cache-tier providers, `inputPricePer1MUsd` is
    // the cache-MISS rate and `inputCacheHitPricePer1MUsd` the hit rate.
    inputPricePer1MUsd: numeric('input_price_per_1m_usd', {
      precision: 12,
      scale: 6,
    }),
    inputCacheHitPricePer1MUsd: numeric('input_cache_hit_price_per_1m_usd', {
      precision: 12,
      scale: 6,
    }),
    outputPricePer1MUsd: numeric('output_price_per_1m_usd', {
      precision: 12,
      scale: 6,
    }),
    // ── image pricing — per-resolution {credits, priceUsd} map ──────
    // Nano Banana charges more for higher resolutions, so credit cost
    // and USD price are tracked per tier (1k / 2k / 4k).
    imageResolutionPricing: jsonb(
      'image_resolution_pricing',
    ).$type<ImageResolutionPricing>(),
    // ── video pricing — USD per generated second ───────────────────
    pricePerSecondUsd: numeric('price_per_second_usd', {
      precision: 12,
      scale: 6,
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    configCapabilityUniq: uniqueIndex('ai_provider_capabilities_config_cap_uniq').on(
      t.configId,
      t.capability,
    ),
    defaultPerCapabilityUniq: uniqueIndex(
      'ai_provider_capabilities_default_uniq',
    )
      .on(t.capability)
      .where(sql`${t.isDefault} = true`),
  }),
)
