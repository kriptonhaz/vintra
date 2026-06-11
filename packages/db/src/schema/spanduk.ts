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

export type SpandukType = 'xbanner' | 'spanduk'

/**
 * Admin-managed catalog of standard print sizes. Tenants may either pick
 * a preset (e.g., "60×160cm X-Banner") or enter a fully custom W×H at
 * generation time. Width/height in centimeters.
 */
export const spandukSizePresets = pgTable(
  'spanduk_size_presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').$type<SpandukType>().notNull(),
    label: text('label').notNull(),
    widthCm: integer('width_cm').notNull(),
    heightCm: integer('height_cm').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    typeIdx: index('spanduk_size_presets_type_idx').on(t.type, t.sortOrder),
  }),
)

/** Admin-configurable selectors shown on the Buat Spanduk page. */
export const spandukPromptFields = pgTable(
  'spanduk_prompt_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    helpText: text('help_text'),
    // 'select' (dropdown of options) | 'text' (free-text input)
    fieldType: text('field_type').notNull().default('select'),
    allowsCustom: boolean('allows_custom').notNull().default(false),
    required: boolean('required').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    keyUniq: uniqueIndex('spanduk_prompt_fields_key_uniq').on(t.key),
  }),
)

/** Predefined choice for a select-type spanduk prompt field. */
export const spandukPromptFieldOptions = pgTable(
  'spanduk_prompt_field_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .references(() => spandukPromptFields.id, { onDelete: 'cascade' })
      .notNull(),
    label: text('label').notNull(),
    promptFragment: text('prompt_fragment').notNull().default(''),
    textInputs: jsonb('text_inputs').$type<KontenOptionTextInput[]>(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    fieldIdx: index('spanduk_prompt_field_options_field_idx').on(t.fieldId),
  }),
)

/**
 * Layout config controlling how the headline / subhead / phone / address
 * are composited onto the AI-generated background. Stored as JSONB so we
 * can iterate without migrations.
 */
export type SpandukTextLayout = {
  // Bottom strip
  stripHeightPct: number // 0..1 — height of strip relative to image
  stripBgColor: string // e.g., "#0F172A"
  stripOpacity: number // 0..1
  // Text style
  headlineFont: string // family name as bundled
  headlineColor: string
  subheadFont: string
  subheadColor: string
  contactFont: string
  contactColor: string
}

/** Singleton platform settings for the spanduk prompt + layout. */
export const spandukSettings = pgTable('spanduk_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  promptTemplate: text('prompt_template').notNull().default(''),
  defaultCreditCost: integer('default_credit_cost').notNull().default(6),
  textLayout: jsonb('text_layout').$type<SpandukTextLayout>(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * One row per AI spanduk generation. Like logos but adds physical
 * dimensions, the text-overlay payload, and both PNG + PDF result keys
 * (the AI background is also kept as bg_image_key for re-compositing).
 * Credits come out of the shared Konten credit pool.
 */
export const spanduks = pgTable(
  'spanduks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').notNull().default('pending'),
    type: text('type').$type<SpandukType>().notNull(),
    sizePresetId: uuid('size_preset_id').references(
      () => spandukSizePresets.id,
      { onDelete: 'set null' },
    ),
    widthCm: integer('width_cm').notNull(),
    heightCm: integer('height_cm').notNull(),
    // Text overlay payload — captured at generation time
    headline: text('headline'),
    subheadline: text('subheadline'),
    phone: text('phone'),
    address: text('address'),
    ctaText: text('cta_text'),
    // Image artifacts in S3
    bgImageKey: text('bg_image_key'), // raw AI background pre-composite
    pngImageKey: text('png_image_key'), // final composited PNG
    pdfImageKey: text('pdf_image_key'), // print-ready PDF
    // 0..4 product reference photos uploaded by the tenant; each S3
    // object keyed at `<tenantId>/spanduks/<id>.source-<n>.<ext>`.
    sourceImageKeys: jsonb('source_image_keys').$type<string[]>(),
    // Generation metadata
    prompt: text('prompt').notNull(),
    selections: jsonb('selections').$type<KontenSelectionSnapshot[]>(),
    resolution: text('resolution'),
    providerConfigId: uuid('provider_config_id'),
    model: text('model'),
    // Gemini seed used for this generation. Reused by commitSpandukPreview
    // to regenerate at 4K with the same composition the user just
    // approved at 1K. Nullable for legacy rows generated before this
    // column existed.
    seed: integer('seed'),
    // Self-reference: a 4K commit row points back at the 1K preview
    // it was generated from. NULL for direct (skip-preview) generations
    // and for preview rows themselves. Intentionally NO foreign-key
    // constraint to keep the schema flexible if preview rows are
    // garbage-collected without taking commits with them.
    parentSpandukId: uuid('parent_spanduk_id'),
    errorMessage: text('error_message'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    creditsCharged: integer('credits_charged').notNull().default(0),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantTimeIdx: index('spanduks_tenant_time_idx').on(t.tenantId, t.createdAt),
  }),
)
