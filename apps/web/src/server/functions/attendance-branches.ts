/**
 * Branches (cabang/outlet) CRUD + cost-aware management context.
 *
 * Historical naming: this file lives at `attendance-branches.ts`
 * because branches were originally an attendance-only primitive (GPS
 * check-in zones + per-branch schedules). They've since become a
 * tenant-level entity used by POS, Inventory, and Attendance — and
 * with the per-module-toggle migration (0070), they're billable per
 * module per branch. The path stays for backwards compat with 6+
 * import sites; the file's actual scope is `master.branches`.
 *
 * Gating:
 *   - reads (`listBranches`, `getBranchWithSchedule`, business hours)
 *     require only `requireAuth` — every authed tenant member needs to
 *     fill branch pickers across POS, Inventory, Attendance modules.
 *   - mutations (`createBranch`, `updateBranch`, `deleteBranch`,
 *     `setBranchSchedule`, `setBranchBusinessHours`) require the new
 *     `branches.manage` permission. Owner + Admin get it by default
 *     (migration 0070); custom roles can be granted it via RBAC.
 *
 * Module-toggle billing: each branch carries `enabledModules`. The
 * `createBranch` enforcement reads the relevant per-module tier
 * (POS Free = 1 outlet, Inventory Free = 1 location) and hard-blocks
 * the row when the toggle would push past the cap on a free plan.
 * Paid plans allow the create — admin reconciles the extra-location
 * fee at the next renewal (we don't generate a payment record yet;
 * the "soft enforcement" flag drives the admin drift indicator).
 */

import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  branches,
  branchSchedules,
  inventorySettings,
  inventoryStockBalances,
  staffProfiles,
  posSettings,
  financialTransactions,
} from '@vintra/db/schema'
import { eq, and, sql, desc } from 'drizzle-orm'
import { z } from 'zod'
import {
  posTierLimits,
  inventoryTierLimits,
  type POSTierKey,
  type InventoryTierKey,
} from '@vintra/shared'
import { requireAuth, requirePermission } from '../middleware/auth'
import { filterBranchesByAccess } from '../lib/branch-scope'

const MODULE_TOGGLE_KEYS = ['pos', 'inventory', 'attendance'] as const
type ModuleToggleKey = (typeof MODULE_TOGGLE_KEYS)[number]

async function requireBranchesManage() {
  return requirePermission('branches.manage')
}

// ─── Read ──────────────────────────────────────────

export const listBranches = createServerFn().handler(async () => {
  const auth = await requireAuth()

  const rows = await db
    .select()
    .from(branches)
    .where(eq(branches.tenantId, auth.tenantId))
    .orderBy(branches.createdAt)

  return rows
})

/**
 * Branches the *current member* may operate, for the topbar branch
 * switcher. Unlike `listBranches` (every branch, used by branch
 * management) this applies `tenant_member_branches` scoping — a
 * branch-restricted staff member only ever sees their pinned set.
 *
 * `totalCount` is the count of active branches in the whole tenant,
 * so the switcher can tell "single-branch tenant" (hide entirely)
 * apart from "scoped staff on one branch of many" (show a label).
 * Main branch is sorted first so it's the natural default.
 */
export const listAccessibleBranches = createServerFn().handler(async () => {
  const auth = await requireAuth()

  const rows = await db
    .select({
      id: branches.id,
      name: branches.name,
      isMain: branches.isMain,
    })
    .from(branches)
    .where(and(eq(branches.tenantId, auth.tenantId), eq(branches.isActive, true)))
    .orderBy(desc(branches.isMain), branches.createdAt)

  return {
    branches: filterBranchesByAccess(auth, rows),
    totalCount: rows.length,
  }
})

export const getBranchWithSchedule = createServerFn()
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireAuth()

    const [branch] = await db
      .select()
      .from(branches)
      .where(
        and(eq(branches.id, data.branchId), eq(branches.tenantId, auth.tenantId)),
      )
      .limit(1)
    if (!branch) throw new Error('Cabang tidak ditemukan')

    const schedules = await db
      .select()
      .from(branchSchedules)
      .where(eq(branchSchedules.branchId, data.branchId))
      .orderBy(branchSchedules.dayOfWeek)

    return { branch, schedules }
  })

