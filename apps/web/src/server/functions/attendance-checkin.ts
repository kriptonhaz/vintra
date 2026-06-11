import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  staffProfiles,
  branches,
  attendanceSettings,
  attendanceRecords,
  qrConsumedNonces,
  tenantMembers,
} from '@vintra/db/schema'
import { eq, and, lt, gte, desc, isNotNull, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireActiveModule } from '../middleware/module-access'
import { requirePermission, type AuthContext } from '../middleware/auth'
import { assertBranchAllowed, filterBranchesByAccess } from '../lib/branch-scope'
import { distanceMeters } from '@/lib/haversine'
import {
  jakartaDayOfWeek,
  dateKeyJakarta,
  deriveClockInStatus,
  deriveClockOutStatus,
} from '@/lib/jakarta-time'
import {
  uploadAttendancePhoto,
  parseDataUrl,
  MAX_PHOTO_BYTES,
  getAttendancePhotoSignedUrl,
} from '@/lib/s3-storage'
import { verifyQrToken } from '@/lib/attendance-qr'
import {
  resolveStaffScheduleForDow,
  type ResolvedSchedule,
} from '../attendance-schedule'

const MODULE_KEY = 'attendance'

/**
 * Resolve the branch a staff member is checking in/out at. By default
 * this is their pinned home branch (`profile.branchId`) — the
 * historical behaviour. When the caller passes an explicit `branchId`
 * (e.g. a supervisor visiting another outlet), use it after
 * `assertBranchAllowed` confirms they have access via
 * `tenant_member_branches` (owner/admin/multi-branch supervisors all
 * pass; a staff member pinned to one branch can't fake it).
 *
 * Returns the branch row plus a `branchShiftId` to attach to the
 * record. The shift only applies at the staff's home branch — visiting
 * other branches falls back to the visiting branch's default schedule
 * (no shift) and a neutral 'present' status if it's a simple-mode
 * branch.
 */
async function resolveAttendanceBranch(
  auth: AuthContext,
  profile: {
    branchId: string | null
    branchShiftId: string | null
  },
  requestedBranchId: string | undefined,
): Promise<{
  branch: typeof branches.$inferSelect
  branchShiftId: string | null
  isVisiting: boolean
}> {
  let effectiveBranchId: string | null = profile.branchId
  let isVisiting = false
  if (requestedBranchId && requestedBranchId !== profile.branchId) {
    // assertBranchAllowed throws when allowedBranchIds is set and the
    // id isn't in it. owner/admin (allowedBranchIds === null) pass.
    assertBranchAllowed(auth, requestedBranchId)
    effectiveBranchId = requestedBranchId
    isVisiting = true
  }
  if (!effectiveBranchId) {
    throw new Error('Anda belum ditugaskan ke cabang.')
  }
  const [branch] = await db
    .select()
    .from(branches)
    .where(eq(branches.id, effectiveBranchId))
    .limit(1)
  if (!branch) throw new Error('Cabang tidak ditemukan.')
  return {
    branch,
    branchShiftId: isVisiting ? null : profile.branchShiftId,
    isVisiting,
  }
}

// ─── Today status (called by check-in page) ─────────

