import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { tenants } from './auth'
import { branches } from './attendance'
import { aiProviderConfigs } from './ai'

/**
 * Per-tenant WhatsApp subscription state.
 * Mirrors the pos_settings / inventory_settings pattern.
 * tier values: 'free' | 'basic' | 'komplit' | 'enterprise'
 */
export const waSettings = pgTable('wa_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  tier: text('tier').notNull().default('free'),
  subscriptionActive: boolean('subscription_active').notNull().default(false),
  subscriptionExpiresAt: timestamp('subscription_expires_at'),
  trialEndsAt: timestamp('trial_ends_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * One WhatsApp account (= one Baileys socket) per row, scoped to a
 * tenant. AI personality lives here (not on tenants) so a single
 * tenant can run several distinct numbers — e.g. "Toko Pusat" vs
 * "Cabang Bandung" — each with its own system prompt and model.
 *
 * `status` values are application-managed (no enum constraint to keep
 * migrations cheap):
 *   disconnected | qr | connecting | connected | logged_out | banned
 *
 * `aiTemperature` is `text` rather than `numeric` because the value
 * round-trips as a string in our config flow anyway and avoiding
 * float math at the DB layer keeps things predictable.
 */
export const waInstances = pgTable(
  'wa_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * Optional — the outlet this WhatsApp number belongs to (null =
     * tenant-level / unassigned). Lets a franchise run a separate
     * number per outlet, sold as a per-branch add-on. Entitlement is
     * checked against `branches.enabled_modules`.
     */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    label: text('label').notNull(),
    phoneNumber: text('phone_number'),
    status: text('status').notNull().default('disconnected'),
    lastConnectedAt: timestamp('last_connected_at'),
    lastDisconnectReason: text('last_disconnect_reason'),

    aiEnabled: boolean('ai_enabled').notNull().default(false),
    aiProvider: text('ai_provider').default('openai'),
    aiModel: text('ai_model').default('gpt-4o-mini'),
    aiSystemPrompt: text('ai_system_prompt'),
    aiTemperature: text('ai_temperature').default('0.7'),
    aiMaxHistory: integer('ai_max_history').notNull().default(10),
    aiProviderConfigId: uuid('ai_provider_config_id').references(
      () => aiProviderConfigs.id,
      { onDelete: 'set null' },
    ),

    /**
     * Handoff workflow (JUR-74). When AI flags a chat for human review,
     * the worker sends a notification to this admin phone via the same
     * WA instance. Must differ from `phoneNumber` — whatsmeow rejects
     * self-sends.
     */
    adminPhone: text('admin_phone'),
    /**
     * After this many hours of admin inactivity, AI auto-resumes when
     * the customer sends a new message. 0 = never auto-resume (manual
     * only). Validated 0-168 at the app layer.
     */
    handoffAutoResumeHours: integer('handoff_auto_resume_hours')
      .notNull()
      .default(24),

    /**
     * Owner-controlled toggle for staff WhatsApp OTP login. When true,
     * inbound messages matching the OTP-request pattern are intercepted:
     * the worker generates a 6-digit code and replies with it instead of
     * routing the message to AI. Off by default — owners enable it from
     * the instance config sheet once staff phones are populated. Tier
     * (wa_settings.tier) must also be basic+ for login to actually work;
     * this flag is the per-instance switch on top of the tier check.
     */
    otpLoginEnabled: boolean('otp_login_enabled').notNull().default(false),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index('wa_instances_tenant_idx').on(t.tenantId),
    aiProviderConfigIdx: index('wa_instances_ai_provider_config_idx').on(
      t.aiProviderConfigId,
    ),
  }),
)

/**
 * Append-only log of every WhatsApp message the platform knows about
 * (inbound + outbound). `external_id` is the Baileys message key.id;
 * we index it for the dedupe path — Baileys re-emits messages during
 * resync after reconnect so we INSERT … ON CONFLICT against this
 * column.
 *
 * Binary media is NOT stored here — `media_key` is the S3 object key
 * (set by JUR-45 onwards), retrieved via signed URL on read.
 */
