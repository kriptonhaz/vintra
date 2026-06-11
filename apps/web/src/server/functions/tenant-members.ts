import { createServerFn } from '@tanstack/react-start'
import { createClient } from '@supabase/supabase-js'
import { db } from '@vintra/db'
import {
  tenantMembers,
  tenantMemberBranches,
  roles,
  staffProfiles,
  branches,
  tenants,
  waInstances,
} from '@vintra/db/schema'
import { eq, and, or, sql, desc, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
  requireAuth,
  requirePermission,
  type AuthContext,
} from '../middleware/auth'
import { normalizeIDPhone, coerceStorablePhone } from '@vintra/shared'
import {
  uploadTenantMemberPhoto,
  getTenantMemberPhotoSignedUrl,
  deleteTenantMemberPhoto,
  parseDataUrl,
} from '@/lib/s3-storage'

function getSupabaseServer() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )
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

async function findUserByEmail(email: string) {
  const supabase = getSupabaseServer()
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error('Gagal mencari pengguna')
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
}

// ─── Franchisee branch scoping ─────────────────────
//
// A branch-restricted caller (an `outlet_owner` / Pemilik Outlet, who
// is pinned to one branch via tenant_member_branches) may only manage
// members of the branch they run. Unrestricted callers — the tenant
// owner / admin, `allowedBranchIds === null` — bypass every check.

/** Throw unless the caller may act on `memberId` (same-branch member). */
async function assertMemberInBranchScope(
  auth: AuthContext,
  memberId: string,
): Promise<void> {
  if (auth.allowedBranchIds === null) return
  const pins = await db
    .select({ branchId: tenantMemberBranches.branchId })
    .from(tenantMemberBranches)
    .where(eq(tenantMemberBranches.tenantMemberId, memberId))
  const inScope = pins.some((p) => auth.allowedBranchIds!.includes(p.branchId))
  if (!inScope) {
    throw new Error('Anggota ini di luar cabang yang Anda kelola.')
  }
}

/** Throw unless every branch in `branchIds` is one the caller controls. */
function assertBranchesWithinScope(
  auth: AuthContext,
  branchIds: string[],
): void {
  if (auth.allowedBranchIds === null) return
  const allowed = new Set(auth.allowedBranchIds)
  if (!branchIds.every((b) => allowed.has(b))) {
    throw new Error('Anda hanya bisa menetapkan cabang yang Anda kelola.')
  }
}

// ─── Read ──────────────────────────────────────────

export const getRolesForAssignment = createServerFn().handler(async () => {
  const auth = await requireAuth()
  // System roles (tenant_id NULL) + this tenant's custom roles. The
  // member form's role dropdown auto-picks up any role the owner has
  // created at /settings/roles — no extra wiring needed there.
  return db
    .select({
      id: roles.id,
      key: roles.key,
      label: roles.label,
      description: roles.description,
      sortOrder: roles.sortOrder,
      isSystem: roles.isSystem,
    })
    .from(roles)
    .where(
      or(isNull(roles.tenantId), eq(roles.tenantId, auth.tenantId)),
    )
    .orderBy(roles.sortOrder, roles.label)
})

