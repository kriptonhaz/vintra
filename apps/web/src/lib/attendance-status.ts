/**
 * Attendance record status values. Stored as plain text in
 * `attendance_records.clock_in_status` / `clock_out_status` — there is
 * no Postgres enum, so these constants are the single source of truth.
 *
 * - `on_time` / `late`        — clock-in outcomes for a scheduled branch
 * - `on_time` / `early_leave` — clock-out outcomes for a scheduled branch
 * - `present`                 — neutral status for "simple mode" branches
 *                               (no schedule → no lateness scoring) and
 *                               for manually entered records where HR
 *                               does not want a late/early classification
 */
export const ATTENDANCE_STATUS = {
  onTime: 'on_time',
  late: 'late',
  earlyLeave: 'early_leave',
  present: 'present',
} as const

export type ClockInStatus = 'on_time' | 'late' | 'present'
export type ClockOutStatus = 'on_time' | 'early_leave' | 'present'

/** Statuses HR may pick from when entering/editing a record by hand. */
export const MANUAL_CLOCK_IN_STATUSES: ClockInStatus[] = [
  'present',
  'on_time',
  'late',
]
export const MANUAL_CLOCK_OUT_STATUSES: ClockOutStatus[] = [
  'present',
  'on_time',
  'early_leave',
]
