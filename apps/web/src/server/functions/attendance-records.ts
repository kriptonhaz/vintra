import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  attendanceRecords,
  staffProfiles,
  branches,
  branchShifts,
  tenantMembers,
} from '@vintra/db/schema'
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import * as XLSX from 'xlsx'
import { requireActiveModule } from '../middleware/module-access'
import { requirePermission } from '../middleware/auth'
import { getAttendancePhotoSignedUrl } from '@/lib/s3-storage'

const MODULE_KEY = 'attendance'

/** Cap on how many photos one bundle request may produce. Owners almost
 *  never need more than ~30 days × ~20 staff × 2 = 1200 in a sweep, so
 *  this protects the browser ZIP step from spiraling into 100s of MB. */
const PHOTO_BUNDLE_MAX = 500

/**
 * Convert a staff name into a slug safe for both filesystem and ZIP
 * entry names. Indonesian common chars (spaces, &, dots) → '-', case
 * lowered, leading/trailing/duplicate dashes stripped. Stays
 * deterministic so the filename in the spreadsheet matches the file
 * inside the ZIP byte-for-byte.
 */
function slugifyName(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-') || 'staf'
  )
}

/**
 * The single source of truth for what a photo file should be called
 * everywhere we surface it (CSV column, XLSX column, ZIP entry name).
 * Format: `2026-04-22_budi-santoso_in.jpg`. Sortable, readable, no path
 * separators. The S3 object stores a UUID-y key under the hood, but
 * that key is meaningless to the owner downloading the archive.
 */
function attendancePhotoFilename(
  date: string,
  staffName: string,
  slot: 'in' | 'out',
): string {
  return `${date}_${slugifyName(staffName)}_${slot}.jpg`
}

// Two aliases for branch_shifts: one joined via the record's snapshot shift
// (what was effective at clock-in), one via the staff's current assignment.
// We coalesce both for display + filtering so records that lack a snapshot
// (e.g., created before the shift feature or when the staff was Regular)
// still pick up the staff's current shift.
const recordShift = alias(branchShifts, 'record_shift')
const currentShift = alias(branchShifts, 'current_shift')

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD')

const filterSchema = z.object({
  from: dateStr,
  to: dateStr,
  staffId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  /** Special value 'regular' = records where no shift was assigned. */
  shiftId: z.string().optional(),
})

const paginatedFilterSchema = filterSchema.extend({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(100).default(25),
})

type Filter = z.infer<typeof filterSchema>

function buildConditions(tenantId: string, filter: Filter) {
  const conds = [
    eq(attendanceRecords.tenantId, tenantId),
    gte(attendanceRecords.date, filter.from),
    lte(attendanceRecords.date, filter.to),
  ]
  if (filter.staffId) conds.push(eq(attendanceRecords.staffProfileId, filter.staffId))
  if (filter.branchId) conds.push(eq(attendanceRecords.branchId, filter.branchId))
  // Filter on the "effective" shift: the record's snapshot if present, else
  // the staff's current shift assignment. Matches how it's displayed.
  if (filter.shiftId === 'regular') {
    conds.push(
      sql`COALESCE(${attendanceRecords.branchShiftId}, ${staffProfiles.branchShiftId}) IS NULL`,
    )
  } else if (filter.shiftId) {
    conds.push(
      sql`COALESCE(${attendanceRecords.branchShiftId}, ${staffProfiles.branchShiftId}) = ${filter.shiftId}`,
    )
  }
  return conds
}

