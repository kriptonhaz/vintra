/**
 * Inventory API hooks (Phase B — read-only list).
 *
 * Server fns exposed via the mobile gateway:
 *   - listInventoryItems    → paginated items with stock + low-stock flag
 *   - listInventoryBranches → branch picker options
 *
 * Full CRUD (create/edit/stock-adjust/transfer) lands in Phase C — the
 * shape of `useInventoryItems` already supports the filter knobs that
 * Phase C will use (search, low-stock-only, per-branch).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

// ─── Items list ──────────────────────────────────────────────────────

export interface InventoryItemRow {
  id: string
  sku: string | null
  name: string
  brand: string | null
  categoryName: string | null
  categoryId: string | null
  baseUnit: { value: string; label: string }
  costPrice: number | null
  lowestBaseUnitPrice: number | null
  pricingUnitCount: number
  minStockLevel: number | null
  photoKey: string | null
  totalQuantity: number
  branchesCount: number
  /** Server-computed: minStockLevel != null && totalQuantity < minStockLevel */
  isLowStock: boolean
  recipeBacked: boolean
  isSellable: boolean
  isBookable: boolean
  isFavorite: boolean
}

interface ListResponse {
  items: InventoryItemRow[]
  total: number
  page: number
  pageSize: number
}

export interface ListItemsInput {
  branchId?: string
  search?: string
  lowStockOnly?: boolean
  page?: number
  pageSize?: number
}

export function useInventoryItems(input: ListItemsInput = {}) {
  const { tenantId } = useTenant()
  const { branchId, search, lowStockOnly, page = 1, pageSize = 50 } = input
  return useQuery({
    queryKey: [
      'inventory',
      'items',
      tenantId,
      branchId ?? null,
      search ?? '',
      lowStockOnly ?? false,
      page,
      pageSize,
    ],
    queryFn: () =>
      callServerFn<ListResponse>('listInventoryItems', {
        branchId,
        search,
        lowStockOnly,
        page,
        pageSize,
      }),
    enabled: !!tenantId,
    // Don't auto-retry on 403 (no inventory access) — bubble it so the
    // screen can render its access-denied state.
    retry: false,
  })
}

// ─── Branches picker ─────────────────────────────────────────────────

export interface InventoryBranch {
  id: string
  name: string
  address: string | null
  isActive: boolean
  stockValueIdr: number
}

interface BranchesResponse {
  branches: InventoryBranch[]
  branchCap: number | null
  branchesUsed: number
  canAdd: boolean
}

export function useInventoryBranches() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'branches', tenantId],
    queryFn: () =>
      callServerFn<BranchesResponse>('listInventoryBranches'),
    enabled: !!tenantId,
    // Branches change rarely — cache for 10 minutes.
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
}

// ─── Phase C: Form masters (units / categories / branches) ─────────

export interface FormMastersUnit {
  id: string
  value: string
  label: string
}

export interface FormMastersCategory {
  id: string
  name: string
}

export interface FormMastersBranch {
  id: string
  name: string
}

export interface FormMastersResponse {
  units: FormMastersUnit[]
  categories: FormMastersCategory[]
  branches: FormMastersBranch[]
  // The full shape has more (suppliers, hppMaterials, hppProducts) but
  // mobile only needs these three for the basic item form.
}

export function useFormMasters() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'form-masters', tenantId],
    queryFn: () =>
      callServerFn<FormMastersResponse>('listInventoryFormMasters'),
    enabled: !!tenantId,
    // Masters are stable — cache aggressively (15 minutes).
    staleTime: 15 * 60 * 1000,
    retry: false,
  })
}

// ─── Phase C: Single item (for the edit form) ───────────────────────

