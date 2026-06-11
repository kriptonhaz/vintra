import { createServerFn } from '@tanstack/react-start'
import { createClient } from '@supabase/supabase-js'
import { db } from '@vintra/db'
import {
  staffProfiles,
  branches,
  branchShifts,
  tenants,
  tenantMembers,
  roles,
  attendanceSettings,
} from '@vintra/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../middleware/auth'
import { requireActiveModule } from '../middleware/module-access'
import { coerceStorablePhone } from '@vintra/shared'

const MODULE_KEY = 'attendance'

function getSupabaseServer() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )
}

async function requireAttendanceManage() {
  await requireActiveModule(MODULE_KEY)
  return requirePermission('attendance.manage')
}

/**
 * Enforce the billed-staff cap set by the platform admin at activation
 * time. Throws if the tenant is already at or above its paid quota.
 * Only counts active staff — deactivating someone frees up a slot.
 *
 * Called before inserting a new staff OR before reactivating an
 * inactive one; both paths consume a slot.
 */
async function assertCanConsumeStaffSlot(tenantId: string) {
  const [settings] = await db
    .select({
      billedStaffCount: attendanceSettings.billedStaffCount,
      subscriptionActive: attendanceSettings.subscriptionActive,
      subscriptionExpiresAt: attendanceSettings.subscriptionExpiresAt,
      trialEndsAt: attendanceSettings.trialEndsAt,
      trialStaffCap: attendanceSettings.trialStaffCap,
    })
    .from(attendanceSettings)
    .where(eq(attendanceSettings.tenantId, tenantId))
    .limit(1)

  // If no settings row exists, the tenant shouldn't have reached here —
  // requireActiveModule would have thrown. But guard anyway.
  if (!settings) return

  // Effective cap: paid subscription wins if active (typically more
  // permissive than trial); else trial cap if trial is running; else 0
  // (module-access guard already blocks this case, but defense-in-depth).
  // `null` cap during trial means UNLIMITED — owners can add as many
  // staff as they want, with no upgrade nag, until the trial expires.
  const now = Date.now()
  const paidActive =
    !!settings.subscriptionActive &&
    !!settings.subscriptionExpiresAt &&
    new Date(settings.subscriptionExpiresAt).getTime() > now
  const trialActive =
    !!settings.trialEndsAt &&
    new Date(settings.trialEndsAt).getTime() > now

  const isTrialCap = !paidActive && trialActive
  const effectiveCap: number | null = paidActive
    ? settings.billedStaffCount
    : trialActive
      ? settings.trialStaffCap // null = unlimited
      : 0

  // Trial with null cap → no slot enforcement at all.
  if (isTrialCap && effectiveCap === null) return

  if (effectiveCap === null || effectiveCap <= 0) {
    throw new Error(
      'Kuota staf untuk modul Absensi belum ditetapkan. Hubungi tim Vintra.',
    )
  }

  const [activeRow] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(staffProfiles)
    .where(
      and(
        eq(staffProfiles.tenantId, tenantId),
        eq(staffProfiles.isActive, true),
      ),
    )

  const active = activeRow?.active ?? 0
  if (active >= effectiveCap) {
    if (isTrialCap) {
      throw new Error(
        `Batas staf trial tercapai (${active}/${effectiveCap} aktif). Berlangganan untuk menambah staf.`,
      )
    }
    throw new Error(
      `Batas staf modul Absensi tercapai (${active}/${effectiveCap} aktif). Hubungi tim Vintra untuk menambah kuota.`,
    )
  }
}

async function findUserByEmail(email: string) {
  const supabase = getSupabaseServer()
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error('Gagal mencari pengguna')
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
}

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseServer()
    const { data } = await supabase.auth.admin.getUserById(userId)
    return data.user?.email ?? null
  } catch {
    return null
  }
}

/**
 * Returns email + activation flag for a user. `isActivated` is true iff
 * the user has ever signed in (password or OAuth) — so it's false for
 * invited users who haven't clicked the magic link nor used Google SSO.
 * Used by the staff list to show a "Pending" badge.
 */
async function getUserInfo(
  userId: string,
): Promise<{ email: string | null; isActivated: boolean }> {
  try {
    const supabase = getSupabaseServer()
    const { data } = await supabase.auth.admin.getUserById(userId)
    return {
      email: data.user?.email ?? null,
      isActivated: !!data.user?.last_sign_in_at,
    }
  } catch {
    return { email: null, isActivated: false }
  }
}