async function queryRecords(
  tenantId: string,
  filter: Filter,
  options?: { limit?: number; offset?: number },
) {
  const conds = buildConditions(tenantId, filter)

  let q = db
    .select({
      id: attendanceRecords.id,
      date: attendanceRecords.date,
      scheduledIn: attendanceRecords.scheduledIn,
      scheduledOut: attendanceRecords.scheduledOut,
      clockInAt: attendanceRecords.clockInAt,
      clockOutAt: attendanceRecords.clockOutAt,
      clockInStatus: attendanceRecords.clockInStatus,
      clockOutStatus: attendanceRecords.clockOutStatus,
      clockInModes: attendanceRecords.clockInModes,
      clockOutModes: attendanceRecords.clockOutModes,
      clockInPhotoKey: attendanceRecords.clockInPhotoKey,
      clockOutPhotoKey: attendanceRecords.clockOutPhotoKey,
      clockInLat: attendanceRecords.clockInLat,
      clockInLng: attendanceRecords.clockInLng,
      clockInNotes: attendanceRecords.clockInNotes,
      clockOutNotes: attendanceRecords.clockOutNotes,
      staffId: staffProfiles.id,
      // Derived from tenant_members (the legacy staff_profiles.full_name
      // column was dropped in migration 0035).
      staffName: sql<string>`TRIM(COALESCE(${tenantMembers.firstName}, '') || ' ' || COALESCE(${tenantMembers.lastName}, ''))`,
      branchId: branches.id,
      branchName: branches.name,
      // The effective shift id + name: record snapshot wins when present,
      // else fall back to the staff's current assignment. Keeps historical
      // accuracy where we have it but makes the display intuitive for
      // records created before the feature or when the staff was Regular.
      branchShiftId: sql<string | null>`COALESCE(${attendanceRecords.branchShiftId}, ${staffProfiles.branchShiftId})`,
      branchShiftName: sql<string | null>`COALESCE(${recordShift.name}, ${currentShift.name})`,
    })
    .from(attendanceRecords)
    .innerJoin(staffProfiles, eq(attendanceRecords.staffProfileId, staffProfiles.id))
    .innerJoin(tenantMembers, eq(staffProfiles.tenantMemberId, tenantMembers.id))
    .leftJoin(branches, eq(attendanceRecords.branchId, branches.id))
    .leftJoin(recordShift, eq(attendanceRecords.branchShiftId, recordShift.id))
    .leftJoin(currentShift, eq(staffProfiles.branchShiftId, currentShift.id))
    .where(and(...conds))
    .orderBy(desc(attendanceRecords.date), desc(attendanceRecords.clockInAt))
    .$dynamic()

  if (options?.limit != null) q = q.limit(options.limit)
  if (options?.offset != null) q = q.offset(options.offset)

  return q
}

async function countRecords(tenantId: string, filter: Filter): Promise<number> {
  const conds = buildConditions(tenantId, filter)
  // Join staffProfiles because the shift-filter condition references
  // staff_profiles.branch_shift_id (for the coalesce fallback).
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attendanceRecords)
    .innerJoin(staffProfiles, eq(attendanceRecords.staffProfileId, staffProfiles.id))
    .where(and(...conds))
  return row?.count ?? 0
}

// ─── List ───────────────────────────────────────────

export const listAttendanceRecords = createServerFn()
  .inputValidator(paginatedFilterSchema)
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission(['attendance.manage','attendance.report'])

    const { page, pageSize } = data
    const offset = (page - 1) * pageSize

    const [rows, totalCount] = await Promise.all([
      queryRecords(auth.tenantId, data, { limit: pageSize, offset }),
      countRecords(auth.tenantId, data),
    ])

    // Pre-sign photo URLs (5 min TTL) for the returned slice
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const clockInPhotoUrl = r.clockInPhotoKey
          ? await getAttendancePhotoSignedUrl(r.clockInPhotoKey).catch(() => null)
          : null
        const clockOutPhotoUrl = r.clockOutPhotoKey
          ? await getAttendancePhotoSignedUrl(r.clockOutPhotoKey).catch(() => null)
          : null
        return { ...r, clockInPhotoUrl, clockOutPhotoUrl }
      }),
    )

    return {
      records: enriched,
      page,
      pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  })

// ─── CSV export ─────────────────────────────────────

