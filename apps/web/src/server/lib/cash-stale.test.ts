import { describe, expect, it } from 'bun:test'
import { isSessionStale, mostRecentCutoffUtc } from './cash-stale'

// WIB (UTC+7) wall-clock → UTC Date. June has no DST anywhere in
// Indonesia, so this is exact.
const wib = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h - 7, mi))

describe('isSessionStale — elapsed_hours', () => {
  const cfg = { mode: 'elapsed_hours' as const, hours: 14 }
  const opened = wib(2026, 6, 5, 8, 9) // 08:09 WIB

  it('not stale before the threshold', () => {
    expect(isSessionStale(cfg, opened, wib(2026, 6, 5, 21, 0))).toBe(false) // ~12.8h
  })

  it('stale once past the threshold', () => {
    expect(isSessionStale(cfg, opened, wib(2026, 6, 5, 22, 29))).toBe(true) // ~14.3h
  })
})

describe('isSessionStale — daily_cutoff 01:00 (Es Teh Paus)', () => {
  const cfg = { mode: 'daily_cutoff' as const, cutoff: '01:00' }
  const opened = wib(2026, 6, 5, 8, 9) // morning shift opened 08:09 WIB

  it('same business day → not stale at closing time', () => {
    expect(isSessionStale(cfg, opened, wib(2026, 6, 5, 22, 29))).toBe(false)
  })

  it('past midnight but before the 01:00 cutoff → still same day', () => {
    expect(isSessionStale(cfg, opened, wib(2026, 6, 6, 0, 30))).toBe(false)
  })

  it('after the 01:00 cutoff → stale (carried into a new day)', () => {
    expect(isSessionStale(cfg, opened, wib(2026, 6, 6, 1, 30))).toBe(true)
  })
})

describe('isSessionStale — early-morning guard (minHours)', () => {
  const cfg = { mode: 'daily_cutoff' as const, cutoff: '01:00', minHours: 4 }
  const opened = wib(2026, 6, 6, 0, 30) // opened 00:30 WIB, just before cutoff

  it('crossed the cutoff but open < minHours → not yet stale', () => {
    expect(isSessionStale(cfg, opened, wib(2026, 6, 6, 1, 30))).toBe(false) // 1h open
  })

  it('crossed the cutoff and open >= minHours → stale', () => {
    expect(isSessionStale(cfg, opened, wib(2026, 6, 6, 5, 0))).toBe(true) // 4.5h open
  })
})

describe('mostRecentCutoffUtc', () => {
  it('returns today\'s cutoff when now is after it (local)', () => {
    // now 6 Jun 01:30 WIB → most recent 01:00 boundary is 6 Jun 01:00 WIB
    expect(mostRecentCutoffUtc(wib(2026, 6, 6, 1, 30), '01:00')).toEqual(
      wib(2026, 6, 6, 1, 0),
    )
  })

  it('steps back a day when today\'s cutoff is still ahead (local)', () => {
    // now 6 Jun 00:30 WIB → most recent 01:00 boundary is 5 Jun 01:00 WIB
    expect(mostRecentCutoffUtc(wib(2026, 6, 6, 0, 30), '01:00')).toEqual(
      wib(2026, 6, 5, 1, 0),
    )
  })
})
