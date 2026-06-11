/**
 * JUR-141 Peti Kas — cashier session + ledger server functions.
 *
 * Lifecycle:
 *   openSession → (cash sales auto-INSERT 'sale' movements via
 *                  pos.ts:createSale)
 *               → recordCashDrop / recordPayout (manual)
 *               → (voids auto-INSERT 'refund' movements via
 *                  pos.ts:voidSale)
 *               → closeSession (variance computed + persisted)
 *
 * Gating: `pos_settings.cash_drawer_enabled` decides whether the
 * cashier flow is gated. Free-tier tenants additionally have the
 * UI hidden so even an opt-in flag won't surface anything.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  posCashSessions,
  posCashMovements,
  posSettings,
  posSales,
  branches,
  tenantMembers,
  DEFAULT_CASH_STALE_CONFIG,
  type CashStaleConfig,
} from '@vintra/db/schema'
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { posTierLimits } from '@vintra/shared'
import { requirePOSAccess } from '../middleware/module-access'
import {
  assertBranchAllowed,
  branchScopeWhere,
} from '../lib/branch-scope'
import { isSessionStale } from '../lib/cash-stale'
import {
  CASH_DRAWER_OPEN_FIRST,
  insertCashMovement,
  findOpenSession,
} from '../lib/cash-movement'
import { writeCashPayoutCashflowEntry } from '../lib/cashflow-sync'

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Read the tenant's cash-drawer toggle + stale-session rule once per
 * call. Avoids repeating the same query in every fn.
 */
async function readCashDrawerConfig(
  tenantId: string,
): Promise<{ enabled: boolean; staleConfig: CashStaleConfig }> {
  const [row] = await db
    .select({
      enabled: posSettings.cashDrawerEnabled,
      staleConfig: posSettings.cashStaleConfig,
    })
    .from(posSettings)
    .where(eq(posSettings.tenantId, tenantId))
    .limit(1)
  // No row yet → column defaults (enabled=true, 14h elapsed).
  // pos_settings is upserted on first POS access so this is cosmetic.
  return {
    enabled: row?.enabled ?? true,
    staleConfig: row?.staleConfig ?? DEFAULT_CASH_STALE_CONFIG,
  }
}

// JUR-145 PR 4 follow-up: shared helpers (insertCashMovement,
// findOpenSession, CASH_DRAWER_OPEN_FIRST) moved to
// `../lib/cash-movement.ts` so the client bundle doesn't pull in
// `db` via this module (which would explode with "Buffer is not
// defined" in the browser).

// ─── Read ────────────────────────────────────────────────────────

/**
 * Cashier UI mount-time check. Returns the current open session
 * (with derived running balance + stale flag) or null. When the
 * tenant has the drawer disabled, also returns null + a `disabled`
 * flag so the UI can skip the blocking modal entirely.
 */