export interface InventoryItemDetail {
  id: string
  tenantId: string
  name: string
  sku: string | null
  brand: string | null
  categoryId: string | null
  baseUnitId: string
  costPrice: string
  franchisePrice: string | null
  minStockLevel: string | null
  photoKey: string | null
  notes: string | null
  linkedHppMaterialId: string | null
  linkedHppProductId: string | null
  isActive: boolean
  isSellable: boolean
  isBookable: boolean
  isFavorite: boolean
  // Plus extra metadata the server attaches (perBranch, recentMovements,
  // units, tiers) — typed loosely so the screen can pick what it needs.
  perBranch?: Array<{
    branch_id: string
    branch_name: string
    quantity: string
    last_movement_at: string | null
  }>
  recentMovements?: Array<{
    id: string
    movement_type: string
    quantity: string
    unit_cost: string | null
    reason: string | null
    notes: string | null
    created_at: string
    branch_name: string
  }>
}

export function useInventoryItem(id: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'item', tenantId, id],
    queryFn: () =>
      callServerFn<InventoryItemDetail>('getInventoryItem', { id: id! }),
    enabled: !!tenantId && !!id,
    retry: false,
  })
}

// ─── Phase C: Item mutations ────────────────────────────────────────

export interface ItemFormInput {
  name: string
  sku?: string | null
  brand?: string | null
  categoryId?: string | null
  baseUnitId: string
  costPrice: number
  franchisePrice?: number | null
  initialSellingPrice?: number | null
  minStockLevel?: number | null
  notes?: string | null
  isSellable?: boolean
}

interface ItemUpdateInput extends ItemFormInput {
  id: string
}

export function useCreateItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ItemFormInput) =>
      callServerFn<InventoryItemDetail>('createInventoryItem', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      void qc.invalidateQueries({ queryKey: ['home', 'inventory-overview'] })
    },
  })
}

export function useUpdateItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ItemUpdateInput) =>
      callServerFn<InventoryItemDetail>('updateInventoryItem', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

export function useDeactivateItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ ok: true }>('deactivateInventoryItem', { id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

// ─── Phase C: Stock movement ────────────────────────────────────────

export interface MovementInput {
  itemId: string
  branchId: string
  movementType: 'in' | 'out' | 'adjustment'
  quantity: number
  unitId?: string
  unitCost?: number
  reason?: string | null
  notes?: string | null
}

export function useRecordMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: MovementInput) =>
      callServerFn<{ ok: true }>('recordMovement', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      void qc.invalidateQueries({ queryKey: ['home', 'inventory-overview'] })
    },
  })
}

// ─── Phase C: Inter-branch requisitions (JUR-190) ───────────────────

export type RequisitionStatus =
  | 'pending'
  | 'approved'
  | 'fulfilled'
  | 'rejected'
  | 'cancelled'

/** Shape from listRequisitions. Trimmed — list rows only carry what
 *  the row needs to render. */
export interface RequisitionRow {
  id: string
  requisitionNumber: string
  status: RequisitionStatus
  requestingBranchName: string
  sourceBranchName: string
  createdAt: string
}

export interface RequisitionLine {
  id: string
  itemId: string
  itemName: string
  baseUnitLabel: string
  requestedQty: number
  fulfilledQty: number
  unitPrice: number | null
  notes: string | null
}

/** Shape from getRequisition. */
export interface RequisitionDetail {
  id: string
  requisitionNumber: string
  status: RequisitionStatus
  notes: string | null
  requestingBranchId: string
  requestingBranchName: string
  sourceBranchId: string
  sourceBranchName: string
  approvedAt: string | null
  fulfilledAt: string | null
  createdAt: string
  lines: RequisitionLine[]
  /** Sum of unitPrice × requestedQty across priced lines. 0 for
   *  independent (non-franchise) transfers. */
  totalCost: number
}

interface ListRequisitionsResponse {
  items: RequisitionRow[]
  total: number
  page: number
  pageSize: number
}

export function useRequisitions(
  filter: { status?: RequisitionStatus; branchId?: string } = {},
) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'requisitions', tenantId, filter],
    queryFn: () =>
      callServerFn<ListRequisitionsResponse>('listRequisitions', filter),
    enabled: !!tenantId,
    retry: false,
  })
}

