/**
 * Home-screen widget hooks — the data behind the owner's dashboard
 * cards. Each call is independently authorized on the server (POS
 * access, cashflow access, inventory access); a 403 just means the
 * widget hides instead of erroring.
 *
 * - useCashflowTodaySummary  → "Kas hari ini" widget (income/expense/net)
 * - useInventoryOverview     → "Stok menipis" widget (low-stock count)
 *
 * POS revenue + today's attendance for the home screen reuse the
 * existing hooks in pos.ts and attendance.ts — no new endpoints needed.
 */
import { useQuery } from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

interface CashflowTodaySummary {
  date: string
  income: number
  expense: number
  net: number
}

export function useCashflowTodaySummary() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['home', 'cashflow-today', tenantId],
    queryFn: () =>
      callServerFn<CashflowTodaySummary>('getCashflowTodaySummary'),
    enabled: !!tenantId,
    // 403 from the access middleware bubbles up as a thrown Error from
    // callServerFn — react-query will keep it in `error` and the
    // component can soft-hide on `isError`.
    retry: false,
  })
}

interface InventoryOverview {
  tier: string
  caps: { skuCap: number | null; branchCap: number; historyDays: number }
  usage: {
    activeItems: number
    lowStockItems: number
    branches: number
    stockValueIdr: number
  }
  features: string[]
  mainBranch: { id: string; name: string } | null
}

export function useInventoryOverview(opts?: {
  enabled?: boolean
  /** Optional outlet scope — when set, low-stock + value totals are
   *  computed for that branch only (matches the topbar outlet
   *  switcher). Omit for tenant-wide totals. */
  branchId?: string | null
}) {
  const { tenantId } = useTenant()
  const branchId = opts?.branchId ?? null
  return useQuery({
    queryKey: ['home', 'inventory-overview', tenantId, branchId],
    queryFn: () =>
      callServerFn<InventoryOverview>(
        'getInventoryOverview',
        branchId ? { branchId } : {},
      ),
    enabled: !!tenantId && (opts?.enabled ?? true),
    retry: false,
  })
}

// ─── Sales series (home chart) ──────────────────────────────────────

export type SalesPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface SalesSeriesPoint {
  bucketStart: string
  revenue: number
}

export interface SalesSeries {
  period: SalesPeriod
  points: SalesSeriesPoint[]
  current: number
  previous: number
  deltaPct: number | null
}

export function useSalesSeries(
  period: SalesPeriod,
  opts?: { branchId?: string | null },
) {
  const { tenantId } = useTenant()
  const branchId = opts?.branchId ?? null
  return useQuery({
    queryKey: ['home', 'sales-series', tenantId, period, branchId],
    queryFn: () =>
      callServerFn<SalesSeries>(
        'getSalesSeries',
        branchId ? { period, branchId } : { period },
      ),
    enabled: !!tenantId,
    retry: false,
    // Keep prior period's data visible while the new one loads so the
    // chart doesn't flash empty when switching the dropdown.
    placeholderData: (prev) => prev,
  })
}

// ─── Attendance today (Hadir Hari Ini card) ─────────────────────────

export interface AttendanceTodayOverview {
  presentCount: number
  totalCount: number
  percentage: number
}

export function useAttendanceTodayOverview(opts?: { enabled?: boolean }) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['home', 'attendance-today', tenantId],
    queryFn: () =>
      callServerFn<AttendanceTodayOverview>('getAttendanceTodayOverview'),
    enabled: !!tenantId && (opts?.enabled ?? true),
    retry: false,
  })
}
