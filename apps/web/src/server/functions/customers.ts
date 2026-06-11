/**
 * Customer database server functions (JUR-6).
 *
 * Tier-gated: Toko + Komplit only (gated via the `customer_db`
 * POS feature flag). Free tenants still get the per-sale name+phone
 * snapshot (existing behaviour) but don't see the /customers route.
 *
 * Phone normalisation: every persisted phone is `62...` form so
 * "08123", "08-1-2-3", and "+62 8123" all map to the same row. The
 * partial unique index `customers_tenant_phone_unique` enforces the
 * dedup at the DB level — the upsert path is `ON CONFLICT DO UPDATE`.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  customers,
  posSales,
  posSaleItems,
  customerStampCards,
  loyaltyStampPrograms,
} from '@vintra/db/schema'
import { and, desc, eq, ilike, or, sql, inArray } from 'drizzle-orm'
import { requirePOSAccess } from '../middleware/module-access'

/**
 * Normalise an Indonesian phone to the canonical `62...` form. Strips
 * non-digits, strips a leading 0 or 62, then prepends 62. Returns null
 * if the result is too short to be a real phone number (< 9 digits
 * total once the country code is in).
 *
 * Mirrors the SQL helper used in the 0022 backfill so existing rows
 * and new upserts agree on the same canonical form.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/\D+/g, '')
  if (digits.length < 8) return null
  const stripped = digits.replace(/^(0|62)/, '')
  if (stripped.length < 7) return null
  return '62' + stripped
}

/**
 * Tier gate: Free tenants can capture name+phone snapshots per sale
 * but can't access the customer database UI. The check is centralised
 * here so every server function in this file shares the same rule.
 */
function requireCustomerDbAccess(posTier: string) {
  if (posTier === 'free') {
    throw new Error(
      'Database pelanggan hanya tersedia di paket Toko atau Komplit.',
    )
  }
}

// ─── Queries ─────────────────────────────────────────────────────────

const listInput = z.object({
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})

export const listCustomers = createServerFn({ method: 'POST' })
  .inputValidator(listInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requireCustomerDbAccess(auth.posTier)

    const conds = [eq(customers.tenantId, auth.tenantId)]
    if (data.search) {
      const raw = data.search.trim()
      const nameQ = `%${raw}%`
      // Stored phones are in canonical `62...` form, so the cashier's
      // `08...` input would never ILIKE-match. Strip the leading 0/62
      // before the phone-side ILIKE so trailing-digit lookups work
      // regardless of which prefix the cashier types (or omits).
      const phoneDigits = raw.replace(/\D+/g, '').replace(/^(0|62)/, '')
      const phoneQ = phoneDigits ? `%${phoneDigits}%` : nameQ
      conds.push(
        or(ilike(customers.name, nameQ), ilike(customers.phone, phoneQ))!,
      )
    }

    const offset = (data.page - 1) * data.pageSize
    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(and(...conds))
        .orderBy(desc(customers.lastVisitAt), desc(customers.createdAt))
        .limit(data.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(customers)
        .where(and(...conds)),
    ])

    // Per-row stamp summary — count of active cards with progress and
    // the sum of current stamps across those cards. Limited to active
    // programs so an archived program's leftover card doesn't pad the
    // badge. Komplit-only data; non-Komplit tenants get zeros (the
    // join returns no rows because they have no active programs).
    const customerIds = rows.map((r) => r.id)
    const stampSummaries =
      customerIds.length > 0
        ? await db
            .select({
              customerId: customerStampCards.customerId,
              activeCards: sql<number>`count(*) filter (where ${customerStampCards.currentStamps} > 0)::int`,
              currentStamps: sql<number>`coalesce(sum(${customerStampCards.currentStamps}), 0)::int`,
            })
            .from(customerStampCards)
            .innerJoin(
              loyaltyStampPrograms,
              and(
                eq(loyaltyStampPrograms.id, customerStampCards.programId),
                eq(loyaltyStampPrograms.isActive, true),
              ),
            )
            .where(
              and(
                eq(customerStampCards.tenantId, auth.tenantId),
                inArray(customerStampCards.customerId, customerIds),
              ),
            )
            .groupBy(customerStampCards.customerId)
        : []
    const stampByCustomer = new Map(
      stampSummaries.map((s) => [s.customerId, s]),
    )

    return {
      items: rows.map((r) => {
        const stamps = stampByCustomer.get(r.id)
        return {
          ...r,
          totalSpent: Number(r.totalSpent),
          activeStampCards: stamps?.activeCards ?? 0,
          currentStamps: stamps?.currentStamps ?? 0,
        }
      }),
      total: totalRow[0]?.count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    }
  })

