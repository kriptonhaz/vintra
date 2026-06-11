/**
 * Qasir-compatible customer import/export.
 *
 * Mimics the layout Qasir's customer export uses so a tenant migrating
 * from Qasir can drop their downloaded xlsx straight in. Six columns:
 *
 *   Row 1: Subdomain | <tenant-slug>     (metadata)
 *   Row 2-3: blank padding
 *   Row 4: Nama Pelanggan | Email | Nomor Telepon | Transaksi | Kasbon | Poin
 *   Row 5+: data
 *
 * Import behaviour (decisions live here so future calls match):
 *   - dedup on (tenant, normalized phone) — same path as upsertCustomer
 *   - name / email / phone / visit_count: OVERWRITE on update
 *   - poin: only seed on NEW customer (creating customer_loyalty_balances).
 *     Never overwrite live balance — re-importing would lose recent earnings.
 *   - kasbon: create one ar_receivables row per non-zero kasbon, but ONLY
 *     if the customer has no prior "Imported from Qasir" AR row. Makes
 *     re-imports of the same file idempotent.
 *   - loyalty-balance writes silently skipped when the tenant lacks the
 *     loyalty_points feature; the preview reports the skipped count so the
 *     operator sees what's being dropped.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import * as XLSX from 'xlsx'
import { db } from '@vintra/db'
import {
  customers,
  customerLoyaltyBalances,
  customerLoyaltyMovements,
  arReceivables,
  tenants,
} from '@vintra/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { posTierLimits } from '@vintra/shared'
import { requirePOSAccess } from '../middleware/module-access'
import { normalizePhone } from './customers'

const QASIR_NOTE_PREFIX = 'Imported from Qasir'

function requireCustomerDbAccess(posTier: string) {
  if (posTier === 'free') {
    throw new Error(
      'Database pelanggan hanya tersedia di paket Toko atau Komplit.',
    )
  }
}

// ─── Export ──────────────────────────────────────────────────────────

export const exportCustomers = createServerFn().handler(async () => {
  const auth = await requirePOSAccess()
  requireCustomerDbAccess(auth.posTier)

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, auth.tenantId))
    .limit(1)
  if (!tenant) throw new Error('Tenant tidak ditemukan')

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      visitCount: customers.visitCount,
    })
    .from(customers)
    .where(eq(customers.tenantId, auth.tenantId))
    .orderBy(customers.name)

  // Pull loyalty + AR aggregates in two batched queries so the export
  // stays O(1) round-trips regardless of customer count.
  const ids = rows.map((r) => r.id)
  const [loyalty, ar] = await Promise.all([
    ids.length
      ? db
          .select({
            customerId: customerLoyaltyBalances.customerId,
            pointsBalance: customerLoyaltyBalances.pointsBalance,
          })
          .from(customerLoyaltyBalances)
          .where(inArray(customerLoyaltyBalances.customerId, ids))
      : [],
    ids.length
      ? db
          .select({
            customerId: arReceivables.customerId,
            // Outstanding = sum(amount - paid_amount) over active rows.
            outstanding: sql<string>`coalesce(sum(${arReceivables.amount} - ${arReceivables.paidAmount}), 0)`,
          })
          .from(arReceivables)
          .where(
            and(
              inArray(arReceivables.customerId, ids),
              inArray(arReceivables.status, ['outstanding', 'partial']),
            ),
          )
          .groupBy(arReceivables.customerId)
      : [],
  ])
  const poinByCustomer = new Map(
    loyalty.map((l) => [l.customerId, Math.round(Number(l.pointsBalance))]),
  )
  const kasbonByCustomer = new Map(
    ar.map((a) => [a.customerId, Math.round(Number(a.outstanding))]),
  )

  const sheetData: (string | number | null)[][] = []
  // Row 1: subdomain metadata (Qasir uses this slot for the store slug).
  sheetData.push(['Subdomain', tenant.slug])
  // Rows 2-3: blank padding to match Qasir's layout exactly.
  sheetData.push([])
  sheetData.push([])
  // Row 4: column headers.
  sheetData.push([
    'Nama Pelanggan',
    'Email',
    'Nomor Telepon',
    'Transaksi',
    'Kasbon',
    'Poin',
  ])
  for (const c of rows) {
    sheetData.push([
      c.name,
      c.email ?? '',
      c.phone ?? '',
      c.visitCount,
      kasbonByCustomer.get(c.id) ?? 0,
      poinByCustomer.get(c.id) ?? 0,
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetData)
  ws['!cols'] = [
    { wch: 25 },
    { wch: 30 },
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Pelanggan')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const ts = new Date()
    .toISOString()
    .replace(/[T:]/g, '-')
    .slice(0, 16)
  return {
    filename: `pelanggan-${tenant.slug}-${ts}.xlsx`,
    bodyBase64: buffer.toString('base64'),
    count: rows.length,
  }
})

// ─── Template ────────────────────────────────────────────────────────

/**
 * Build a blank Qasir-format xlsx the user can fill in and upload back.
 * Layout MUST match what the importCustomers parser detects (header
 * detection lives at lines ~217-234 of this file). If you change the
 * layout here, update the parser too — they're keyed to each other.
 *
 * Structure:
 *   Row 0:  Subdomain | <tenant-slug>            (Qasir metadata)
 *   Row 1-2: blank padding
 *   Row 3:  Nama Pelanggan | Email | Nomor Telepon | Transaksi | Kasbon | Poin
 *   Row 4:  one example row showing the expected types
 */