// ─── Management context (drives /master/branches UI) ──

/**
 * Snapshot of everything the redesigned /master/branches page needs in
 * a single round-trip: branches with their module toggles, the tenant's
 * per-module tier + active flag, and per-module branch counts so the
 * cost-preview math can be done client-side.
 *
 * No write permission required (any authed tenant member can read);
 * the mutate buttons are conditionally rendered against
 * `permissions.includes('branches.manage')` on the client.
 */
export const getBranchManagementContext = createServerFn().handler(
  async () => {
    const auth = await requireAuth()

    const [rows, pos, inv, posLatest, invLatest] = await Promise.all([
      db
        .select()
        .from(branches)
        .where(eq(branches.tenantId, auth.tenantId))
        .orderBy(branches.createdAt),
      db
        .select({ tier: posSettings.tier, active: posSettings.subscriptionActive })
        .from(posSettings)
        .where(eq(posSettings.tenantId, auth.tenantId))
        .limit(1),
      db
        .select({
          tier: inventorySettings.tier,
          active: inventorySettings.subscriptionActive,
        })
        .from(inventorySettings)
        .where(eq(inventorySettings.tenantId, auth.tenantId))
        .limit(1),
      // Per module, surface (planKey of the latest paid row) plus the
      // MAX billed_outlet_count across ALL paid rows. MAX — not the
      // latest row's value — because two admin writers exist:
      //   - recordAdditionalOutlet writes cumulative billed counts
      //   - recordPOSPaymentAndActivate writes the per-payment
      //     outletCount (defaults to 1 on renewals)
      // The reader used to pick the latest row, so a renewal landing
      // as billed=1 would silently regress the cap on a tenant who
      // had already paid for, say, 12 outlets via earlier
      // outlet-tambahan rows. MAX is robust to whichever writer ran
      // last and matches the "highest amount this tenant ever paid
      // for" semantic the cap is meant to enforce.
      db.execute<{
        plan_key: string | null
        billed_outlet_count: number | null
      }>(sql`
        SELECT
          (SELECT plan_key FROM financial_transactions
            WHERE tenant_id = ${auth.tenantId}
              AND module_key = 'pos'
              AND status = 'paid'
            ORDER BY created_at DESC LIMIT 1) AS plan_key,
          (SELECT MAX(billed_outlet_count) FROM financial_transactions
            WHERE tenant_id = ${auth.tenantId}
              AND module_key = 'pos'
              AND status = 'paid') AS billed_outlet_count
      `),
      db.execute<{
        plan_key: string | null
        billed_outlet_count: number | null
      }>(sql`
        SELECT
          (SELECT plan_key FROM financial_transactions
            WHERE tenant_id = ${auth.tenantId}
              AND module_key = 'inventory'
              AND status = 'paid'
            ORDER BY created_at DESC LIMIT 1) AS plan_key,
          (SELECT MAX(billed_outlet_count) FROM financial_transactions
            WHERE tenant_id = ${auth.tenantId}
              AND module_key = 'inventory'
              AND status = 'paid') AS billed_outlet_count
      `),
    ])

    const counts = {
      pos: rows.filter((b) => b.enabledModules.includes('pos')).length,
      inventory: rows.filter((b) => b.enabledModules.includes('inventory'))
        .length,
      attendance: rows.filter((b) => b.enabledModules.includes('attendance'))
        .length,
    }

    return {
      branches: rows,
      posTier: (pos[0]?.tier as POSTierKey | undefined) ?? 'free',
      posActive: pos[0]?.active ?? false,
      posPlanKey: posLatest[0]?.plan_key ?? null,
      posBilledOutletCount: Number(posLatest[0]?.billed_outlet_count ?? 0),
      inventoryTier:
        (inv[0]?.tier as InventoryTierKey | undefined) ?? 'free',
      inventoryActive: inv[0]?.active ?? false,
      inventoryPlanKey: invLatest[0]?.plan_key ?? null,
      inventoryBilledOutletCount: Number(
        invLatest[0]?.billed_outlet_count ?? 0,
      ),
      counts,
      canManage: auth.permissions?.includes('branches.manage') ?? false,
    }
  },
)

