/**
 * Pre-defined permission bundles for the /settings/roles editor.
 * Pure code-level data — picking a template just pre-checks the
 * editor's checkboxes; the owner can tweak then save.
 *
 * Keys reference rows seeded by `seed-rbac.ts`. Keep this list in sync
 * with the PERMISSIONS array there — TS won't catch a typo until
 * runtime when the unknown key gets silently dropped by `applyPermissions`.
 */

export interface RoleTemplate {
  /** Stable id used by the dropdown. */
  id: string
  /** Indonesian-language name shown in the picker. */
  label: string
  /** Short hint explaining the template's scope. */
  description: string
  /** Pre-filled permission keys. Owner can tweak before saving. */
  permissionKeys: string[]
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: 'kosong',
    label: 'Kosong',
    description: 'Mulai tanpa centang. Pilih sendiri akses yang dibutuhkan.',
    permissionKeys: [],
  },
  {
    id: 'kasir',
    label: 'Kasir',
    description:
      'Bisa membuat transaksi POS. Tidak bisa membatalkan/void — itu tugas Supervisor.',
    permissionKeys: ['pos.read', 'pos.transact'],
  },
  {
    id: 'pegawai-absensi',
    label: 'Pegawai Absensi',
    description: 'Hanya bisa absensi (clock in/out). Cocok untuk staf operasional.',
    permissionKeys: ['attendance.read', 'attendance.write'],
  },
  {
    id: 'manajer-stok',
    label: 'Manajer Stok',
    description:
      'Kelola inventaris, mutasi stok, pembelian, dan lihat HPP. Tidak melihat POS.',
    permissionKeys: [
      'inventory.read',
      'inventory.write',
      'inventory.manage',
      'hpp.read',
    ],
  },
  {
    id: 'supervisor-outlet',
    label: 'Supervisor Outlet',
    description:
      'Mengawasi POS (termasuk void/cancel), stok, absensi, dan booking outlet.',
    permissionKeys: [
      'pos.read',
      'pos.transact',
      'pos.manage',
      'inventory.read',
      'inventory.write',
      'attendance.read',
      'attendance.write',
      'attendance.manage',
      'finance.read',
      'booking.read',
      'booking.write',
    ],
  },
]
