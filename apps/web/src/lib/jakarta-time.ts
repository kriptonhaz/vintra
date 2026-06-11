/**
 * Jakarta time helpers. Indonesia (WIB) is UTC+7 with no DST.
 * Every attendance event is stored in UTC; we only convert at the boundary
 * (scheduling comparisons, date-key computation for `attendance_records.date`).
 */

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000

/** Current UTC timestamp shifted to Jakarta wall-clock. Avoid using .toISOString() on this — it will show UTC again. */
export function nowJakartaWallClock(): Date {
  return new Date(Date.now() + JAKARTA_OFFSET_MS)
}

/** Day-of-week in Jakarta (0 = Sunday ... 6 = Saturday) for the given instant. */
export function jakartaDayOfWeek(d: Date = new Date()): number {
  return new Date(d.getTime() + JAKARTA_OFFSET_MS).getUTCDay()
}

/** YYYY-MM-DD calendar date in Jakarta for the given instant. */
export function dateKeyJakarta(d: Date = new Date()): string {
  const w = new Date(d.getTime() + JAKARTA_OFFSET_MS)
  const y = w.getUTCFullYear()
  const m = String(w.getUTCMonth() + 1).padStart(2, '0')
  const day = String(w.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Pinned-Jakarta date formatter for display. Identical SSR + CSR
 * because the timeZone is forced to Asia/Jakarta — without this,
 * server (UTC) and browser (user's TZ) can disagree by one day for
 * timestamps near midnight UTC, firing React #418 (JUR-17).
 *
 * Accepts either a `Date` or an ISO string. Returns `'—'` when the
 * input is null/undefined so callers can drop the falsy guard.
 */
export function formatDateJakarta(
  input: Date | string | null | undefined,
  style: Intl.DateTimeFormatOptions['dateStyle'] = 'medium',
): string {
  if (input == null) return '—'
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('id-ID', {
    dateStyle: style,
    timeZone: 'Asia/Jakarta',
  })
}

/**
 * Compare an actual timestamp (UTC) to a scheduled HH:mm:ss time on the same
 * Jakarta calendar day, honoring an optional late-grace in minutes.
 * Returns `'on_time'` when the actual ≤ scheduled + grace; otherwise `'late'`.
 */
export function deriveClockInStatus(
  scheduledHHmmss: string,
  actualUtc: Date,
  graceMinutes: number,
): 'on_time' | 'late' {
  const actualJakarta = new Date(actualUtc.getTime() + JAKARTA_OFFSET_MS)
  const [hh, mm, ss] = scheduledHHmmss.split(':').map((v) => parseInt(v, 10))
  const scheduledJakarta = new Date(
    Date.UTC(
      actualJakarta.getUTCFullYear(),
      actualJakarta.getUTCMonth(),
      actualJakarta.getUTCDate(),
      hh ?? 0,
      (mm ?? 0) + graceMinutes,
      ss ?? 0,
    ),
  )
  return actualJakarta.getTime() <= scheduledJakarta.getTime()
    ? 'on_time'
    : 'late'
}

/**
 * Mirror of the above for clock-out. `'on_time'` when actual ≥ scheduled - grace
 * (i.e., staff didn't leave too early); otherwise `'early_leave'`.
 */
export function deriveClockOutStatus(
  scheduledHHmmss: string,
  actualUtc: Date,
  graceMinutes: number,
): 'on_time' | 'early_leave' {
  const actualJakarta = new Date(actualUtc.getTime() + JAKARTA_OFFSET_MS)
  const [hh, mm, ss] = scheduledHHmmss.split(':').map((v) => parseInt(v, 10))
  const scheduledJakarta = new Date(
    Date.UTC(
      actualJakarta.getUTCFullYear(),
      actualJakarta.getUTCMonth(),
      actualJakarta.getUTCDate(),
      hh ?? 0,
      (mm ?? 0) - graceMinutes,
      ss ?? 0,
    ),
  )
  return actualJakarta.getTime() >= scheduledJakarta.getTime()
    ? 'on_time'
    : 'early_leave'
}

/**
 * Minutes between an actual timestamp and the scheduled HH:mm:ss on the same
 * Jakarta calendar day. Positive = after scheduled; negative = before. Grace
 * period is NOT applied — this is the raw difference for display purposes.
 */
export function minutesFromScheduled(
  scheduledHHmmss: string,
  actualUtc: Date,
): number {
  const actualJakarta = new Date(actualUtc.getTime() + JAKARTA_OFFSET_MS)
  const [hh, mm, ss] = scheduledHHmmss.split(':').map((v) => parseInt(v, 10))
  const scheduledJakarta = new Date(
    Date.UTC(
      actualJakarta.getUTCFullYear(),
      actualJakarta.getUTCMonth(),
      actualJakarta.getUTCDate(),
      hh ?? 0,
      mm ?? 0,
      ss ?? 0,
    ),
  )
  return Math.round(
    (actualJakarta.getTime() - scheduledJakarta.getTime()) / 60_000,
  )
}