export const getCustomerImportTemplate = createServerFn().handler(async () => {
  const auth = await requirePOSAccess()
  requireCustomerDbAccess(auth.posTier)

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, auth.tenantId))
    .limit(1)
  if (!tenant) throw new Error('Tenant tidak ditemukan')

  const aoa: (string | number)[][] = [
    ['Subdomain', tenant.slug, '', '', '', ''],
    ['', '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['Nama Pelanggan', 'Email', 'Nomor Telepon', 'Transaksi', 'Kasbon', 'Poin'],
    // One example row so first-time users see the expected types. Phone
    // as string ("081...") so Excel doesn't strip the leading zero.
    ['Budi Santoso', 'budi@example.com', '081234567890', 0, 0, 0],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Force phone column to text so Excel never reformats it.
  ws['C5'] = { t: 's', v: '081234567890' }
  // Reasonable column widths so the header isn't crammed.
  ws['!cols'] = [
    { wch: 28 }, // Nama
    { wch: 22 }, // Email
    { wch: 18 }, // Nomor Telepon
    { wch: 12 }, // Transaksi
    { wch: 12 }, // Kasbon
    { wch: 10 }, // Poin
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Pelanggan')
  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return {
    filename: `vintra-template-pelanggan-${tenant.slug}.xlsx`,
    bodyBase64: buffer.toString('base64'),
  }
})

// ─── Import ──────────────────────────────────────────────────────────

const importInput = z.object({
  bodyBase64: z.string().min(1, 'File kosong'),
  mode: z.enum(['preview', 'commit']),
  /**
   * Default behaviour: skip the `poin` column for existing customers so
   * a stale export can't clobber a live balance. When `true`, the
   * import overwrites the live balance to the file's value and writes
   * a compensating 'adjust' row to `customer_loyalty_movements` so the
   * audit trail explains the change. Lifetime_earned is preserved
   * either way — it captures real historical earnings.
   */
  overrideLoyalty: z.boolean().optional().default(false),
})

type ParsedRow = {
  /** 1-based row number in the source xlsx, for error display. */
  rowNumber: number
  name: string
  email: string | null
  /** Already-normalized; null when the source phone is missing/invalid. */
  phone: string | null
  visitCount: number
  kasbon: number
  poin: number
}

type SkippedRow = {
  rowNumber: number
  name: string
  reason: string
}

type ClassifiedRow = ParsedRow & {
  /** 'create' = no existing customer with this phone; 'update' = matched. */
  action: 'create' | 'update'
  /** Set when action='update' — the customer to merge into. */
  existingCustomerId?: string
  /** True when an existing imported AR row blocks kasbon insertion. */
  kasbonSuppressed?: boolean
}

export const importCustomers = createServerFn({ method: 'POST' })
  .inputValidator(importInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requireCustomerDbAccess(auth.posTier)

    const buffer = Buffer.from(data.bodyBase64, 'base64')
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error('File terlalu besar (maks. 10MB).')
    }

    const wb = XLSX.read(buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]!]
    if (!ws) throw new Error('Sheet pertama tidak ditemukan dalam file.')
    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      raw: true,
    }) as unknown[][]

    // Find the header row: Qasir puts it at row 4 (1-based) but we
    // detect by content so manually-edited files still work.
    let headerRow = -1
    for (let i = 0; i < Math.min(raw.length, 20); i++) {
      const cells = (raw[i] ?? []).map((c) =>
        typeof c === 'string' ? c.trim().toLowerCase() : '',
      )
      if (
        cells.includes('nama pelanggan') &&
        cells.some((c) => c.startsWith('nomor'))
      ) {
        headerRow = i
        break
      }
    }
    if (headerRow === -1) {
      throw new Error(
        'Header tidak ditemukan. Pastikan ada baris dengan kolom "Nama Pelanggan", "Email", "Nomor Telepon", "Transaksi", "Kasbon", "Poin".',
      )
    }

    // Resolve column indices from the header — tolerates reordering.
    const header = (raw[headerRow] ?? []).map((c) =>
      typeof c === 'string' ? c.trim().toLowerCase() : '',
    )
    const colName = header.indexOf('nama pelanggan')
    const colEmail = header.indexOf('email')
    const colPhone = header.findIndex((c) => c.startsWith('nomor'))
    const colVisit = header.findIndex(
      (c) => c === 'transaksi' || c === 'jumlah transaksi',
    )
    const colKasbon = header.indexOf('kasbon')
    const colPoin = header.indexOf('poin')

    const parsed: ParsedRow[] = []
    const skipped: SkippedRow[] = []

    for (let i = headerRow + 1; i < raw.length; i++) {
      const r = raw[i] ?? []
      const rowNumber = i + 1 // 1-based for human display
      const name = String(r[colName] ?? '').trim()
      if (!name) continue // silently skip blank rows
      const email = String(r[colEmail] ?? '').trim() || null
      const rawPhone = String(r[colPhone] ?? '').trim()
      const phone = normalizePhone(rawPhone) // null on garbage
      const visitCount = toInt(r[colVisit])
      const kasbon = toFloat(r[colKasbon])
      const poin = toInt(r[colPoin])

      // Phone garbage is a soft skip — we still flag it so the operator
      // can fix the source row, but we don't abort the whole import.
      if (rawPhone && !phone) {
        skipped.push({
          rowNumber,
          name,
          reason: `Nomor telepon tidak valid: ${rawPhone}`,
        })
        continue
      }

      parsed.push({
        rowNumber,
        name,
        email,
        phone,
        visitCount,
        kasbon,
        poin,
      })
    }

    // In-file dedup by normalized phone. Qasir exports sometimes carry
    // the same customer twice (e.g. cashier rang up a regular under two
    // slightly different names — "kak Novi jts 2 (hh)" vs "Kak Novi
    // jts 2 (an)" — both pointing at the same phone). The DB has a
    // partial unique index on (tenant_id, phone) so without this pass
    // the first INSERT succeeds, the second hits the constraint, and
    // the whole transaction rolls back with nothing imported. Keep the
    // first occurrence (matches the "earlier wins" mental model) and
    // surface the rest in `skipped` so the operator can see exactly
    // which file rows collided.
    const firstByPhone = new Map<string, ParsedRow>()
    const deduped: ParsedRow[] = []
    for (const row of parsed) {
      if (!row.phone) {
        deduped.push(row)
        continue
      }
      const prior = firstByPhone.get(row.phone)
      if (prior) {
        skipped.push({
          rowNumber: row.rowNumber,
          name: row.name,
          reason: `Duplikat nomor HP di file (cocok dengan baris ${prior.rowNumber})`,
        })
        continue
      }
      firstByPhone.set(row.phone, row)
      deduped.push(row)
    }
    // Replace `parsed` in place. Note: `parsed.push(...deduped)` would
    // spread each row as a separate argument and blow V8's argument
    // count limit on a 5k+ row import; a plain for-loop is safe.
    parsed.length = 0
    for (const row of deduped) parsed.push(row)

    if (parsed.length === 0 && skipped.length === 0) {
      throw new Error('Tidak ada data pelanggan yang bisa di-import.')
    }

    // Dedup on (tenant, normalized phone) — one round-trip for the
    // whole batch. Rows with null phone always create.
    const phones = parsed.filter((p) => p.phone).map((p) => p.phone!) as string[]
    const existing =
      phones.length > 0
        ? await db
            .select({ id: customers.id, phone: customers.phone })
            .from(customers)
            .where(
              and(
                eq(customers.tenantId, auth.tenantId),
                inArray(customers.phone, phones),
              ),
            )
        : []
    const customerByPhone = new Map(existing.map((c) => [c.phone!, c.id]))

    // Idempotency probe for kasbon: which existing customers already
    // have a prior "Imported from Qasir" AR row?
    const existingIds = existing.map((c) => c.id)
    const alreadyImported =
      existingIds.length > 0
        ? await db
            .select({ customerId: arReceivables.customerId })
            .from(arReceivables)
            .where(
              and(
                inArray(arReceivables.customerId, existingIds),
                sql`${arReceivables.note} ILIKE ${QASIR_NOTE_PREFIX + '%'}`,
              ),
            )
        : []
    const suppressKasbonFor = new Set(
      alreadyImported.map((a) => a.customerId),
    )

    const classified: ClassifiedRow[] = parsed.map((p) => {
      const existingId = p.phone ? customerByPhone.get(p.phone) : undefined
      return {
        ...p,
        action: existingId ? 'update' : 'create',
        existingCustomerId: existingId,
        kasbonSuppressed: existingId
          ? suppressKasbonFor.has(existingId)
          : false,
      }
    })

    // Counts for the preview summary.
    const hasLoyalty = posTierLimits(auth.posTier).features.includes(
      'loyalty_points',
    )
    const toCreate = classified.filter((c) => c.action === 'create').length
    const toUpdate = classified.filter((c) => c.action === 'update').length
    const poinSkippedNoFeature = !hasLoyalty
      ? classified.filter((c) => c.poin > 0).length
      : 0
    // When override is on, existing-customer poin rows are no longer
    // "skipped" — they get applied. Surface both counts so the preview
    // can render "X di-override" vs "Y diabaikan" clearly.
    const poinSkippedExisting =
      hasLoyalty && !data.overrideLoyalty
        ? classified.filter((c) => c.action === 'update' && c.poin > 0).length
        : 0
    const poinOverridden =
      hasLoyalty && data.overrideLoyalty
        ? classified.filter((c) => c.action === 'update' && c.poin > 0).length
        : 0
    const kasbonSkippedDup = classified.filter(
      (c) => c.kasbon > 0 && c.kasbonSuppressed,
    ).length
    const kasbonToInsert = classified.filter(
      (c) => c.kasbon > 0 && !c.kasbonSuppressed,
    ).length
    const poinToSeed = hasLoyalty
      ? classified.filter((c) => c.action === 'create' && c.poin > 0).length
      : 0

    const summary = {
      totalRows: parsed.length + skipped.length,
      parsed: parsed.length,
      toCreate,
      toUpdate,
      poinToSeed,
      poinOverridden,
      poinSkippedExisting,
      poinSkippedNoFeature,
      kasbonToInsert,
      kasbonSkippedDup,
      skipped,
      // Cap preview slice to keep payload bounded — full list lives in
      // `skipped` already for the bad-phone case.
      sample: classified.slice(0, 50).map((c) => ({
        rowNumber: c.rowNumber,
        name: c.name,
        phone: c.phone,
        action: c.action,
        poin: c.poin,
        kasbon: c.kasbon,
        kasbonSuppressed: !!c.kasbonSuppressed,
      })),
    }

    if (data.mode === 'preview') {
      return { ...summary, committed: false as const }
    }

    // ─── Commit ─────────────────────────────────────────────────────
    // Single transaction so a mid-import error rolls back cleanly.
    const now = new Date()
    const noteTag = `${QASIR_NOTE_PREFIX} ${now.toISOString().slice(0, 10)}`

    await db.transaction(async (tx) => {
      // resolvedIds[i] holds the customer id for classified[i] after
      // create/update completes — lets us emit the loyalty + AR follow-up
      // batches without re-scanning.
      const resolvedIds: (string | undefined)[] = new Array(classified.length)

      // CREATEs go through one batched INSERT per chunk so a 5k-row
      // import finishes in seconds instead of minutes (one round-trip
      // to Supabase per chunk vs. one per row — which used to timeout
      // behind Cloudflare's ~100s window). Postgres caps a single
      // query at 65_535 parameters; 5 columns × 1000 rows = 5000
      // params per chunk leaves plenty of headroom. RETURNING
      // preserves insertion order within a single statement, so
      // mapping inserted[k].id back to createIndices[start + k] is
      // safe even for null-phone rows that can't be matched by phone.
      const CREATE_CHUNK = 1000
      const createIndices: number[] = []
      for (let i = 0; i < classified.length; i++) {
        if (classified[i]!.action === 'create') createIndices.push(i)
      }
      for (let start = 0; start < createIndices.length; start += CREATE_CHUNK) {
        const slice = createIndices.slice(start, start + CREATE_CHUNK)
        const values = slice.map((i) => {
          const c = classified[i]!
          return {
            tenantId: auth.tenantId,
            name: c.name,
            phone: c.phone,
            email: c.email,
            visitCount: c.visitCount,
          }
        })
        const inserted = await tx
          .insert(customers)
          .values(values)
          .returning({ id: customers.id })
        for (let k = 0; k < slice.length; k++) {
          resolvedIds[slice[k]!] = inserted[k]?.id
        }
      }

      // UPDATEs stay per-row — there's no clean batched UPDATE for
      // row-specific values in Postgres without a temp table, and
      // updates only fire on a re-import (a tenant uploading the same
      // file twice). Re-imports are rare and typically small enough
      // that sequential UPDATEs are fine. Revisit if a power user
      // routinely re-imports thousands of rows.
      for (let i = 0; i < classified.length; i++) {
        const c = classified[i]!
        if (c.action === 'update' && c.existingCustomerId) {
          await tx
            .update(customers)
            .set({
              name: c.name,
              email: c.email,
              visitCount: c.visitCount,
              updatedAt: now,
            })
            .where(
              and(
                eq(customers.id, c.existingCustomerId),
                eq(customers.tenantId, auth.tenantId),
              ),
            )
          resolvedIds[i] = c.existingCustomerId
        }
      }

      // Seed loyalty balance for NEW customers with non-zero poin only.
      // Existing customers are skipped by default to protect a live
      // balance from being clobbered by a stale Qasir export; opt-in
      // via overrideLoyalty=true to overwrite plus write a ledger row.
      if (hasLoyalty) {
        const loyaltyValues = classified
          .map((c, i) =>
            c.action === 'create' && c.poin > 0 && resolvedIds[i]
              ? {
                  tenantId: auth.tenantId,
                  customerId: resolvedIds[i]!,
                  pointsBalance: c.poin.toString(),
                  // Treat the imported balance as historical earnings so
                  // the customer detail "ever earned" stays sane.
                  lifetimeEarned: c.poin.toString(),
                }
              : null,
          )
          .filter((v): v is NonNullable<typeof v> => v != null)
        if (loyaltyValues.length > 0) {
          await tx.insert(customerLoyaltyBalances).values(loyaltyValues)
        }

        // Opt-in override: for each existing customer whose import row
        // carries a non-zero poin, overwrite the balance to the file's
        // value and emit a compensating 'adjust' ledger row so the
        // audit history explains the change ("dari Rp X menjadi Rp Y").
        // lifetime_earned is left alone — the override changes the
        // current balance, not the customer's true historical earnings.
        if (data.overrideLoyalty) {
          const overrideTargets = classified
            .map((c, i) =>
              c.action === 'update' &&
              c.poin > 0 &&
              c.existingCustomerId &&
              resolvedIds[i]
                ? { customerId: resolvedIds[i]!, newPoin: c.poin }
                : null,
            )
            .filter((v): v is NonNullable<typeof v> => v != null)

          if (overrideTargets.length > 0) {
            // One round-trip to read the prior balances so the ledger
            // rows can record both sides of the change.
            const ids = overrideTargets.map((t) => t.customerId)
            const priorRows = await tx
              .select({
                customerId: customerLoyaltyBalances.customerId,
                pointsBalance: customerLoyaltyBalances.pointsBalance,
              })
              .from(customerLoyaltyBalances)
              .where(inArray(customerLoyaltyBalances.customerId, ids))
            const priorByCustomer = new Map(
              priorRows.map((r) => [r.customerId, Number(r.pointsBalance ?? 0)]),
            )

            for (const t of overrideTargets) {
              const prior = priorByCustomer.get(t.customerId) ?? 0
              if (prior === t.newPoin) continue // no-op
              const delta = t.newPoin - prior

              await tx.insert(customerLoyaltyMovements).values({
                tenantId: auth.tenantId,
                customerId: t.customerId,
                type: 'adjust',
                points: Math.abs(delta).toString(),
                reason: `Import override (${now.toISOString().slice(0, 10)}): saldo ${prior} → ${t.newPoin}`,
                performedBy: auth.userId,
              })

              if (priorByCustomer.has(t.customerId)) {
                await tx
                  .update(customerLoyaltyBalances)
                  .set({
                    pointsBalance: t.newPoin.toString(),
                    updatedAt: now,
                  })
                  .where(
                    eq(customerLoyaltyBalances.customerId, t.customerId),
                  )
              } else {
                // Existing customer that never had a balance row yet —
                // seed it the same way the create branch does, but with
                // lifetime_earned = newPoin so future reports stay sane.
                await tx.insert(customerLoyaltyBalances).values({
                  tenantId: auth.tenantId,
                  customerId: t.customerId,
                  pointsBalance: t.newPoin.toString(),
                  lifetimeEarned: t.newPoin.toString(),
                })
              }
            }
          }
        }
      }

      // AR row per non-zero kasbon. Idempotency: never insert a second
      // imported row for an existing customer that already has one
      // (suppressKasbonFor was computed pre-transaction).
      const arValues = classified
        .map((c, i) =>
          c.kasbon > 0 && !c.kasbonSuppressed && resolvedIds[i]
            ? {
                tenantId: auth.tenantId,
                customerId: resolvedIds[i]!,
                amount: c.kasbon.toString(),
                note: noteTag,
                status: 'outstanding',
              }
            : null,
        )
        .filter((v): v is NonNullable<typeof v> => v != null)
      if (arValues.length > 0) {
        await tx.insert(arReceivables).values(arValues)
      }
    })

    return { ...summary, committed: true as const }
  })

// ─── helpers ─────────────────────────────────────────────────────────

function toInt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^\d-]/g, ''), 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function toFloat(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}