// ─── Mutations ─────────────────────────────────────

const moduleToggleSchema = z.enum(MODULE_TOGGLE_KEYS)

const branchSchema = z.object({
  name: z.string().min(1, 'Nama cabang wajib diisi'),
  address: z.string().optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(10).max(5000).default(100),
  isMain: z.boolean().optional(),
  /**
   * How the branch is operated. The main branch is always HQ — the
   * form only offers this choice for additional branches, and the
   * server forces 'independent' for whichever branch is main.
   */
  branchModel: z.enum(['independent', 'franchise']).default('independent'),
  /**
   * Which modules treat this branch as one of their active locations.
   * Defaults to all 3 — that matches the migration default and keeps
   * existing form code working without UI changes. The redesigned
   * /master/branches page sends an explicit subset (e.g. just
   * ['inventory'] for a gudang).
   */
  enabledModules: z
    .array(moduleToggleSchema)
    .min(1, 'Pilih minimal 1 modul')
    .default(['pos', 'inventory', 'attendance']),
})

/**
 * Free-tier hard block. POS Free + Inventory Free each cap at 1 branch
 * (matches the per-module branchCap in shared/pricing.ts). When a
 * tenant tries to toggle a new branch onto a module they're on Free
 * for, throw a clear "Upgrade" error so the UI can swap the create
 * button for an upgrade CTA.
 *
 * Paid tiers are unlimited at the cap level — they pay per extra
 * location via the admin manual-billing reconciliation, but the create
 * is always allowed (soft enforcement model per the planning round).
 */
