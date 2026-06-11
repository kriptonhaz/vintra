import { createServerFn } from '@tanstack/react-start'
import { createClient } from '@supabase/supabase-js'
import { db } from '@vintra/db'
import {
  tenants,
  tenantMembers,
  platformAdmins,
  products,
  productMaterials,
  materials,
  suppliers,
  overheadCosts,
  tenantCategories,
  platformAdminAuditLogs,
  activeImpersonations,
  waSettings,
  branches,
} from '@vintra/db/schema'
import { eq, desc, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getOptionalAuth } from '../middleware/auth'
import { requirePlatformAdmin, isPlatformAdmin } from '../middleware/platform-admin'

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

async function getUsersEmails(userIds: string[]): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(userIds))
  const pairs = await Promise.all(
    unique.map(async (id) => [id, await getUserEmail(id)] as const),
  )
  return Object.fromEntries(pairs)
}

// ─── Status check (called by user-facing UI to decide whether to show admin link) ────

export const getPlatformAdminStatus = createServerFn().handler(async () => {
  const auth = await getOptionalAuth()
  if (!auth) return { isPlatformAdmin: false }
  return { isPlatformAdmin: await isPlatformAdmin(auth.userId) }
})

// ─── Tenants ────────────────────────────────────────

const listTenantsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(100).default(25),
  search: z.string().optional(),
})

export const listTenants = createServerFn()
  .inputValidator(listTenantsSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const offset = (data.page - 1) * data.pageSize
    const conds = []
    if (data.search && data.search.trim().length > 0) {
      const q = `%${data.search.trim().toLowerCase()}%`
      conds.push(sql`(lower(${tenants.businessName}) LIKE ${q} OR lower(${tenants.slug}) LIKE ${q})`)
    }

    // Compute subscription status per tenant via correlated subqueries.
    //
    // Status derivation (first match wins):
    //   - 'comp'  — has an applied, unexpired comp grant (free access,
    //               JUR-194) — checked first so a comped tenant isn't
    //               mislabelled "Berbayar"
    //   - 'paid'  — attendance subscription_active AND not expired
    //   - 'trial' — attendance trial_ends_at > now (and not paid)
    //   - 'free'  — none of the above
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: tenants.id,
          businessName: tenants.businessName,
          slug: tenants.slug,
          ownerId: tenants.ownerId,
          plan: tenants.plan,
          activeModules: tenants.activeModules,
          businessCategory: tenants.businessCategory,
          onboardingCompleted: tenants.onboardingCompleted,
          createdAt: tenants.createdAt,
          // Hand-qualify both columns: Drizzle's `${column}` inside a subquery
          // literal renders unqualified names, so `tenant_id = id` would resolve
          // both against tenant_members and always be false.
          memberCount: sql<number>`(select count(*)::int from tenant_members where tenant_members.tenant_id = tenants.id)`,
          subscriptionStatus: sql<'paid' | 'trial' | 'free' | 'comp'>`(
            select case
              when exists (
                select 1 from comp_grants cg
                where cg.tenant_id = tenants.id
                  and cg.status = 'applied'
                  and (cg.expires_at is null or cg.expires_at > now())
              ) then 'comp'
              when exists (
                select 1 from attendance_settings s
                where s.tenant_id = tenants.id
                  and s.subscription_active = true
                  and s.subscription_expires_at > now()
              ) then 'paid'
              when exists (
                select 1 from attendance_settings s
                where s.tenant_id = tenants.id and s.trial_ends_at > now()
              ) then 'trial'
              else 'free'
            end
          )`,
        })
        .from(tenants)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(tenants.createdAt))
        .limit(data.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tenants)
        .where(conds.length > 0 ? and(...conds) : undefined)
    ])

    const totalCount = totalRow[0]?.count ?? 0
    const emails = await getUsersEmails(rows.map((r) => r.ownerId))

    return {
      rows: rows.map((r) => ({
        ...r,
        ownerEmail: emails[r.ownerId] ?? null,
        // Coalesce null to 'free' — tenants with no attendance_settings row
        // are HPP-only, which is free.
        subscriptionStatus: r.subscriptionStatus ?? 'free',
      })),
      page: data.page,
      pageSize: data.pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / data.pageSize)),
    }
  })

