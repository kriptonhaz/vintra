import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  branches,
  branchShifts,
  branchShiftSchedules,
  staffProfiles,
  attendanceRecords,
} from '@vintra/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../middleware/auth'
import { requireActiveModule } from '../middleware/module-access'

const MODULE_KEY = 'attendance'

async function requireAttendanceManage() {
  await requireActiveModule(MODULE_KEY)
  return requirePermission('attendance.manage')
}

// ─── Read ──────────────────────────────────────────

export const listShifts = createServerFn()
  .inputValidator(z.object({ branchId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)

    const conds = [eq(branchShifts.tenantId, auth.tenantId)]
    if (data.branchId) conds.push(eq(branchShifts.branchId, data.branchId))

    // Include staff count so the UI can warn before delete and show "X staf".
    // Count every assigned profile (active + inactive) to match the staff
    // sheet, which lists inactive staff with a dimmed style — so a shift
    // with one active and one deactivated assignee shows "2" both places.
    const rows = await db
      .select({
        id: branchShifts.id,
        branchId: branchShifts.branchId,
        name: branchShifts.name,
        isActive: branchShifts.isActive,
        createdAt: branchShifts.createdAt,
        staffCount: sql<number>`(
          select count(*)::int from ${staffProfiles}
          where ${staffProfiles.branchShiftId} = ${branchShifts.id}
        )`,
      })
      .from(branchShifts)
      .where(and(...conds))
      .orderBy(branchShifts.createdAt)

    return rows
  })

export const getShiftWithSchedule = createServerFn()
  .inputValidator(z.object({ shiftId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)

    const [shift] = await db
      .select()
      .from(branchShifts)
      .where(
        and(
          eq(branchShifts.id, data.shiftId),
          eq(branchShifts.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!shift) throw new Error('Shift tidak ditemukan')

    const schedules = await db
      .select()
      .from(branchShiftSchedules)
      .where(eq(branchShiftSchedules.branchShiftId, data.shiftId))
      .orderBy(branchShiftSchedules.dayOfWeek)

    return { shift, schedules }
  })

// ─── Mutations ─────────────────────────────────────

const shiftSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().min(1, 'Nama shift wajib diisi').max(50, 'Maksimal 50 karakter'),
})

export const createShift = createServerFn({ method: 'POST' })
  .inputValidator(shiftSchema)
  .handler(async ({ data }) => {
    const auth = await requireAttendanceManage()

    // Verify branch belongs to tenant
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(eq(branches.id, data.branchId), eq(branches.tenantId, auth.tenantId)),
      )
      .limit(1)
    if (!branch) throw new Error('Cabang tidak ditemukan')

    let shift: typeof branchShifts.$inferSelect
    try {
      const [inserted] = await db
        .insert(branchShifts)
        .values({
          tenantId: auth.tenantId,
          branchId: data.branchId,
          name: data.name,
        })
        .returning()
      shift = inserted!
    } catch (err) {
      if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
        throw new Error('Nama shift sudah digunakan di cabang ini')
      }
      throw err
    }

    // Seed 7 schedule rows, all off by default. Owner fills them in via
    // Edit Jadwal. Use null clock times so the CHECK constraint is satisfied
    // for non-work days without requiring dummy hours.
    await db.insert(branchShiftSchedules).values(
      [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
        tenantId: auth.tenantId,
        branchShiftId: shift.id,
        dayOfWeek: dow,
        isWorkDay: false,
        clockInTime: null,
        clockOutTime: null,
        lateGraceMinutes: 10,
        earlyLeaveGraceMinutes: 0,
      })),
    )

    return shift
  })

const updateShiftSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(50),
  isActive: z.boolean(),
})

export const updateShift = createServerFn({ method: 'POST' })
  .inputValidator(updateShiftSchema)
  .handler(async ({ data }) => {
    const auth = await requireAttendanceManage()

    try {
      const [shift] = await db
        .update(branchShifts)
        .set({ name: data.name, isActive: data.isActive, updatedAt: new Date() })
        .where(
          and(
            eq(branchShifts.id, data.id),
            eq(branchShifts.tenantId, auth.tenantId),
          ),
        )
        .returning()
      if (!shift) throw new Error('Shift tidak ditemukan')
      return shift
    } catch (err) {
      if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
        throw new Error('Nama shift sudah digunakan di cabang ini')
      }
      throw err
    }
  })