export function useRequisition(id: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'requisition', tenantId, id],
    queryFn: () =>
      callServerFn<RequisitionDetail>('getRequisition', { id: id! }),
    enabled: !!tenantId && !!id,
    retry: false,
  })
}

export interface CreateRequisitionInput {
  requestingBranchId: string
  notes?: string | null
  lines: Array<{
    itemId: string
    requestedQty: number
    notes?: string | null
  }>
}

export function useCreateRequisition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateRequisitionInput) =>
      callServerFn<{ id: string; requisitionNumber: string }>(
        'createRequisition',
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory', 'requisitions'] })
    },
  })
}

export function useApproveRequisition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ ok: true }>('approveRequisition', { id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory', 'requisitions'] })
      void qc.invalidateQueries({ queryKey: ['inventory', 'requisition'] })
    },
  })
}

export function useRejectRequisition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; reason?: string }) =>
      callServerFn<{ ok: true }>('rejectRequisition', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory', 'requisitions'] })
      void qc.invalidateQueries({ queryKey: ['inventory', 'requisition'] })
    },
  })
}

export function useCancelRequisition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ ok: true }>('cancelRequisition', { id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory', 'requisitions'] })
      void qc.invalidateQueries({ queryKey: ['inventory', 'requisition'] })
    },
  })
}

export interface FulfillRequisitionInput {
  id: string
  lines: Array<{ id: string; fulfilledQty: number }>
}

export function useFulfillRequisition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: FulfillRequisitionInput) =>
      callServerFn<{ ok: true }>('fulfillRequisition', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      void qc.invalidateQueries({ queryKey: ['home', 'inventory-overview'] })
    },
  })
}

// ─── Phase D — overview, movements ledger, PO, bulk import ──────────

export type InventoryTier = 'free' | 'toko' | 'bisnis' | string

export interface InventoryOverview {
  tier: InventoryTier
  caps: {
    skuCap: number | null
    branchCap: number | null
    historyDays: number | null
  }
  usage: {
    activeItems: number
    lowStockItems: number
    branches: number
    stockValueIdr: number
  }
  features: string[]
  mainBranch: { id: string; name: string } | null
}

export function useInventoryOverview(branchId?: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'overview', tenantId, branchId ?? null],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<InventoryOverview>(
        'getInventoryOverview',
        branchId ? { branchId } : {},
        { tenantId },
      ),
  })
}

// ─── Movements ledger ───────────────────────────────────────────────

export type MovementType =
  | 'in'
  | 'out'
  | 'transfer_in'
  | 'transfer_out'
  | 'adjustment'
  | 'sale'
  | 'po_receive'
  | string

export interface MovementRow {
  id: string
  itemId: string
  itemName: string
  branchId: string
  branchName: string
  movementType: MovementType
  quantity: number
  unitCost: number | null
  reason: string | null
  notes: string | null
  createdAt: string
}

interface ListMovementsInput {
  itemId?: string
  branchId?: string
  from?: string
  page?: number
  pageSize?: number
}

interface ListMovementsResponse {
  items: MovementRow[]
  total: number
  page: number
  pageSize: number
  historyClampedToDays: number | null
}

export function useInventoryMovements(input: ListMovementsInput = {}) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'movements', tenantId, input],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ListMovementsResponse>(
        'listInventoryMovements',
        input,
        { tenantId },
      ),
  })
}

export function useDeleteMovement() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteMovement',
        { id },
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

// ─── HPP import candidates ──────────────────────────────────────────

export interface HppImportUnit {
  id: string
  value: string
  label: string
}

export interface HppMaterialCandidate {
  id: string
  name: string
  brand: string | null
  unitId: string
  unitLabel: string
  pricePerUnit: string
  alreadyImported: boolean
}