export const waMessages = pgTable(
  'wa_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    instanceId: uuid('instance_id')
      .references(() => waInstances.id, { onDelete: 'cascade' })
      .notNull(),
    remoteJid: text('remote_jid').notNull(),
    externalId: text('external_id'),
    fromMe: boolean('from_me').notNull(),
    type: text('type').notNull(),
    body: text('body'),
    // S3 object key for media messages (image / sticker / document).
    // NULL for text-only messages and for media we failed to download.
    // Populated by JUR-75 (inbound) and JUR-76 (outbound).
    mediaKey: text('media_key'),
    mediaMime: text('media_mime'),
    mediaSizeBytes: integer('media_size_bytes'),
    status: text('status').notNull().default('pending'),
    errorMessage: text('error_message'),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    // FK to ai_usage_logs intentionally not declared — would create a
    // cross-file circular dep at the schema-import level. The column
    // is nullable; consistency is enforced at write time.
    aiUsageLogId: uuid('ai_usage_log_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    // Conversation tail read — the hot path for the chat UI.
    instanceJidTimeIdx: index('wa_messages_instance_jid_time_idx').on(
      t.instanceId,
      t.remoteJid,
      t.createdAt,
    ),
    tenantTimeIdx: index('wa_messages_tenant_time_idx').on(
      t.tenantId,
      t.createdAt,
    ),
    // Dedupe lookup — covers the resync-after-reconnect case.
    externalIdx: index('wa_messages_external_idx').on(t.externalId),
  }),
)

/**
 * Per-instance contact projection — cheap lookup for name/pushName
 * caching and "who has been messaging me" lists. One row per (instance,
 * jid); upserted on every inbound.
 */
export const waContacts = pgTable(
  'wa_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    instanceId: uuid('instance_id')
      .references(() => waInstances.id, { onDelete: 'cascade' })
      .notNull(),
    remoteJid: text('remote_jid').notNull(),
    // The privacy-mode LID for the same identity. WhatsApp emits both
    // forms — phone-number JID (`@s.whatsapp.net`) and LID (`@lid`) —
    // for every message via Info.Chat + Info.RecipientAlt. We persist
    // both so future messages addressed against the LID can be resolved
    // back to the canonical PN row.
    lidJid: text('lid_jid'),
    name: text('name'),
    pushName: text('push_name'),
    lastMessageAt: timestamp('last_message_at'),
    // Number of unread inbound messages since the user last opened this
    // conversation. Incremented by the inbound worker, reset to 0 by
    // the "mark read" endpoint when the user opens the chat in the UI.
    unreadCount: integer('unread_count').notNull().default(0),

    /**
     * Handoff state (JUR-74). When `needsHuman=true`, the AI auto-reply
     * worker skips this contact until either an admin manually clears
     * via the chat UI, or `wa_instances.handoff_auto_resume_hours`
     * elapses on the next inbound. `handoffSummary` is generated by
     * the LLM at handoff time and surfaces in the admin notification +
     * chat banner so context isn't lost.
     */
    needsHuman: boolean('needs_human').notNull().default(false),
    handoffAt: timestamp('handoff_at'),
    handoffReason: text('handoff_reason'),
    handoffSummary: text('handoff_summary'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    instanceJidUniq: uniqueIndex('wa_contacts_instance_jid_uniq').on(
      t.instanceId,
      t.remoteJid,
    ),
    instanceLidIdx: index('wa_contacts_instance_lid_idx').on(
      t.instanceId,
      t.lidJid,
    ),
  }),
)

/**
 * JUR-80 — inbound emoji reactions attached to a parent message.
 *
 * v1 silently dropped reactions in registry.isSkippableMessage so the
 * inbox didn't fill with "[Pesan tidak didukung]" bubbles; v2 captures
 * them so operators can SEE that a customer reacted 👍 to a product
 * photo or ❤️ to a payment confirmation — quiet-but-meaningful signal.
 *
 * Unique (parent_message_id, sender_jid) so one sender can only have
 * one active reaction per message — updating swaps the emoji in place
 * (whatsmeow re-emits the event), removing the reaction deletes the row.
 * No audit history for v2 — reaction history isn't a business need.
 */
export const waReactions = pgTable(
  'wa_reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    instanceId: uuid('instance_id')
      .references(() => waInstances.id, { onDelete: 'cascade' })
      .notNull(),
    parentMessageId: uuid('parent_message_id')
      .references(() => waMessages.id, { onDelete: 'cascade' })
      .notNull(),
    senderJid: text('sender_jid').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    parentSenderUniq: uniqueIndex('wa_reactions_parent_sender_uniq').on(
      t.parentMessageId,
      t.senderJid,
    ),
    parentIdx: index('wa_reactions_parent_idx').on(t.parentMessageId),
  }),
)