export const getMyTodayStatus = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      // Optional — when present, resolves against the visiting branch
      // instead of the staff's pinned home branch. Used by the check-in
      // page so a supervisor who switched the topbar branch can see the
      // correct schedule + GPS-allowed-area for the branch they're
      // physically at. Falls back to profile.branchId when omitted.
      branchId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)

    const [row] = await db
      .select({
        profile: staffProfiles,
        firstName: tenantMembers.firstName,
        lastName: tenantMembers.lastName,
      })
      .from(staffProfiles)
      .innerJoin(tenantMembers, eq(staffProfiles.tenantMemberId, tenantMembers.id))
      .where(
        and(
          eq(staffProfiles.userId, auth.userId),
          eq(staffProfiles.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    const profile = row
      ? {
          ...row.profile,
          // Derived display name (legacy fullName column dropped 0035).
          fullName:
            [row.firstName, row.lastName].filter(Boolean).join(' ').trim() ||
            null,
        }
      : undefined

    const [settings] = await db
      .select()
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, auth.tenantId))
      .limit(1)

    let branch: typeof branches.$inferSelect | null = null
    let todaySchedule: ResolvedSchedule | null = null
    let todayRecord: typeof attendanceRecords.$inferSelect | null = null
    let isVisiting = false

    if (profile) {
      // Resolve effective branch — visiting branch when supplied & allowed,
      // else the staff's pinned home branch. Don't blow up the page if a
      // supervisor switches to a branch they can't access; surface a null
      // branch (the UI already handles "no branch" with a friendly card).
      try {
        const resolved = await resolveAttendanceBranch(
          auth,
          {
            branchId: profile.branchId ?? null,
            branchShiftId: profile.branchShiftId ?? null,
          },
          data.branchId,
        )
        branch = resolved.branch
        isVisiting = resolved.isVisiting
        const dow = jakartaDayOfWeek()
        todaySchedule = await resolveStaffScheduleForDow(
          {
            branchId: resolved.branch.id,
            branchShiftId: resolved.branchShiftId,
          },
          dow,
        )
      } catch {
        branch = null
        todaySchedule = null
      }
    }

    // Today's records for THIS staff across every branch they can
    // access. Drives both:
    //   1. `todayRecord` — the record at the currently-resolved branch
    //      (clock-in / clock-out state for the active outlet)
    //   2. `accessibleBranches` — every branch the staff may operate
    //      with a per-branch status chip. For single-branch staff this
    //      is a list of one; for multi-outlet supervisors it's the full
    //      set so the UI can render "✓ Outlet A · ⏳ Outlet B".
    type BranchStatus = 'pending' | 'clocked-in' | 'clocked-out'
    let accessibleBranches: Array<{
      id: string
      name: string
      isMain: boolean
      status: BranchStatus
    }> = []
    if (profile) {
      const today = dateKeyJakarta()

      // Active accessible branches for this caller. filterBranchesByAccess
      // honours `tenant_member_branches` — owners/admins see all,
      // multi-branch supervisors see their pinned set, single-branch
      // staff see one.
      const branchRows = await db
        .select({
          id: branches.id,
          name: branches.name,
          isMain: branches.isMain,
        })
        .from(branches)
        .where(
          and(eq(branches.tenantId, auth.tenantId), eq(branches.isActive, true)),
        )
        .orderBy(desc(branches.isMain), branches.createdAt)
      const accessible = filterBranchesByAccess(auth, branchRows)

      // All of today's records for this staff across the accessible set
      // (small N — handful of branches max). One query, then we both
      // pick out the active-branch record and build the per-branch
      // status list.
      const accessibleIds = accessible.map((b) => b.id)
      const todayRows = accessibleIds.length
        ? await db
            .select()
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.staffProfileId, profile.id),
                eq(attendanceRecords.date, today),
                inArray(attendanceRecords.branchId, accessibleIds),
              ),
            )
        : []
      const byBranch = new Map(
        todayRows.filter((r) => r.branchId).map((r) => [r.branchId!, r]),
      )

      if (branch) {
        todayRecord = byBranch.get(branch.id) ?? null
      }
      accessibleBranches = accessible.map((b) => {
        const rec = byBranch.get(b.id)
        let status: BranchStatus = 'pending'
        if (rec?.clockOutAt) status = 'clocked-out'
        else if (rec?.clockInAt) status = 'clocked-in'
        return { id: b.id, name: b.name, isMain: b.isMain, status }
      })
    }

    return {
      hasProfile: !!profile,
      profile: profile ?? null,
      branch,
      isVisiting,
      todaySchedule,
      todayRecord,
      accessibleBranches,
      settings: settings ?? null,
      jakartaDayOfWeek: jakartaDayOfWeek(),
      jakartaDate: dateKeyJakarta(),
    }
  })

// ─── Today overview (owner-home "Hadir Hari Ini" widget) ─────────