export interface HppProductCandidate {
  id: string
  name: string
  category: string | null
  sellingPrice: string
  /** Cost of one FULL BATCH (productionQty units) — not what an item costs. */
  hpp: string | null
  /**
   * `hpp` divided by the batch yield: the figure that actually becomes the
   * inventory item's Modal. Show this, not `hpp`, or the number changes the
   * moment the product is imported.
   */
  hppPerUnit: number | null
  alreadyImported: boolean
}

export interface HppImportPayload {
  units: HppImportUnit[]
  skuCap: number | null
  skuCount: number
  materials: HppMaterialCandidate[]
  products: HppProductCandidate[]
}

export function useHppImportCandidates() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'hpp-import', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<HppImportPayload>(
        'getHppImportCandidates',
        {},
        { tenantId },
      ),
  })
}

interface BulkImportInput {
  source: 'material' | 'product'
  items: Array<{
    hppId: string
    baseUnitId: string
    minStockLevel?: number | null
    isSellable: boolean
    isBookable: boolean
  }>
}

export function useBulkImportFromHpp() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BulkImportInput) =>
      callServerFn<{ createdCount: number; skipped: number }>(
        'bulkCreateInventoryItemsFromHpp',
        input,
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

// ─── Purchase Orders ────────────────────────────────────────────────

export type POStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled' | string

export interface PurchaseOrderRow {
  id: string
  poNumber: string
  status: POStatus
  subtotal: number
  expectedAt: string | null
  receivedAt: string | null
  createdAt: string
  supplierId: string
  supplierName: string
  branchId: string
  branchName: string
}

interface ListPOInput {
  status?: POStatus
  supplierId?: string
  branchId?: string
  page?: number
  pageSize?: number
}

interface ListPOResponse {
  items: PurchaseOrderRow[]
  total: number
  page: number
  pageSize: number
}

export function usePurchaseOrders(input: ListPOInput = {}) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'po-list', tenantId, input],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ListPOResponse>(
        'listPurchaseOrders',
        input,
        { tenantId },
      ),
  })
}

export interface POLine {
  id: string
  itemId: string
  itemName: string
  sku: string | null
  orderedQty: number
  receivedQty: number
  unitCost: number
  sellingPrice: number | null
  subtotal: number
  notes: string | null
  baseUnitLabel: string
  unitId: string | null
  unitRatio: number
  unitLabel: string
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  notes: string | null
  lines: POLine[]
}

export function usePurchaseOrder(id: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'po', tenantId, id],
    enabled: !!tenantId && !!id,
    queryFn: () =>
      callServerFn<PurchaseOrderDetail>(
        'getPurchaseOrder',
        { id },
        { tenantId },
      ),
  })
}

interface CreatePOInput {
  branchId: string
  supplierId: string
  expectedAt?: string | null
  notes?: string | null
  lines: Array<{
    itemId: string
    unitId?: string | null
    orderedQty: number
    unitCost: number
    subtotal?: number | null
  }>
}

export function useCreatePO() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePOInput) =>
      callServerFn<PurchaseOrderRow>(
        'createPurchaseOrder',
        input,
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory', 'po-list'] })
    },
  })
}

export function useSendPO() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<PurchaseOrderDetail>(
        'sendPurchaseOrder',
        { id },
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

export function useCancelPO() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; reason?: string }) =>
      callServerFn<PurchaseOrderDetail>(
        'cancelPurchaseOrder',
        input,
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

interface ReceivePOInput {
  id: string
  lines: Array<{ poItemId: string; receivedQty: number }>
}

export function useReceivePO() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ReceivePOInput) =>
      callServerFn<PurchaseOrderDetail>(
        'receivePurchaseOrder',
        input,
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

export interface POItemUnit {
  unitId: string
  unitLabel: string
  ratioToBase: number
  isDefault: boolean
}

export interface POItemOption {
  id: string
  name: string
  sku: string | null
  costPrice: number | null
  baseUnitLabel: string
  units: POItemUnit[]
}

export function usePOItems() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['inventory', 'po-items', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<POItemOption[]>('listItemsForPO', {}, { tenantId }),
  })
}
