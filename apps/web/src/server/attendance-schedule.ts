/**
 * Server-only schedule resolver shared by attendance check-in handlers
 * and the notification scheduler. Lives outside the `functions/`
 * directory so exporting it doesn't widen the public surface of any
 * server-fn file (which would defeat tree-shaking on the client side).
 */
import { db } from '@vintra/db'
import { branchSchedules, branchShiftSchedules } from '@vintra/db/schema'
import { and, eq } from 'drizzle-orm'

export interface ResolvedSchedule {
  dayOfWeek: number
  isWorkDay: boolean
  clockInTime: string | null
  clockOutTime: string | null
  lateGraceMinutes: number
  earlyLeaveGraceMinutes: number
}

/**
 * Resolve the schedule row for a given staff profile + day of week.
 * If the staff has a shift assignment, uses branch_shift_schedules;
 * otherwise falls back to the branch's default schedule. Returns null
 * when no row is found for the requested day (shouldn't happen with
 * normal seeding but guards against half-configured setups).
 */
export async function resolveStaffScheduleForDow(
  staffProfile: { branchId: string | null; branchShiftId: string | null },
  dow: number,
): Promise<ResolvedSchedule | null> {
  if (staffProfile.branchShiftId) {
    const [row] = await db
      .select()
      .from(branchShiftSchedules)
      .where(
        and(
          eq(branchShiftSchedules.branchShiftId, staffProfile.branchShiftId),
          eq(branchShiftSchedules.dayOfWeek, dow),
        ),
      )
      .limit(1)
    if (!row) return null
    return {
      dayOfWeek: row.dayOfWeek,
      isWorkDay: row.isWorkDay,
      clockInTime: row.clockInTime,
      clockOutTime: row.clockOutTime,
      lateGraceMinutes: row.lateGraceMinutes,
      earlyLeaveGraceMinutes: row.earlyLeaveGraceMinutes,
    }
  }
  if (!staffProfile.branchId) return null
  const [row] = await db
    .select()
    .from(branchSchedules)
    .where(
      and(
        eq(branchSchedules.branchId, staffProfile.branchId),
        eq(branchSchedules.dayOfWeek, dow),
      ),
    )
    .limit(1)
  if (!row) return null
  return {
    dayOfWeek: row.dayOfWeek,
    isWorkDay: row.isWorkDay,
    clockInTime: row.clockInTime,
    clockOutTime: row.clockOutTime,
    lateGraceMinutes: row.lateGraceMinutes,
    earlyLeaveGraceMinutes: row.earlyLeaveGraceMinutes,
  }
}