/**
 * Aggregate attendance snapshot for the owner dashboard: how many
 * active staff have clocked in today vs the total active headcount.
 * Drives the home "Hadir Hari Ini" card (present/total + ring).
 *
 * Scoped to active staff only — a present record from a now-deactivated
 * staff member is excluded so `presentCount` can never exceed
 * `totalCount`.
 *
 * Gated on the `attendance.manage` permission — NOT `requireActiveModule`.
 * This is the team-oversight metric (how many of *everyone* showed up),
 * so it belongs to managers/owners, not to a staff member who only
 * clocks themselves in (they hold `attendance.write`, not `.manage`).
 * Gating on the permission rather than the module also means it doesn't
 * 403 for a tenant that hasn't subscribed to the paid attendance module
 * — owners/admins hold the permission regardless, and a tenant with no
 * staff simply gets 0/0, a clean empty state consistent with the other
 * home cards. The mobile home hides this card for roles lacking the
 * permission, so the two layers agree.
 */
export const getAttendanceTodayOverview = createServerFn().handler(
  async () => {
    const auth = await requirePermission('attendance.manage')

    const today = dateKeyJakarta()

    const activeStaff = await db
      .select({ id: staffProfiles.id })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.tenantId, auth.tenantId),
          eq(staffProfiles.isActive, true),
        ),
      )
    const activeIds = new Set(activeStaff.map((s) => s.id))
    const totalCount = activeIds.size

    const clockedInToday = await db
      .select({ staffProfileId: attendanceRecords.staffProfileId })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.tenantId, auth.tenantId),
          eq(attendanceRecords.date, today),
          isNotNull(attendanceRecords.clockInAt),
        ),
      )
    const presentCount = new Set(
      clockedInToday
        .map((r) => r.staffProfileId)
        .filter((id) => activeIds.has(id)),
    ).size

    const percentage =
      totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0

    return { presentCount, totalCount, percentage }
  },
)

// ─── Shared validation ─────────────────────────────

const submitSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  /** data URL `data:image/jpeg;base64,...` */
  photoDataUrl: z.string().optional(),
  qrToken: z.string().optional(),
  notes: z.string().max(500).optional(),
  /** Optional visiting-branch override — see resolveAttendanceBranch. */
  branchId: z.string().uuid().optional(),
})
type SubmitInput = z.infer<typeof submitSchema>

interface ValidatedProof {
  lat: number | null
  lng: number | null
  photoKey: string | null
  modesUsed: string[]
}

async function validateCheckIn(
  input: SubmitInput,
  ctx: {
    tenantId: string
    staffProfileId: string
    branch: typeof branches.$inferSelect
    settings: typeof attendanceSettings.$inferSelect
    dateKey: string
    slot: 'in' | 'out'
  },
): Promise<ValidatedProof> {
  const { settings, branch } = ctx
  const missing: string[] = []
  const modesUsed: string[] = []

  // Collect required proofs up-front so we can report ALL missing ones in one go
  if (settings.modeGpsEnabled) {
    if (input.lat == null || input.lng == null) missing.push('gps')
    else modesUsed.push('gps')
  }
  if (settings.modePhotoEnabled) {
    if (!input.photoDataUrl) missing.push('photo')
    else modesUsed.push('photo')
  }
  if (settings.modeQrEnabled) {
    if (!input.qrToken) missing.push('qr')
    else modesUsed.push('qr')
  }

  if (missing.length > 0) {
    throw new Error(`Bukti ${missing.join(', ')} wajib diisi.`)
  }

  let lat: number | null = null
  let lng: number | null = null
  let photoKey: string | null = null

  // GPS
  if (settings.modeGpsEnabled && input.lat != null && input.lng != null) {
    const dist = distanceMeters(
      input.lat,
      input.lng,
      Number(branch.latitude),
      Number(branch.longitude),
    )
    if (dist > branch.radiusMeters) {
      throw new Error(
        `Di luar area lokasi kantor (${Math.round(dist)} m dari ${branch.name}).`,
      )
    }
    lat = input.lat
    lng = input.lng
  }

  // QR — verify signature + nonce replay protection. Do this BEFORE photo upload
  // so we don't burn S3 cycles on an invalid scan.
  if (settings.modeQrEnabled && input.qrToken) {
    const verified = verifyQrToken(input.qrToken)
    if (!verified.ok) {
      if (verified.reason === 'expired') {
        throw new Error('QR kedaluwarsa. Mohon scan ulang.')
      }
      throw new Error('QR tidak valid.')
    }
    const { payload } = verified
    if (payload.t !== ctx.tenantId) {
      throw new Error('QR tidak valid untuk tenant ini.')
    }
    if (payload.b !== branch.id) {
      throw new Error('QR tidak sesuai dengan cabang Anda.')
    }
    // Consume nonce (reject on duplicate). Best-effort cleanup of >5min nonces.
    try {
      await db.insert(qrConsumedNonces).values({
        nonce: payload.n,
        tenantId: ctx.tenantId,
        staffProfileId: ctx.staffProfileId,
      })
    } catch {
      throw new Error('QR sudah digunakan. Mohon scan QR baru.')
    }
    // Opportunistic cleanup
    await db
      .delete(qrConsumedNonces)
      .where(lt(qrConsumedNonces.consumedAt, new Date(Date.now() - 5 * 60 * 1000)))
  }

  // Photo upload — last, because failures here shouldn't invalidate nonce or GPS
  if (settings.modePhotoEnabled && input.photoDataUrl) {
    const { bytes, mimeType } = parseDataUrl(input.photoDataUrl)
    if (bytes.byteLength > MAX_PHOTO_BYTES) {
      throw new Error(
        `Foto terlalu besar (max ${Math.round(MAX_PHOTO_BYTES / 1024)} KB).`,
      )
    }
    const { key } = await uploadAttendancePhoto({
      tenantId: ctx.tenantId,
      staffProfileId: ctx.staffProfileId,
      date: ctx.dateKey,
      slot: ctx.slot,
      bytes,
      mimeType,
    })
    photoKey = key
  }

  return { lat, lng, photoKey, modesUsed }
}