/**
 * Reject if a Supabase user is already attached to any tenant — either
 * as a `tenant_members` row OR as a `tenants.owner_id`. Protects against
 * the silent failure where a user invited to a second tenant would log in
 * and only see one (random) tenant because getCurrentUser does a
 * `.limit(1)` without an explicit tenant selector.
 *
 * We can relax this once a real tenant-switcher UI exists.
 */
async function assertUserNotAttachedElsewhere(userId: string) {
  const [existingMembership] = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, userId))
    .limit(1)
  if (existingMembership) {
    throw new Error(
      'Email ini sudah terdaftar di tenant lain. Gunakan email baru atau minta pengguna membuat akun baru.',
    )
  }
  const [existingOwned] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.ownerId, userId))
    .limit(1)
  if (existingOwned) {
    throw new Error(
      'Email ini adalah pemilik tenant lain. Gunakan email baru untuk mengundang sebagai staf.',
    )
  }
}

// ─── Read ──────────────────────────────────────────

export const getStaffQuota = createServerFn().handler(async () => {
  const auth = await requireActiveModule(MODULE_KEY)

  const [settings] = await db
    .select({
      billedStaffCount: attendanceSettings.billedStaffCount,
      subscriptionActive: attendanceSettings.subscriptionActive,
      subscriptionExpiresAt: attendanceSettings.subscriptionExpiresAt,
      trialEndsAt: attendanceSettings.trialEndsAt,
      trialStaffCap: attendanceSettings.trialStaffCap,
    })
    .from(attendanceSettings)
    .where(eq(attendanceSettings.tenantId, auth.tenantId))
    .limit(1)

  const [activeRow2] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(staffProfiles)
    .where(
      and(
        eq(staffProfiles.tenantId, auth.tenantId),
        eq(staffProfiles.isActive, true),
      ),
    )
  const active = activeRow2?.active ?? 0

  // Effective denominator matches what assertCanConsumeStaffSlot
  // enforces — paid cap when paid is active, trial cap when only trial
  // is active. Keeps the UI count consistent with the actual limit.
  const now = Date.now()
  const paidActive =
    !!settings?.subscriptionActive &&
    !!settings?.subscriptionExpiresAt &&
    new Date(settings.subscriptionExpiresAt).getTime() > now
  const trialActive =
    !!settings?.trialEndsAt &&
    new Date(settings.trialEndsAt).getTime() > now
  const isTrial = !paidActive && trialActive

  // Trial with null cap = unlimited; surfaces as billedCount = null so
  // the UI can render "tanpa batas" instead of a fraction.
  const billedCount: number | null = paidActive
    ? (settings?.billedStaffCount ?? 0)
    : trialActive
      ? (settings?.trialStaffCap ?? null)
      : 0

  return {
    activeCount: active,
    billedCount,
    isTrial,
  }
})

export const listStaff = createServerFn().handler(async () => {
  const auth = await requireActiveModule(MODULE_KEY)

  const rows = await db
    .select({
      id: staffProfiles.id,
      userId: staffProfiles.userId,
      tenantMemberId: staffProfiles.tenantMemberId,
      // Name now lives on tenant_members. We compose `fullName` here
      // for callers that still want a single display string.
      firstName: tenantMembers.firstName,
      lastName: tenantMembers.lastName,
      phone: staffProfiles.phone,
      nik: staffProfiles.nik,
      employeeNumber: staffProfiles.employeeNumber,
      // "Position" is the member's job title — staff_profiles.position is
      // deprecated; tenant_members.jobTitle is the single source.
      position: tenantMembers.jobTitle,
      joinedDate: staffProfiles.joinedDate,
      baseSalary: staffProfiles.baseSalary,
      branchId: staffProfiles.branchId,
      branchName: branches.name,
      branchShiftId: staffProfiles.branchShiftId,
      branchShiftName: branchShifts.name,
      isActive: staffProfiles.isActive,
      createdAt: staffProfiles.createdAt,
    })
    .from(staffProfiles)
    .innerJoin(tenantMembers, eq(staffProfiles.tenantMemberId, tenantMembers.id))
    .leftJoin(branches, eq(staffProfiles.branchId, branches.id))
    .leftJoin(branchShifts, eq(staffProfiles.branchShiftId, branchShifts.id))
    .where(eq(staffProfiles.tenantId, auth.tenantId))
    .orderBy(staffProfiles.createdAt)

  // Resolve email + activation status for display. Pending = Supabase
  // user exists but has never signed in (no password set and no OAuth
  // link established yet).
  const infos = await Promise.all(rows.map((r) => getUserInfo(r.userId)))
  return rows.map((r, i) => {
    const fullName = [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || null
    return {
      ...r,
      fullName,
      email: infos[i]?.email ?? null,
      isActivated: infos[i]?.isActivated ?? false,
    }
  })
})

/**
 * Whether the caller can manage attendance staff — the attendance
 * module is active (subscription/trial valid) AND the caller holds
 * `attendance.manage`. Non-throwing: used by /settings/members to
 * decide whether to render the HR ("Data Absensi") section.
 */
export const isAttendanceManageable = createServerFn().handler(async () => {
  try {
    await requireAttendanceManage()
    return true
  } catch {
    return false
  }
})

/**
 * HR profile fields for a tenant member, looked up by member id. Returns
 * null when the member has no staff_profile yet. Used by the member edit
 * sheet on /settings/members to pre-fill the "Data Absensi" section.
 */
export const getMemberHrProfile = createServerFn()
  .inputValidator(z.object({ memberId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireAttendanceManage()

    const [profile] = await db
      .select({
        id: staffProfiles.id,
        nik: staffProfiles.nik,
        employeeNumber: staffProfiles.employeeNumber,
        joinedDate: staffProfiles.joinedDate,
        baseSalary: staffProfiles.baseSalary,
        branchId: staffProfiles.branchId,
        branchShiftId: staffProfiles.branchShiftId,
        isActive: staffProfiles.isActive,
      })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.tenantMemberId, data.memberId),
          eq(staffProfiles.tenantId, auth.tenantId),
        ),
      )
      .limit(1)

    return profile ?? null
  })