export const getCurrentOpenSession = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    // JUR-135: cashier asking about a branch they don't own should
    // get the same answer as "no session" — keep it simple.
    assertBranchAllowed(auth, data.branchId)

    // JUR-145 PR 4: Komplit-only feature. The settings toggle is
    // ANDed with the tier check — free / legacy tenants always get
    // `disabled: true` so the cashier UI never tries to render the
    // BukaKasModal.
    const drawer =
      auth.posTier === 'komplit'
        ? await readCashDrawerConfig(auth.tenantId)
        : null
    if (!drawer?.enabled) {
      return { disabled: true as const, session: null }
    }

    const [row] = await db
      .select({
        id: posCashSessions.id,
        openingBalance: posCashSessions.openingBalance,
        openingNotes: posCashSessions.openingNotes,
        openedAt: posCashSessions.openedAt,
        cashInTotal: posCashSessions.cashInTotal,
        cashOutTotal: posCashSessions.cashOutTotal,
      })
      .from(posCashSessions)
      .where(
        and(
          eq(posCashSessions.tenantId, auth.tenantId),
          eq(posCashSessions.branchId, data.branchId),
          eq(posCashSessions.cashierUserId, auth.userId),
          eq(posCashSessions.status, 'open'),
        ),
      )
      .limit(1)

    if (!row) {
      return { disabled: false as const, session: null }
    }

    // Running balance = opening + cash_in - cash_out. Cheap to compute
    // here so the cashier header can render without recomputing per
    // movement.
    const opening = parseFloat(row.openingBalance)
    const inTotal = parseFloat(row.cashInTotal)
    const outTotal = parseFloat(row.cashOutTotal)
    const runningBalance = opening + inTotal - outTotal

    // Stale = the session should be force-closed before selling again.
    // The rule is configurable (#216): tenant default on pos_settings,
    // optional per-branch override. Triggers the <StaleSessionModal>
    // so the cashier can force-close before starting a fresh shift.
    const [branchCfgRow] = await db
      .select({ cfg: branches.cashStaleConfig })
      .from(branches)
      .where(
        and(
          eq(branches.id, data.branchId),
          eq(branches.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    const staleConfig = branchCfgRow?.cfg ?? drawer.staleConfig
    const isStale = isSessionStale(staleConfig, new Date(row.openedAt), new Date())

    return {
      disabled: false as const,
      session: {
        id: row.id,
        openingBalance: opening,
        openingNotes: row.openingNotes,
        openedAt: row.openedAt,
        cashInTotal: inTotal,
        cashOutTotal: outTotal,
        runningBalance,
        isStale,
      },
    }
  })

/**
 * Owner reporting list. Branch-scoped via JUR-135. Returns a row per
 * session with all the summary fields the table needs.
 */
export const listCashSessions = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      branchId: z.string().uuid().optional(),
      cashierUserId: z.string().uuid().optional(),
      status: z.enum(['open', 'closed', 'all']).optional().default('all'),
      hasVarianceOnly: z.boolean().optional().default(false),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()

    const conds: SQL[] = [eq(posCashSessions.tenantId, auth.tenantId)]
    if (data.branchId) {
      assertBranchAllowed(auth, data.branchId)
      conds.push(eq(posCashSessions.branchId, data.branchId))
    } else {
      const scope = branchScopeWhere(auth, posCashSessions.branchId)
      if (scope) conds.push(scope)
    }
    // JUR-141 / JUR-144: cashiers (no pos.manage) see only their own
    // sessions — they shouldn't be peeking at other cashiers' till
    // history. Supervisors + owners (pos.manage) see everyone and
    // can filter by cashierUserId via the input.
    const canSeeAllCashiers = auth.permissions.includes('pos.manage')
    if (!canSeeAllCashiers) {
      conds.push(eq(posCashSessions.cashierUserId, auth.userId))
    } else if (data.cashierUserId) {
      conds.push(eq(posCashSessions.cashierUserId, data.cashierUserId))
    }
    if (data.status !== 'all') {
      conds.push(eq(posCashSessions.status, data.status))
    }
    if (data.from) {
      conds.push(gte(posCashSessions.openedAt, new Date(`${data.from}T00:00:00`)))
    }
    if (data.to) {
      conds.push(lte(posCashSessions.openedAt, new Date(`${data.to}T23:59:59`)))
    }
    if (data.hasVarianceOnly) {
      // Only closed sessions with a non-zero variance.
      conds.push(
        sql`${posCashSessions.variance} IS NOT NULL AND ${posCashSessions.variance} <> 0`,
      )
    }

    const offset = (data.page - 1) * data.pageSize
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: posCashSessions.id,
          branchId: posCashSessions.branchId,
          branchName: branches.name,
          cashierUserId: posCashSessions.cashierUserId,
          // First+last name lookup is per-tenant via tenant_members.
          cashierFirstName: tenantMembers.firstName,
          cashierLastName: tenantMembers.lastName,
          status: posCashSessions.status,
          openingBalance: posCashSessions.openingBalance,
          openedAt: posCashSessions.openedAt,
          expectedClosing: posCashSessions.expectedClosing,
          actualClosing: posCashSessions.actualClosing,
          variance: posCashSessions.variance,
          closedAt: posCashSessions.closedAt,
          forceClosed: posCashSessions.forceClosed,
        })
        .from(posCashSessions)
        .innerJoin(branches, eq(branches.id, posCashSessions.branchId))
        .leftJoin(
          tenantMembers,
          and(
            eq(tenantMembers.tenantId, posCashSessions.tenantId),
            eq(tenantMembers.userId, posCashSessions.cashierUserId),
          ),
        )
        .where(and(...conds))
        .orderBy(desc(posCashSessions.openedAt))
        .limit(data.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(posCashSessions)
        .where(and(...conds)),
    ])

    return {
      sessions: rows,
      total: totalRow[0]?.count ?? 0,
    }
  })

