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

export const referralCodes = pgTable('referral_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(),
  label: text('label'),
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
  referrerTenantId: uuid('referrer_tenant_id').notNull().references(() => tenants.id),
  discountPctSnapshot: numeric('discount_pct_snapshot', { precision: 5, scale: 2 }).notNull(),
  commissionPctSnapshot: numeric('commission_pct_snapshot', { precision: 5, scale: 2 }).notNull(),
  windowMonths: integer('window_months').notNull().default(12),
  attributedAt: timestamp('attributed_at', { withTimezone: true }).notNull().defaultNow(),
  windowEndsAt: timestamp('window_ends_at', { withTimezone: true }).notNull(),
})

export const tenantPayoutMethods = pgTable('tenant_payout_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  bankName: text('bank_name').notNull(),
  accountNumber: text('account_number').notNull(),
  accountHolderName: text('account_holder_name').notNull(),
  isDefault: boolean('is_default').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const referralClaimRequests = pgTable('referral_claim_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
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
  referrerTenantId: uuid('referrer_tenant_id').notNull(),
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
