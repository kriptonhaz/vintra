/**
 * Peti Kas (cash session) hooks. Calls the existing pos-cash server fns
 * via the mobile gateway. Cash sales auto-record into the open session
 * server-side, so the app only drives open / manual cash in-out / close.
 *
 * Numeric fields arrive as strings from postgres `numeric` — coerce with
 * Number() at the callsite.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

export interface CashSession {
  id: string
  branchId: string
  status: string
  openingBalance: string
  openingNotes: string | null
  openedAt: string
  cashInTotal: string
  cashOutTotal: string
}

export interface CashMovement {
  id: string
  /** 'sale' | 'refund' | 'drop' | 'payout' */
  type: string
  amount: string
  reason: string | null
  referenceSaleNumber: string | null
  createdAt: string
}

interface ActiveCashSessionResponse {
  session: CashSession | null
  movements: CashMovement[]
}

export interface CloseSessionResult {
  expectedClosing: number
  actualClosing: number
  variance: number
}

function cashSessionKey(tenantId: string | null, branchId: string) {
  return ['pos', 'cash-session', tenantId, branchId] as const
}

// ─── History list (standalone screen) ───────────────────────────────

export interface CashSessionListRow {
  id: string
  branchId: string
  branchName: string
  cashierUserId: string
  cashierFirstName: string | null
  cashierLastName: string | null
  status: 'open' | 'closed' | string
  openingBalance: string
  openedAt: string
  expectedClosing: string | null
  actualClosing: string | null
  variance: string | null
  closedAt: string | null
  forceClosed: boolean
}

interface ListCashSessionsResponse {
  sessions: CashSessionListRow[]
  total: number
}

interface ListCashSessionsInput {
  from?: string
  to?: string
  branchId?: string
  status?: 'open' | 'closed' | 'all'
  hasVarianceOnly?: boolean
  page?: number
  pageSize?: number
}

export function useCashSessionsList(input: ListCashSessionsInput = {}) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'cash-sessions-list', tenantId, input],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ListCashSessionsResponse>(
        'listCashSessions',
        input,
        { tenantId },
      ),
  })
}

export interface CashSessionDetailRow extends CashSessionListRow {
  openingNotes: string | null
  closingNotes: string | null
  cashInTotal: string
  cashOutTotal: string
}

interface CashSessionDetailResponse {
  session: CashSessionDetailRow | null
  movements: CashMovement[]
}

export function useCashSessionDetail(sessionId: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'cash-session-detail', tenantId, sessionId],
    enabled: !!tenantId && !!sessionId,
    queryFn: () =>
      callServerFn<CashSessionDetailResponse>(
        'getCashSessionDetail',
        { sessionId },
        { tenantId },
      ),
  })
}

export function useActiveCashSession(branchId: string, enabled = true) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: cashSessionKey(tenantId, branchId),
    enabled: !!tenantId && !!branchId && enabled,
    retry: false,
    queryFn: () =>
      callServerFn<ActiveCashSessionResponse>(
        'getActiveCashSession',
        { branchId },
        { tenantId },
      ),
  })
}

export function useOpenCashSession() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      branchId: string
      openingBalance: number
      openingNotes?: string
    }) => callServerFn<{ id: string }>('openCashSession', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos'] })
    },
  })
}

export function useRecordCashDrop() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { sessionId: string; amount: number; reason: string }) =>
      callServerFn<{ ok: true }>('recordCashDrop', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', 'cash-session'] })
    },
  })
}

export function useRecordCashPayout() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      sessionId: string
      amount: number
      reason: string
      /** Cashflow expense category; omit to use the default "Pengeluaran Kas". */
      categoryId?: string
    }) => callServerFn<{ ok: true }>('recordCashPayout', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', 'cash-session'] })
    },
  })
}

export interface CashflowCategory {
  id: string
  name: string
  kind: 'income' | 'expense'
  isSystem: boolean
}

/**
 * Expense categories for the Tarik Tunai picker — the same list curated
 * on web under Arus Kas → Kategori. Tarik Tunai books a cashflow expense,
 * so the cashier tags it here. Rarely changes → long staleTime.
 */
export function useExpenseCategories(enabled = true) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'categories', 'expense', tenantId],
    enabled: !!tenantId && enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const all = await callServerFn<CashflowCategory[]>(
        'listCashflowCategories',
        {},
        { tenantId },
      )
      return all.filter((c) => c.kind === 'expense')
    },
  })
}

export function useCloseCashSession() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      sessionId: string
      actualClosing: number
      closingNotes?: string
      forceClosed?: boolean
    }) =>
      callServerFn<CloseSessionResult>('closeCashSession', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos'] })
    },
  })
}

/** Running expected cash for an open session: opening + cash in − cash out. */
export function expectedCash(session: CashSession): number {
  return (
    Number(session.openingBalance) +
    Number(session.cashInTotal) -
    Number(session.cashOutTotal)
  )
}
