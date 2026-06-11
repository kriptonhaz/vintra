/**
 * Tenant-owner RBAC page (issue #209 follow-up).
 *
 * The tenant owner curates a per-tenant pool of roles on top of the
 * 6 built-in system roles. The flow:
 *   1. /settings/members → "Tambah Anggota" → role dropdown shows
 *      `getRolesForAssignment()` = system + this tenant's custom roles.
 *   2. Owner needs a combo the system roles don't cover (e.g.
 *      "Kasir + Stok") → here they create it once and assign forever.
 *   3. Outlet owners (Pemilik Outlet, future) only pick from the pool
 *      — they don't create their own. Curation stays with the tenant
 *      owner so all branches share one role catalog.
 *
 * The editor sheet mirrors Kledo's pattern: module-grouped permission
 * rows, tri-state module headers, optional "Mulai dari template" pre-
 * fill. System roles render read-only so the owner sees what each
 * built-in does — those roles also work as implicit templates ("Mulai
 * dari peran sistem" → pre-checks that role's permissions).
 */
import { useState, useMemo } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Users,
} from 'lucide-react'
import {
  listTenantRoles,
  listAllPermissions,
  createTenantRole,
  updateTenantRole,
  deleteTenantRole,
} from '@/server/functions/tenant-roles'
import { ROLE_TEMPLATES } from '@/lib/role-templates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

// Module display names — keys match `permissions.module` values seeded
// in seed-rbac.ts. New module? Add an entry here so the editor groups
// it under a recognisable header.
const MODULE_LABELS: Record<string, string> = {
  hpp: 'HPP / Kalkulator Modal',
  pos: 'POS / Kasir',
  inventory: 'Inventaris',
  attendance: 'Absensi',
  finance: 'Keuangan',
  whatsapp: 'WhatsApp',
  booking: 'Booking',
  settings: 'Pengaturan',
  members: 'Anggota / Tim',
}

type RoleRow = Awaited<ReturnType<typeof listTenantRoles>>[number]
type Permission = Awaited<ReturnType<typeof listAllPermissions>>[number]
type EditingState = { kind: 'create' } | { kind: 'edit'; role: RoleRow }

export const Route = createFileRoute('/_authed/settings/roles')({
  beforeLoad: ({ context }) => {
    // Owner-only: curating the role pool gates every other member's
    // privileges, so we restrict to settings.manage (owner role).
    const user = (context as {
      user?: { permissions?: string[] }
    }).user
    if (!user?.permissions?.includes('settings.manage')) {
      throw redirect({ to: '/settings/members' })
    }
  },
  loader: async () => {
    const [list, permissions] = await Promise.all([
      listTenantRoles(),
      listAllPermissions(),
    ])
    return { list, permissions }
  },
  component: RolesPage,
})

