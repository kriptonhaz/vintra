import { useState, useMemo } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, Trash2, Shield, Lock } from 'lucide-react'
import {
  listRoles,
  listPermissions,
  createRole,
  updateRole,
  setRolePermissions,
  deleteRole,
} from '@/server/functions/rbac'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export const Route = createFileRoute('/admin/roles')({
  loader: async () => {
    const [roles, permissions] = await Promise.all([
      listRoles(),
      listPermissions(),
    ])
    return { roles, permissions }
  },
  component: RolesPage,
})

type Role = Awaited<ReturnType<typeof listRoles>>[number]
type Permission = Awaited<ReturnType<typeof listPermissions>>[number]

const roleFormSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_-]*$/, 'Gunakan huruf kecil, angka, "-" atau "_"'),
  label: z.string().min(1, 'Label wajib diisi'),
  description: z.string().optional(),
  sortOrder: z.coerce.number().int().min(0),
  permissionKeys: z.array(z.string()),
})
type RoleForm = z.infer<typeof roleFormSchema>

function RolesPage() {
  const { roles, permissions } = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const [editing, setEditing] = useState<Role | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Role | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete() {
    if (!deleting) return
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      await deleteRole({ data: { id: deleting.id } })
      setDeleting(null)
      await router.invalidate()
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : t('admin.roles.deleteError'),
      )
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('admin.roles.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('admin.roles.subtitle')}
          </p>
        </div>
        <Button variant="brand" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          {t('admin.roles.newRole')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.roles.colRole')}</TableHead>
              <TableHead>{t('admin.roles.colPermissions')}</TableHead>
              <TableHead>{t('admin.roles.colMembers')}</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {r.isSystem && (
                      <Shield className="h-4 w-4 text-gray-400" />
                    )}
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {r.label}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {r.key}
                        {r.description ? ` · ${r.description}` : ''}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                  {t('admin.roles.permissionsCount', { count: r.permissionKeys.length })}
                </TableCell>
                <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                  {r.memberCount}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                      aria-label={t('admin.roles.ariaEdit')}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {!r.isSystem && (
                      <button
                        type="button"
                        onClick={() => setDeleting(r)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30"
                        aria-label={t('admin.roles.ariaDelete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {creating && (
        <RoleSheet
          mode="create"
          permissions={permissions}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false)
            await router.invalidate()
          }}
        />
      )}

      {editing && (
        <RoleSheet
          mode="edit"
          role={editing}
          permissions={permissions}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await router.invalidate()
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleting(null)
          setDeleteError(null)
        }}
        title={t('admin.roles.deleteTitle')}
        description={
          deleteError ??
          t('admin.roles.deleteDesc', { label: deleting?.label ?? '' })
        }
        confirmText={t('admin.roles.deleteCta')}
        cancelText={t('common.cancel')}
        loading={deleteLoading}
        variant="danger"
      />
    </div>
  )
}

function RoleSheet({
  mode,
  role,
  permissions,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  role?: Role
  permissions: Permission[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const isOwnerRole = role?.key === 'owner'
  const isSystemRole = role?.isSystem ?? false
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<RoleForm>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: {
      key: role?.key ?? '',
      label: role?.label ?? '',
      description: role?.description ?? '',
      sortOrder: role?.sortOrder ?? 100,
      permissionKeys: role?.permissionKeys ?? [],
    },
  })

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>()
    for (const p of permissions) {
      const list = map.get(p.module) ?? []
      list.push(p)
      map.set(p.module, list)
    }
    return Array.from(map.entries())
  }, [permissions])

  async function onSubmit(values: RoleForm) {
    setServerError(null)
    try {
      if (mode === 'create') {
        await createRole({
          data: {
            key: values.key,
            label: values.label,
            description: values.description || null,
            sortOrder: values.sortOrder,
            permissionKeys: values.permissionKeys,
          },
        })
      } else if (role) {
        await updateRole({
          data: {
            id: role.id,
            label: values.label,
            description: values.description || null,
            sortOrder: values.sortOrder,
          },
        })
        if (!isOwnerRole) {
          await setRolePermissions({
            data: { roleId: role.id, permissionKeys: values.permissionKeys },
          })
        }
      }
      await onSaved()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('admin.roles.saveError'))
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {mode === 'create'
            ? t('admin.roles.sheetCreateTitle')
            : t('admin.roles.sheetEditTitle', { label: role?.label ?? '' })}
        </SheetTitle>
        <SheetDescription>
          {t('admin.roles.sheetDescription')}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.roles.fieldKey')}
              </label>
              <Input
                {...form.register('key')}
                disabled={mode === 'edit'}
                placeholder={t('admin.roles.fieldKeyPlaceholder')}
              />
              {form.formState.errors.key && (
                <p className="mt-1 text-xs text-danger-600">
                  {form.formState.errors.key.message}
                </p>
              )}
              {mode === 'edit' && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('admin.roles.fieldKeyImmutable')}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.roles.fieldLabel')}
              </label>
              <Input
                {...form.register('label')}
                placeholder={t('admin.roles.fieldLabelPlaceholder')}
              />
              {form.formState.errors.label && (
                <p className="mt-1 text-xs text-danger-600">
                  {form.formState.errors.label.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.roles.fieldDescription')}
            </label>
            <Textarea
              {...form.register('description')}
              rows={2}
              placeholder={t('admin.roles.fieldDescriptionPlaceholder')}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.roles.fieldSortOrder')}
            </label>
            <Input type="number" {...form.register('sortOrder')} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.roles.fieldPermissions')}
              </label>
              {isOwnerRole && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  <Lock className="h-3 w-3" />
                  {t('admin.roles.ownerLocked')}
                </span>
              )}
            </div>

            <Controller
              control={form.control}
              name="permissionKeys"
              render={({ field }) => (
                <div className="space-y-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  {grouped.map(([module, perms]) => (
                    <div key={module}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        {module}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {perms.map((p) => {
                          const checked = field.value.includes(p.key)
                          return (
                            <label
                              key={p.id}
                              className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 px-2 py-1.5 text-sm dark:border-gray-700"
                            >
                              <input
                                type="checkbox"
                                disabled={isOwnerRole}
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    field.onChange([...field.value, p.key])
                                  } else {
                                    field.onChange(
                                      field.value.filter((k) => k !== p.key),
                                    )
                                  }
                                }}
                                className="mt-0.5 h-4 w-4"
                              />
                              <div className="flex-1">
                                <p className="text-gray-900 dark:text-gray-100">
                                  {p.label}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {p.key}
                                </p>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            />
          </div>

          {serverError && (
            <p className="text-sm text-danger-600">{serverError}</p>
          )}
          {isSystemRole && mode === 'edit' && (
            <p className="text-xs text-gray-500">
              {t('admin.roles.systemRoleNote')}
              {isOwnerRole ? t('admin.roles.ownerExceptionNote') : ''}.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            loading={form.formState.isSubmitting}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