export const listTenantMembers = createServerFn().handler(async () => {
  const auth = await requirePermission('members.read')

  const rows = await db
    .select({
      id: tenantMembers.id,
      userId: tenantMembers.userId,
      roleText: tenantMembers.role,
      roleId: tenantMembers.roleId,
      roleKey: roles.key,
      roleLabel: roles.label,
      firstName: tenantMembers.firstName,
      lastName: tenantMembers.lastName,
      phone: tenantMembers.phone,
      jobTitle: tenantMembers.jobTitle,
      photoKey: tenantMembers.photoKey,
      // Per-member WhatsApp OTP login flags. Drives the "Login WA" badge
      // / toggle on /settings/members. waLoginEmail is null for staff
      // who have a real email (Supabase resolves their address); set to
      // the synthetic "wa-{slug}-{phone}@login.vintra.local" for
      // phone-only staff invited via the dedicated path.
      waLoginEnabled: tenantMembers.waLoginEnabled,
      waLoginEmail: tenantMembers.waLoginEmail,
      // Boolean flag — does this member have an attached staff_profiles
      // row? Drives the "Staf Absensi" badge / "Buat profil staf →" CTA
      // on /settings/members. Left-join + isNotNull avoids the second
      // round-trip the older "fetch profile per row" approach needed.
      hasStaffProfile: sql<boolean>`${staffProfiles.id} IS NOT NULL`,
      createdAt: tenantMembers.createdAt,
    })
    .from(tenantMembers)
    .leftJoin(roles, eq(tenantMembers.roleId, roles.id))
    .leftJoin(staffProfiles, eq(staffProfiles.tenantMemberId, tenantMembers.id))
    .where(eq(tenantMembers.tenantId, auth.tenantId))
    .orderBy(tenantMembers.createdAt)

  // JUR-135: fetch branch pins for every member in this tenant in one
  // query, then group in JS. Empty array ⇒ unrestricted ("all branches"
  // — backward-compat for pre-JUR-135 members).
  const memberIds = rows.map((r) => r.id)
  const pinRows =
    memberIds.length === 0
      ? []
      : await db
          .select({
            memberId: tenantMemberBranches.tenantMemberId,
            branchId: tenantMemberBranches.branchId,
          })
          .from(tenantMemberBranches)
          .where(inArray(tenantMemberBranches.tenantMemberId, memberIds))
  const pinsByMember = new Map<string, string[]>()
  for (const p of pinRows) {
    const list = pinsByMember.get(p.memberId) ?? []
    list.push(p.branchId)
    pinsByMember.set(p.memberId, list)
  }

  // Fetch email + signed photo URL in parallel per row.
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const [email, photoUrl] = await Promise.all([
        getUserEmail(r.userId),
        r.photoKey ? getTenantMemberPhotoSignedUrl(r.photoKey).catch(() => null) : null,
      ])
      return {
        ...r,
        email,
        photoUrl,
        // null ⇒ unrestricted (owner or empty junction). string[] ⇒
        // explicit branch set. Mirrors AuthContext.allowedBranchIds.
        assignedBranchIds:
          r.roleKey === 'owner' ? null : pinsByMember.get(r.id) ?? null,
      }
    }),
  )
  // Franchisee scoping: a branch-restricted caller only sees members
  // assigned to a branch they run. Owner/admin (null) see everyone.
  if (auth.allowedBranchIds !== null) {
    const allowed = new Set(auth.allowedBranchIds)
    return enriched.filter((m) =>
      (m.assignedBranchIds ?? []).some((b) => allowed.has(b)),
    )
  }

  return enriched
})

// ─── Mutations ─────────────────────────────────────

/**
 * Photo data URL (e.g. "data:image/jpeg;base64,…") produced by the
 * <PhotoUploadField> component. Server splits + uploads to S3 then
 * stores the key on the member row.
 */
const photoDataUrlSchema = z
  .string()
  .regex(/^data:image\/(jpe?g|png|webp);base64,/, 'Format foto tidak didukung')
  .optional()
  .nullable()

const profileFieldsSchema = {
  firstName: z.string().min(1, 'Nama depan wajib diisi'),
  lastName: z.string().optional().nullable(),
  phone: z.string().min(6, 'Nomor HP tidak valid').optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  photoDataUrl: photoDataUrlSchema,
}

/**
 * JUR-135: branch-assignment input. The UI defaults new members to
 * "main branch only" ({ mode: 'specific', branchIds: [<isMain>] }) and
 * the owner explicitly opts into the "all branches" mode. Owner role
 * always submits `{ mode: 'all' }` and the server ignores any
 * branchIds for owner members.
 *
 * `branchIds.min(1)` is the server-side guarantee that no member ends
 * up with an effective "zero branches = no access" state. The UI
 * enforces the same rule but we re-validate here so a hand-crafted
 * request can't bypass it.
 */
const branchAssignmentSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({
    mode: z.literal('specific'),
    branchIds: z.array(z.string().uuid()).min(1, 'Pilih minimal 1 cabang'),
  }),
])
type BranchAssignment = z.infer<typeof branchAssignmentSchema>

const inviteSchema = z.object({
  email: z.string().email('Email tidak valid'),
  roleId: z.string().uuid('Role tidak valid'),
  ...profileFieldsSchema,
  branches: branchAssignmentSchema,
})

/**
 * JUR-135: guard against an admin smuggling a branch_id from a
 * different tenant into the assignment payload. Always run before
 * touching `tenant_member_branches`.
 */
async function assertBranchesBelongToTenant(
  tenantId: string,
  branchIds: string[],
): Promise<void> {
  if (branchIds.length === 0) return
  const rows = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), inArray(branches.id, branchIds)))
  if (rows.length !== branchIds.length) {
    throw new Error('Salah satu cabang tidak ditemukan di tenant ini.')
  }
}

async function persistPhotoIfPresent(
  tenantId: string,
  memberId: string,
  dataUrl: string | null | undefined,
): Promise<string | null> {
  if (!dataUrl) return null
  const { bytes, mimeType } = parseDataUrl(dataUrl)
  const { key } = await uploadTenantMemberPhoto({
    tenantId,
    memberId,
    bytes,
    mimeType,
  })
  return key
}

export const inviteTenantMember = createServerFn({ method: 'POST' })
  .inputValidator(inviteSchema)
  .handler(async ({ data }) => {
    const auth = await requirePermission('members.manage')

    // Franchisee scoping: a branch-restricted caller must invite into
    // their own branch(es), never as an all-branches member.
    if (auth.allowedBranchIds !== null) {
      if (data.branches.mode !== 'specific') {
        throw new Error('Anda harus menugaskan anggota baru ke cabang Anda.')
      }
      assertBranchesWithinScope(auth, data.branches.branchIds)
    }

    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.id, data.roleId))
      .limit(1)
    if (!role) throw new Error('Role tidak ditemukan')
    if (role.key === 'owner') {
      throw new Error('Role pemilik tidak dapat diberikan melalui undangan')
    }

    const supabase = getSupabaseServer()
    let user = await findUserByEmail(data.email)

    if (!user) {
      const { data: invited, error: inviteErr } =
        await supabase.auth.admin.inviteUserByEmail(data.email)
      if (inviteErr || !invited.user) {
        throw new Error(inviteErr?.message ?? 'Gagal mengundang pengguna')
      }
      user = invited.user
    }

    const existing = await db
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, auth.tenantId),
          eq(tenantMembers.userId, user.id),
        ),
      )
      .limit(1)
    if (existing.length > 0) {
      throw new Error('Pengguna ini sudah menjadi anggota tenant')
    }

    const [member] = await db
      .insert(tenantMembers)
      .values({
        tenantId: auth.tenantId,
        userId: user.id,
        role: role.key,
        roleId: role.id,
        firstName: data.firstName,
        lastName: data.lastName ?? null,
        phone: coerceStorablePhone(data.phone),
        jobTitle: data.jobTitle ?? null,
      })
      .returning()

    // JUR-135: pin the new member to branches (if specific). Owner role
    // never gets junction rows — it always has access to everything.
    if (member && data.branches.mode === 'specific' && role.key !== 'owner') {
      await assertBranchesBelongToTenant(auth.tenantId, data.branches.branchIds)
      await db.insert(tenantMemberBranches).values(
        data.branches.branchIds.map((branchId) => ({
          tenantMemberId: member.id,
          branchId,
        })),
      )
    }

    // Photo upload happens AFTER the insert because the key needs the
    // memberId. If it fails, we keep the member row (the owner can
    // re-upload later) but surface the error.
    let photoKey: string | null = null
    if (member && data.photoDataUrl) {
      try {
        photoKey = await persistPhotoIfPresent(
          auth.tenantId,
          member.id,
          data.photoDataUrl,
        )
        await db
          .update(tenantMembers)
          .set({ photoKey })
          .where(eq(tenantMembers.id, member.id))
      } catch (err) {
        // Non-fatal — member exists, just no photo.
        console.error('[inviteTenantMember] photo upload failed:', err)
      }
    }

    return {
      ...member!,
      photoKey,
      email: user.email ?? null,
      roleLabel: role.label,
    }
  })

