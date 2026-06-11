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

/**
 * A frozen snapshot of one field selection on a generation. Stored on
 * konten_images so the gallery always shows what was picked even after an
 * admin renames or deletes the underlying prompt field/option.
 */
export type KontenSelectionSnapshot = {
  fieldKey: string
  fieldLabel: string
  value: string
  isCustom: boolean
  /** Free-text values the tenant typed into the option's text inputs
   *  (e.g. headline / subheadline / CTA for the "use my own text" option). */
  textInputs?: Array<{ key: string; label: string; value: string }>
}

/**
 * One declared free-text input on a konten prompt-field option. When an
 * option carries `textInputs`, the generate UI reveals these boxes once
 * the option is picked, and the option's `prompt_fragment` may reference
 * the typed values with `{key}` tokens.
 */
export type KontenOptionTextInput = {
  key: string
  label: string
  placeholder?: string
  multiline?: boolean
  maxLength?: number
}

/**
 * Per-tenant balance of Konten credits. 1 credit = 1 AI image generation.
 * Topped up by platform admins (no payment gateway yet — manual grants).
 *
 * `balance` is a cached running total. It MUST only ever be mutated in the
 * same transaction as a matching konten_credit_ledger row, so the ledger
 * stays the source of truth and the balance stays reconcilable.
 */
export const kontenCreditAccounts = pgTable(
  'konten_credit_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    balance: integer('balance').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantUniq: uniqueIndex('konten_credit_accounts_tenant_uniq').on(t.tenantId),
  }),
)

/**
 * Append-only audit trail of every credit movement. `delta` is signed:
 * positive for top-ups / refunds, negative for generation spend.
 */
export const kontenCreditLedger = pgTable(
  'konten_credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    delta: integer('delta').notNull(),
    // 'topup' | 'generation' | 'refund' | 'adjustment'
    type: text('type').notNull(),
    // Links a 'generation' / 'refund' row to the konten image it paid for.
    refId: uuid('ref_id'),
    note: text('note'),
    // Supabase auth user id of whoever caused the movement (admin or tenant).
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantTimeIdx: index('konten_credit_ledger_tenant_time_idx').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
)

/**
 * One row per AI image generation. Created with status `pending`, then
 * flipped to `success` (with `resultImageKey`) or `error`. Credits are
 * only charged on success.
 */
export const kontenImages = pgTable(
  'konten_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    // 'pending' while generation runs, then 'success' | 'error'.
    status: text('status').notNull().default('pending'),
    // S3 keys — see lib/s3-storage.ts uploadKontenImage.
    sourceImageKey: text('source_image_key'),
    resultImageKey: text('result_image_key'),
    // Optional second source image — the person to feature when the
    // tenant picks a UGC subjek (Tangan/Siluet, Suasana Santai, or
    // Fokus Orang) and uploads their own face/silhouette. Fused with
    // the product into the final result.
    personImageKey: text('person_image_key'),
    // Optional link to the product the image is for. No FK — it may
    // point at an inventory item or an HPP product.
    productId: uuid('product_id'),
    // Final assembled prompt sent to the model — kept for audit; the
    // gallery shows `selections` instead of this raw text.
    prompt: text('prompt').notNull(),
    // 'guided' (field selections) | 'custom' (user-written raw prompt).
    promptMode: text('prompt_mode').notNull().default('guided'),
    // Frozen snapshot of the guided-mode field selections — see the
    // KontenSelectionSnapshot type. Empty/null for custom-mode rows.
    selections: jsonb('selections').$type<KontenSelectionSnapshot[]>(),
    // Resolution tier the image was generated at ('1k' | '2k' | '4k').
    resolution: text('resolution'),
    // Snapshot of the AI config + model used. No FK on configId so a
    // later config delete doesn't orphan generation history.
    providerConfigId: uuid('provider_config_id'),
    model: text('model'),
    errorMessage: text('error_message'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    creditsCharged: integer('credits_charged').notNull().default(0),
    // Supabase auth user id of the tenant member who ran the generation.
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantTimeIdx: index('konten_images_tenant_time_idx').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
)

/**
 * Admin-configurable selectors shown on the Konten generate page (e.g.
 * "Gaya", "Target Pasar", "Platform"). Each field's options carry a
 * prompt fragment; `allowsCustom` lets the tenant type their own value.
 */
export const kontenPromptFields = pgTable(
  'konten_prompt_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Stable key referenced by the prompt template's {placeholders}.
    key: text('key').notNull(),
    label: text('label').notNull(),
    helpText: text('help_text'),
    // When true, the generate UI lets the tenant enter a free-text value.
    allowsCustom: boolean('allows_custom').notNull().default(false),
    required: boolean('required').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    keyUniq: uniqueIndex('konten_prompt_fields_key_uniq').on(t.key),
  }),
)

/** A predefined choice for a prompt field. */
export const kontenPromptFieldOptions = pgTable(
  'konten_prompt_field_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .references(() => kontenPromptFields.id, { onDelete: 'cascade' })
      .notNull(),
    label: text('label').notNull(),
    // Text substituted into the prompt template when this option is picked.
    // May reference typed values from `textInputs` with `{input_key}` tokens.
    promptFragment: text('prompt_fragment').notNull().default(''),
    // Optional free-text inputs the tenant fills in when this option is
    // picked — see KontenOptionTextInput. Null/empty = no inputs.
    textInputs: jsonb('text_inputs').$type<KontenOptionTextInput[]>(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    fieldIdx: index('konten_prompt_field_options_field_idx').on(t.fieldId),
  }),
)

/**
 * Platform-wide Konten settings — a single row. `promptTemplate` is the
 * guided-mode prompt with {field_key} placeholders substituted from the
 * tenant's selections at generation time.
 */
export const kontenSettings = pgTable('konten_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  promptTemplate: text('prompt_template').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
