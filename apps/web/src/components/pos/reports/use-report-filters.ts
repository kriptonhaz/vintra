import * as React from 'react'

export type Preset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom'

export const PRESET_LABEL: Record<Preset, string> = {
  today: 'Hari ini',
  yesterday: 'Kemarin',
  last7: '7 hari',
  last30: '30 hari',
  thisMonth: 'Bulan ini',
  lastMonth: 'Bulan lalu',
  custom: 'Custom',
}

// Jakarta-zone (UTC+7) YYYY-MM-DD for the requested preset. Mirrors
// the inline implementation that previously lived in
// reports.index.tsx — every report route shares this so users see the
// same numbers regardless of which surface they opened.
export function presetRange(
  preset: Preset,
  custom?: { from: string; to: string },
): { from: string; to: string } {
  const now = new Date()
  const jakartaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const ymd = (d: Date) => d.toISOString().slice(0, 10)

  switch (preset) {
    case 'today':
      return { from: ymd(jakartaNow), to: ymd(jakartaNow) }
    case 'yesterday': {
      const y = new Date(jakartaNow)
      y.setUTCDate(y.getUTCDate() - 1)
      return { from: ymd(y), to: ymd(y) }
    }
    case 'last7': {
      const start = new Date(jakartaNow)
      start.setUTCDate(start.getUTCDate() - 6)
      return { from: ymd(start), to: ymd(jakartaNow) }
    }
    case 'last30': {
      const start = new Date(jakartaNow)
      start.setUTCDate(start.getUTCDate() - 29)
      return { from: ymd(start), to: ymd(jakartaNow) }
    }
    case 'thisMonth': {
      const start = new Date(
        Date.UTC(jakartaNow.getUTCFullYear(), jakartaNow.getUTCMonth(), 1),
      )
      return { from: ymd(start), to: ymd(jakartaNow) }
    }
    case 'lastMonth': {
      const start = new Date(
        Date.UTC(jakartaNow.getUTCFullYear(), jakartaNow.getUTCMonth() - 1, 1),
      )
      const end = new Date(
        Date.UTC(jakartaNow.getUTCFullYear(), jakartaNow.getUTCMonth(), 0),
      )
      return { from: ymd(start), to: ymd(end) }
    }
    case 'custom':
      return custom ?? { from: ymd(jakartaNow), to: ymd(jakartaNow) }
  }
}

/**
 * Filter state shared by every /pos/reports/* route. Date inputs are
 * deferred to a mount effect so SSR and the client hydration pass
 * produce identical markup (otherwise a day-boundary render fires
 * React hydration error #418, same gotcha that lives in the inline
 * reports.index.tsx version).
 */
export function useReportFilters() {
  const [preset, setPresetState] = React.useState<Preset>('last7')
  const [from, setFromState] = React.useState('')
  const [to, setToState] = React.useState('')
  const [branchId, setBranchId] = React.useState('')

  React.useEffect(() => {
    const r = presetRange('last7')
    setFromState(r.from)
    setToState(r.to)
  }, [])

  function applyPreset(p: Preset) {
    setPresetState(p)
    if (p !== 'custom') {
      const r = presetRange(p)
      setFromState(r.from)
      setToState(r.to)
    }
  }

  function setFrom(v: string) {
    setFromState(v)
    setPresetState('custom')
  }
  function setTo(v: string) {
    setToState(v)
    setPresetState('custom')
  }

  return {
    preset,
    from,
    to,
    branchId,
    applyPreset,
    setFrom,
    setTo,
    setBranchId,
  }
}

export type ReportFiltersState = ReturnType<typeof useReportFilters>