const updateProfileSchema = z.object({
  memberId: z.string().uuid(),
  ...profileFieldsSchema,
})

export const updateTenantMemberProfile = createServerFn({ method: 'POST' })
  .inputValidator(updateProfileSchema)
  .handler(async ({ data }) => {
    const auth = await requirePermission('members.manage')
    await assertMemberInBranchScope(auth, data.memberId)

    const [member] = await db
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.id, data.memberId),
          eq(tenantMembers.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!member) throw new Error('Anggota tidak ditemukan')

    let photoKey = member.photoKey
    if (data.photoDataUrl) {
      const newKey = await persistPhotoIfPresent(
        auth.tenantId,
        member.id,
        data.photoDataUrl,
      )
      if (newKey && newKey !== member.photoKey && member.photoKey) {
        // Different extension → old object is now an orphan. Best-effort delete.
        try {
          await deleteTenantMemberPhoto(member.photoKey)
        } catch {
          /* swallow — orphan is acceptable */
        }
      }
      photoKey = newKey
    }

    const [updated] = await db
      .update(tenantMembers)
      .set({
        firstName: data.firstName,
        lastName: data.lastName ?? null,
        phone: coerceStorablePhone(data.phone),
        jobTitle: data.jobTitle ?? null,
        photoKey,
      })
      .where(eq(tenantMembers.id, member.id))
      .returning()

    return updated
  })

const updateRoleSchema = z.object({
  memberId: z.string().uuid(),
  roleId: z.string().uuid(),
})

export const updateTenantMemberRole = createServerFn({ method: 'POST' })
  .inputValidator(updateRoleSchema)
  .handler(async ({ data }) => {
    const auth = await requirePermission('members.manage')
    await assertMemberInBranchScope(auth, data.memberId)

    const [member] = await db
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.id, data.memberId),
          eq(tenantMembers.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!member) throw new Error('Anggota tidak ditemukan')

    const [newRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.id, data.roleId))
      .limit(1)
    if (!newRole) throw new Error('Role tidak ditemukan')
    if (newRole.key === 'owner') {
      throw new Error('Role pemilik tidak dapat diberikan melalui UI')
    }

    if (member.role === 'owner' && newRole.key !== 'owner') {
      const [ownerCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, auth.tenantId),
            eq(tenantMembers.role, 'owner'),
          ),
        )
      if ((ownerCountRow?.count ?? 0) <= 1) {
        throw new Error('Tidak dapat menurunkan pemilik terakhir')
      }
    }

    const [updated] = await db
      .update(tenantMembers)
      .set({ roleId: newRole.id, role: newRole.key })
      .where(eq(tenantMembers.id, data.memberId))
      .returning()

    // JUR-135: promoting to owner clears any branch pins — owners are
    // always unrestricted. We delete rather than leave-stale because a
    // future demote-back-to-cashier would otherwise silently re-apply
    // out-of-date scoping the owner never re-confirmed.
    if (newRole.key === 'owner') {
      await db
        .delete(tenantMemberBranches)
        .where(eq(tenantMemberBranches.tenantMemberId, data.memberId))
    }

    return updated
  })