// ─── Mutations ─────────────────────────────────────

/**
 * Create or update the HR (staff_profile) row for an existing tenant
 * member. This is the merged-flow writer used by /settings/members —
 * the staff profile is just the HR extension of a member, so the member
 * page owns name/phone/role and this owns NIK / employee number /
 * position / salary / home branch.
 *
 * Inserting a new profile consumes a billed staff slot (quota check).
 * Updating an existing one does not. The shift assignment is NOT touched
 * here — it's managed on /attendance/shifts; on a home-branch change the
 * stale shift is cleared (a shift belongs to a single branch).
 */
const memberHrSchema = z.object({
  memberId: z.string().uuid(),
  homeBranchId: z.string().uuid(),
  nik: z.string().optional().nullable(),
  employeeNumber: z.string().optional().nullable(),
  joinedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal: YYYY-MM-DD'),
  baseSalary: z.coerce.number().min(0).optional().nullable(),
})

export const upsertMemberStaffProfile = createServerFn({ method: 'POST' })
  .inputValidator(memberHrSchema)
  .handler(async ({ data }) => {
    const auth = await requireAttendanceManage()

    const [member] = await db
      .select({ id: tenantMembers.id, userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.id, data.memberId),
          eq(tenantMembers.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!member) throw new Error('Anggota tidak ditemukan')

    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.id, data.homeBranchId),
          eq(branches.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!branch) throw new Error('Cabang tidak ditemukan')

    const [existing] = await db
      .select({
        id: staffProfiles.id,
        branchId: staffProfiles.branchId,
        branchShiftId: staffProfiles.branchShiftId,
      })
      .from(staffProfiles)
      .where(eq(staffProfiles.tenantMemberId, data.memberId))
      .limit(1)

    const salary =
      data.baseSalary != null ? data.baseSalary.toString() : null

    if (existing) {
      // A shift belongs to a single branch — if the home branch changed,
      // the existing shift assignment is no longer valid.
      const keepShift = existing.branchId === data.homeBranchId
      const [updated] = await db
        .update(staffProfiles)
        .set({
          nik: data.nik ?? null,
          employeeNumber: data.employeeNumber ?? null,
          joinedDate: data.joinedDate,
          baseSalary: salary,
          branchId: data.homeBranchId,
          branchShiftId: keepShift ? existing.branchShiftId : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(staffProfiles.id, existing.id),
            eq(staffProfiles.tenantId, auth.tenantId),
          ),
        )
        .returning()
      return updated
    }

    // New profile — consumes a billed staff slot.
    await assertCanConsumeStaffSlot(auth.tenantId)
    const [created] = await db
      .insert(staffProfiles)
      .values({
        tenantId: auth.tenantId,
        userId: member.userId,
        tenantMemberId: member.id,
        nik: data.nik ?? null,
        employeeNumber: data.employeeNumber ?? null,
        joinedDate: data.joinedDate,
        baseSalary: salary,
        branchId: data.homeBranchId,
        branchShiftId: null,
      })
      .returning()
    return created
  })

