/**
 * Attendance API + helpers. Calls the existing server fns in
 * apps/web/src/server/functions/attendance-checkin.ts — no new
 * backend code needed.
 *
 * Server fns surfaced here:
 *   - getMyTodayStatus  → one-shot fetch of profile + branch + today's record
 *   - submitClockIn     → POST { lat, lng, photoDataUrl }
 *   - submitClockOut    → POST { lat, lng, photoDataUrl }
 *
 * The web's getMyTodayStatus encapsulates ALL the screen needs in
 * one call — profile, branch, today's schedule, today's record,
 * settings, jakarta date. Mobile mirrors that single-fetch design.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

// ─── Server response shapes ──────────────────────────────────────────
// Sourced from `attendance-checkin.ts` getMyTodayStatus return type.
// Kept loose (`unknown` for nested objects we don't render yet) to
// avoid duplicating the entire web schema — only fields the mobile
// screens actually read are typed.

export interface AttendanceBranch {
  id: string
  name: string
  address: string | null
  latitude: string // numeric arrives as string from postgres
  longitude: string
  radiusMeters: number
}

export interface AttendanceProfile {
  id: string
  isActive: boolean
  branchId: string | null
  fullName: string | null
}

export interface AttendanceRecord {
  id: string
  date: string
  branchId: string | null
  clockInAt: string | null
  clockOutAt: string | null
  clockInStatus: string | null
  clockOutStatus: string | null
}

/** Per-branch today status for the multi-outlet chip strip. */
export interface AccessibleBranchToday {
  id: string
  name: string
  isMain: boolean
  status: 'pending' | 'clocked-in' | 'clocked-out'
}

export interface AttendanceSettings {
  modeGpsEnabled: boolean
  modePhotoEnabled: boolean
  modeQrEnabled: boolean
}

export interface TodaySchedule {
  isWorkDay: boolean
  /** Scheduled clock-in, "HH:mm:ss" (Jakarta) or null on schedule-less branches. */
  clockInTime: string | null
  /** Scheduled clock-out, "HH:mm:ss" (Jakarta) or null. */
  clockOutTime: string | null
}

export interface TodayStatus {
  hasProfile: boolean
  profile: AttendanceProfile | null
  branch: AttendanceBranch | null
  /** True when `branch` was overridden from the topbar branch picker
   *  (i.e. the staff is visiting an outlet that isn't their pinned
   *  home branch). */
  isVisiting: boolean
  todaySchedule: TodaySchedule | null
  /** Today's record at the resolved branch — clock-in / clock-out
   *  state for the active outlet only. */
  todayRecord: AttendanceRecord | null
  /** Every branch the caller may operate, each with their today
   *  status. Drives the per-outlet chip strip. */
  accessibleBranches: AccessibleBranchToday[]
  settings: AttendanceSettings | null
  jakartaDate: string
}

// ─── Hooks ───────────────────────────────────────────────────────────

export function useTodayStatus(opts?: {
  enabled?: boolean
  /** Visiting-branch override from the outlet picker. When omitted,
   *  the server returns today's status for the staff's pinned home
   *  branch (matches pre-multi-outlet behavior). */
  branchId?: string | null
}) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['attendance', 'today', tenantId, opts?.branchId ?? ''],
    enabled: !!tenantId && (opts?.enabled ?? true),
    queryFn: () =>
      callServerFn<TodayStatus>(
        'getMyTodayStatus',
        { branchId: opts?.branchId ?? undefined },
        { tenantId },
      ),
    // Re-fetch on focus — staff coming back to the tab after their
    // shift starts should see the updated schedule + check-in button.
    refetchOnWindowFocus: true,
  })
}

interface ClockSubmitInput {
  lat: number
  lng: number
  photoDataUrl: string
  /** Visiting-branch override — mirrors the web's submit payload. */
  branchId?: string
}

export function useClockIn() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ClockSubmitInput) =>
      callServerFn('submitClockIn', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

export function useClockOut() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ClockSubmitInput) =>
      callServerFn('submitClockOut', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

export interface AttendanceHistoryRecord {
  id: string
  date: string
  /** Branch the record is attributed to. Multi-outlet supervisors get
   *  one row per branch per day. Nullable because branch deletion
   *  cascades to NULL on the FK. */
  branchId: string | null
  /** Display name of the branch — server-side LEFT JOIN. NULL when the
   *  branch was deleted. */
  branchName: string | null
  clockInAt: string | null
  clockOutAt: string | null
  clockInStatus: string | null
  clockOutStatus: string | null
  clockInLat: string | null
  clockInLng: string | null
  clockOutLat: string | null
  clockOutLng: string | null
  clockInPhotoUrl: string | null
  clockOutPhotoUrl: string | null
}

interface HistoryResponse {
  records: AttendanceHistoryRecord[]
}

export function useAttendanceHistory(days: number = 30) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['attendance', 'history', tenantId, days],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<HistoryResponse>(
        'getMyAttendanceHistory',
        { days },
        { tenantId },
      ),
  })
}

