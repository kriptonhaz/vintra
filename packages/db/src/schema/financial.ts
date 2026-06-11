import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { tenants } from './auth'

/**
 * Append-only ledger of manual payments + refunds for paid modules.
 *
 * - One row per payment (status='paid')
 * - One row per refund (status='refund', refundOfTransactionId → original)
 * - Subscription state still lives on `attendance_settings` (etc.). This
 *   table is the event log; the module settings table is the snapshot.
 *
 * Invoice number format: INV-{YYYY}-{####}. Generated atomically via
 * `financial_invoice_counters` inside the same DB transaction as the
 * insert, so there are no gaps or duplicates even under concurrency.
 */
export const financialTransactions = pgTable(
  'financial_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    invoiceNumber: text('invoice_number').notNull().unique(),
    moduleKey: text('module_key').notNull(),
    planKey: text('plan_key').notNull(),
    periodStartAt: timestamp('period_start_at').notNull(),
    periodEndAt: timestamp('period_end_at').notNull(),
    // Stored as integer rupiah (no fractional currency). numeric(15,0)
    // lets us go up to hundreds of trillions while staying exact.
    amountIdr: numeric('amount_idr', { precision: 15, scale: 0 }).notNull(),
    transferDate: date('transfer_date').notNull(),
    bankReference: text('bank_reference'),
    proofPhotoKey: text('proof_photo_key'),
    // Attendance uses this; other modules may leave null.
    billedStaffCount: integer('billed_staff_count'),
    // POS uses this — how many outlets the payment covers for the
    // billing period. Null for non-POS rows. The billing math is
    // base_price + (billedOutletCount - 1) × additional_outlet_price.
    billedOutletCount: integer('billed_outlet_count'),
    notes: text('notes'),
    // 'paid' | 'refund'. Refunds never mutate the original row — a new
    // row is inserted and linked via refundOfTransactionId so the
    // original "when was payment received" signal stays true.
    status: text('status').notNull().default('paid'),
    refundOfTransactionId: uuid('refund_of_transaction_id').references(
      (): any => financialTransactions.id,
      { onDelete: 'set null' },
    ),
    // Platform admin who entered the record — shown in the audit trail
    // and surfaced as "Dicatat oleh" in the finance list.
    recordedByUserId: uuid('recorded_by_user_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    byTenant: index('financial_transactions_tenant_created_idx').on(
      t.tenantId,
      t.createdAt.desc(),
    ),
    byCreated: index('financial_transactions_created_idx').on(
      t.createdAt.desc(),
    ),
    byModuleStatus: index('financial_transactions_module_status_idx').on(
      t.moduleKey,
      t.status,
      t.createdAt.desc(),
    ),
  }),
)

/**
 * Per-year monotonic invoice-number sequence. Keyed by year so the
 * number resets each Jan 1. Atomic increment via:
 *   INSERT ... VALUES ($year, 1)
 *   ON CONFLICT (year) DO UPDATE
 *     SET last_number = financial_invoice_counters.last_number + 1
 *   RETURNING last_number;
 */
export const financialInvoiceCounters = pgTable(
  'financial_invoice_counters',
  {
    year: integer('year').primaryKey(),
    lastNumber: integer('last_number').notNull().default(0),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
)
