import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { UserCog, Plus, Trash2 } from 'lucide-react'
import { formatDate } from '@/lib/utils' // JUR-137
import {
  listPlatformAdmins,
  grantPlatformAdmin,
  revokePlatformAdmin,
} from '@/server/functions/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export const Route = createFileRoute('/admin/platform-admins')({
  loader: () => listPlatformAdmins(),
  component: PlatformAdminsPage,
})

const grantSchema = z.object({
  email: z.string().email('Email tidak valid'),
})

type GrantForm = z.infer<typeof grantSchema>
type AdminRow = Awaited<ReturnType<typeof listPlatformAdmins>>[number]

function PlatformAdminsPage() {
  const admins = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const [serverError, setServerError] = useState<string | null>(null)
  const [pendingRevoke, setPendingRevoke] = useState<AdminRow | null>(null)
  const [revokeLoading, setRevokeLoading] = useState(false)

  const form = useForm<GrantForm>({
    resolver: zodResolver(grantSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(data: GrantForm) {
    setServerError(null)
    try {
      await grantPlatformAdmin({ data })
      form.reset()
      await router.invalidate()
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : t('admin.platformAdmins.addError'),
      )
    }
  }

  async function handleRevoke() {
    if (!pendingRevoke) return
    setRevokeLoading(true)
    try {
      await revokePlatformAdmin({ data: { userId: pendingRevoke.userId } })
      setPendingRevoke(null)
      await router.invalidate()
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : t('admin.platformAdmins.revokeError'),
      )
    } finally {
      setRevokeLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('admin.platformAdmins.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('admin.platformAdmins.subtitle')}
        </p>
      </div>

      {/* Grant form */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
          <Plus className="h-4 w-4" />
          {t('admin.platformAdmins.addTitle')}
        </h2>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
        >
          <div className="flex-1">
            <Input
              type="email"
              placeholder={t('admin.platformAdmins.emailPlaceholder')}
              {...form.register('email')}
            />
            {form.formState.errors.email && (
              <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>
          <Button
            type="submit"
            variant="brand"
            loading={form.formState.isSubmitting}
          >
            {t('admin.platformAdmins.addButton')}
          </Button>
        </form>
        {serverError && (
          <p className="mt-3 text-sm text-danger-600 dark:text-danger-400">
            {serverError}
          </p>
        )}
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {t('admin.platformAdmins.addHint')}
        </p>
      </div>

      {/* Admin list */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <UserCog className="h-4 w-4 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('admin.platformAdmins.listTitle', { count: admins.length })}
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.platformAdmins.colEmail')}</TableHead>
              <TableHead>{t('admin.platformAdmins.colCreatedAt')}</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="py-8 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {t('admin.platformAdmins.empty')}
                </TableCell>
              </TableRow>
            ) : (
              admins.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {a.email ?? (
                      <span className="italic text-gray-400">
                        {t('admin.platformAdmins.noEmail')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(a.createdAt, 'dd MMM yyyy')}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setPendingRevoke(a)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30"
                      aria-label={t('admin.platformAdmins.ariaRevoke')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onConfirm={handleRevoke}
        onCancel={() => setPendingRevoke(null)}
        title={t('admin.platformAdmins.revokeTitle')}
        description={t('admin.platformAdmins.revokeDesc', {
          email: pendingRevoke?.email ?? '',
        })}
        confirmText={t('admin.platformAdmins.revokeCta')}
        cancelText={t('common.cancel')}
        loading={revokeLoading}
        variant="danger"
      />
    </div>
  )
}