// ─── Clock-in ───────────────────────────────────────

export const submitClockIn = createServerFn({ method: 'POST' })
  .inputValidator(submitSchema)
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission('attendance.write')

    // Staff profile + branch
    const [profile] = await db
      .select()
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.userId, auth.userId),
          eq(staffProfiles.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!profile) throw new Error('Profil staf tidak ditemukan.')
    if (!profile.isActive) throw new Error('Akun staf Anda tidak aktif.')

    // Resolve effective branch — visiting branch when supplied & allowed
    // (assertBranchAllowed throws on unauthorized), else home branch.
    const resolved = await resolveAttendanceBranch(
      auth,
      {
        branchId: profile.branchId ?? null,
        branchShiftId: profile.branchShiftId ?? null,
      },
      data.branchId,
    )
    const branch = resolved.branch
    const effectiveBranchShiftId = resolved.branchShiftId

    // Schedule for today — uses the staff's shift if assigned at their
    // home branch, else the branch default schedule. Only resolved for
    // "advanced" branches; a simple-mode branch (requiresSchedule =
    // false) has no schedule and staff may clock in any time with a
    // neutral 'present' status. At a visiting branch we always resolve
    // against the branch default (shift doesn't follow the staff).
    const dow = jakartaDayOfWeek()
    const schedule = branch.requiresSchedule
      ? await resolveStaffScheduleForDow(
          { branchId: branch.id, branchShiftId: effectiveBranchShiftId },
          dow,
        )
      : null
    if (
      branch.requiresSchedule &&
      (!schedule ||
        !schedule.isWorkDay ||
        !schedule.clockInTime ||
        !schedule.clockOutTime)
    ) {
      throw new Error('Hari ini bukan hari kerja di cabang Anda.')
    }

    // Settings
    const [settings] = await db
      .select()
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, auth.tenantId))
      .limit(1)
    if (!settings) throw new Error('Pengaturan absensi belum dikonfigurasi.')
    if (
      !settings.modeGpsEnabled &&
      !settings.modePhotoEnabled &&
      !settings.modeQrEnabled
    ) {
      throw new Error('Belum ada metode verifikasi yang aktif.')
    }

    // Duplicate check — per (staff, branch, day) so a multi-outlet
    // supervisor can clock in independently at each outlet they visit.
    // Open clock-ins at other branches don't block.
    const dateKey = dateKeyJakarta()
    const [existing] = await db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.staffProfileId, profile.id),
          eq(attendanceRecords.branchId, branch.id),
          eq(attendanceRecords.date, dateKey),
        ),
      )
      .limit(1)
    if (existing?.clockInAt) {
      throw new Error(
        existing.clockOutAt
          ? `Anda sudah selesai absensi di ${branch.name} hari ini.`
          : `Anda sudah clock-in di ${branch.name} hari ini.`,
      )
    }

    // Validate proofs + upload
    const proof = await validateCheckIn(data, {
      tenantId: auth.tenantId,
      staffProfileId: profile.id,
      branch,
      settings,
      dateKey,
      slot: 'in',
    })

    const clockInAt = new Date()
    // Simple-mode branches (no schedule) record a neutral 'present'
    // status — there is no scheduled time to score lateness against.
    const status =
      schedule && schedule.clockInTime
        ? deriveClockInStatus(
            schedule.clockInTime,
            clockInAt,
            schedule.lateGraceMinutes,
          )
        : 'present'

    const trimmedNotes = data.notes?.trim() ? data.notes.trim() : null

    if (existing) {
      // Shouldn't happen (existing.clockInAt was null but row exists) — update
      const [updated] = await db
        .update(attendanceRecords)
        .set({
          clockInAt,
          clockInModes: proof.modesUsed,
          clockInLat: proof.lat != null ? proof.lat.toString() : null,
          clockInLng: proof.lng != null ? proof.lng.toString() : null,
          clockInPhotoKey: proof.photoKey,
          clockInStatus: status,
          scheduledIn: schedule?.clockInTime ?? null,
          scheduledOut: schedule?.clockOutTime ?? null,
          branchId: branch.id,
          branchShiftId: effectiveBranchShiftId,
          clockInNotes: trimmedNotes ?? existing.clockInNotes,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecords.id, existing.id))
        .returning()
      return updated!
    }

    const [created] = await db
      .insert(attendanceRecords)
      .values({
        tenantId: auth.tenantId,
        staffProfileId: profile.id,
        branchId: branch.id,
        branchShiftId: effectiveBranchShiftId,
        date: dateKey,
        scheduledIn: schedule?.clockInTime ?? null,
        scheduledOut: schedule?.clockOutTime ?? null,
        clockInAt,
        clockInModes: proof.modesUsed,
        clockInLat: proof.lat != null ? proof.lat.toString() : null,
        clockInLng: proof.lng != null ? proof.lng.toString() : null,
        clockInPhotoKey: proof.photoKey,
        clockInStatus: status,
        clockInNotes: trimmedNotes,
      })
      .returning()

    return created!
  })

