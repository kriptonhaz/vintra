/**
 * Master data hooks: branches, suppliers, categories, customers.
 * Wrap the gateway-exposed server fns. Suppliers + categories piggyback
 * the HPP server fns (same tables on web).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

// ─── Branches ──────────────────────────────────────────────────────

export type ScheduleMode = 'shared' | 'per_resource' | string

export interface MasterBranch {
  id: string
  name: string
  address: string | null
  phoneNumber: string | null
  isMain: boolean
  isActive: boolean
  scheduleMode: ScheduleMode
  latitude: string | null
  longitude: string | null
  radiusMeters: number | null
}

export function useMasterBranches() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['master', 'branches', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<MasterBranch[]>(
        'listMasterBranches',
        {},
        { tenantId },
      ),
  })
}

export interface BranchContext {
  branches: MasterBranch[]
  branchCap: number | null
  canAddBranch: boolean
  modules: Array<{ key: string; label: string; active: boolean }>
}

export function useBranchManagementContext() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['master', 'branch-ctx', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<BranchContext>(
        'getBranchManagementContext',
        {},
        { tenantId },
      ),
  })
}

interface UpsertBranchInput {
  id?: string
  name: string
  address?: string | null
  phoneNumber?: string | null
  latitude?: number | null
  longitude?: number | null
  radiusMeters?: number | null
  isActive?: boolean
}

function inv(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['master'] })
  void qc.invalidateQueries({ queryKey: ['booking'] })
  void qc.invalidateQueries({ queryKey: ['attendance'] })
}

export function useCreateMasterBranch() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<UpsertBranchInput, 'id'>) =>
      callServerFn<MasterBranch>('createBranch', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useUpdateMasterBranch() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertBranchInput & { id: string }) =>
      callServerFn<MasterBranch>('updateBranch', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteMasterBranch() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteBranch',
        { id },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

// ─── Suppliers (reuses HPP table) ─────────────────────────────────

export interface MasterSupplier {
  id: string
  name: string
  address: string | null
  phoneNumber: string | null
  personInCharge: string | null
  notes: string | null
}

export function useMasterSuppliers() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['master', 'suppliers', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<MasterSupplier[]>('getSuppliers', {}, { tenantId }),
  })
}

interface UpsertSupplierInput {
  id?: string
  name: string
  address?: string | null
  phoneNumber?: string | null
  personInCharge?: string | null
  notes?: string | null
}

export function useCreateMasterSupplier() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<UpsertSupplierInput, 'id'>) =>
      callServerFn<MasterSupplier>('createSupplier', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useUpdateMasterSupplier() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertSupplierInput & { id: string }) =>
      callServerFn<MasterSupplier>('updateSupplier', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteMasterSupplier() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteSupplier',
        { id },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

// ─── Categories (HPP tenant categories) ───────────────────────────

export interface MasterCategory {
  id: string
  name: string
  sortOrder: number
  isVisibleOnSitus: boolean
}

export function useMasterCategories() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['master', 'categories', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<MasterCategory[]>(
        'getTenantCategories',
        {},
        { tenantId },
      ),
  })
}

export function useCreateMasterCategory() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      sortOrder?: number
      isVisibleOnSitus?: boolean
    }) =>
      callServerFn<MasterCategory>(
        'createTenantCategory',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useUpdateMasterCategory() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      name?: string
      sortOrder?: number
      isVisibleOnSitus?: boolean
    }) =>
      callServerFn<MasterCategory>(
        'updateTenantCategory',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteMasterCategory() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteTenantCategory',
        { id },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

// ─── Customers ────────────────────────────────────────────────────

export interface MasterCustomer {
  id: string
  tenantId: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface ListCustomersResponse {
  items: MasterCustomer[]
  total: number
  page: number
  pageSize: number
}

export function useMasterCustomers(input: {
  search?: string
  page?: number
  pageSize?: number
}) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['master', 'customers', tenantId, input],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ListCustomersResponse>(
        'listCustomers',
        input,
        { tenantId },
      ),
  })
}

export function useMasterCustomer(id: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['master', 'customer', tenantId, id],
    enabled: !!tenantId && !!id,
    queryFn: () =>
      callServerFn<MasterCustomer>('getCustomer', { id }, { tenantId }),
  })
}

interface UpsertCustomerInput {
  id?: string
  name: string
  phone?: string | null
  email?: string | null
  notes?: string | null
}

export function useUpsertMasterCustomer() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertCustomerInput) =>
      callServerFn<MasterCustomer>('upsertCustomer', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteMasterCustomer() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteCustomer',
        { id },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}
