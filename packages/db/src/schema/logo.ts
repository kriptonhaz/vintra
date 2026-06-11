import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  jsonb,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { tenants } from './auth'
import type {
  KontenOptionTextInput,
  KontenSelectionSnapshot,
} from './konten'

/**
 * Admin-configurable selectors shown on the Buat Logo page. Same shape as
 * konten_prompt_fields, but with a `fieldType` discriminator: 'select'
 * fields render as dropdowns (with options + optional custom input), while
 * 'text' fields render as a plain free-text input (no options needed) —
 * the right fit for business name and tagline.
 */
export const logoPromptFields = pgTable(
  'logo_prompt_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    helpText: text('help_text'),
    // 'select' (dropdown of options) | 'text' (free-text input)
    fieldType: text('field_type').notNull().default('select'),
    // Only meaningful when fieldType='select': lets the tenant enter a
    // free-text value instead of picking one of the options.
    allowsCustom: boolean('allows_custom').notNull().default(false),
    required: boolean('required').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    keyUniq: uniqueIndex('logo_prompt_fields_key_uniq').on(t.key),
  }),
)

/** Predefined choice for a select-type logo prompt field. */
export const logoPromptFieldOptions = pgTable(
  'logo_prompt_field_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .references(() => logoPromptFields.id, { onDelete: 'cascade' })
      .notNull(),
    label: text('label').notNull(),
    promptFragment: text('prompt_fragment').notNull().default(''),
    textInputs: jsonb('text_inputs').$type<KontenOptionTextInput[]>(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    fieldIdx: index('logo_prompt_field_options_field_idx').on(t.fieldId),
  }),
)

/** Singleton platform settings for the logo prompt template. */
export const logoSettings = pgTable('logo_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  promptTemplate: text('prompt_template').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * One row per AI logo generation. Mirrors konten_images, minus the
 * source_image_key (logos are text-to-image — no source photo is
 * uploaded). Credits are deducted from the shared Konten credit pool.
 */
export const logos = pgTable(
  'logos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').notNull().default('pending'),
    resultImageKey: text('result_image_key'),
    prompt: text('prompt').notNull(),
    selections: jsonb('selections').$type<KontenSelectionSnapshot[]>(),
    resolution: text('resolution'),
    providerConfigId: uuid('provider_config_id'),
    model: text('model'),
    errorMessage: text('error_message'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    creditsCharged: integer('credits_charged').notNull().default(0),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantTimeIdx: index('logos_tenant_time_idx').on(t.tenantId, t.createdAt),
  }),
)
