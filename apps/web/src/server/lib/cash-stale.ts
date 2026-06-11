/**
 * #216 — stale cash-session evaluation. Pure, dependency-free, and
 * unit-tested (cash-stale.test.ts) so the boundary math stays correct.
 *
 * A session is "stale" when it should be force-closed before the cashier
 * can keep selling. Two modes:
 *   - `elapsed_hours`: stale once it's been open longer than N hours
 *     (the pre-#216 hardcoded rule was `> 14h`).
 *   - `daily_cutoff`: stale once the local clock crosses the configured
 *     daily boundary (e.g. 01:00) AND the session was opened before that
 *     boundary — i.e. it has carried into a new business day. An optional
 *     `minHours` suppresses the flag for sessions opened only a short
 *     while before the cutoff (the early-morning guard, so a session
 *     opened at 00:30 isn't flagged the instant 01:00 passes).
 *
 * Timezone: Indonesia observes no DST, so a fixed offset is exact. We
 * default to WIB (UTC+7). Multi-timezone outlets (WITA/WIT) are tracked
 * in #217 — when that lands, thread the branch's offset through here.
 */
import type { CashStaleConfig } from '@vintra/db/schema'

export const WIB_OFFSET_HOURS = 7

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * @param cfg          resolved config (branch override ?? tenant default)
 * @param openedAtUtc  session open time (DB stores UTC)
 * @param nowUtc       current time (UTC)
 * @param offsetHours  local-tz offset from UTC; defaults to WIB (+7)
 */
export function isSessionStale(
  cfg: CashStaleConfig,
  openedAtUtc: Date,
  nowUtc: Date,
  offsetHours: number = WIB_OFFSET_HOURS,
): boolean {
  const hoursOpen = (nowUtc.getTime() - openedAtUtc.getTime()) / HOUR_MS

  if (cfg.mode === 'elapsed_hours') {
    return hoursOpen > cfg.hours
  }

  // daily_cutoff
  const cutoff = mostRecentCutoffUtc(nowUtc, cfg.cutoff, offsetHours)
  if (openedAtUtc.getTime() >= cutoff.getTime()) return false
  if (cfg.minHours != null && hoursOpen < cfg.minHours) return false
  return true
}

/**
 * The most recent occurrence of `hhmm` (local wall-clock) at or before
 * `nowUtc`, returned as a UTC Date. If today's cutoff is still in the
 * future locally, we step back a day.
 */
export function mostRecentCutoffUtc(
  nowUtc: Date,
  hhmm: string,
  offsetHours: number = WIB_OFFSET_HOURS,
): Date {
  const offsetMs = offsetHours * HOUR_MS
  // Shift into local wall-clock by treating the UTC fields of this
  // shifted Date as the local Y/M/D/H/M.
  const local = new Date(nowUtc.getTime() + offsetMs)
  const [h, m] = hhmm.split(':').map(Number)
  let cutLocalMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    h,
    m,
  )
  if (cutLocalMs > local.getTime()) cutLocalMs -= DAY_MS
  return new Date(cutLocalMs - offsetMs)
}
