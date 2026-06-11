/**
 * Cashflow (Arus Kas) API hooks — wraps every server fn for the 6
 * mobile cashflow screens: dashboard, entries (catatan), categories,
 * accounts + transfers, receivables (bon), payables (cicilan).
 *
 * Numbers from postgres `numeric` come back as strings — the server
 * already number-ifies most aggregates, but per-row amount fields can
 * be either depending on the fn. Each interface annotates the actual
 * shape; coerce at call sites with Number().
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

// ─── Access gate ────────────────────────────────────────────────────

/** Income/expense rollup for the cashflow tab's home "Hari ini" card. */
export interface CashflowTodaySummary {
  income: number
  expense: number
}

export function useHomeCashflow() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['home', 'cashflow-today', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<CashflowTodaySummary>(
        'getCashflowTodaySummary',
        {},
        { tenantId },
      ),
  })
}

export function useCashflowOverview() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'overview', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<{ hasAccess: boolean }>(
        'getCashflowOverview',
        {},
        { tenantId },
      ),
  })
}

// ─── Categories ─────────────────────────────────────────────────────

export type CashflowKind = 'income' | 'expense'

export interface CashflowCategory {
  id: string
  tenantId: string | null
  name: string
  kind: CashflowKind
  isSystem: boolean
}

export function useCashflowCategories() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'categories', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<CashflowCategory[]>(
        'listCashflowCategories',
        {},
        { tenantId },
      ),
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['cashflow'] })
  void qc.invalidateQueries({ queryKey: ['home', 'cashflow-today'] })
}

export function useCreateCashflowCategory() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; kind: CashflowKind }) =>
      callServerFn<{ id: string }>(
        'createCashflowCategory',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateCashflowCategory() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      callServerFn<{ success: true }>(
        'updateCashflowCategory',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteCashflowCategory() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteCashflowCategory',
        { id },
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

// ─── Entries (catatan kas) ──────────────────────────────────────────

export interface CashflowEntry {
  id: string
  date: string
  type: CashflowKind
  amount: string
  note: string | null
  source: string
  sourceRef: string | null
  categoryId: string
  categoryName: string
  accountId: string
  accountName: string
  branchId: string | null
  branchName: string | null
}

export interface ListEntriesInput {
  from: string
  to: string
  type?: CashflowKind
  branchId?: string
  categoryId?: string
  accountId?: string
  hidePos?: boolean
  page?: number
}

export interface ListEntriesResponse {
  items: CashflowEntry[]
  total: number
  page: number
  pageSize: number
  totals: { income: number; expense: number; net: number }
}

export function useCashflowEntries(input: ListEntriesInput) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'entries', tenantId, input],
    enabled: !!tenantId && !!input.from && !!input.to,
    queryFn: () =>
      callServerFn<ListEntriesResponse>(
        'listCashflowEntries',
        input,
        { tenantId },
      ),
  })
}

export interface EntryInput {
  type: CashflowKind
  categoryId: string
  accountId?: string | null
  amount: number
  date: string
  branchId?: string | null
  note?: string | null
}

export function useCreateCashflowEntry() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: EntryInput) =>
      callServerFn<{ id: string }>(
        'createCashflowEntry',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateCashflowEntry() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: EntryInput & { id: string }) =>
      callServerFn<{ success: true }>(
        'updateCashflowEntry',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteCashflowEntry() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteCashflowEntry',
        { id },
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

// ─── Accounts ───────────────────────────────────────────────────────

export type CashflowAccountKind = 'cash' | 'bank' | 'ewallet' | 'other'

export interface CashflowAccount {
  id: string
  name: string
  kind: CashflowAccountKind
  openingBalance: number
  isDefault: boolean
  isActive: boolean
  balance: number
}

export function useCashflowAccounts() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'accounts', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<CashflowAccount[]>(
        'listCashflowAccounts',
        {},
        { tenantId },
      ),
  })
}

interface AccountInput {
  name: string
  kind: CashflowAccountKind
  openingBalance?: number
}

export function useCreateCashflowAccount() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AccountInput) =>
      callServerFn<{ id: string }>(
        'createCashflowAccount',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateCashflowAccount() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; name?: string; isActive?: boolean }) =>
      callServerFn<{ success: true }>(
        'updateCashflowAccount',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteCashflowAccount() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteCashflowAccount',
        { id },
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export interface CashflowTransfer {
  id: string
  amount: string
  date: string
  note: string | null
  fromName: string
  toName: string
  createdAt: string
}

export function useCashflowTransfers() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'transfers', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<CashflowTransfer[]>(
        'listCashflowTransfers',
        {},
        { tenantId },
      ),
  })
}

interface TransferInput {
  fromAccountId: string
  toAccountId: string
  amount: number
  date: string
  note?: string | null
}