/**
 * Session detail for the drawer/page. Returns the session header +
 * the full movement ledger (sorted newest first).
 */
export const getCashSessionDetail = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ sessionId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()

    const [session] = await db
      .select({
        id: posCashSessions.id,
        tenantId: posCashSessions.tenantId,
        branchId: posCashSessions.branchId,
        branchName: branches.name,
        cashierUserId: posCashSessions.cashierUserId,
        cashierFirstName: tenantMembers.firstName,
        cashierLastName: tenantMembers.lastName,
        status: posCashSessions.status,
        openingBalance: posCashSessions.openingBalance,
        openingNotes: posCashSessions.openingNotes,
        openedAt: posCashSessions.openedAt,
        expectedClosing: posCashSessions.expectedClosing,
        actualClosing: posCashSessions.actualClosing,
        variance: posCashSessions.variance,
        closingNotes: posCashSessions.closingNotes,
        closedAt: posCashSessions.closedAt,
        cashInTotal: posCashSessions.cashInTotal,
        cashOutTotal: posCashSessions.cashOutTotal,
        forceClosed: posCashSessions.forceClosed,
      })
      .from(posCashSessions)
      .innerJoin(branches, eq(branches.id, posCashSessions.branchId))
      .leftJoin(
        tenantMembers,
        and(
          eq(tenantMembers.tenantId, posCashSessions.tenantId),
          eq(tenantMembers.userId, posCashSessions.cashierUserId),
        ),
      )
      .where(
        and(
          eq(posCashSessions.id, data.sessionId),
          eq(posCashSessions.tenantId, auth.tenantId),
          // JUR-135: 404-via-scope — restricted member can't even
          // see (or close) sessions on branches they don't manage.
          branchScopeWhere(auth, posCashSessions.branchId),
        ),
      )
      .limit(1)
    if (!session) throw new Error('Sesi tidak ditemukan')
    // JUR-141 / JUR-144: cashiers (no pos.manage) can only inspect
    // their own sessions. 404-style message keeps the existence of
    // other cashiers' sessions opaque.
    if (
      !auth.permissions.includes('pos.manage') &&
      session.cashierUserId !== auth.userId
    ) {
      throw new Error('Sesi tidak ditemukan')
    }

    const movements = await db
      .select({
        id: posCashMovements.id,
        type: posCashMovements.type,
        amount: posCashMovements.amount,
        reason: posCashMovements.reason,
        referenceSaleId: posCashMovements.referenceSaleId,
        referenceSaleNumber: posSales.saleNumber,
        createdByUserId: posCashMovements.createdByUserId,
        createdAt: posCashMovements.createdAt,
      })
      .from(posCashMovements)
      .leftJoin(posSales, eq(posSales.id, posCashMovements.referenceSaleId))
      .where(eq(posCashMovements.sessionId, data.sessionId))
      .orderBy(desc(posCashMovements.createdAt))

    return { session, movements }
  })

/**
 * The caller's currently-open cash session for a branch (or null) plus
 * its movement ledger. Drives the mobile "Peti Kas" pill — the mobile
 * has no session id up front, so it can't use getCashSessionDetail.
 * `expectedCash` = opening + cash in − cash out, computed client-side
 * from these fields while the session is still open.
 */
export const getActiveCashSession = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertBranchAllowed(auth, data.branchId)

    const open = await findOpenSession(auth.tenantId, data.branchId, auth.userId)
    if (!open) return { session: null, movements: [] }

    const [session] = await db
      .select({
        id: posCashSessions.id,
        branchId: posCashSessions.branchId,
        status: posCashSessions.status,
        openingBalance: posCashSessions.openingBalance,
        openingNotes: posCashSessions.openingNotes,
        openedAt: posCashSessions.openedAt,
        cashInTotal: posCashSessions.cashInTotal,
        cashOutTotal: posCashSessions.cashOutTotal,
      })
      .from(posCashSessions)
      .where(eq(posCashSessions.id, open.id))
      .limit(1)

    const movements = await db
      .select({
        id: posCashMovements.id,
        type: posCashMovements.type,
        amount: posCashMovements.amount,
        reason: posCashMovements.reason,
        referenceSaleNumber: posSales.saleNumber,
        createdAt: posCashMovements.createdAt,
      })
      .from(posCashMovements)
      .leftJoin(posSales, eq(posSales.id, posCashMovements.referenceSaleId))
      .where(eq(posCashMovements.sessionId, open.id))
      .orderBy(desc(posCashMovements.createdAt))

    return { session: session ?? null, movements }
  })