/**
 * Search by phone for the cashier autocomplete. Matches anywhere in
 * the phone string so partial entries like "8123" surface candidates
 * before the user finishes typing. Capped at 8 results to keep the
 * dropdown manageable on mobile.
 *
 * Stored phones are canonicalised to `62...` form (leading 0 / 62
 * stripped, then `62` prepended). Cashiers, however, type the
 * familiar `08...` form. We strip the same leading `0`/`62` from the
 * search input before ILIKE so `08118492869` finds the row stored as
 * `628118492869`. Without this, the leading `0` causes the ILIKE to
 * never hit any canonicalised row.
 */
export const searchCustomersByPhone = createServerFn({ method: 'POST' })
  // Accepts `query` (the new client field — phone digits OR name) or
  // `phone` (legacy — older mobile Dev Client builds still send this).
  // Fn name kept stable for API back-compat; the behaviour is broader
  // than the name suggests now.
  .inputValidator(
    z
      .object({
        phone: z.string().optional(),
        query: z.string().optional(),
      })
      .refine(
        (d) => ((d.query ?? d.phone) ?? '').trim().length >= 3,
        { message: 'Minimal 3 karakter' },
      ),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requireCustomerDbAccess(auth.posTier)

    const raw = ((data.query ?? data.phone) ?? '').trim()
    // Strip non-digits and the canonical-storage prefix (0 / 62) so
    // "08118492869" finds rows stored as "628118492869".
    const digits = raw.replace(/\D+/g, '').replace(/^(0|62)/, '')

    // Phone match only when the caller actually typed digits — an
    // empty `digits` would otherwise produce `%%` and match every
    // row. Name match is always on (ILIKE is case-insensitive in
    // Postgres, so "qa" finds "QA Test").
    const phoneClause = digits.length > 0
      ? ilike(customers.phone, `%${digits}%`)
      : undefined
    const nameClause = ilike(customers.name, `%${raw}%`)
    const matchClause = phoneClause
      ? or(phoneClause, nameClause)
      : nameClause

    const rows = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        visitCount: customers.visitCount,
      })
      .from(customers)
      .where(and(eq(customers.tenantId, auth.tenantId), matchClause))
      .orderBy(desc(customers.lastVisitAt))
      .limit(8)

    return rows
  })

export const getCustomer = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requireCustomerDbAccess(auth.posTier)

    const [row] = await db
      .select()
      .from(customers)
      .where(
        and(eq(customers.id, data.id), eq(customers.tenantId, auth.tenantId)),
      )
      .limit(1)
    if (!row) throw new Error('Pelanggan tidak ditemukan')

    // Recent 20 sales for the detail page timeline. Joined for
    // sale_number + total in a single query.
    const recentSales = await db
      .select({
        id: posSales.id,
        saleNumber: posSales.saleNumber,
        total: posSales.total,
        status: posSales.status,
        paymentMethod: posSales.paymentMethod,
        createdAt: posSales.createdAt,
      })
      .from(posSales)
      .where(eq(posSales.customerId, data.id))
      .orderBy(desc(posSales.createdAt))
      .limit(20)

    // Per-sale item-count is shown alongside each sale in the timeline.
    const saleIds = recentSales.map((s) => s.id)
    const itemCounts =
      saleIds.length > 0
        ? await db
            .select({
              saleId: posSaleItems.saleId,
              count: sql<number>`count(*)::int`,
            })
            .from(posSaleItems)
            .where(inArray(posSaleItems.saleId, saleIds))
            .groupBy(posSaleItems.saleId)
        : []
    const countBySale = new Map(itemCounts.map((c) => [c.saleId, c.count]))

    return {
      ...row,
      totalSpent: Number(row.totalSpent),
      recentSales: recentSales.map((s) => ({
        ...s,
        total: Number(s.total),
        itemCount: countBySale.get(s.id) ?? 0,
      })),
    }
  })