function escapeCsv(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  // Quote if contains comma / quote / newline
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function formatJakartaTime(d: Date | null): string {
  if (!d) return ''
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(11, 16)
}

export const exportAttendanceCsv = createServerFn()
  .inputValidator(filterSchema)
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission(['attendance.manage','attendance.report'])

    const rows = await queryRecords(auth.tenantId, data)

    const headers = [
      'Tanggal',
      'Staf',
      'Cabang',
      'Shift',
      'Jam Masuk',
      'Jam Pulang',
      'Status Masuk',
      'Status Pulang',
      'Metode Masuk',
      'Metode Pulang',
      'Catatan Masuk',
      'Catatan Pulang',
      'File Foto Masuk',
      'File Foto Pulang',
    ]

    const lines: string[] = [headers.join(',')]
    for (const r of rows) {
      // The photo filename is whatever the photo would be called inside
      // the bulk ZIP download — empty when the row never captured one.
      const inFile = r.clockInPhotoKey
        ? attendancePhotoFilename(r.date, r.staffName, 'in')
        : ''
      const outFile = r.clockOutPhotoKey
        ? attendancePhotoFilename(r.date, r.staffName, 'out')
        : ''
      lines.push(
        [
          escapeCsv(r.date),
          escapeCsv(r.staffName),
          escapeCsv(r.branchName ?? ''),
          escapeCsv(r.branchShiftName ?? 'Reguler'),
          escapeCsv(formatJakartaTime(r.clockInAt)),
          escapeCsv(formatJakartaTime(r.clockOutAt)),
          escapeCsv(r.clockInStatus ?? ''),
          escapeCsv(r.clockOutStatus ?? ''),
          escapeCsv((r.clockInModes ?? []).join('+')),
          escapeCsv((r.clockOutModes ?? []).join('+')),
          escapeCsv(r.clockInNotes ?? ''),
          escapeCsv(r.clockOutNotes ?? ''),
          escapeCsv(inFile),
          escapeCsv(outFile),
        ].join(','),
      )
    }

    // Prepend UTF-8 BOM so Excel opens Indonesian strings correctly
    const body = '\uFEFF' + lines.join('\n')
    return {
      filename: `absensi-${data.from}-${data.to}.csv`,
      body,
      count: rows.length,
    }
  })

// ─── XLSX export ────────────────────────────────────

const XLSX_HEADERS = [
  'Tanggal',
  'Staf',
  'Cabang',
  'Shift',
  'Jam Masuk',
  'Jam Pulang',
  'Status Masuk',
  'Status Pulang',
  'Metode Masuk',
  'Metode Pulang',
  'Catatan Masuk',
  'Catatan Pulang',
  'File Foto Masuk',
  'File Foto Pulang',
]

export const exportAttendanceXlsx = createServerFn()
  .inputValidator(filterSchema)
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission(['attendance.manage','attendance.report'])

    const rows = await queryRecords(auth.tenantId, data)

    const sheetData: (string | number | null)[][] = [XLSX_HEADERS]
    for (const r of rows) {
      const inFile = r.clockInPhotoKey
        ? attendancePhotoFilename(r.date, r.staffName, 'in')
        : ''
      const outFile = r.clockOutPhotoKey
        ? attendancePhotoFilename(r.date, r.staffName, 'out')
        : ''
      sheetData.push([
        r.date,
        r.staffName,
        r.branchName ?? '',
        r.branchShiftName ?? 'Reguler',
        formatJakartaTime(r.clockInAt),
        formatJakartaTime(r.clockOutAt),
        r.clockInStatus ?? '',
        r.clockOutStatus ?? '',
        (r.clockInModes ?? []).join('+'),
        (r.clockOutModes ?? []).join('+'),
        r.clockInNotes ?? '',
        r.clockOutNotes ?? '',
        inFile,
        outFile,
      ])
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetData)
    // Set reasonable column widths
    ws['!cols'] = [
      { wch: 12 }, // Tanggal
      { wch: 22 }, // Staf
      { wch: 18 }, // Cabang
      { wch: 14 }, // Shift
      { wch: 10 }, // Jam Masuk
      { wch: 10 }, // Jam Pulang
      { wch: 12 }, // Status Masuk
      { wch: 12 }, // Status Pulang
      { wch: 14 }, // Metode Masuk
      { wch: 14 }, // Metode Pulang
      { wch: 32 }, // Catatan Masuk
      { wch: 32 }, // Catatan Pulang
      { wch: 36 }, // File Foto Masuk
      { wch: 36 }, // File Foto Pulang
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Absensi')

    const buffer = XLSX.write(wb, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer

    return {
      filename: `absensi-${data.from}-${data.to}.xlsx`,
      // Base64 encoded so it can travel over the JSON RPC boundary
      bodyBase64: buffer.toString('base64'),
      count: rows.length,
    }
  })