export const getTenantDetail = createServerFn()
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)

    if (!tenant) throw new Error('Tenant tidak ditemukan')

    const members = await db
      .select({
        id: tenantMembers.id,
        userId: tenantMembers.userId,
        role: tenantMembers.role,
        phone: tenantMembers.phone,
        createdAt: tenantMembers.createdAt,
      })
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, data.tenantId))
      .orderBy(tenantMembers.createdAt)

    const [counts] = await db
      .select({
        products: sql<number>`(select count(*)::int from ${products} where ${products.tenantId} = ${tenant.id})`,
        materials: sql<number>`(select count(*)::int from ${materials} where ${materials.tenantId} = ${tenant.id})`,
        branches: sql<number>`(select count(*)::int from ${branches} where ${branches.tenantId} = ${tenant.id})`,
      })
      .from(tenants)
      .where(eq(tenants.id, tenant.id))

    const emails = await getUsersEmails([
      tenant.ownerId,
      ...members.map((m) => m.userId),
    ])

    const [waSub] = await db
      .select({
        tier: waSettings.tier,
        subscriptionActive: waSettings.subscriptionActive,
        subscriptionExpiresAt: waSettings.subscriptionExpiresAt,
      })
      .from(waSettings)
      .where(eq(waSettings.tenantId, tenant.id))
      .limit(1)

    const waExpiresAt = waSub?.subscriptionExpiresAt ? new Date(waSub.subscriptionExpiresAt) : null
    const waSubscriptionActive = !!(waSub?.subscriptionActive) && (!waExpiresAt || waExpiresAt.getTime() > Date.now())

    // Owner's phone lives on tenant_members.phone (collected at
    // register-time). Surface it on the detail payload so the admin
    // info panel can show a tappable WhatsApp/call link.
    const ownerPhone =
      members.find((m) => m.userId === tenant.ownerId)?.phone ?? null

    return {
      tenant: {
        ...tenant,
        ownerEmail: emails[tenant.ownerId] ?? null,
        ownerPhone,
      },
      members: members.map((m) => ({ ...m, email: emails[m.userId] ?? null })),
      counts: counts ?? { products: 0, materials: 0, branches: 0 },
      waSubscription: {
        tier: waSub?.tier ?? 'free',
        active: waSubscriptionActive,
        expiresAt: waExpiresAt ? waExpiresAt.toISOString() : null,
      },
    }
  })

export const deleteTenant = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tenantId: z.string().uuid(),
      confirmBusinessName: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    // Re-check the typed confirmation server-side.
    if (data.confirmBusinessName.trim() !== tenant.businessName.trim()) {
      throw new Error('Nama usaha tidak cocok')
    }

    // Collect userIds before deleting memberships — needed for the orphan
    // check afterwards.
    const memberRows = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, data.tenantId))
    const affectedUserIds = Array.from(
      new Set([tenant.ownerId, ...memberRows.map((r) => r.userId)]),
    )

    // Atomic cleanup of tenant-owned rows. Ordering matters for tables
    // without onDelete: cascade (HPP tables, tenant_members, tenant_categories).
    // Attendance tables cascade automatically when the tenants row is removed.
    await db.transaction(async (tx) => {
      await tx
        .delete(productMaterials)
        .where(eq(productMaterials.tenantId, data.tenantId))
      await tx.delete(products).where(eq(products.tenantId, data.tenantId))
      await tx.delete(materials).where(eq(materials.tenantId, data.tenantId))
      await tx.delete(suppliers).where(eq(suppliers.tenantId, data.tenantId))
      await tx
        .delete(overheadCosts)
        .where(eq(overheadCosts.tenantId, data.tenantId))
      await tx
        .delete(tenantCategories)
        .where(eq(tenantCategories.tenantId, data.tenantId))
      await tx
        .delete(tenantMembers)
        .where(eq(tenantMembers.tenantId, data.tenantId))
      await tx.delete(tenants).where(eq(tenants.id, data.tenantId))
    })

    // Post-delete: clean up auth users who have no remaining tenant_members
    // rows anywhere. Runs outside the DB transaction because Supabase admin
    // calls aren't transactional; a failure here leaves an orphan auth
    // account but never leaves partial DB state.
    const supabase = getSupabaseServer()
    const deletedAuthUserIds: string[] = []
    for (const userId of affectedUserIds) {
      const [stillMember] = await db
        .select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, userId))
        .limit(1)
      if (!stillMember) {
        const { error } = await supabase.auth.admin.deleteUser(userId)
        if (!error) deletedAuthUserIds.push(userId)
      }
    }

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'tenant_delete',
      targetTenantId: null,
      targetUserId: null,
      metadata: {
        deletedTenant: {
          id: tenant.id,
          businessName: tenant.businessName,
          slug: tenant.slug,
          plan: tenant.plan,
          createdAt: tenant.createdAt,
        },
        memberCount: affectedUserIds.length,
        deletedAuthUserCount: deletedAuthUserIds.length,
      },
    })

    return {
      success: true as const,
      deletedAuthUserCount: deletedAuthUserIds.length,
    }
  })