export const deleteShift = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireAttendanceManage()

    // Block if any active staff still assigned
    const [staffRow] = await db
      .select({ staff: sql<number>`count(*)::int` })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.branchShiftId, data.id),
          eq(staffProfiles.isActive, true),
        ),
      )
    const staff = staffRow?.staff ?? 0
    if (staff > 0) {
      throw new Error(
        `Shift masih digunakan ${staff} staf aktif. Pindahkan staf ke shift lain atau jadikan Reguler sebelum menghapus.`,
      )
    }

    // Block if any historical records reference this shift (preserve attribution).
    // Owner can still soft-archive via isActive=false.
    const [recordsRow] = await db
      .select({ records: sql<number>`count(*)::int` })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.branchShiftId, data.id))
    const records = recordsRow?.records ?? 0
    if (records > 0) {
      throw new Error(
        `Shift memiliki ${records} riwayat absensi yang tidak dapat dihapus. Nonaktifkan shift agar tidak bisa dipilih lagi.`,
      )
    }

    await db
      .delete(branchShifts)
      .where(
        and(
          eq(branchShifts.id, data.id),
          eq(branchShifts.tenantId, auth.tenantId),
        ),
      )

    return { success: true }
  })

// ─── Schedule ──────────────────────────────────────

const daySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isWorkDay: z.boolean(),
    clockInTime: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Format jam tidak valid')
      .nullable(),
    clockOutTime: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Format jam tidak valid')
      .nullable(),
    lateGraceMinutes: z.number().int().min(0).max(120),
    earlyLeaveGraceMinutes: z.number().int().min(0).max(120),
  })
  .refine(
    (d) =>
      !d.isWorkDay ||
      (d.clockInTime != null &&
        d.clockOutTime != null &&
        d.clockOutTime > d.clockInTime),
    {
      message:
        'Hari kerja harus punya jam masuk dan pulang, dan jam pulang harus setelah jam masuk (shift v1 tidak mendukung lintas tengah malam).',
    },
  )

/**
 * Assign a staff member to a shift, or clear the assignment (regular
 * worker). Used by the shift staff drill-down on /attendance/shifts.
 * A null `branchShiftId` makes the staff a regular worker (follows the
 * branch schedule). A non-null shift must belong to the staff's home
 * branch — a shift from another branch is invalid.
 */
export const setStaffShift = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      staffProfileId: z.string().uuid(),
      branchShiftId: z.string().uuid().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireAttendanceManage()

    const [staff] = await db
      .select({ id: staffProfiles.id, branchId: staffProfiles.branchId })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.id, data.staffProfileId),
          eq(staffProfiles.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!staff) throw new Error('Staf tidak ditemukan')

    if (data.branchShiftId) {
      if (!staff.branchId) {
        throw new Error('Staf belum punya cabang. Tetapkan cabang dulu.')
      }
      const [shift] = await db
        .select({ id: branchShifts.id })
        .from(branchShifts)
        .where(
          and(
            eq(branchShifts.id, data.branchShiftId),
            eq(branchShifts.branchId, staff.branchId),
            eq(branchShifts.tenantId, auth.tenantId),
          ),
        )
        .limit(1)
      if (!shift) throw new Error('Shift tidak ada di cabang staf ini')
    }

    await db
      .update(staffProfiles)
      .set({ branchShiftId: data.branchShiftId, updatedAt: new Date() })
      .where(
        and(
          eq(staffProfiles.id, data.staffProfileId),
          eq(staffProfiles.tenantId, auth.tenantId),
        ),
      )

    return { success: true }
  })

export const setShiftSchedule = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      shiftId: z.string().uuid(),
      days: z.array(daySchema).length(7),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireAttendanceManage()

    // Verify shift belongs to caller's tenant
    const [shift] = await db
      .select({ id: branchShifts.id })
      .from(branchShifts)
      .where(
        and(
          eq(branchShifts.id, data.shiftId),
          eq(branchShifts.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!shift) throw new Error('Shift tidak ditemukan')

    // Upsert all 7 rows via delete + insert (atomic within a transaction so
    // the unique-constraint doesn't fire against the rows we just deleted).
    await db.transaction(async (tx) => {
      await tx
        .delete(branchShiftSchedules)
        .where(eq(branchShiftSchedules.branchShiftId, data.shiftId))

      await tx.insert(branchShiftSchedules).values(
        data.days.map((d) => ({
          tenantId: auth.tenantId,
          branchShiftId: data.shiftId,
          dayOfWeek: d.dayOfWeek,
          isWorkDay: d.isWorkDay,
          // Store null when the day is off, so the CHECK constraint passes
          // without forcing the UI to invent dummy times.
          clockInTime: d.isWorkDay ? d.clockInTime : null,
          clockOutTime: d.isWorkDay ? d.clockOutTime : null,
          lateGraceMinutes: d.lateGraceMinutes,
          earlyLeaveGraceMinutes: d.earlyLeaveGraceMinutes,
        })),
      )
    })

    return { success: true }
  })
