import { db } from './client'
import { roles, permissions, rolePermissions, tenantMembers } from './schema'
import { eq, isNull, sql } from 'drizzle-orm'

type PermissionSeed = {
  key: string
  label: string
  module: string
  description?: string
}

const PERMISSIONS: PermissionSeed[] = [
  // HPP module
  { key: 'hpp.read', label: 'Lihat HPP', module: 'hpp' },
  { key: 'hpp.write', label: 'Kelola HPP', module: 'hpp' },
  { key: 'hpp.delete', label: 'Hapus data HPP', module: 'hpp' },
  // POS module
  { key: 'pos.read', label: 'Lihat POS', module: 'pos' },
  { key: 'pos.transact', label: 'Buat transaksi POS', module: 'pos' },
  { key: 'pos.manage', label: 'Kelola pengaturan POS', module: 'pos' },
  // Gates the /pos/reports (Laporan) and /pos/reports/prep-waste pages
  // separately from pos.read. Cashiers with pos.read can see their own
  // sales history but should not pull tenant-wide P&L. Owner / Admin /
  // Pemilik Outlet / Supervisor get this; Kasir doesn't.
  { key: 'pos.report.view', label: 'Lihat laporan POS', module: 'pos' },
  // Owner-only by default: gates HPP cost, untung kotor, and margin %
  // on /pos/reports. Supervisor with pos.report.view sees revenue /
  // transaction stats; only owner + admin + outlet_owner see profit.
  { key: 'pos.report.profit', label: 'Lihat margin & untung POS', module: 'pos' },
  // Inventory module
  { key: 'inventory.read', label: 'Lihat stok', module: 'inventory' },
  { key: 'inventory.write', label: 'Catat keluar/masuk stok', module: 'inventory' },
  { key: 'inventory.manage', label: 'Kelola inventaris', module: 'inventory' },
  // Attendance module
  { key: 'attendance.read', label: 'Lihat absensi', module: 'attendance' },
  { key: 'attendance.write', label: 'Catat absensi', module: 'attendance' },
  { key: 'attendance.manage', label: 'Kelola absensi & karyawan', module: 'attendance' },
  { key: 'attendance.report', label: 'Lihat laporan absensi', module: 'attendance' },
  // Finance module
  { key: 'finance.read', label: 'Lihat laporan keuangan', module: 'finance' },
  { key: 'finance.manage', label: 'Kelola laporan keuangan', module: 'finance' },
  // WhatsApp module
  { key: 'whatsapp.read', label: 'Lihat WhatsApp', module: 'whatsapp' },
  { key: 'whatsapp.manage', label: 'Kelola WhatsApp', module: 'whatsapp' },
  // Booking module
  { key: 'booking.read', label: 'Lihat Booking', module: 'booking' },
  { key: 'booking.write', label: 'Kelola Booking', module: 'booking' },
  // Announcements (Pengumuman) — broadcast to staff. Reading needs no
  // permission (every member sees announcements); this gates authoring.
  { key: 'announcements.manage', label: 'Kelola pengumuman', module: 'announcements' },
  // Settings & members (cross-cutting)
  { key: 'settings.read', label: 'Lihat pengaturan', module: 'settings' },
  { key: 'settings.manage', label: 'Kelola pengaturan tenant', module: 'settings' },
  { key: 'members.read', label: 'Lihat anggota', module: 'members' },
  { key: 'members.manage', label: 'Kelola anggota & role', module: 'members' },
]

type RoleSeed = {
  key: string
  label: string
  description: string
  isSystem: boolean
  sortOrder: number
  permissionKeys: string[] | 'all' | 'all-except-settings-manage'
}

