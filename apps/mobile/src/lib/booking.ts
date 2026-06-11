/**
 * Booking API hooks — reservation + queue management for a tenant.
 * Mobile renders a day-list (one card per booking) instead of the
 * desktop calendar grid.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

export type BookingMode = 'slot' | 'queue' | 'stay'
export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | string

export interface BookingSettings {
  tenantId: string
  mode: BookingMode
  slotDurationMin: number
  maxConcurrentSlots: number | null
  blackoutDates: string[] | null
  setupCompleted: boolean
}

export interface BookingResource {
  id: string
  name: string
  color: string | null
  isActive: boolean
  memberId: string | null
}

export interface BookingService {
  id: string
  name: string
  color: string | null
  durationMinutes: number | null
  basePrice: number | null
  recipeBacked: boolean
}

export interface BookingRow {
  id: string
  tenantId: string
  branchId: string | null
  customerId: string | null
  publicName: string | null
  publicPhone: string | null
  resourceId: string | null
  startAt: string
  endAt: string | null
  status: BookingStatus
  note: string | null
  source: string
}

export interface BookingBranchOption {
  id: string
  name: string
}

function inv(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['booking'] })
}

export function useBookingSettings() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['booking', 'settings', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<BookingSettings | null>(
        'getBookingSettings',
        {},
        { tenantId },
      ),
  })
}

export interface BookingSettingsState {
  settings: BookingSettings | null
  resources: Array<BookingResource & {
    memberFirstName: string | null
    memberLastName: string | null
  }>
  members: Array<{
    userId: string
    firstName: string | null
    lastName: string | null
    isBookable: boolean
    resourceId: string | null
  }>
}

export function useBookingSettingsState() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['booking', 'settings-state', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<BookingSettingsState>(
        'getBookingSettingsState',
        {},
        { tenantId },
      ),
  })
}

export function useBookingResources() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['booking', 'resources', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<BookingResource[]>(
        'getBookingResources',
        {},
        { tenantId },
      ),
  })
}

export function useBookingServices() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['booking', 'services', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<BookingService[]>(
        'getBookingServices',
        {},
        { tenantId },
      ),
  })
}

export function useBookings(range: { startDate: string; endDate: string }) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['booking', 'list', tenantId, range],
    enabled: !!tenantId && !!range.startDate && !!range.endDate,
    refetchInterval: 30_000,
    queryFn: () =>
      callServerFn<BookingRow[]>('getBookings', range, { tenantId }),
  })
}

export function useBookingBranches() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['booking', 'branches', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<BookingBranchOption[]>(
        'listBookingBranches',
        {},
        { tenantId },
      ),
  })
}

export function useSearchBookingCustomers(q: string, enabled = true) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['booking', 'customer-search', tenantId, q],
    enabled: !!tenantId && enabled && q.length >= 2,
    queryFn: () =>
      callServerFn<
        Array<{
          id: string
          name: string
          phone: string | null
        }>
      >('searchBookingCustomers', { q }, { tenantId }),
  })
}

interface CreateBookingInput {
  branchId?: string | null
  customerId?: string
  publicName?: string
  publicPhone?: string
  startAt: string
  resourceId: string
  serviceIds: string[]
  note?: string
  source?: 'walk_in' | 'public_page' | 'wa' | 'manual'
}

export function useCreateBooking() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateBookingInput) =>
      callServerFn<BookingRow>('createBooking', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useUpdateBookingStatus() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; status: BookingStatus }) =>
      callServerFn<{ success: true }>(
        'updateBookingStatus',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteBooking() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteBooking',
        { id },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

interface SaveSettingsInput {
  mode: BookingMode
  slotDurationMin: number
  maxConcurrentSlots?: number | null
  blackoutDates?: string[]
}

export function useSaveBookingSettings() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveSettingsInput) =>
      callServerFn<{ success: true }>(
        'saveBookingSettings',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useToggleMemberBookable() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { userId: string; bookable: boolean }) =>
      callServerFn<{ success: true }>(
        'toggleMemberBookable',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useAddBookingStaff() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; color?: string }) =>
      callServerFn<BookingResource>('addBookingStaff', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteBookingResource() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (resourceId: string) =>
      callServerFn<{ success: true }>(
        'deleteBookingResource',
        { resourceId },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}