function RolesPage() {
  const { list, permissions } = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [deleting, setDeleting] = useState<RoleRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // JUR-206: a role is editable only when it's both `!isSystem` AND
  // tenant-scoped (tenantId != null). Globally seeded roles like
  // Kasir / Supervisor / Staff carry isSystem=false but tenantId=null
  // and the server's loadEditableRole rejects mutations on them, so
  // surfacing them as "custom" used to make the editor sheet appear
  // editable while the save silently reverted. Bucket them with the
  // identity-defining system roles (Pemilik / Admin / Pemilik Outlet).
  const customRoles = list.filter((r) => !r.isSystem && r.tenantId !== null)
  const systemRoles = list.filter((r) => r.isSystem || r.tenantId === null)

  async function handleDelete() {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await deleteTenantRole({ data: { id: deleting.id } })
      setDeleting(null)
      await router.invalidate()
      queryClient.invalidateQueries({ queryKey: ['roles-for-assignment'] })
      toast({
        title: 'Peran dihapus',
        description: `Peran "${deleting.label}" dihapus.`,
        variant: 'success',
      })
    } catch (err) {
      toast({
        title: 'Gagal menghapus peran',
        description: err instanceof Error ? err.message : 'Terjadi kesalahan.',
        variant: 'error',
      })
    } finally {
      setDeleteLoading(false)
    }
  }

  async function handleSaved() {
    setEditing(null)
    await router.invalidate()
    queryClient.invalidateQueries({ queryKey: ['roles-for-assignment'] })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Peran & Akses
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Atur siapa bisa apa di tenant Anda. Buat peran kustom untuk
            kombinasi akses yang tidak tersedia di peran bawaan.
          </p>
        </div>
        <Button variant="brand" onClick={() => setEditing({ kind: 'create' })}>
          <Plus className="h-4 w-4" />
          Tambah Peran
        </Button>
      </div>

      <RoleSection
        title="Peran kustom"
        hint="Peran yang Anda buat sendiri. Klik untuk mengubah izinnya."
        emptyHint="Belum ada peran kustom. Klik “Tambah Peran” untuk membuat yang pertama."
      >
        {customRoles.map((r) => (
          <RoleCard
            key={r.id}
            role={r}
            permissions={permissions}
            onEdit={() => setEditing({ kind: 'edit', role: r })}
            onDelete={() => setDeleting(r)}
          />
        ))}
      </RoleSection>

      <RoleSection
        title="Peran bawaan sistem"
        hint="Tidak bisa diedit. Bisa dipakai langsung saat menambahkan anggota."
      >
        {systemRoles.map((r) => (
          <RoleCard key={r.id} role={r} permissions={permissions} readonly />
        ))}
      </RoleSection>

      {editing && (
        <RoleEditorSheet
          permissions={permissions}
          state={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Hapus peran?"
        description={
          deleting
            ? `Peran "${deleting.label}" akan dihapus permanen. Anggota yang masih memakai peran ini harus dipindahkan dulu.`
            : undefined
        }
        confirmText="Hapus"
        variant="danger"
        loading={deleteLoading}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

// ─── Section + cards ────────────────────────────────────────────────

function RoleSection({
  title,
  hint,
  emptyHint,
  children,
}: {
  title: string
  hint?: string
  emptyHint?: string
  children: React.ReactNode
}) {
  const hasChildren = !!(
    Array.isArray(children) ? children.length : children
  )
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {title}
        </h2>
        {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      </div>
      {hasChildren ? (
        <div className="space-y-2">{children}</div>
      ) : emptyHint ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
          {emptyHint}
        </div>
      ) : null}
    </div>
  )
}

function RoleCard({
  role,
  permissions,
  readonly,
  onEdit,
  onDelete,
}: {
  role: RoleRow
  permissions: Permission[]
  readonly?: boolean
  onEdit?: () => void
  onDelete?: () => void
}) {
  // Summarise the role's permissions as a list of module-level chips
  // ("POS · Inventaris · Absensi"). The detailed grid lives in the
  // editor sheet — the card stays at a glance.
  const modules = useMemo(() => {
    const set = new Set<string>()
    for (const k of role.permissionKeys) {
      const p = permissions.find((x) => x.key === k)
      if (p) set.add(p.module)
    }
    return [...set]
      .map((m) => MODULE_LABELS[m] ?? m)
      .sort((a, b) => a.localeCompare(b, 'id'))
  }, [role.permissionKeys, permissions])

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {role.isSystem ? (
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary-600" />
          ) : null}
          <p className="truncate font-semibold text-gray-900 dark:text-gray-100">
            {role.label}
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            <Users className="h-3 w-3" />
            {role.memberCount}
          </span>
        </div>
        {role.description && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {role.description}
          </p>
        )}
        {modules.length > 0 ? (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Akses: <span className="text-gray-700 dark:text-gray-200">{modules.join(' · ')}</span>
          </p>
        ) : (
          <p className="mt-2 text-xs text-gray-400">Tanpa akses modul.</p>
        )}
      </div>
      {!readonly && (
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" onClick={onEdit} className="h-8 px-2">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={onDelete}
            className="h-8 px-2 text-danger-600 hover:text-danger-700"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Editor sheet ───────────────────────────────────────────────────

function RoleEditorSheet({
  permissions,
  state,
  onClose,
  onSaved,
}: {
  permissions: Permission[]
  state: EditingState
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const { toast } = useToast()
  const initial = state.kind === 'edit' ? state.role : null

  const [label, setLabel] = useState(initial?.label ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial?.permissionKeys ?? []),
  )
  const [templateId, setTemplateId] = useState<string>('kosong')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Group permissions by module — drives the collapsible UI below.
  // The seed already orders by module + key, so we just bucket
  // sequentially and preserve order within each module.
  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>()
    for (const p of permissions) {
      const list = map.get(p.module) ?? []
      list.push(p)
      map.set(p.module, list)
    }
    return [...map.entries()].map(([module, perms]) => ({
      module,
      label: MODULE_LABELS[module] ?? module,
      perms,
    }))
  }, [permissions])

  const allKeys = useMemo(() => permissions.map((p) => p.key), [permissions])

  function toggleOne(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function setMany(keys: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }
  function pickTemplate(id: string) {
    setTemplateId(id)
    const tpl = ROLE_TEMPLATES.find((t) => t.id === id)
    if (!tpl) return
    setSelected(new Set(tpl.permissionKeys))
  }

  async function handleSave() {
    if (!label.trim()) {
      setError('Nama peran wajib diisi.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        label: label.trim(),
        description: description.trim() || null,
        permissionKeys: [...selected],
      }
      if (state.kind === 'edit') {
        await updateTenantRole({ data: { id: state.role.id, ...payload } })
        toast({
          title: 'Peran diperbarui',
          description: `"${payload.label}" disimpan.`,
          variant: 'success',
        })
      } else {
        await createTenantRole({ data: payload })
        toast({
          title: 'Peran dibuat',
          description: `"${payload.label}" siap dipakai.`,
          variant: 'success',
        })
      }
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan peran.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {state.kind === 'edit' ? 'Ubah Peran' : 'Tambah Peran'}
        </SheetTitle>
        <SheetDescription>
          Atur akses per modul. Centang per item atau pakai tombol
          “Semua” di header modul untuk pilih sekaligus.
        </SheetDescription>
      </SheetHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          void handleSave()
        }}
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Nama Peran
            </label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Contoh: Kasir Pagi"
              disabled={saving}
              maxLength={60}
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Deskripsi (opsional)
            </label>
            <Input
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Catatan singkat untuk diri sendiri"
              disabled={saving}
              maxLength={200}
            />
          </div>

          {state.kind === 'create' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Mulai dari template
              </label>
              <select
                value={templateId}
                onChange={(e) => pickTemplate(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                {ROLE_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {ROLE_TEMPLATES.find((t) => t.id === templateId)?.description}
              </p>
            </div>
          )}

          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Izin per Modul
              </p>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setMany(allKeys, true)}
                  className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  Pilih Semua
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={() => setMany(allKeys, false)}
                  className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  Hapus Semua
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {grouped.map((g) => (
                <ModuleBlock
                  key={g.module}
                  module={g.module}
                  label={g.label}
                  perms={g.perms}
                  selected={selected}
                  onTogglePerm={toggleOne}
                  onSetAll={(on) => setMany(g.perms.map((p) => p.key), on)}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-900/20 dark:text-danger-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" variant="brand" loading={saving}>
            Simpan
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

// ─── Module block (collapsible) ─────────────────────────────────────

function ModuleBlock({
  module,
  label,
  perms,
  selected,
  onTogglePerm,
  onSetAll,
}: {
  module: string
  label: string
  perms: Permission[]
  selected: Set<string>
  onTogglePerm: (key: string) => void
  onSetAll: (on: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const checkedCount = perms.filter((p) => selected.has(p.key)).length
  const state: 'all' | 'some' | 'none' =
    checkedCount === 0
      ? 'none'
      : checkedCount === perms.length
        ? 'all'
        : 'some'

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
          aria-label={`Toggle ${label}`}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {label}
          </span>
          <span className="text-xs text-gray-500">
            ({checkedCount}/{perms.length})
          </span>
        </button>
        <TriStateCheckbox
          state={state}
          onChange={(on) => onSetAll(on)}
          ariaLabel={`Pilih semua ${label}`}
        />
      </div>
      {expanded && (
        <ul className="divide-y divide-gray-100 bg-white dark:divide-gray-700 dark:bg-gray-900">
          {perms.map((p) => (
            <li
              key={p.key}
              className="flex items-start justify-between gap-3 px-4 py-2.5"
            >
              <label className="min-w-0 flex-1 cursor-pointer">
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  {p.label}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px] dark:bg-gray-800">
                    {p.key}
                  </code>
                </p>
              </label>
              <input
                type="checkbox"
                checked={selected.has(p.key)}
                onChange={() => onTogglePerm(p.key)}
                className="mt-1 h-4 w-4 cursor-pointer rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TriStateCheckbox({
  state,
  onChange,
  ariaLabel,
}: {
  state: 'all' | 'some' | 'none'
  onChange: (on: boolean) => void
  ariaLabel: string
}) {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={state === 'all'}
      ref={(el) => {
        if (el) el.indeterminate = state === 'some'
      }}
      onChange={(e) => onChange(e.target.checked)}
      className={cn(
        'h-4 w-4 cursor-pointer rounded border-gray-300 text-brand-600 focus:ring-brand-500',
      )}
    />
  )
}