// ─── Clock-out ──────────────────────────────────────

export const submitClockOut = createServerFn({ method: 'POST' })
  .inputValidator(submitSchema)
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission('attendance.write')

    const [profile] = await db
      .select()
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.userId, auth.userId),
          eq(staffProfiles.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!profile) throw new Error('Profil staf tidak ditemukan.')
    if (!profile.isActive) throw new Error('Akun staf Anda tidak aktif.')

    // Resolve effective clock-out branch the same way as clock-in. If
    // the supervisor moved branches between clock-in and clock-out, the
    // GPS proximity check uses wherever they are now — the record's
    // branchId stays as what was set on clock-in.
    const resolved = await resolveAttendanceBranch(
      auth,
      {
        branchId: profile.branchId ?? null,
        branchShiftId: profile.branchShiftId ?? null,
      },
      data.branchId,
    )
    const branch = resolved.branch
    const effectiveBranchShiftId = resolved.branchShiftId

    const [settings] = await db
      .select()
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, auth.tenantId))
      .limit(1)
    if (!settings) throw new Error('Pengaturan absensi belum dikonfigurasi.')

    // Per-branch lookup — clock-out targets the record at the branch
    // the user is currently at. A multi-outlet supervisor still has to
    // clock out at each outlet they checked in to; an open clock-in
    // elsewhere does NOT block this clock-out.
    const dateKey = dateKeyJakarta()
    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.staffProfileId, profile.id),
          eq(attendanceRecords.branchId, branch.id),
          eq(attendanceRecords.date, dateKey),
        ),
      )
      .limit(1)
    if (!record || !record.clockInAt) {
      throw new Error(`Anda belum clock-in di ${branch.name} hari ini.`)
    }
    if (record.clockOutAt) {
      throw new Error(`Anda sudah clock-out di ${branch.name} hari ini.`)
    }

    const proof = await validateCheckIn(data, {
      tenantId: auth.tenantId,
      staffProfileId: profile.id,
      branch,
      settings,
      dateKey,
      slot: 'out',
    })

    // Re-resolve today's schedule so we can pull earlyLeaveGraceMinutes.
    // Using the snapshotted scheduledOut on the record means grace must come
    // from a live lookup (by design — grace is a policy, not an event).
    const clockOutAt = new Date()
    const outDow = jakartaDayOfWeek()
    const outSchedule = await resolveStaffScheduleForDow(
      { branchId: branch.id, branchShiftId: effectiveBranchShiftId },
      outDow,
    )
    const earlyLeaveGrace = outSchedule?.earlyLeaveGraceMinutes ?? 0
    // No scheduled clock-out time (simple-mode branch) → neutral
    // 'present' rather than scoring it as on-time.
    const status = record.scheduledOut
      ? deriveClockOutStatus(record.scheduledOut, clockOutAt, earlyLeaveGrace)
      : 'present'

    const trimmedOut = data.notes?.trim() ? data.notes.trim() : null

    const [updated] = await db
      .update(attendanceRecords)
      .set({
        clockOutAt,
        clockOutModes: proof.modesUsed,
        clockOutLat: proof.lat != null ? proof.lat.toString() : null,
        clockOutLng: proof.lng != null ? proof.lng.toString() : null,
        clockOutPhotoKey: proof.photoKey,
        clockOutStatus: status,
        clockOutNotes: trimmedOut,
        updatedAt: new Date(),
      })
      .where(eq(attendanceRecords.id, record.id))
      .returning()

    return updated!
  })