// ─── Module activation toggle ────────────────────────

export const setTenantActiveModules = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    tenantId: z.string().uuid(),
    modules: z.array(z.string()),
  }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .update(tenants)
      .set({ activeModules: data.modules })
      .where(eq(tenants.id, data.tenantId))
    return null
  })

// ─── Platform admins management ─────────────────────

export const listPlatformAdmins = createServerFn().handler(async () => {
  await requirePlatformAdmin()

  const rows = await db
    .select()
    .from(platformAdmins)
    .orderBy(desc(platformAdmins.createdAt))

  const emails = await getUsersEmails(rows.map((r) => r.userId))
  return rows.map((r) => ({ ...r, email: emails[r.userId] ?? null }))
})

export const grantPlatformAdmin = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ email: z.string().email('Email tidak valid') }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const supabase = getSupabaseServer()
    // listUsers is the only reliable way to find a user by email via admin API
    const { data: list, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    if (error) throw new Error('Gagal mencari pengguna')

    const target = list.users.find(
      (u) => u.email?.toLowerCase() === data.email.toLowerCase(),
    )
    if (!target) throw new Error('Pengguna dengan email tersebut belum terdaftar')

    const existing = await db
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.userId, target.id))
      .limit(1)

    if (existing.length > 0) {
      throw new Error('Pengguna sudah menjadi admin platform')
    }

    const [created] = await db
      .insert(platformAdmins)
      .values({ userId: target.id, createdBy: auth.userId })
      .returning()

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'grant_admin',
      targetUserId: target.id,
      metadata: { email: target.email ?? null },
    })

    return { ...created, email: target.email ?? null }
  })

export const revokePlatformAdmin = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    if (data.userId === auth.userId) {
      throw new Error('Tidak dapat mencabut akses admin untuk diri sendiri')
    }

    // Prevent removing the last platform admin
    const [adminCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(platformAdmins)

    if ((adminCountRow?.count ?? 0) <= 1) {
      throw new Error('Tidak dapat mencabut admin terakhir')
    }

    // Clear any active impersonation for the user being revoked, then delete admin row
    await db
      .delete(activeImpersonations)
      .where(eq(activeImpersonations.adminUserId, data.userId))

    await db
      .delete(platformAdmins)
      .where(eq(platformAdmins.userId, data.userId))

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'revoke_admin',
      targetUserId: data.userId,
    })

    return { success: true }
  })

// ─── Audit log ──────────────────────────────────────

export const listAuditLogs = createServerFn().handler(async () => {
  await requirePlatformAdmin()

  const rows = await db
    .select()
    .from(platformAdminAuditLogs)
    .orderBy(desc(platformAdminAuditLogs.createdAt))
    .limit(200)

  // Resolve admin user emails + (optionally) target user emails
  const userIds = Array.from(
    new Set([
      ...rows.map((r) => r.adminUserId),
      ...rows.flatMap((r) => (r.targetUserId ? [r.targetUserId] : [])),
    ]),
  )
  const emails = await getUsersEmails(userIds)

  // Resolve target tenant names
  const tenantIds = Array.from(
    new Set(rows.flatMap((r) => (r.targetTenantId ? [r.targetTenantId] : []))),
  )
  const tenantNames: Record<string, string> = {}
  if (tenantIds.length > 0) {
    const ts = await db
      .select({ id: tenants.id, businessName: tenants.businessName })
      .from(tenants)
    for (const t of ts) tenantNames[t.id] = t.businessName
  }

  return rows.map((r) => ({
    ...r,
    adminEmail: emails[r.adminUserId] ?? null,
    targetEmail: r.targetUserId ? emails[r.targetUserId] ?? null : null,
    targetTenantName: r.targetTenantId
      ? tenantNames[r.targetTenantId] ?? null
      : null,
  }))
})