export const removeTenantMember = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ memberId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePermission('members.manage')
    await assertMemberInBranchScope(auth, data.memberId)

    const [member] = await db
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.id, data.memberId),
          eq(tenantMembers.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!member) throw new Error('Anggota tidak ditemukan')

    if (member.userId === auth.userId) {
      throw new Error('Tidak dapat mengeluarkan diri sendiri')
    }

    if (member.role === 'owner') {
      const [ownerCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, auth.tenantId),
            eq(tenantMembers.role, 'owner'),
          ),
        )
      if ((ownerCountRow?.count ?? 0) <= 1) {
        throw new Error('Tidak dapat mengeluarkan pemilik terakhir')
      }
    }

    if (member.photoKey) {
      try {
        await deleteTenantMemberPhoto(member.photoKey)
      } catch {
        /* swallow */
      }
    }

    await db.delete(tenantMembers).where(eq(tenantMembers.id, data.memberId))
    return { success: true }
  })

// ─── JUR-135: branch assignment ─────────────────────

/**
 * Light read used by the members invite form + inline editor. Returns
 * the active branch picker list — main branch first (so it sorts to
 * the top of the dropdown / pre-selects naturally), then by createdAt
 * so order is stable across requests.
 */
export const listTenantBranchesForMembers = createServerFn().handler(async () => {
  const auth = await requirePermission('members.read')
  return db
    .select({
      id: branches.id,
      name: branches.name,
      isMain: branches.isMain,
    })
    .from(branches)
    .where(and(eq(branches.tenantId, auth.tenantId), eq(branches.isActive, true)))
    .orderBy(desc(branches.isMain), branches.createdAt)
})

const setMemberBranchesSchema = z.object({
  memberId: z.string().uuid(),
  branches: branchAssignmentSchema,
})

/**
 * Replace a member's branch pins. Used by the inline chip editor on
 * /settings/members. Idempotent — sends the full desired set and the
 * server diffs (delete + insert in one transaction) so the row UI can
 * stay simple.
 *
 * Refuses to mutate owner rows (owners are always unrestricted; the
 * UI hides the editor for them but we re-enforce here so a crafted
 * request can't write junk rows).
 */
export const setTenantMemberBranches = createServerFn({ method: 'POST' })
  .inputValidator(setMemberBranchesSchema)
  .handler(async ({ data }) => {
    const auth = await requirePermission('members.manage')
    // Franchisee scoping: can only re-pin a member already in their
    // branch, and only to branches they themselves control.
    await assertMemberInBranchScope(auth, data.memberId)
    if (auth.allowedBranchIds !== null) {
      if (data.branches.mode !== 'specific') {
        throw new Error('Anda hanya bisa menetapkan cabang yang Anda kelola.')
      }
      assertBranchesWithinScope(auth, data.branches.branchIds)
    }

    const [member] = await db
      .select({
        id: tenantMembers.id,
        role: tenantMembers.role,
        roleId: tenantMembers.roleId,
      })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.id, data.memberId),
          eq(tenantMembers.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!member) throw new Error('Anggota tidak ditemukan')

    // Resolve the canonical role key — `roles.key` is the source of
    // truth; `tenant_members.role` is the legacy text fallback. We
    // need this to decide if the owner-bypass rule applies.
    let roleKey = member.role
    if (member.roleId) {
      const [r] = await db
        .select({ key: roles.key })
        .from(roles)
        .where(eq(roles.id, member.roleId))
        .limit(1)
      if (r) roleKey = r.key
    }
    if (roleKey === 'owner') {
      throw new Error('Pemilik selalu punya akses ke semua cabang.')
    }

    await db.transaction(async (tx) => {
      // Clear existing pins. CASCADE on the branch FK would also do
      // this if we deleted the branch, but here we're replacing the
      // set for an unchanged branch, so explicit DELETE is correct.
      await tx
        .delete(tenantMemberBranches)
        .where(eq(tenantMemberBranches.tenantMemberId, data.memberId))

      if (data.branches.mode === 'specific') {
        await assertBranchesBelongToTenant(auth.tenantId, data.branches.branchIds)
        await tx.insert(tenantMemberBranches).values(
          data.branches.branchIds.map((branchId) => ({
            tenantMemberId: data.memberId,
            branchId,
          })),
        )
      }
      // mode === 'all' → leave junction empty (= unrestricted).
    })

    return { success: true }
  })