// ─── My history (mobile self-view) ───────────────────

/**
 * Returns the current staff's last N days of attendance records,
 * each enriched with pre-signed photo URLs (5-min TTL). Distinct
 * from `listAttendanceRecords` which requires `attendance.manage`
 * and serves the admin records page — this one is a self-view that
 * any active staff member can call to see their own history.
 *
 * Defaults to 30 days because that's the rolling window the mobile
 * Absensi tab surfaces. Cap at 90 to keep the response size bounded.
 */
export const getMyAttendanceHistory = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      days: z.number().int().min(1).max(90).default(30),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)

    const [profile] = await db
      .select({ id: staffProfiles.id })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.userId, auth.userId),
          eq(staffProfiles.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!profile) return { records: [] }

    // Date math: today (Jakarta) minus N days, in YYYY-MM-DD form so
    // it compares against the `date` column directly.
    const today = dateKeyJakarta()
    const sinceDate = new Date(today)
    sinceDate.setUTCDate(sinceDate.getUTCDate() - data.days)
    const since = sinceDate.toISOString().slice(0, 10)

    // LEFT JOIN branches so multi-outlet supervisors' history rows
    // carry the outlet name; the mobile UI groups rows by date and
    // labels each entry with its branch.
    const rows = await db
      .select({
        record: attendanceRecords,
        branchName: branches.name,
      })
      .from(attendanceRecords)
      .leftJoin(branches, eq(attendanceRecords.branchId, branches.id))
      .where(
        and(
          eq(attendanceRecords.staffProfileId, profile.id),
          gte(attendanceRecords.date, since),
        ),
      )
      .orderBy(desc(attendanceRecords.date))

    // Pre-sign photo URLs in parallel — keeps response time predictable
    // even for users with 30 days × 2 photos each.
    const records = await Promise.all(
      rows.map(async ({ record: r, branchName }) => ({
        ...r,
        branchName,
        clockInPhotoUrl: r.clockInPhotoKey
          ? await getAttendancePhotoSignedUrl(r.clockInPhotoKey).catch(() => null)
          : null,
        clockOutPhotoUrl: r.clockOutPhotoKey
          ? await getAttendancePhotoSignedUrl(r.clockOutPhotoKey).catch(() => null)
          : null,
      })),
    )

    return { records }
  })