const inviteSchema = z.object({
  email: z.string().email('Email tidak valid'),
  firstName: z.string().min(1, 'Nama depan wajib diisi'),
  lastName: z.string().optional().nullable(),
  phone: z.string().optional(),
  nik: z.string().optional(),
  employeeNumber: z.string().optional(),
  position: z.string().max(80, 'Posisi maksimal 80 karakter').optional(),
  joinedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal: YYYY-MM-DD'),
  baseSalary: z.coerce.number().min(0).optional(),
  branchId: z.string().uuid().optional(),
  /** Null / omitted = regular worker (follows branch schedule). */
  branchShiftId: z.string().uuid().optional().nullable(),
  /**
   * When invoked from "Buat profil staf" on the Anggota Tim page, the
   * member already exists. Skip the Supabase invite + member-insert
   * path and just create the staff_profile underneath.
   */
  fromMemberId: z.string().uuid().optional(),
})

export const inviteStaff = createServerFn({ method: 'POST' })
  .inputValidator(inviteSchema)
  .handler(async ({ data }) => {
    const auth = await requireAttendanceManage()

    // Enforce the platform-admin-set billed staff cap. Check up-front so we
    // don't waste a Supabase invite email on a request that will fail later.
    await assertCanConsumeStaffSlot(auth.tenantId)

    let member:
      | typeof tenantMembers.$inferSelect
      | undefined

    if (data.fromMemberId) {
      // "Buat profil staf" path from /settings/members. Member already
      // exists; we skip the Supabase invite + tenant_members insert and
      // just attach a staff_profile underneath.
      const [existing] = await db
        .select()
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.id, data.fromMemberId),
            eq(tenantMembers.tenantId, auth.tenantId),
          ),
        )
        .limit(1)
      if (!existing) throw new Error('Anggota tidak ditemukan')

      const [existingProfile] = await db
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(eq(staffProfiles.tenantMemberId, existing.id))
        .limit(1)
      if (existingProfile) {
        throw new Error('Profil staf sudah ada untuk anggota ini')
      }

      // Update the member's name/phone if the form changed them.
      await db
        .update(tenantMembers)
        .set({
          firstName: data.firstName,
          lastName: data.lastName ?? existing.lastName,
          phone: coerceStorablePhone(data.phone ?? existing.phone),
        })
        .where(eq(tenantMembers.id, existing.id))

      member = { ...existing, firstName: data.firstName }
    } else {
      // Standard path: invite a new Supabase user, create member + profile.
      // Find existing Supabase user FIRST (without inviting yet). If they
      // already belong to another tenant we want to refuse before sending
      // a new invite email — otherwise we'd spam someone who's already
      // attached somewhere else, and create a member row that
      // getCurrentUser can't disambiguate (no tenant switcher yet).
      const supabase = getSupabaseServer()
      let user = await findUserByEmail(data.email)
      if (user) {
        await assertUserNotAttachedElsewhere(user.id)
      }

      // Only now, if we don't have a Supabase user, send the invite email.
      if (!user) {
        const { data: invited, error: inviteErr } =
          await supabase.auth.admin.inviteUserByEmail(data.email)
        if (inviteErr || !invited.user) {
          throw new Error(inviteErr?.message ?? 'Gagal mengundang pengguna')
        }
        user = invited.user
      }

      const [staffRole] = await db
        .select({ id: roles.id, key: roles.key })
        .from(roles)
        .where(eq(roles.key, 'staff'))
        .limit(1)
      if (!staffRole) throw new Error("Role 'staff' tidak ditemukan. Jalankan seed:rbac.")

      const existingMembership = await db
        .select()
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, auth.tenantId),
            eq(tenantMembers.userId, user.id),
          ),
        )
        .limit(1)
      if (existingMembership.length > 0) {
        throw new Error('Pengguna ini sudah menjadi anggota tenant')
      }

      const existingProfile = await db
        .select()
        .from(staffProfiles)
        .where(eq(staffProfiles.userId, user.id))
        .limit(1)
      if (existingProfile.length > 0) {
        throw new Error('Profil staf sudah ada untuk pengguna ini')
      }

      const [inserted] = await db
        .insert(tenantMembers)
        .values({
          tenantId: auth.tenantId,
          userId: user.id,
          role: staffRole.key,
          roleId: staffRole.id,
          firstName: data.firstName,
          lastName: data.lastName ?? null,
          phone: coerceStorablePhone(data.phone),
          jobTitle: data.position ?? null,
        })
        .returning()
      member = inserted
    }

    if (!member) throw new Error('Gagal membuat anggota')

    // Validate shift belongs to the same branch (if both supplied)
    if (data.branchShiftId && data.branchId) {
      const [shift] = await db
        .select({ id: branchShifts.id })
        .from(branchShifts)
        .where(
          and(
            eq(branchShifts.id, data.branchShiftId),
            eq(branchShifts.branchId, data.branchId),
            eq(branchShifts.tenantId, auth.tenantId),
          ),
        )
        .limit(1)
      if (!shift) throw new Error('Shift tidak ditemukan di cabang yang dipilih')
    }

    const [profile] = await db
      .insert(staffProfiles)
      .values({
        tenantId: auth.tenantId,
        userId: member.userId,
        tenantMemberId: member.id,
        phone: data.phone ?? null,
        nik: data.nik ?? null,
        employeeNumber: data.employeeNumber ?? null,
        position: data.position?.trim() || null,
        joinedDate: data.joinedDate,
        baseSalary: data.baseSalary != null ? data.baseSalary.toString() : null,
        branchId: data.branchId ?? null,
        branchShiftId: data.branchShiftId ?? null,
      })
      .returning()

    const email = await getUserEmail(member.userId)
    return { ...profile, email }
  })

const updateStaffSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().min(1, 'Nama depan wajib diisi'),
  lastName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  nik: z.string().optional().nullable(),
  employeeNumber: z.string().optional().nullable(),
  position: z.string().max(80).optional().nullable(),
  joinedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  baseSalary: z.coerce.number().min(0).optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
  branchShiftId: z.string().uuid().optional().nullable(),
})

export const updateStaff = createServerFn({ method: 'POST' })
  .inputValidator(updateStaffSchema)
  .handler(async ({ data }) => {
    const auth = await requireAttendanceManage()

    const { id, ...updates } = data

    // Validate shift↔branch consistency. Clearing the shift is always allowed.
    if (updates.branchShiftId && updates.branchId) {
      const [shift] = await db
        .select({ id: branchShifts.id })
        .from(branchShifts)
        .where(
          and(
            eq(branchShifts.id, updates.branchShiftId),
            eq(branchShifts.branchId, updates.branchId),
            eq(branchShifts.tenantId, auth.tenantId),
          ),
        )
        .limit(1)
      if (!shift) throw new Error('Shift tidak ditemukan di cabang yang dipilih')
    } else if (updates.branchShiftId && !updates.branchId) {
      throw new Error('Shift hanya bisa dipilih jika staf punya cabang')
    }

    const [existing] = await db
      .select({ tenantMemberId: staffProfiles.tenantMemberId })
      .from(staffProfiles)
      .where(
        and(eq(staffProfiles.id, id), eq(staffProfiles.tenantId, auth.tenantId)),
      )
      .limit(1)
    if (!existing) throw new Error('Staf tidak ditemukan')

    // Name + phone + jobTitle live on tenant_members now.
    await db
      .update(tenantMembers)
      .set({
        firstName: updates.firstName,
        lastName: updates.lastName ?? null,
        phone: updates.phone ?? null,
        jobTitle: updates.position?.trim() || null,
      })
      .where(eq(tenantMembers.id, existing.tenantMemberId))

    const [profile] = await db
      .update(staffProfiles)
      .set({
        phone: updates.phone ?? null,
        nik: updates.nik ?? null,
        employeeNumber: updates.employeeNumber ?? null,
        position: updates.position?.trim() || null,
        joinedDate: updates.joinedDate,
        baseSalary:
          updates.baseSalary != null ? updates.baseSalary.toString() : null,
        branchId: updates.branchId ?? null,
        // If branch cleared, shift must clear too (FK already allows null but
        // we avoid orphaned assignment).
        branchShiftId: updates.branchId ? updates.branchShiftId ?? null : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(staffProfiles.id, id),
          eq(staffProfiles.tenantId, auth.tenantId),
        ),
      )
      .returning()

    if (!profile) throw new Error('Staf tidak ditemukan')
    return profile
  })

export const setStaffActive = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ id: z.string().uuid(), isActive: z.boolean() }),
  )
  .handler(async ({ data }) => {
    const auth = await requireAttendanceManage()

    // Reactivating consumes a billed slot — check the cap before flipping.
    // Deactivating is always allowed (frees a slot).
    if (data.isActive) {
      await assertCanConsumeStaffSlot(auth.tenantId)
    }

    await db
      .update(staffProfiles)
      .set({ isActive: data.isActive, updatedAt: new Date() })
      .where(
        and(
          eq(staffProfiles.id, data.id),
          eq(staffProfiles.tenantId, auth.tenantId),
        ),
      )

    return { success: true }
  })