// ─── Photo bundle (signed URLs) ─────────────────────
//
// Returns the photo entries that match the same filter set as the
// CSV/XLSX exports, paired with short-lived signed URLs and the
// human-readable filename used in those exports. The browser does
// the actual ZIP packaging (jszip + file-saver) — this avoids the
// server having to stream large binary payloads through Node and
// keeps S3 talking directly to the user. Hard-capped to
// PHOTO_BUNDLE_MAX so a wide filter doesn't try to bundle 10k photos.

export const getAttendancePhotoBundle = createServerFn()
  .inputValidator(filterSchema)
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission(['attendance.manage','attendance.report'])

    const rows = await queryRecords(auth.tenantId, data)

    // Flatten one row → up to two photo entries (in + out). Skip rows
    // where neither slot captured a photo.
    const entries: Array<{
      filename: string
      key: string
      slot: 'in' | 'out'
      date: string
      staffName: string
    }> = []
    for (const r of rows) {
      if (r.clockInPhotoKey) {
        entries.push({
          filename: attendancePhotoFilename(r.date, r.staffName, 'in'),
          key: r.clockInPhotoKey,
          slot: 'in',
          date: r.date,
          staffName: r.staffName,
        })
      }
      if (r.clockOutPhotoKey) {
        entries.push({
          filename: attendancePhotoFilename(r.date, r.staffName, 'out'),
          key: r.clockOutPhotoKey,
          slot: 'out',
          date: r.date,
          staffName: r.staffName,
        })
      }
    }

    const truncated = entries.length > PHOTO_BUNDLE_MAX
    const limited = truncated ? entries.slice(0, PHOTO_BUNDLE_MAX) : entries

    // Sign URLs in parallel — getAttendancePhotoSignedUrl already wraps
    // the AWS SDK call. Failed signs (object missing because lifecycle
    // already deleted it) return null and are filtered out client-side.
    const signed = await Promise.all(
      limited.map(async (e) => {
        try {
          const url = await getAttendancePhotoSignedUrl(e.key)
          return { filename: e.filename, signedUrl: url }
        } catch {
          return { filename: e.filename, signedUrl: null }
        }
      }),
    )

    return {
      items: signed,
      total: entries.length,
      truncated,
      max: PHOTO_BUNDLE_MAX,
    }
  })

// ─── Manual record CRUD (HR reconciliation) ─────────
//
// HR enters / edits / deletes attendance records by hand — for verbally
// reported shift swaps, force-majeure days, or a missed clock-in. Times
// are entered as Jakarta wall-clock HH:mm and combined with the record
// date into a UTC instant for storage (the +07:00 offset mirrors how
// the check-in flow's timestamps read back via formatJakartaTime).
//
// HR picks the status from a dropdown — the system does not re-score
// lateness, since a manual entry is precisely the case where the
// schedule cannot be trusted.

const MANUAL_IN_STATUSES = ['present', 'on_time', 'late'] as const
const MANUAL_OUT_STATUSES = ['present', 'on_time', 'early_leave'] as const

const manualRecordSchema = z.object({
  staffProfileId: z.string().uuid(),
  date: dateStr,
  clockInTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format jam HH:mm').optional(),
  clockOutTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format jam HH:mm').optional(),
  clockInStatus: z.enum(MANUAL_IN_STATUSES).optional(),
  clockOutStatus: z.enum(MANUAL_OUT_STATUSES).optional(),
  clockInNotes: z.string().max(500).optional(),
  clockOutNotes: z.string().max(500).optional(),
})

const updateRecordSchema = z.object({
  id: z.string().uuid(),
  clockInTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format jam HH:mm').optional(),
  clockOutTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format jam HH:mm').optional(),
  clockInStatus: z.enum(MANUAL_IN_STATUSES).optional(),
  clockOutStatus: z.enum(MANUAL_OUT_STATUSES).optional(),
  clockInNotes: z.string().max(500).optional(),
  clockOutNotes: z.string().max(500).optional(),
})