async function assertBranchModuleCaps(
  tenantId: string,
  enabledModules: ModuleToggleKey[],
  excludeBranchId?: string,
) {
  if (enabledModules.length === 0) return

  // Fetch current counts only for modules being toggled ON in this
  // request — no point checking attendance if the new branch isn't
  // enabling it.
  const [pos, inv] = await Promise.all([
    enabledModules.includes('pos')
      ? db
          .select({ tier: posSettings.tier })
          .from(posSettings)
          .where(eq(posSettings.tenantId, tenantId))
          .limit(1)
      : Promise.resolve([]),
    enabledModules.includes('inventory')
      ? db
          .select({ tier: inventorySettings.tier })
          .from(inventorySettings)
          .where(eq(inventorySettings.tenantId, tenantId))
          .limit(1)
      : Promise.resolve([]),
  ])

  if (enabledModules.includes('pos')) {
    const tier = (pos[0]?.tier as POSTierKey | undefined) ?? 'free'
    const cap = posTierLimits(tier).branchCap
    if (cap !== null) {
      const [{ count = 0 } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(branches)
        .where(
          and(
            eq(branches.tenantId, tenantId),
            sql`'pos' = ANY(${branches.enabledModules})`,
            excludeBranchId
              ? sql`${branches.id} <> ${excludeBranchId}`
              : sql`TRUE`,
          ),
        )
      if (count + 1 > cap) {
        throw new Error(
          `Paket POS ${tier} cuma boleh ${cap} outlet. Upgrade ke Toko/Komplit untuk menambah outlet POS.`,
        )
      }
    }
  }

  if (enabledModules.includes('inventory')) {
    const tier = (inv[0]?.tier as InventoryTierKey | undefined) ?? 'free'
    const cap = inventoryTierLimits(tier).branchCap
    if (cap !== null) {
      const [{ count = 0 } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(branches)
        .where(
          and(
            eq(branches.tenantId, tenantId),
            sql`'inventory' = ANY(${branches.enabledModules})`,
            excludeBranchId
              ? sql`${branches.id} <> ${excludeBranchId}`
              : sql`TRUE`,
          ),
        )
      if (count + 1 > cap) {
        throw new Error(
          `Paket Stok ${tier} cuma boleh ${cap} lokasi. Upgrade ke Toko/Bisnis untuk menambah lokasi gudang/cabang.`,
        )
      }
    }
  }
}

/**
 * Demote every other branch in the tenant before promoting `keepId`.
 * The partial unique index on (tenant_id) WHERE is_main only allows
 * one main per tenant, so the demote+promote has to happen inside a
 * single transaction. Caller is responsible for the outer tx.
 *
 * Also mirrors the choice into the legacy
 * `inventory_settings.main_branch_id` slot so any code path still
 * reading from there (free-tier inventory gate, etc.) sees the same
 * answer.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
async function setMainBranch(tx: Tx, tenantId: string, keepId: string) {
  await tx
    .update(branches)
    .set({ isMain: false, updatedAt: new Date() })
    .where(
      and(
        eq(branches.tenantId, tenantId),
        sql`${branches.id} <> ${keepId}`,
        eq(branches.isMain, true),
      ),
    )
  await tx
    .update(branches)
    .set({ isMain: true, updatedAt: new Date() })
    .where(and(eq(branches.id, keepId), eq(branches.tenantId, tenantId)))
  await tx
    .insert(inventorySettings)
    .values({ tenantId, mainBranchId: keepId })
    .onConflictDoUpdate({
      target: inventorySettings.tenantId,
      set: { mainBranchId: keepId, updatedAt: new Date() },
    })
}

const DAYS: Array<{ dayOfWeek: number; isWorkDay: boolean }> = [
  { dayOfWeek: 0, isWorkDay: false }, // Sunday
  { dayOfWeek: 1, isWorkDay: true },
  { dayOfWeek: 2, isWorkDay: true },
  { dayOfWeek: 3, isWorkDay: true },
  { dayOfWeek: 4, isWorkDay: true },
  { dayOfWeek: 5, isWorkDay: true },
  { dayOfWeek: 6, isWorkDay: false }, // Saturday
]

export const createBranch = createServerFn({ method: 'POST' })
  .inputValidator(branchSchema)
  .handler(async ({ data }) => {
    const auth = await requireBranchesManage()
    await assertBranchModuleCaps(auth.tenantId, data.enabledModules)

    return db.transaction(async (tx) => {
      // First-branch-ever defaults to main even when the form didn't ask
      // for it — every tenant should always have exactly one main.
      const countRow = await tx
        .select({ existingCount: sql<number>`count(*)::int` })
        .from(branches)
        .where(eq(branches.tenantId, auth.tenantId))
      const existingCount = countRow[0]?.existingCount ?? 0
      const wantMain = data.isMain || existingCount === 0

      // New branches start in attendance "simple mode" — no fixed
      // schedule, no schedule rows seeded. The owner opts into a
      // schedule later via the branch form (setBranchScheduleMode),
      // which seeds the default Mon-Fri rows on demand.
      const [branch] = await tx
        .insert(branches)
        .values({
          tenantId: auth.tenantId,
          name: data.name,
          address: data.address ?? null,
          latitude: data.latitude.toString(),
          longitude: data.longitude.toString(),
          radiusMeters: data.radiusMeters,
          isMain: false,
          enabledModules: data.enabledModules,
          requiresSchedule: false,
          // The main branch is HQ — never a franchise outlet.
          branchModel: wantMain ? 'independent' : data.branchModel,
        })
        .returning()

      if (wantMain && branch) {
        await setMainBranch(tx, auth.tenantId, branch.id)
      }

      return branch!
    })
  })

const updateBranchSchema = branchSchema.extend({
  id: z.string().uuid(),
})

export const updateBranch = createServerFn({ method: 'POST' })
  .inputValidator(updateBranchSchema)
  .handler(async ({ data }) => {
    const auth = await requireBranchesManage()
    // Cap check excludes the branch being edited — toggling its own
    // modules off → on within the existing limit shouldn't trip the
    // counter against itself.
    await assertBranchModuleCaps(auth.tenantId, data.enabledModules, data.id)

    return db.transaction(async (tx) => {
      const { id, ...updates } = data
      const [branch] = await tx
        .update(branches)
        .set({
          name: updates.name,
          address: updates.address ?? null,
          latitude: updates.latitude.toString(),
          longitude: updates.longitude.toString(),
          radiusMeters: updates.radiusMeters,
          enabledModules: updates.enabledModules,
          branchModel: updates.branchModel,
          updatedAt: new Date(),
        })
        .where(and(eq(branches.id, id), eq(branches.tenantId, auth.tenantId)))
        .returning()

      if (!branch) throw new Error('Cabang tidak ditemukan')

      // The main branch is HQ — it can never be a franchise outlet.
      // Throwing here rolls the transaction back.
      if (branch.isMain && branch.branchModel === 'franchise') {
        throw new Error('Cabang Utama tidak bisa memakai model waralaba.')
      }

      // Don't allow un-marking the only main branch — every tenant
      // must always have one. Mark another first, then come back.
      if (branch.isMain && !updates.isMain) {
        throw new Error(
          'Tidak bisa hapus tanda Cabang Utama tanpa menetapkan cabang lain sebagai utama.',
        )
      }

      if (updates.isMain && !branch.isMain) {
        await setMainBranch(tx, auth.tenantId, branch.id)
        return { ...branch, isMain: true }
      }

      return branch
    })
  })

export const deleteBranch = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireBranchesManage()

    // Block delete if this is the marked main branch — force the user
    // to flip another branch to main first. (Single-branch tenants can
    // delete the last branch; the next create auto-promotes its first.)
    const [target] = await db
      .select({ isMain: branches.isMain })
      .from(branches)
      .where(and(eq(branches.id, data.id), eq(branches.tenantId, auth.tenantId)))
      .limit(1)
    if (!target) throw new Error('Cabang tidak ditemukan')
    if (target.isMain) {
      const otherRow = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(branches)
        .where(
          and(eq(branches.tenantId, auth.tenantId), sql`${branches.id} <> ${data.id}`),
        )
      const otherCount = otherRow[0]?.count ?? 0
      if (otherCount > 0) {
        throw new Error(
          'Cabang ini ditandai sebagai Cabang Utama. Tetapkan cabang lain sebagai utama dulu sebelum menghapus.',
        )
      }
    }

    // Block delete if staff still assigned to this branch
    const [staffCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.branchId, data.id),
          eq(staffProfiles.isActive, true),
        ),
      )

    const staffCount = staffCountRow?.count ?? 0
    if (staffCount > 0) {
      throw new Error(
        `Cabang masih memiliki ${staffCount} staf aktif. Pindahkan staf ke cabang lain sebelum menghapus.`,
      )
    }

    // Block if branch is set as the tenant's main inventory branch.
    // Free tier inventory points at exactly one branch — deleting it
    // out from under the user would leave inventory with no place to
    // record movements. Force them to pick a different branch first.
    const [mainRef] = await db
      .select({ id: inventorySettings.id })
      .from(inventorySettings)
      .where(eq(inventorySettings.mainBranchId, data.id))
      .limit(1)
    if (mainRef) {
      throw new Error(
        'Cabang ini sedang dipakai sebagai cabang utama Inventory. Pilih cabang utama lain dulu di menu Stok Barang sebelum menghapus.',
      )
    }

    // Block if any inventory stock balance still references this
    // branch — cascading deletes would silently destroy stock data.
    const [balRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryStockBalances)
      .where(eq(inventoryStockBalances.branchId, data.id))
    const balanceCount = balRow?.count ?? 0
    if (balanceCount > 0) {
      throw new Error(
        `Cabang masih punya saldo stok inventory di ${balanceCount} item. Pindahkan stok atau hapus item dulu.`,
      )
    }

    await db
      .delete(branches)
      .where(and(eq(branches.id, data.id), eq(branches.tenantId, auth.tenantId)))

    return { success: true }
  })

// ─── Schedule ──────────────────────────────────────

const daySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isWorkDay: z.boolean(),
  clockInTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Format jam tidak valid'),
  clockOutTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Format jam tidak valid'),
  lateGraceMinutes: z.number().int().min(0).max(120),
  earlyLeaveGraceMinutes: z.number().int().min(0).max(120),
})

export const setBranchSchedule = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      days: z.array(daySchema).length(7),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireBranchesManage()

    // Verify branch belongs to caller's tenant
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(eq(branches.id, data.branchId), eq(branches.tenantId, auth.tenantId)),
      )
      .limit(1)
    if (!branch) throw new Error('Cabang tidak ditemukan')

    // Upsert all 7 rows via delete + insert (atomic within each request)
    await db
      .delete(branchSchedules)
      .where(eq(branchSchedules.branchId, data.branchId))

    await db.insert(branchSchedules).values(
      data.days.map((d) => ({
        tenantId: auth.tenantId,
        branchId: data.branchId,
        dayOfWeek: d.dayOfWeek,
        isWorkDay: d.isWorkDay,
        clockInTime: d.clockInTime,
        clockOutTime: d.clockOutTime,
        lateGraceMinutes: d.lateGraceMinutes,
        earlyLeaveGraceMinutes: d.earlyLeaveGraceMinutes,
      })),
    )

    return { success: true }
  })

/**
 * Flip a branch between attendance "advanced" mode (fixed schedule) and
 * "simple" mode (free clock-in, no lateness scoring).
 *
 * Turning it ON seeds the default Mon-Fri 08:00-17:00 rows only if the
 * branch has none yet — an existing schedule is left intact. Turning it
 * OFF deletes all schedule rows. Both the flag flip and the row change
 * happen in one transaction so the branch is never left half-converted.
 */
export const setBranchScheduleMode = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      requiresSchedule: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireBranchesManage()

    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(eq(branches.id, data.branchId), eq(branches.tenantId, auth.tenantId)),
      )
      .limit(1)
    if (!branch) throw new Error('Cabang tidak ditemukan')

    await db.transaction(async (tx) => {
      await tx
        .update(branches)
        .set({ requiresSchedule: data.requiresSchedule, updatedAt: new Date() })
        .where(eq(branches.id, data.branchId))

      if (data.requiresSchedule) {
        const existing = await tx
          .select({ id: branchSchedules.id })
          .from(branchSchedules)
          .where(eq(branchSchedules.branchId, data.branchId))
          .limit(1)
        if (existing.length === 0) {
          await tx.insert(branchSchedules).values(
            DAYS.map((d) => ({
              tenantId: auth.tenantId,
              branchId: data.branchId,
              dayOfWeek: d.dayOfWeek,
              isWorkDay: d.isWorkDay,
              clockInTime: '08:00:00',
              clockOutTime: '17:00:00',
              lateGraceMinutes: 10,
              earlyLeaveGraceMinutes: 0,
            })),
          )
        }
      } else {
        await tx
          .delete(branchSchedules)
          .where(eq(branchSchedules.branchId, data.branchId))
      }
    })

    return { success: true }
  })

