import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './auth'
import { branches } from './attendance'
import { customers, posSales } from './pos'
import { suppliers } from './hpp'

/**
 * Cashflow Monitoring Phase 1 (JUR-155).
 *
 * `cashflow_categories` carries both shared system rows and per-tenant
 * custom rows: a system row has `tenant_id = NULL` + `is_system = true`
 * and is visible to every tenant; a custom row is tenant-scoped. The
 * manual ledger surface only ever creates custom rows.
 */
export const cashflowCategories = pgTable(
  'cashflow_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL for shared system categories; set for tenant-custom rows. */
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    /** 'income' | 'expense' — a category only applies to one side. */
    kind: text('kind').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    kindChk: check(
      'cashflow_categories_kind_chk',
      sql`${t.kind} IN ('income', 'expense')`,
    ),
  }),
)

/**
 * Akun Kas & Bank (JUR-192). A tenant's money pots — cash drawer, bank
 * accounts, e-wallets. Every tenant has exactly one `is_default` account
 * (auto-seeded); single-account tenants never see the rest of the UI.
 */
export const cashflowAccounts = pgTable(
  'cashflow_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    /** Optional — which outlet owns this money pot (null = shared). */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    /** 'cash' | 'bank' | 'ewallet' | 'other'. */
    kind: text('kind').notNull().default('cash'),
    openingBalance: numeric('opening_balance', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    kindChk: check(
      'cashflow_accounts_kind_chk',
      sql`${t.kind} IN ('cash', 'bank', 'ewallet', 'other')`,
    ),
    tenantIdx: index('cashflow_accounts_tenant_idx').on(t.tenantId),
    // At most one default account per tenant.
    defaultUnique: uniqueIndex('cashflow_accounts_default_unique')
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
  }),
)

/**
 * The cashflow ledger. Phase 1 only writes `source = 'manual'` rows;
 * 'pos_sale' (Phase 2) and 'bank_import' (post-v1) are reserved in the
 * CHECK constraint so neither needs a migration later.
 */
export const cashflowEntries = pgTable(
  'cashflow_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    /** Optional — multi-branch tenants attribute an entry to one outlet. */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    /** 'income' | 'expense'. Must match the category's `kind`. */
    type: text('type').notNull(),
    categoryId: uuid('category_id')
      .references(() => cashflowCategories.id)
      .notNull(),
    /** Which money pot this entry landed in / came out of (JUR-192). */
    accountId: uuid('account_id')
      .references(() => cashflowAccounts.id)
      .notNull(),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    /** Business date of the entry (not the row's created_at). */
    date: date('date').notNull(),
    source: text('source').notNull().default('manual'),
    /** Back-reference for non-manual rows (e.g. the POS sale id). */
    sourceRef: text('source_ref'),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    typeChk: check(
      'cashflow_entries_type_chk',
      sql`${t.type} IN ('income', 'expense')`,
    ),
    sourceChk: check(
      'cashflow_entries_source_chk',
      sql`${t.source} IN ('manual', 'pos_sale', 'bank_import', 'ar_payment', 'ap_payment', 'stock_requisition', 'pos_cash_payout')`,
    ),
    tenantDateIdx: index('cashflow_entries_tenant_date_idx').on(
      t.tenantId,
      t.date,
    ),
  }),
)

/**
 * Bon Pelanggan / accounts receivable (JUR-157). Money a customer owes
 * the tenant — typically a warung letting a regular buy on credit.
 * `amount` is the original debt; `paidAmount` accumulates as payments
 * land; `status` is derived (outstanding → partial → paid).
 */
export const arReceivables = pgTable(
  'ar_receivables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    customerId: uuid('customer_id')
      .references(() => customers.id, { onDelete: 'cascade' })
      .notNull(),
    /** Optional — the outlet that extended the credit (null = unassigned). */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    /** Set when the bon originated from an under-paid POS sale. */
    saleId: uuid('sale_id').references(() => posSales.id, {
      onDelete: 'set null',
    }),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    paidAmount: numeric('paid_amount', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    status: text('status').notNull().default('outstanding'),
    dueDate: date('due_date'),
    note: text('note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    paidAt: timestamp('paid_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    statusChk: check(
      'ar_receivables_status_chk',
      sql`${t.status} IN ('outstanding', 'partial', 'paid', 'written_off')`,
    ),
    tenantStatusIdx: index('ar_receivables_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
  }),
)

/** Individual payments against a receivable — supports partial collection. */
export const arPayments = pgTable(
  'ar_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receivableId: uuid('receivable_id')
      .references(() => arReceivables.id, { onDelete: 'cascade' })
      .notNull(),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    method: text('method').notNull(),
    note: text('note'),
    recordedByUserId: uuid('recorded_by_user_id').notNull(),
    paidAt: timestamp('paid_at').defaultNow().notNull(),
  },
  (t) => ({
    methodChk: check(
      'ar_payments_method_chk',
      sql`${t.method} IN ('cash', 'transfer', 'qris', 'other')`,
    ),
    receivableIdx: index('ar_payments_receivable_idx').on(t.receivableId),
  }),
)

/**
 * Cicilan / accounts payable (JUR-158). Money the tenant owes on an
 * installment plan — supplier cicilan, equipment, recurring bills.
 * `ap_payments` holds the per-installment schedule generated up front.
 */
export const apPayables = pgTable(
  'ap_payables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    /** Optional — the outlet that owes this (null = unassigned). */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    supplierId: uuid('supplier_id').references(() => suppliers.id, {
      onDelete: 'set null',
    }),
    totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull(),
    scheduleKind: text('schedule_kind').notNull(),
    installmentCount: integer('installment_count').notNull(),
    firstDueDate: date('first_due_date').notNull(),
    remindersMuted: boolean('reminders_muted').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    scheduleKindChk: check(
      'ap_payables_schedule_kind_chk',
      sql`${t.scheduleKind} IN ('one_off', 'monthly')`,
    ),
    tenantIdx: index('ap_payables_tenant_idx').on(t.tenantId),
  }),
)

/** One installment of a payable. `paidAt` null = still due. */
export const apPayments = pgTable(
  'ap_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payableId: uuid('payable_id')
      .references(() => apPayables.id, { onDelete: 'cascade' })
      .notNull(),
    installmentIndex: integer('installment_index').notNull(),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    dueDate: date('due_date').notNull(),
    paidAt: timestamp('paid_at'),
    method: text('method'),
    note: text('note'),
    recordedByUserId: uuid('recorded_by_user_id'),
  },
  (t) => ({
    methodChk: check(
      'ap_payments_method_chk',
      sql`${t.method} IS NULL OR ${t.method} IN ('cash', 'transfer', 'qris', 'other')`,
    ),
    payableIdx: index('ap_payments_payable_idx').on(t.payableId),
  }),
)

/**
 * Money moved between a tenant's own accounts (JUR-192). A transfer is
 * NOT income or expense — it nets to zero on the P&L. Account balances
 * read it directly: +amount on `to`, −amount on `from`.
 */
export const cashflowTransfers = pgTable(
  'cashflow_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    fromAccountId: uuid('from_account_id')
      .references(() => cashflowAccounts.id)
      .notNull(),
    toAccountId: uuid('to_account_id')
      .references(() => cashflowAccounts.id)
      .notNull(),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    date: date('date').notNull(),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    distinctChk: check(
      'cashflow_transfers_distinct_chk',
      sql`${t.fromAccountId} <> ${t.toAccountId}`,
    ),
    tenantDateIdx: index('cashflow_transfers_tenant_date_idx').on(
      t.tenantId,
      t.date,
    ),
  }),
)