/** Combine a Jakarta calendar date + HH:mm into the UTC instant to store. */
function jakartaInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+07:00`)
}

export const createAttendanceRecord = createServerFn({ method: 'POST' })
  .inputValidator(manualRecordSchema)
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission('attendance.manage')

    if (!data.clockInTime && !data.clockOutTime) {
      throw new Error('Isi minimal jam masuk atau jam pulang.')
    }

    // Verify the staff profile belongs to the caller's tenant.
    const [staff] = await db
      .select({
        id: staffProfiles.id,
        branchId: staffProfiles.branchId,
        branchShiftId: staffProfiles.branchShiftId,
      })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.id, data.staffProfileId),
          eq(staffProfiles.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!staff) throw new Error('Staf tidak ditemukan.')

    // One record per (staff, date) — pre-check so HR gets a clear
    // message instead of a raw unique-constraint violation.
    const [dup] = await db
      .select({ id: attendanceRecords.id })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.staffProfileId, data.staffProfileId),
          eq(attendanceRecords.date, data.date),
        ),
      )
      .limit(1)
    if (dup) {
      throw new Error(
        'Sudah ada catatan absensi untuk staf ini di tanggal tersebut. Edit catatan yang ada.',
      )
    }

    const clockInAt = data.clockInTime
      ? jakartaInstant(data.date, data.clockInTime)
      : null
    const clockOutAt = data.clockOutTime
      ? jakartaInstant(data.date, data.clockOutTime)
      : null

    const [created] = await db
      .insert(attendanceRecords)
      .values({
        tenantId: auth.tenantId,
        staffProfileId: data.staffProfileId,
        branchId: staff.branchId ?? null,
        branchShiftId: staff.branchShiftId ?? null,
        date: data.date,
        clockInAt,
        clockOutAt,
        // 'manual' marks the row as HR-entered (vs gps/photo/qr) so
        // reports and the records UI can tell them apart.
        clockInModes: clockInAt ? ['manual'] : null,
        clockOutModes: clockOutAt ? ['manual'] : null,
        clockInStatus: clockInAt ? data.clockInStatus ?? 'present' : null,
        clockOutStatus: clockOutAt ? data.clockOutStatus ?? 'present' : null,
        clockInNotes: data.clockInNotes?.trim() || null,
        clockOutNotes: data.clockOutNotes?.trim() || null,
      })
      .returning()
    return created!
  })

export const updateAttendanceRecord = createServerFn({ method: 'POST' })
  .inputValidator(updateRecordSchema)
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission('attendance.manage')

    if (!data.clockInTime && !data.clockOutTime) {
      throw new Error('Isi minimal jam masuk atau jam pulang.')
    }

    // Verify the record belongs to the caller's tenant.
    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.id, data.id),
          eq(attendanceRecords.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!record) throw new Error('Catatan absensi tidak ditemukan.')

    const clockInAt = data.clockInTime
      ? jakartaInstant(record.date, data.clockInTime)
      : null
    const clockOutAt = data.clockOutTime
      ? jakartaInstant(record.date, data.clockOutTime)
      : null

    const [updated] = await db
      .update(attendanceRecords)
      .set({
        clockInAt,
        clockOutAt,
        // Preserve the original verification modes when the record
        // already had a clock-in (HR is just correcting a time);
        // tag a newly added clock-in as 'manual'.
        clockInModes: clockInAt
          ? record.clockInAt
            ? record.clockInModes
            : ['manual']
          : null,
        clockOutModes: clockOutAt
          ? record.clockOutAt
            ? record.clockOutModes
            : ['manual']
          : null,
        clockInStatus: clockInAt ? data.clockInStatus ?? 'present' : null,
        clockOutStatus: clockOutAt ? data.clockOutStatus ?? 'present' : null,
        clockInNotes: data.clockInNotes?.trim() || null,
        clockOutNotes: data.clockOutNotes?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(attendanceRecords.id, data.id))
      .returning()
    return updated!
  })

export const deleteAttendanceRecord = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission('attendance.manage')

    const [record] = await db
      .select({ id: attendanceRecords.id })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.id, data.id),
          eq(attendanceRecords.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!record) throw new Error('Catatan absensi tidak ditemukan.')

    await db.delete(attendanceRecords).where(eq(attendanceRecords.id, data.id))
    return { success: true }
  })