// ─── Business hours (customer-facing store hours) ──
//
// Distinct from branch_schedules: this is "kapan toko buka untuk pelanggan",
// not "kapan staff masuk kerja". Read by the RAG operating_hours retriever
// when an inbound WhatsApp asks "jam buka jam berapa?".

const businessHourEntrySchema = z.object({
  /** 0=Sunday, 1=Monday, ..., 6=Saturday — matches dayNames in the Go retriever. */
  day: z.number().int().min(0).max(6),
  /** "HH:mm" (24h). The retriever renders the string verbatim. */
  open: z.string().regex(/^\d{2}:\d{2}$/, 'format jam harus HH:mm'),
  close: z.string().regex(/^\d{2}:\d{2}$/, 'format jam harus HH:mm'),
})

export const getBranchBusinessHours = createServerFn()
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    const [row] = await db
      .select({ businessHours: branches.businessHours })
      .from(branches)
      .where(
        and(eq(branches.id, data.branchId), eq(branches.tenantId, auth.tenantId)),
      )
      .limit(1)
    if (!row) throw new Error('Cabang tidak ditemukan')
    return { hours: row.businessHours ?? [] }
  })

export const setBranchBusinessHours = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      // Empty array clears the column (back to "not configured" — RAG returns
      // empty snippet, AI falls back to "tanya admin" gracefully).
      hours: z.array(businessHourEntrySchema),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireBranchesManage()
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(eq(branches.id, data.branchId), eq(branches.tenantId, auth.tenantId)),
      )
      .limit(1)
    if (!branch) throw new Error('Cabang tidak ditemukan')

    await db
      .update(branches)
      .set({
        businessHours: data.hours.length > 0 ? data.hours : null,
        updatedAt: new Date(),
      })
      .where(eq(branches.id, data.branchId))

    return { success: true }
  })
