import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { tenants } from './auth'
import { waInstances } from './whatsapp'

/**
 * Short-lived OTPs issued by the WhatsApp login flow.
 *
 * Lifecycle:
 *   1. Staff sends "minta otp login" to the tenant's WA instance.
 *   2. The wa:incoming worker detects the pattern, generates a 6-digit
 *      code, argon2id-hashes it, and inserts a row here. The plaintext
 *      code is sent back to the user via wa:send and never persisted.
 *   3. User types the code into the login page; the verify endpoint
 *      looks up the most recent unconsumed unexpired row for
 *      (tenant_id, phone), compares the hash, and on success sets
 *      consumed_at = now() and mints a Supabase session.
 *
 * Why these columns:
 *   - remote_jid: the @s.whatsapp.net JID from the inbound message.
 *     Captured as proof-of-ownership of the phone (the WA network
 *     guarantees the sender JID); stored for audit, never re-displayed.
 *   - attempts: 3-strikes-and-the-row-is-consumed cap, set by the verify
 *     endpoint. Combined with the 5-minute TTL this makes brute force
 *     infeasible (10^6 keyspace, 5 min, 3 tries per code).
 *   - consumed_at: NULL while pending. Set on first successful verify
 *     OR on the third failed attempt OR when a newer OTP is issued for
 *     the same (tenant, phone). The lookup query filters
 *     `consumed_at IS NULL`.
 */
export const waLoginOtps = pgTable(
  'wa_login_otps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    instanceId: uuid('instance_id')
      .references(() => waInstances.id, { onDelete: 'cascade' })
      .notNull(),
    // E.164-normalized digits only, e.g. "628123456789". Matches the
    // format we use in tenant_members.phone after normalization.
    phone: text('phone').notNull(),
    remoteJid: text('remote_jid').notNull(),
    otpHash: text('otp_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // Hot path: "latest unconsumed unexpired OTP for (tenant, phone)".
    // The verify endpoint hits this on every login attempt.
    lookupIdx: index('wa_login_otps_lookup_idx').on(
      t.tenantId,
      t.phone,
      t.expiresAt,
    ),
  }),
)
