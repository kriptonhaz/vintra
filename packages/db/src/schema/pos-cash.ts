import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  boolean,
  check,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './auth'
import { branches } from './attendance'
import { posSales } from './pos'

/**
 * JUR-141: Peti Kas (cash drawer) — per-cashier shift state.
 *
 * One row per open/close cycle for a single cashier at one branch.
 * The partial unique index enforces "at most one open session per
 * (branch, cashier)" — DB-level guarantee so a race in the cashier
 * UI can't double-open.
 *
 * Rolling totals (`cash_in_total`, `cash_out_total`) are bumped on
 * every movement INSERT so the header chip can render without
 * scanning the ledger. `expected_closing` is recomputed FROM the
 * ledger on close as a sanity check against the rolling totals.
 *
 * Lives in its own file (not pos.ts) so the cross-schema FK to
 * `branches` (in attendance.ts) doesn't introduce a circular import
 * — same pattern as `tenant_member_branches` (JUR-135).
 */
export const posCashSessions = pgTable(
  'pos_cash_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id)
      .notNull(),
    /** Supabase auth.users.id of the cashier who owns this session. */
    cashierUserId: uuid('cashier_user_id').notNull(),
    status: text('status').notNull().default('open'),
    /** Modal awal — cashier's physical count at open. */
    openingBalance: numeric('opening_balance', { precision: 15, scale: 2 }).notNull(),
    openingNotes: text('opening_notes'),
    openedAt: timestamp('opened_at').notNull().defaultNow(),
    /**
     * Snapshot on close. `expected_closing` is the computed
     * `opening + cash_in_total - cash_out_total`. `actual_closing` is
     * the cashier's physical count. `variance = actual - expected`
     * (positive = surplus, negative = shortage).
     */
    expectedClosing: numeric('expected_closing', { precision: 15, scale: 2 }),
    actualClosing: numeric('actual_closing', { precision: 15, scale: 2 }),
    variance: numeric('variance', { precision: 15, scale: 2 }),
    closingNotes: text('closing_notes'),
    closedAt: timestamp('closed_at'),
    /**
     * Rolling totals for fast header reads. Always = SUM of related
     * `pos_cash_movements` of the corresponding type. `closeSession`
     * recomputes from the ledger to catch any drift.
     */
    cashInTotal: numeric('cash_in_total', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    cashOutTotal: numeric('cash_out_total', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    /**
     * True when the session was closed without a physical count
     * (stale-session force-close path). UI surfaces this so owners
     * can spot "unreliable" reconciliations in the report.
     */
    forceClosed: boolean('force_closed').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    statusChk: check(
      'pos_cash_sessions_status_chk',
      sql`${t.status} IN ('open', 'closed')`,
    ),
    // Partial unique index: at most ONE open session per (branch,
    // cashier). Doesn't constrain closed sessions, so the same
    // cashier accumulates a history across days.
    openPerCashier: uniqueIndex('pos_cash_sessions_open_per_cashier_uniq')
      .on(t.branchId, t.cashierUserId)
      .where(sql`${t.status} = 'open'`),
    // Hot path: listSessions filters by tenant + date range.
    tenantOpenedIdx: index('pos_cash_sessions_tenant_opened_idx').on(
      t.tenantId,
      t.openedAt,
    ),
    // For drill-down by cashier.
    cashierIdx: index('pos_cash_sessions_cashier_idx').on(t.cashierUserId),
  }),
)

/**
 * Ledger of cash movements inside a session. Sale + refund types are
 * auto-inserted by `createSale` / `voidSale`; drop + payout are
 * cashier-initiated.
 *
 * `amount` is always positive — direction is implied by `type`:
 *   sale, drop returning cash to till … (none — drops decrease till)
 *   in : sale       (cash entered till)
 *   out: refund, drop, payout (cash left till)
 *
 * `reference_sale_id` is required for sale/refund (audit link back to
 * the originating pos_sales row). `reason` is required for drop/payout
 * (cashier explanation, e.g. "Setor ke owner sore", "Beli galon").
 * Both rules enforced by CHECK constraints below.
 */
export const posCashMovements = pgTable(
  'pos_cash_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Denormalised tenant id — lets tenant-scoped reports query
     * movements without joining sessions. Matches the parent
     * session's tenant_id; enforced at the application layer.
     */
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: uuid('session_id')
      .references(() => posCashSessions.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    reason: text('reason'),
    referenceSaleId: uuid('reference_sale_id').references(() => posSales.id, {
      onDelete: 'set null',
    }),
    /** Supabase auth.users.id — who recorded this movement. */
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    typeChk: check(
      'pos_cash_movements_type_chk',
      sql`${t.type} IN ('sale', 'refund', 'drop', 'payout')`,
    ),
    // Cashier-initiated movements MUST carry a reason. Sale/refund
    // movements are system-generated and don't need one.
    reasonChk: check(
      'pos_cash_movements_reason_chk',
      sql`(${t.type} IN ('drop', 'payout')) = (${t.reason} IS NOT NULL)`,
    ),
    // Sale/refund movements MUST link to a pos_sales row. Drop/payout
    // never do. The set null FK above means deleting a sale orphans
    // the movement (audit trail preserved) — caller should not
    // physically delete sales for this reason.
    referenceChk: check(
      'pos_cash_movements_reference_chk',
      sql`(${t.type} IN ('sale', 'refund')) = (${t.referenceSaleId} IS NOT NULL)`,
    ),
    sessionCreatedIdx: index('pos_cash_movements_session_created_idx').on(
      t.sessionId,
      t.createdAt,
    ),
    // For owner reports filtered by tenant.
    tenantCreatedIdx: index('pos_cash_movements_tenant_created_idx').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
)