const ROLES: RoleSeed[] = [
  {
    key: 'owner',
    label: 'Pemilik',
    description: 'Pemilik usaha — akses penuh, tidak dapat diturunkan dari UI.',
    isSystem: true,
    sortOrder: 10,
    permissionKeys: 'all',
  },
  {
    key: 'admin',
    label: 'Admin',
    description: 'Akses penuh kecuali pengaturan tenant kritis.',
    isSystem: true,
    sortOrder: 20,
    permissionKeys: 'all-except-settings-manage',
  },
  {
    // Franchisee — runs one franchise branch semi-autonomously. The
    // branch-scoping (these powers apply only to *their* branch) is
    // enforced by tenant_member_branches, not the role: a member with
    // this role is always pinned to exactly one branch. They get full
    // operational control of that outlet but only read access to the
    // HQ-owned catalog (hpp.read, no hpp.write) and no tenant settings.
    key: 'outlet_owner',
    label: 'Pemilik Outlet',
    description:
      'Pemilik outlet waralaba — mengelola cabangnya sendiri (staf, jam buka, arus kas, permintaan stok). Katalog & harga ditetapkan pusat.',
    isSystem: true,
    sortOrder: 25,
    permissionKeys: [
      'hpp.read',
      'pos.read', 'pos.transact', 'pos.manage',
      'pos.report.view', 'pos.report.profit',
      'inventory.read', 'inventory.write',
      'attendance.read', 'attendance.write', 'attendance.manage',
      'finance.read', 'finance.manage',
      'whatsapp.read',
      'booking.read', 'booking.write',
      'announcements.manage',
      'settings.read',
      'members.read', 'members.manage',
    ],
  },
  {
    key: 'supervisor',
    label: 'Supervisor',
    description: 'Mengawasi operasional — dapat melihat dan menulis sebagian besar modul.',
    isSystem: false,
    sortOrder: 30,
    permissionKeys: [
      'hpp.read', 'hpp.write',
      'pos.read', 'pos.transact',
      'pos.report.view',
      'inventory.read', 'inventory.write',
      'attendance.read', 'attendance.write', 'attendance.report',
      'finance.read',
      'whatsapp.read',
      'booking.read', 'booking.write',
      'announcements.manage',
      'settings.read',
      'members.read',
    ],
  },
  {
    key: 'staff',
    label: 'Staff',
    description: 'Akses terbatas — hanya absensi. Role operasional lain tersedia untuk tugas spesifik.',
    isSystem: false,
    sortOrder: 40,
    permissionKeys: [
      'attendance.read', 'attendance.write',
    ],
  },
  {
    key: 'cashier',
    label: 'Kasir',
    description: 'Membuat transaksi POS dan melihat riwayat penjualannya.',
    isSystem: false,
    sortOrder: 50,
    // pos.read gates /pos/sales (history) — owners regularly need their
    // cashiers to look up past transactions for reprints, refunds, and
    // customer questions. Profit/margin on /pos/reports stays gated on
    // pos.report.profit so cashiers don't see margin.
    permissionKeys: ['pos.transact', 'pos.read'],
  },
]

async function seedRbac() {
  console.log('Seeding RBAC...')

  // 1. Insert permissions (idempotent)
  await db
    .insert(permissions)
    .values(PERMISSIONS)
    .onConflictDoNothing({ target: permissions.key })
  console.log(`  Seeded ${PERMISSIONS.length} permissions`)

  // 2. Insert roles (idempotent)
  await db
    .insert(roles)
    .values(
      ROLES.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description,
        isSystem: r.isSystem,
        sortOrder: r.sortOrder,
      })),
    )
    // roles_system_key_unique is a partial index (WHERE tenant_id IS NULL),
    // so the conflict target must include its predicate for Postgres to infer it
    .onConflictDoNothing({ target: roles.key, where: sql`tenant_id is null` })
  console.log(`  Seeded ${ROLES.length} roles`)

  // 3. Re-fetch role + permission rows to get their IDs
  const allRoles = await db.select().from(roles)
  const allPerms = await db.select().from(permissions)
  const roleIdByKey = new Map(allRoles.map((r) => [r.key, r.id]))
  const permIdByKey = new Map(allPerms.map((p) => [p.key, p.id]))

  // 4. Insert role_permissions mappings (idempotent on unique constraint)
  for (const role of ROLES) {
    const roleId = roleIdByKey.get(role.key)
    if (!roleId) continue

    let permKeys: string[]
    if (role.permissionKeys === 'all') {
      permKeys = PERMISSIONS.map((p) => p.key)
    } else if (role.permissionKeys === 'all-except-settings-manage') {
      permKeys = PERMISSIONS.map((p) => p.key).filter(
        (k) => k !== 'settings.manage',
      )
    } else {
      permKeys = role.permissionKeys
    }

    const mappings = permKeys
      .map((k) => permIdByKey.get(k))
      .filter((id): id is string => !!id)
      .map((permissionId) => ({ roleId, permissionId }))

    if (mappings.length > 0) {
      await db
        .insert(rolePermissions)
        .values(mappings)
        .onConflictDoNothing()
    }
    console.log(`  ${role.key}: ${mappings.length} permissions`)
  }

  // 5. Backfill tenant_members.role_id from existing text role values
  const ownerRoleId = roleIdByKey.get('owner')
  const staffRoleId = roleIdByKey.get('staff')
  if (!ownerRoleId || !staffRoleId) {
    throw new Error('Default roles missing — cannot backfill members')
  }

  const ownerBackfill = await db
    .update(tenantMembers)
    .set({ roleId: ownerRoleId })
    .where(sql`${tenantMembers.roleId} IS NULL AND ${tenantMembers.role} = 'owner'`)
    .returning({ id: tenantMembers.id })

  const memberBackfill = await db
    .update(tenantMembers)
    .set({ roleId: staffRoleId })
    .where(isNull(tenantMembers.roleId))
    .returning({ id: tenantMembers.id })

  console.log(
    `  Backfilled ${ownerBackfill.length} owners + ${memberBackfill.length} other members`,
  )

  console.log('RBAC seed complete.')
  process.exit(0)
}

seedRbac().catch((err) => {
  console.error('seed-rbac failed:', err)
  process.exit(1)
})