// ─── Mutations ───────────────────────────────────────────────────

export const openCashSession = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      // Whole rupiah only — cashier is counting physical notes.
      openingBalance: z
        .number()
        .min(0, 'Modal awal tidak boleh negatif')
        .max(1_000_000_000, 'Modal awal terlalu besar'),
      openingNotes: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertBranchAllowed(auth, data.branchId)

    // Defensive: refuse if the toggle is off OR tier isn't Komplit
    // (JUR-145 PR 4). UI shouldn't call this for non-Komplit, but
    // a curl could.
    if (auth.posTier !== 'komplit') {
      throw new Error('Peti Kas hanya tersedia di paket Komplit.')
    }
    const { enabled } = await readCashDrawerConfig(auth.tenantId)
    if (!enabled) {
      throw new Error('Peti Kas tidak aktif untuk tenant ini.')
    }

    try {
      const [row] = await db
        .insert(posCashSessions)
        .values({
          tenantId: auth.tenantId,
          branchId: data.branchId,
          cashierUserId: auth.userId,
          status: 'open',
          openingBalance: data.openingBalance.toString(),
          openingNotes: data.openingNotes ?? null,
        })
        .returning({ id: posCashSessions.id })
      return { id: row!.id }
    } catch (err) {
      // 23505 = unique_violation — the partial unique index fired
      // because (branch, cashier) already has an open session.
      const msg = (err as { code?: string; message?: string })?.message ?? ''
      if (
        (err as { code?: string }).code === '23505' ||
        msg.includes('pos_cash_sessions_open_per_cashier_uniq')
      ) {
        throw new Error(
          'Sudah ada sesi kas yang terbuka untuk cabang ini. Tutup dulu sebelum membuka yang baru.',
        )
      }
      throw err
    }
  })

const manualMovementInput = z.object({
  sessionId: z.string().uuid(),
  amount: z
    .number()
    .min(1, 'Jumlah minimal Rp 1')
    .max(1_000_000_000, 'Jumlah terlalu besar'),
  reason: z.string().min(1, 'Alasan wajib diisi').max(500),
})

// Tarik Tunai also books a cashflow expense, so it optionally carries
// the expense category the cashier picked. Omitted → the writer falls
// back to the "Pengeluaran Kas" system category.
const payoutInput = manualMovementInput.extend({
  categoryId: z.string().uuid().optional(),
})

/**
 * Setor Tunai — cash put INTO the till (e.g., owner topping up the
 * float, cashier returning unused change/kembalian from a purchase).
 * Increases the running balance. The mirror of Tarik Tunai.
 */
export const recordCashDrop = createServerFn({ method: 'POST' })
  .inputValidator(manualMovementInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    await assertSessionOwnership(auth.tenantId, data.sessionId, auth.userId)
    await db.transaction(async (tx) => {
      // Cast to typeof db — matches the existing pattern in pos.ts
      // (drizzle's tx type is a strict subset of the db type for
      // our purposes; the helper only uses .insert / .update).
      await insertCashMovement(tx as unknown as typeof db, {
        tenantId: auth.tenantId,
        sessionId: data.sessionId,
        type: 'drop',
        amount: data.amount,
        reason: data.reason,
        createdByUserId: auth.userId,
      })
    })
    return { ok: true as const }
  })

/**
 * Tarik Tunai (Paid Out) — cash leaves the till for a business
 * expense (e.g., petty cash, supplies). Same direction as drop;
 * the distinction is reporting-only so owners can tell "moved to
 * safe" from "spent on supplies".
 */