// ─── WhatsApp OTP login (PR 6) ────────────────────────

/**
 * Invite a staff member who has no email — only a WhatsApp number.
 * Generates a synthetic Supabase auth email so we can mint sessions
 * via the standard admin.generateLink flow at verify time, but the
 * user themselves only ever interacts with the WA login page.
 *
 * Two effects beyond a normal invite:
 *   1. wa_login_enabled = true on the new tenant_members row (the
 *      whole point of this path — opt-in is implicit).
 *   2. wa_login_email = "wa-{slug}-{phone}@login.vintra.local"
 *      column on tenant_members. The Supabase auth user has the SAME
 *      email; storing it on tenant_members lets the verify endpoint
 *      return it without a Supabase round-trip per attempt.
 */
const invitePhoneOnlySchema = z.object({
  firstName: z.string().min(1, 'Nama depan wajib diisi'),
  lastName: z.string().optional().nullable(),
  phone: z.string().min(6, 'Nomor HP tidak valid'),
  jobTitle: z.string().optional().nullable(),
  roleId: z.string().uuid('Role tidak valid'),
  branches: branchAssignmentSchema,
})

export const invitePhoneOnlyTenantMember = createServerFn({ method: 'POST' })
  .inputValidator(invitePhoneOnlySchema)
  .handler(async ({ data }) => {
    const auth = await requirePermission('members.manage')

    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.id, data.roleId))
      .limit(1)
    if (!role) throw new Error('Role tidak ditemukan')
    if (role.key === 'owner') {
      throw new Error('Role pemilik tidak dapat diberikan melalui undangan')
    }

    const phone = normalizeIDPhone(data.phone)
    if (!phone) throw new Error('Format nomor HP tidak dikenali')

    const [tenant] = await db
      .select({ slug: tenants.slug, publicSlug: tenants.publicSlug })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    // Synthetic email — never user-facing. The .local TLD signals
    // "not a real domain" and prevents accidental email delivery
    // attempts. The (slug, phone) tuple guarantees uniqueness across
    // tenants since `tenants.slug` is unique.
    const syntheticEmail = `wa-${tenant.slug}-${phone}@login.vintra.local`

    const supabase = getSupabaseServer()
    let user = await findUserByEmail(syntheticEmail)
    if (!user) {
      // Random password — never used for sign-in (we always go through
      // the magic-link path). Stored only so Supabase doesn't reject
      // the createUser call.
      const password = crypto.randomUUID() + crypto.randomUUID()
      const { data: created, error: createErr } =
        await supabase.auth.admin.createUser({
          email: syntheticEmail,
          password,
          email_confirm: true,
        })
      if (createErr || !created.user) {
        throw new Error(createErr?.message ?? 'Gagal membuat akun')
      }
      user = created.user
    }

    const existing = await db
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, auth.tenantId),
          eq(tenantMembers.userId, user.id),
        ),
      )
      .limit(1)
    if (existing.length > 0) {
      throw new Error('Pengguna ini sudah menjadi anggota tenant')
    }

    const [member] = await db
      .insert(tenantMembers)
      .values({
        tenantId: auth.tenantId,
        userId: user.id,
        role: role.key,
        roleId: role.id,
        firstName: data.firstName,
        lastName: data.lastName ?? null,
        phone,
        jobTitle: data.jobTitle ?? null,
        waLoginEnabled: true,
        waLoginEmail: syntheticEmail,
      })
      .returning()

    if (member && data.branches.mode === 'specific' && role.key !== 'owner') {
      await assertBranchesBelongToTenant(auth.tenantId, data.branches.branchIds)
      await db.insert(tenantMemberBranches).values(
        data.branches.branchIds.map((branchId) => ({
          tenantMemberId: member.id,
          branchId,
        })),
      )
    }

    return {
      ...member!,
      email: syntheticEmail,
      roleLabel: role.label,
      // Staff-friendly URL when the tenant has claimed a public_slug;
      // otherwise the auto slug. Both resolve to the same tenant via
      // the wa-login alias resolver — synthetic email keeps using the
      // canonical slug regardless, so existing accounts are stable.
      loginUrl: `/auth/wa-login/${tenant.publicSlug ?? tenant.slug}`,
    }
  })