// ─── Manager-side hooks ──────────────────────────────────────────────
// Mirrors the web /attendance + /attendance/records views for tenant
// owners/admins. Permission gating happens server-side via
// `requirePermission('attendance.manage')`; mobile only calls these
// when the active member holds that permission.

export interface DashboardStatsToday {
  totalActiveStaff: number
  onTime: number
  late: number
  present: number
  presentToday: number
  absent: number
  clockedOut: number
}

export interface DashboardStats {
  hasScheduledBranch: boolean
  today: DashboardStatsToday
  sevenDays: Array<{ date: string; onTime: number; late: number }>
  topLateThisMonth: Array<{
    staffId: string
    staffName: string
    lateCount: number
  }>
}

export function useAttendanceDashboardStats(branchId?: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['attendance', 'dashboard-stats', tenantId, branchId ?? null],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<DashboardStats>(
        'getAttendanceDashboardStats',
        branchId ? { branchId } : {},
        { tenantId },
      ),
    refetchOnWindowFocus: true,
  })
}

export interface AttendanceRecordRow {
  id: string
  date: string
  staffId: string
  staffName: string
  branchId: string | null
  branchName: string | null
  branchShiftId: string | null
  branchShiftName: string | null
  scheduledIn: string | null
  scheduledOut: string | null
  clockInAt: string | null
  clockOutAt: string | null
  clockInStatus: string | null
  clockOutStatus: string | null
  clockInModes: string[] | null
  clockOutModes: string[] | null
  clockInPhotoUrl: string | null
  clockOutPhotoUrl: string | null
  clockInLat: string | null
  clockInLng: string | null
  clockInNotes: string | null
  clockOutNotes: string | null
}

interface RecordsResponse {
  records: AttendanceRecordRow[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface RecordsFilter {
  from: string // YYYY-MM-DD
  to: string
  staffId?: string
  branchId?: string
  page?: number
  pageSize?: number
}

export function useAttendanceRecords(filter: RecordsFilter) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['attendance', 'records', tenantId, filter],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<RecordsResponse>(
        'listAttendanceRecords',
        {
          from: filter.from,
          to: filter.to,
          staffId: filter.staffId,
          branchId: filter.branchId,
          page: filter.page ?? 1,
          pageSize: filter.pageSize ?? 20,
        },
        { tenantId },
      ),
  })
}

export interface AttendanceStaffRow {
  id: string
  fullName: string | null
  branchId: string | null
  branchName: string | null
  isActive: boolean
}

export function useAttendanceStaff() {
  const { tenantId, hasPermission } = useTenant()
  return useQuery({
    queryKey: ['attendance', 'staff', tenantId],
    enabled:
      !!tenantId &&
      (hasPermission('attendance.manage') ||
        hasPermission('attendance.report')),
    queryFn: () =>
      callServerFn<AttendanceStaffRow[]>(
        'listAttendanceStaff',
        {},
        { tenantId },
      ),
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Geofence helpers ────────────────────────────────────────────────

/**
 * Distance between two lat/lng points in meters via haversine. Used
 * for the in-app "you are X meters from the branch" readout BEFORE
 * submit — the server runs its own authoritative check, but the
 * client-side hint avoids round-tripping a bad submission.
 *
 * Mirrors the formula in apps/web/src/lib/haversine.ts so the two
 * calculations stay consistent (no "client says 90m, server rejects
 * at 110m" UX surprises).
 */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000 // earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Convenience: branch.latitude/longitude come back as strings from
 *  postgres `numeric`. Coerce + compute. */
export function distanceToBranch(
  device: { lat: number; lng: number },
  branch: AttendanceBranch,
): number {
  return distanceMeters(device, {
    lat: Number(branch.latitude),
    lng: Number(branch.longitude),
  })
}

// ─── Phase D — settings + shifts + billing + qr host ──────────────

export interface AttendanceFullSettings {
  modeGpsEnabled: boolean
  modePhotoEnabled: boolean
  modeQrEnabled: boolean
  qrRotationSeconds: number
  subscriptionActive: boolean
  subscriptionStartedAt: string | null
  subscriptionExpiresAt: string | null
  billedStaffCount: number
  trialStartedAt: string | null
  trialEndsAt: string | null
  trialStaffCap: number | null
  trialUsed: boolean
  clockinReminderEnabled: boolean
  clockinReminderMinutes: number
  clockinReminderDirection: 'before' | 'after'
  clockoutReminderEnabled: boolean
  clockoutReminderMinutes: number
  clockoutReminderDirection: 'before' | 'after'
}

export interface AttendanceCurrentPlan {
  planKey: string
  labelKey: string
  durationMonths: number
  pricePerStaffPerMonth: number
  billedStaffCount: number
  amountIdr: number
  invoiceNumber: string | null
  periodStartAt: string | null
  periodEndAt: string | null
  isTrial: boolean
}

export interface AttendanceOverview {
  settings: AttendanceFullSettings
  staff: { total: number; active: number }
  branches: { total: number; active: number }
  currentPlan: AttendanceCurrentPlan | null
}

export function useAttendanceOverview() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['attendance', 'overview', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<AttendanceOverview>(
        'getAttendanceOverview',
        {},
        { tenantId },
      ),
  })
}

export function useUpdateModeToggles() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { gps: boolean; photo: boolean; qr: boolean }) =>
      callServerFn<{ success: true }>(
        'updateModeToggles',
        input,
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

export function useUpdateQrRotation() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (seconds: number) =>
      callServerFn<{ success: true }>(
        'updateQrRotation',
        { seconds },
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

export interface ReminderSettingsInput {
  clockinReminderEnabled: boolean
  clockinReminderMinutes: number
  clockinReminderDirection: 'before' | 'after'
  clockoutReminderEnabled: boolean
  clockoutReminderMinutes: number
  clockoutReminderDirection: 'before' | 'after'
}

export function useUpdateAttendanceReminders() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ReminderSettingsInput) =>
      callServerFn<{ success: true }>(
        'updateAttendanceReminderSettings',
        input,
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

// ─── Billing history (transactions) ────────────────────────────────

export interface AttendanceTransaction {
  id: string
  invoiceNumber: string | null
  moduleKey: string
  planKey: string
  amountIdr: number
  transferDate: string | null
  periodStartAt: string | null
  periodEndAt: string | null
  billedStaffCount: number | null
  status: string
}

export function useAttendanceBillingHistory() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['attendance', 'billing-history', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<AttendanceTransaction[]>(
        'getMyBillingHistory',
        {},
        { tenantId },
      ),
  })
}