export function useCreateCashflowTransfer() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TransferInput) =>
      callServerFn<{ id: string }>(
        'createCashflowTransfer',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

// ─── Dashboard ──────────────────────────────────────────────────────

export interface CashflowDashboardResponse {
  income: number
  expense: number
  net: number
  cashPosition: number
  categoryBreakdown: Array<{
    categoryId: string
    categoryName: string
    kind: CashflowKind
    amount: number
  }>
  dailyTrend: Array<{ date: string; income: number; expense: number }>
  ar: { outstanding: number; overdueCount: number }
  ap: { outstanding: number; dueThisMonth: number }
}

export function useCashflowDashboard(input: {
  from: string
  to: string
  branchId?: string
}) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'dashboard', tenantId, input],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<CashflowDashboardResponse>(
        'getCashflowDashboard',
        input,
        { tenantId },
      ),
  })
}

// ─── Receivables (bon) ──────────────────────────────────────────────

export interface ReceivableRow {
  id: string
  customerId: string | null
  customerName: string
  customerPhone: string | null
  totalAmount: number
  paidAmount: number
  outstanding: number
  dueDate: string | null
  daysOverdue: number
  note: string | null
  isSettled: boolean
  createdAt: string
}

export function useReceivables(input: { settled?: boolean; search?: string } = {}) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'receivables', tenantId, input],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ReceivableRow[]>(
        'listReceivables',
        input,
        { tenantId },
      ),
  })
}

export interface ArCustomerOption {
  id: string
  name: string
  phone: string | null
}

export function useArCustomerOptions() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'ar-customer-options', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ArCustomerOption[]>(
        'listArCustomerOptions',
        {},
        { tenantId },
      ),
  })
}

export function useReceivablePayments(receivableId: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'ar-payments', tenantId, receivableId],
    enabled: !!tenantId && !!receivableId,
    queryFn: () =>
      callServerFn<
        Array<{ id: string; amount: number; date: string; note: string | null }>
      >('getReceivablePayments', { receivableId }, { tenantId }),
  })
}

interface CreateReceivableInput {
  customerId?: string | null
  customerName: string
  customerPhone?: string | null
  totalAmount: number
  dueDate?: string | null
  note?: string | null
  date: string
}

export function useCreateReceivable() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateReceivableInput) =>
      callServerFn<{ id: string }>('createReceivable', input, { tenantId }),
    onSuccess: () => invalidateAll(qc),
  })
}

interface ArPaymentInput {
  receivableId: string
  amount: number
  date: string
  note?: string | null
  accountId?: string | null
}

export function useRecordArPayment() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ArPaymentInput) =>
      callServerFn<{ id: string }>('recordArPayment', input, { tenantId }),
    onSuccess: () => invalidateAll(qc),
  })
}

// ─── Payables (cicilan) ─────────────────────────────────────────────

export interface PayableInstallment {
  id: string
  installmentNo: number
  dueDate: string
  amount: number
  status: 'pending' | 'paid' | 'overdue' | string
  paidAt: string | null
}

export interface PayableRow {
  id: string
  supplierId: string | null
  supplierName: string
  description: string | null
  totalAmount: number
  paidAmount: number
  outstanding: number
  remindersEnabled: boolean
  isSettled: boolean
  createdAt: string
  installments: PayableInstallment[]
}

export function usePayables(input: { settled?: boolean } = {}) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'payables', tenantId, input],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<PayableRow[]>(
        'listPayables',
        input,
        { tenantId },
      ),
  })
}

export interface CicilanSupplierOption {
  id: string
  name: string
}

export function useCicilanSuppliers() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'cicilan-suppliers', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<CicilanSupplierOption[]>(
        'listCicilanSuppliers',
        {},
        { tenantId },
      ),
  })
}

interface CreatePayableInput {
  supplierId?: string | null
  supplierName: string
  description?: string | null
  totalAmount: number
  startDate: string
  cadence: 'one_off' | 'monthly'
  installmentCount: number
  remindersEnabled?: boolean
}

export function useCreatePayable() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePayableInput) =>
      callServerFn<{ id: string }>('createPayable', input, { tenantId }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useMarkInstallmentPaid() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      installmentId: string
      paidAt: string
      accountId?: string | null
      note?: string | null
    }) =>
      callServerFn<{ success: true }>(
        'markInstallmentPaid',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useTogglePayableReminders() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { payableId: string; enabled: boolean }) =>
      callServerFn<{ success: true }>(
        'togglePayableReminders',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

// ─── Branches (shared with attendance, but cashflow-scoped fn) ─────

export interface CashflowBranchOption {
  id: string
  name: string
}

export function useCashflowBranches() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['cashflow', 'branches', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<CashflowBranchOption[]>(
        'listCashflowBranches',
        {},
        { tenantId },
      ),
  })
}