/**
 * Toggle a member's wa_login_enabled flag. Owner-only (members.manage).
 * Doesn't change anything else — same row, same Supabase user, just
 * the flag. Used by the chip toggle on /settings/members.
 *
 * Note: a member with no `phone` populated can be toggled enabled, but
 * they'll never actually receive an OTP because the detector matches
 * sender phone against `tenant_members.phone`. The UI should warn /
 * disable the toggle for phone-less members.
 */
const setWaLoginSchema = z.object({
  memberId: z.string().uuid(),
  enabled: z.boolean(),
})

export const setTenantMemberWaLogin = createServerFn({ method: 'POST' })
  .inputValidator(setWaLoginSchema)
  .handler(async ({ data }) => {
    const auth = await requirePermission('members.manage')
    await assertMemberInBranchScope(auth, data.memberId)

    const [member] = await db
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.id, data.memberId),
          eq(tenantMembers.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!member) throw new Error('Anggota tidak ditemukan')

    if (data.enabled && !member.phone) {
      throw new Error(
        'Anggota harus memiliki nomor HP sebelum login WhatsApp dapat diaktifkan.',
      )
    }

    const [updated] = await db
      .update(tenantMembers)
      .set({ waLoginEnabled: data.enabled })
      .where(eq(tenantMembers.id, data.memberId))
      .returning()
    return updated
  })

/**
 * Returns the tenant's URL slug — used by the members UI to build the
 * "Bagikan link login WhatsApp" copy-button. Read-only, requires
 * members.read so cashiers see it but not anonymous traffic.
 */
export const getTenantSlugForWaLogin = createServerFn().handler(async () => {
  const auth = await requirePermission('members.read')
  const [tenant] = await db
    .select({
      slug: tenants.slug,
      publicSlug: tenants.publicSlug,
      businessName: tenants.businessName,
    })
    .from(tenants)
    .where(eq(tenants.id, auth.tenantId))
    .limit(1)
  if (!tenant) throw new Error('Tenant tidak ditemukan')
  // Prefer the vanity public_slug when claimed (memorable for staff);
  // fall back to the auto-generated internal slug. Both resolve to the
  // same tenant via the wa-login alias resolver server-side.
  const urlSlug = tenant.publicSlug ?? tenant.slug
  return {
    slug: tenant.slug,
    publicSlug: tenant.publicSlug,
    businessName: tenant.businessName,
    loginUrl: `/auth/wa-login/${urlSlug}`,
  }
})

/**
 * WhatsApp-login readiness. Inviting a phone-only member only works if
 * the tenant has a connected WA instance to send the login OTP through
 * — owning the WhatsApp module isn't enough. The invite form gates the
 * "WhatsApp (tanpa email)" option on this.
 */
export const getWaLoginAvailability = createServerFn().handler(async () => {
  const auth = await requirePermission('members.read')
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(waInstances)
    .where(
      and(
        eq(waInstances.tenantId, auth.tenantId),
        eq(waInstances.status, 'connected'),
      ),
    )
  return { available: (row?.c ?? 0) > 0 }
})