// ─── Shifts CRUD ────────────────────────────────────────────────────

export interface ShiftRow {
  id: string
  branchId: string
  name: string
  isActive: boolean
  createdAt: string
  staffCount: number
}

export function useShifts(branchId?: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['attendance', 'shifts', tenantId, branchId ?? null],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ShiftRow[]>(
        'listShifts',
        branchId ? { branchId } : {},
        { tenantId },
      ),
  })
}

export interface ShiftScheduleDay {
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number
  isWorkDay: boolean
  clockInTime: string | null
  clockOutTime: string | null
  lateGraceMinutes: number
  earlyLeaveGraceMinutes: number
}

export interface ShiftWithSchedule {
  shift: ShiftRow & { tenantId: string; updatedAt: string }
  schedules: ShiftScheduleDay[]
}

export function useShiftWithSchedule(shiftId: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['attendance', 'shift', tenantId, shiftId],
    enabled: !!tenantId && !!shiftId,
    queryFn: () =>
      callServerFn<ShiftWithSchedule>(
        'getShiftWithSchedule',
        { shiftId },
        { tenantId },
      ),
  })
}

interface UpsertShiftInput {
  branchId: string
  name: string
}

export function useCreateShift() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertShiftInput) =>
      callServerFn<ShiftRow>('createShift', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance', 'shifts'] })
    },
  })
}

export function useUpdateShift() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      callServerFn<ShiftRow>('updateShift', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

export function useDeleteShift() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteShift',
        { id },
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance', 'shifts'] })
    },
  })
}

export function useSetShiftSchedule() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { shiftId: string; days: ShiftScheduleDay[] }) =>
      callServerFn<{ success: true }>(
        'setShiftSchedule',
        input,
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

// ─── Accessible branches (for QR host + manager pickers) ──────────

export interface AccessibleBranch {
  id: string
  name: string
  isMain: boolean
}

interface AccessibleBranchesResponse {
  branches: AccessibleBranch[]
  totalCount: number
}

export function useAccessibleBranches() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['attendance', 'accessible-branches', tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      callServerFn<AccessibleBranchesResponse>(
        'listAccessibleBranches',
        {},
        { tenantId },
      ),
  })
}

// ─── QR host (kiosk) ────────────────────────────────────────────────

export interface QrHostStarted {
  branchId: string
  branchName: string
}

export interface QrHostToken {
  token: string
  expiresAt: string
  rotationSeconds: number
}

export function useStartQrHost() {
  const { tenantId } = useTenant()
  return useMutation({
    mutationFn: (branchId: string) =>
      callServerFn<QrHostStarted>(
        'startQrHost',
        { branchId },
        { tenantId },
      ),
  })
}

export function useRotateQrToken() {
  const { tenantId } = useTenant()
  return useMutation({
    mutationFn: () =>
      callServerFn<QrHostToken>('rotateQrToken', {}, { tenantId }),
  })
}

export function useStopQrHost() {
  const { tenantId } = useTenant()
  return useMutation({
    mutationFn: () =>
      callServerFn<{ success: true }>('stopQrHost', {}, { tenantId }),
  })
}