// ─── Mutations ───────────────────────────────────────────────────────

const upsertInput = z.object({
  /** Optional id — when present, updates an existing row. */
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Nama wajib diisi').max(200),
  /** Raw user input. Server normalises before persisting. */
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email('Email tidak valid').max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})

/**
 * Create or update a customer. When `id` is set, performs an update.
 * Otherwise upserts on `(tenant_id, normalised_phone)` — if a
 * customer with that phone already exists, that row is updated and
 * returned (so the cashier-side "Pelanggan baru" path is idempotent).
 *
 * If phone is not provided, always inserts a new row (no dedup —
 * anonymous walk-ins).
 */
export const upsertCustomer = createServerFn({ method: 'POST' })
  .inputValidator(upsertInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requireCustomerDbAccess(auth.posTier)

    const phone = normalizePhone(data.phone ?? null)

    // Update path: id supplied → must match this tenant.
    if (data.id) {
      const [updated] = await db
        .update(customers)
        .set({
          name: data.name,
          phone,
          email: data.email?.trim() || null,
          notes: data.notes?.trim() || null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customers.id, data.id),
            eq(customers.tenantId, auth.tenantId),
          ),
        )
        .returning()
      if (!updated) throw new Error('Pelanggan tidak ditemukan')
      return updated
    }

    // Insert path with phone-based upsert.
    if (phone) {
      // The unique index `customers_tenant_phone_unique` is PARTIAL
      // (WHERE phone IS NOT NULL — anonymous walk-ins shouldn't
      // collide). Postgres requires `ON CONFLICT (...)` to declare
      // the same predicate when the target index is partial; without
      // `targetWhere` it can't match the index and falls back with:
      //   "there is no unique or exclusion constraint matching the
      //    ON CONFLICT specification"
      const [row] = await db
        .insert(customers)
        .values({
          tenantId: auth.tenantId,
          name: data.name,
          phone,
          email: data.email?.trim() || null,
          notes: data.notes?.trim() || null,
        })
        .onConflictDoUpdate({
          target: [customers.tenantId, customers.phone],
          targetWhere: sql`${customers.phone} IS NOT NULL`,
          set: {
            name: data.name,
            email: data.email?.trim() || null,
            notes: data.notes?.trim() || null,
            updatedAt: new Date(),
          },
        })
        .returning()
      return row!
    }

    // No phone — straight insert. No dedup possible without a phone.
    const [row] = await db
      .insert(customers)
      .values({
        tenantId: auth.tenantId,
        name: data.name,
        email: data.email?.trim() || null,
        notes: data.notes?.trim() || null,
      })
      .returning()
    return row!
  })

export const deleteCustomer = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requireCustomerDbAccess(auth.posTier)

    // Hard delete is fine — the customer_id FK on pos_sales is set to
    // NULL on delete (ON DELETE SET NULL would be cleaner; the schema
    // uses no action so we manually unlink first).
    await db.transaction(async (tx) => {
      await tx
        .update(posSales)
        .set({ customerId: null })
        .where(
          and(
            eq(posSales.customerId, data.id),
            eq(posSales.tenantId, auth.tenantId),
          ),
        )
      await tx
        .delete(customers)
        .where(
          and(
            eq(customers.id, data.id),
            eq(customers.tenantId, auth.tenantId),
          ),
        )
    })
    return { ok: true }
  })