export const recordCashPayout = createServerFn({ method: 'POST' })
  .inputValidator(payoutInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    const session = await assertSessionOwnership(
      auth.tenantId,
      data.sessionId,
      auth.userId,
    )
    // Tarik Tunai books a matching cashflow expense so the drawer and
    // the ledger stay consistent from one action — but only when the
    // tenant actually has the cashflow feature (Komplit). Non-cashflow
    // tenants just record the drawer movement.
    const booksToCashflow = posTierLimits(auth.posTier).features.includes(
      'cashflow',
    )
    await db.transaction(async (tx) => {
      // Cast to typeof db — matches the existing pattern in pos.ts
      // (drizzle's tx type is a strict subset of the db type for
      // our purposes; the helper only uses .insert / .update).
      const exec = tx as unknown as typeof db
      const { id: movementId } = await insertCashMovement(exec, {
        tenantId: auth.tenantId,
        sessionId: data.sessionId,
        type: 'payout',
        amount: data.amount,
        reason: data.reason,
        createdByUserId: auth.userId,
      })
      if (booksToCashflow) {
        await writeCashPayoutCashflowEntry(exec, {
          tenantId: auth.tenantId,
          movementId,
          branchId: session.branchId,
          amount: data.amount,
          reason: data.reason,
          categoryId: data.categoryId,
          occurredAt: new Date(),
          createdByUserId: auth.userId,
        })
      }
    })
    return { ok: true as const }
  })

export const closeCashSession = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      sessionId: z.string().uuid(),
      // Cashier's physical count. May be 0 (whole drawer dropped).
      actualClosing: z.number().min(0).max(1_000_000_000),
      closingNotes: z.string().max(1000).optional(),
      // True when the cashier opted to force-close a stale session
      // without bothering to count. variance is still computed but
      // owners should treat it as informational.
      forceClosed: z.boolean().optional().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    const session = await assertSessionOwnership(
      auth.tenantId,
      data.sessionId,
      auth.userId,
    )

    // Recompute expected from the ledger to catch any rolling-total
    // drift (defensive — atomic INSERT helper should keep them in
    // sync, but a manual SQL touch could desync). The ledger is the
    // source of truth.
    const [agg] = await db.execute<{
      cash_in: string
      cash_out: string
    }>(sql`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('sale','drop')    THEN amount::numeric ELSE 0 END), 0) AS cash_in,
        COALESCE(SUM(CASE WHEN type IN ('refund','payout') THEN amount::numeric ELSE 0 END), 0) AS cash_out
      FROM pos_cash_movements
      WHERE session_id = ${data.sessionId}
    `)
    const opening = parseFloat(session.openingBalance)
    const cashIn = parseFloat(agg?.cash_in ?? '0')
    const cashOut = parseFloat(agg?.cash_out ?? '0')
    const expected = opening + cashIn - cashOut
    const variance = data.actualClosing - expected

    await db
      .update(posCashSessions)
      .set({
        status: 'closed',
        expectedClosing: expected.toString(),
        actualClosing: data.actualClosing.toString(),
        variance: variance.toString(),
        closingNotes: data.closingNotes ?? null,
        closedAt: new Date(),
        forceClosed: data.forceClosed,
        // Sync rolling totals with the recomputed values.
        cashInTotal: cashIn.toString(),
        cashOutTotal: cashOut.toString(),
        updatedAt: new Date(),
      })
      .where(eq(posCashSessions.id, data.sessionId))

    return {
      expectedClosing: expected,
      actualClosing: data.actualClosing,
      variance,
    }
  })

// ─── Internal ────────────────────────────────────────────────────

/**
 * Confirms the session belongs to the caller's tenant + cashier +
 * is still open. Used by every mutation that mutates an existing
 * session.
 */
async function assertSessionOwnership(
  tenantId: string,
  sessionId: string,
  cashierUserId: string,
): Promise<{ openingBalance: string; branchId: string }> {
  const [row] = await db
    .select({
      cashierUserId: posCashSessions.cashierUserId,
      status: posCashSessions.status,
      openingBalance: posCashSessions.openingBalance,
      branchId: posCashSessions.branchId,
    })
    .from(posCashSessions)
    .where(
      and(
        eq(posCashSessions.id, sessionId),
        eq(posCashSessions.tenantId, tenantId),
      ),
    )
    .limit(1)
  if (!row) throw new Error('Sesi tidak ditemukan')
  if (row.cashierUserId !== cashierUserId) {
    throw new Error('Sesi ini bukan milik Anda.')
  }
  if (row.status !== 'open') {
    throw new Error('Sesi sudah ditutup.')
  }
  return { openingBalance: row.openingBalance, branchId: row.branchId }
}
