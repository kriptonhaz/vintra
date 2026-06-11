import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { listPermissions } from '@/server/functions/rbac'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export const Route = createFileRoute('/admin/permissions')({
  loader: () => listPermissions(),
  component: PermissionsPage,
})

function PermissionsPage() {
  const permissions = Route.useLoaderData()
  const { t } = useTranslation()

  const grouped = useMemo(() => {
    const map = new Map<string, typeof permissions>()
    for (const p of permissions) {
      const list = map.get(p.module) ?? []
      list.push(p)
      map.set(p.module, list)
    }
    return Array.from(map.entries())
  }, [permissions])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('admin.permissions.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('admin.permissions.subtitle')}
        </p>
      </div>

      <div className="space-y-6">
        {grouped.map(([module, perms]) => (
          <div
            key={module}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="border-b border-gray-200 px-5 py-3 dark:border-gray-700">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                {module}
              </h2>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.permissions.colKey')}</TableHead>
                  <TableHead>{t('admin.permissions.colLabel')}</TableHead>
                  <TableHead>{t('admin.permissions.colDescription')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perms.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs text-gray-700 dark:text-gray-300">
                      {p.key}
                    </TableCell>
                    <TableCell>{p.label}</TableCell>
                    <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                      {p.description ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
    </div>
  )
}
