import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
} from 'drizzle-orm/pg-core'
import { tenants } from './auth'
import { marketingAgents } from './marketing'

export const referralCodes = pgTable('referral_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  // For tenant-owned codes: the owning tenant. For agent-owned codes: the
  // internal tenant (tenants.is_internal = true) the agent belongs to.
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // 'tenant' = classic tenant-to-tenant referral (commission credited to the
  // referrer tenant). 'agent' = internal marketing program (commission split
  // between a staff agent and their head). See `./marketing`.
  ownerType: text('owner_type').notNull().default('tenant'),
  // Set only when owner_type = 'agent'. The marketing agent who owns this code.
  ownerAgentId: uuid('owner_agent_id').references(() => marketingAgents.id),
  code: text('code').notNull().unique(),
  label: text('label'),
  // Discount to the referred tenant. For agent codes, commission_pct is the
  // STAFF's own commission slice; the head's override is stored separately on
  // the agent allocation and snapshotted onto the attribution at signup.
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull(),
  commissionPct: numeric('commission_pct', { precision: 5, scale: 2 }).notNull(),
  // Optional usage cap. Null = unlimited. When set, attribution silently
  // skips once the attribution count reaches this number, and the public
  // validator surfaces a 'quota_full' state so the register form can
  // show the code as exhausted.
  maxClaims: integer('max_claims'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const referralAttributions = pgTable('referral_attributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  refereeTenantId: uuid('referee_tenant_id').notNull().unique().references(() => tenants.id, { onDelete: 'cascade' }),
  codeId: uuid('code_id').notNull().references(() => referralCodes.id),
  // Always set: for tenant codes it is the referrer tenant; for agent codes
  // it is the internal tenant the agents belong to. Kept non-null so the
  // existing tenant-referral queries are unaffected.
  referrerTenantId: uuid('referrer_tenant_id').notNull().references(() => tenants.id),
  // Mirrors the owning code's owner_type at signup time.
  ownerType: text('owner_type').notNull().default('tenant'),
  // Agent codes only: the staff agent who owns the code and the head above
  // them at signup time (head is null when a head's own code was used).
  // Snapshotted so later re-allocation never rewrites historical earnings.
  staffAgentId: uuid('staff_agent_id').references(() => marketingAgents.id),
  headAgentId: uuid('head_agent_id').references(() => marketingAgents.id),
  // Agent codes only: the head's override slice at signup time. Null for
  // tenant codes and for a head's own code.
  headOverridePctSnapshot: numeric('head_override_pct_snapshot', { precision: 5, scale: 2 }),
  discountPctSnapshot: numeric('discount_pct_snapshot', { precision: 5, scale: 2 }).notNull(),
  // For agent codes this is the STAFF's commission slice. The head's slice is
  // headOverridePctSnapshot.
  commissionPctSnapshot: numeric('commission_pct_snapshot', { precision: 5, scale: 2 }).notNull(),
  windowMonths: integer('window_months').notNull().default(12),
  attributedAt: timestamp('attributed_at', { withTimezone: true }).notNull().defaultNow(),
  windowEndsAt: timestamp('window_ends_at', { withTimezone: true }).notNull(),
})

export const tenantPayoutMethods = pgTable('tenant_payout_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  // For tenant payout methods: the owning tenant. For agent payout methods:
  // the internal tenant the agent belongs to (kept non-null).
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // 'tenant' = owned by a tenant (one default per tenant, as today).
  // 'agent' = owned by a marketing agent (one default per agent).
  ownerType: text('owner_type').notNull().default('tenant'),
  // Set only when owner_type = 'agent'.
  ownerAgentId: uuid('owner_agent_id').references(() => marketingAgents.id),
  bankName: text('bank_name').notNull(),
  accountNumber: text('account_number').notNull(),
  accountHolderName: text('account_holder_name').notNull(),
  isDefault: boolean('is_default').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const referralClaimRequests = pgTable('referral_claim_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  // For tenant claims: the claiming tenant. For agent claims: the internal
  // tenant the agent belongs to (kept non-null).
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // 'tenant' = submitted by a tenant. 'agent' = submitted by a marketing agent.
  ownerType: text('owner_type').notNull().default('tenant'),
  // Set only when owner_type = 'agent'. The agent who submitted the claim.
  ownerAgentId: uuid('owner_agent_id').references(() => marketingAgents.id),
  payoutMethodId: uuid('payout_method_id').notNull().references(() => tenantPayoutMethods.id),
  totalAmountIdr: numeric('total_amount_idr', { precision: 15, scale: 2 }).notNull(),
  status: text('status').notNull().default('submitted'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processedBy: uuid('processed_by'),
  adminNotes: text('admin_notes'),
  transferProofKey: text('transfer_proof_key'),
})

export const referralCommissions = pgTable('referral_commissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  attributionId: uuid('attribution_id').notNull().references(() => referralAttributions.id),
  // Legacy tenant-referral beneficiary. For agent commissions this is the
  // internal tenant (kept non-null); the real beneficiary is beneficiaryAgentId.
  referrerTenantId: uuid('referrer_tenant_id').notNull(),
  // 'tenant' = credited to a referrer tenant (one row per payment).
  // 'agent' = credited to a marketing agent. Each agent-referral payment
  // produces up to two rows: one for the staff agent, one for the head.
  beneficiaryType: text('beneficiary_type').notNull().default('tenant'),
  // Set only when beneficiary_type = 'agent'. The agent (staff or head) who
  // earns this row.
  beneficiaryAgentId: uuid('beneficiary_agent_id').references(() => marketingAgents.id),
  amountIdr: numeric('amount_idr', { precision: 15, scale: 2 }).notNull(),
  sourceInvoiceId: uuid('source_invoice_id'),
  status: text('status').notNull().default('pending'),
  pendingUntil: timestamp('pending_until', { withTimezone: true }).notNull(),
  claimableAt: timestamp('claimable_at', { withTimezone: true }),
  claimRequestId: uuid('claim_request_id').references(() => referralClaimRequests.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const referralGlobalConfig = pgTable('referral_global_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  capPct: numeric('cap_pct', { precision: 5, scale: 2 }).notNull().default('20.00'),
  // Global default cap for the internal marketing program (see `./marketing`).
  // A head's cap_pct defaults to this on enrollment and must be <= this value.
  // Independent of `capPct` above, which governs tenant-to-tenant referral.
  marketingCapPct: numeric('marketing_cap_pct', { precision: 5, scale: 2 })
    .notNull()
    .default('10.00'),
  defaultWindowMonths: integer('default_window_months').notNull().default(12),
  clawbackDays: integer('clawback_days').notNull().default(14),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
})

// Per-tenant referral allowlist. The referral program is curated: a
// tenant can run it (create codes, view pendaftar, claim commissions)
// only if it has a row here with `enabled = true`. No row = no access.
// `capPct` overrides `referral_global_config.capPct` for that tenant.
//
// Being *referred* (signing up with someone else's code) stays
// universal — that path never consults this table.
export const tenantReferralSettings = pgTable('tenant_referral_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  // True = access granted. False = admin toggled off; the row is kept
  // so re-enabling preserves the previously-set cap.
  enabled: boolean('enabled').notNull().default(true),
  // discountPct + commissionPct on each of this tenant's codes must be
  // <= this value.
  capPct: numeric('cap_pct', { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
