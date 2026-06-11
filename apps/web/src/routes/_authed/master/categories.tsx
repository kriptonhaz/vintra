import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  getTenantCategories,
  createTenantCategory,
  updateTenantCategory,
  deleteTenantCategory,
} from '@/server/functions/hpp'
import { invalidateTenantCategories } from '@/lib/invalidate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
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
import { Plus, Pencil, Trash2, Tag } from 'lucide-react'

export const Route = createFileRoute('/_authed/master/categories')({
  loader: () => getTenantCategories(),
  component: CategoriesPage,
})

type Category = Awaited<ReturnType<typeof getTenantCategories>>[number]

function CategoriesPage() {
  const categories = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  const [showCreateSheet, setShowCreateSheet] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null)
  const [mutationLoading, setMutationLoading] = useState(false)

  // ─── Handlers ──────────────────────────────────────

  async function handleCreate(values: { name: string; isVisibleOnSitus: boolean }) {
    setMutationLoading(true)
    try {
      await createTenantCategory({
        data: {
          name: values.name,
          sortOrder: categories.length + 1,
          isVisibleOnSitus: values.isVisibleOnSitus,
        },
      })
      setShowCreateSheet(false)
      invalidateTenantCategories(queryClient)
      await router.invalidate()
    } catch {
      // TODO: show error toast
    } finally {
      setMutationLoading(false)
    }
  }

  async function handleUpdate(values: { name: string; isVisibleOnSitus: boolean }) {
    if (!editingCategory) return
    setMutationLoading(true)
    try {
      await updateTenantCategory({
        data: {
          id: editingCategory.id,
          name: values.name,
          isVisibleOnSitus: values.isVisibleOnSitus,
        },
      })
      setEditingCategory(null)
      invalidateTenantCategories(queryClient)
      await router.invalidate()
    } catch {
      // TODO: show error toast
    } finally {
      setMutationLoading(false)
    }
  }

  async function handleDelete() {
    if (!deletingCategory) return
    setMutationLoading(true)
    try {
      await deleteTenantCategory({ data: { id: deletingCategory.id } })
      setDeletingCategory(null)
      invalidateTenantCategories(queryClient)
      await router.invalidate()
    } catch {
      // TODO: show error toast
    } finally {
      setMutationLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{t('categories.pageTitle')}</CardTitle>
              <CardDescription className="mt-1">
                {t('categories.pageDescription')}
              </CardDescription>
            </div>
            <Button
              variant="brand"
              className="mt-3 w-full sm:mt-0 sm:w-auto"
              onClick={() => setShowCreateSheet(true)}
            >
              <Plus className="h-4 w-4" />
              {t('categories.addCategory')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t('categories.emptyTitle')}
              </p>
              <p className="mt-1 text-center text-sm text-gray-500 dark:text-gray-400">
                {t('categories.emptyDesc')}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('categories.colName')}</TableHead>
                  <TableHead className="w-32">
                    {t('categories.colVisibility')}
                  </TableHead>
                  <TableHead className="w-24 text-right">
                    {t('categories.colActions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => (
                  <TableRow key={cat.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/30">
                          <Tag className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                        </div>
                        <span className="font-medium">{cat.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {cat.isVisibleOnSitus ? (
                        <span className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                          {t('categories.badgeVisible')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                          {t('categories.badgeHidden')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                          aria-label={t('common.edit')}
                          onClick={() => setEditingCategory(cat)}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                          aria-label={t('common.delete')}
                          onClick={() => setDeletingCategory(cat)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create sheet */}
      <Sheet
        open={showCreateSheet}
        onClose={() => setShowCreateSheet(false)}
      >
        <SheetHeader onClose={() => setShowCreateSheet(false)}>
          <SheetTitle>{t('categories.sheetCreateTitle')}</SheetTitle>
          <SheetDescription>{t('categories.sheetCreateDesc')}</SheetDescription>
        </SheetHeader>
        <CategoryForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreateSheet(false)}
          loading={mutationLoading}
        />
      </Sheet>

      {/* Edit sheet */}
      <Sheet
        open={!!editingCategory}
        onClose={() => setEditingCategory(null)}
      >
        <SheetHeader onClose={() => setEditingCategory(null)}>
          <SheetTitle>{t('categories.sheetEditTitle')}</SheetTitle>
          <SheetDescription>{t('categories.sheetEditDesc')}</SheetDescription>
        </SheetHeader>
        <CategoryForm
          defaultName={editingCategory?.name}
          defaultVisibleOnSitus={editingCategory?.isVisibleOnSitus}
          onSubmit={handleUpdate}
          onCancel={() => setEditingCategory(null)}
          loading={mutationLoading}
        />
      </Sheet>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deletingCategory}
        onCancel={() => setDeletingCategory(null)}
        onConfirm={handleDelete}
        title={t('categories.deleteTitle')}
        description={t('categories.deleteConfirm', {
          name: deletingCategory?.name,
        })}
        confirmText={t('common.delete')}
        variant="danger"
        loading={mutationLoading}
      />
    </div>
  )
}

// ─── Category Form ───────────────────────────────────

interface CategoryFormProps {
  defaultName?: string
  defaultVisibleOnSitus?: boolean
  onSubmit: (values: { name: string; isVisibleOnSitus: boolean }) => void
  onCancel: () => void
  loading?: boolean
}

function CategoryForm({
  defaultName = '',
  defaultVisibleOnSitus = true,
  onSubmit,
  onCancel,
  loading,
}: CategoryFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(defaultName)
  const [isVisibleOnSitus, setIsVisibleOnSitus] = useState(defaultVisibleOnSitus)
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('validation.categoryRequired'))
      return
    }
    setError('')
    onSubmit({ name: trimmed, isVisibleOnSitus })
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={handleSubmit}
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <Input
          label={t('categories.labelName')}
          placeholder={t('categories.placeholderName')}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (error) setError('')
          }}
          error={error}
          autoFocus
        />
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={isVisibleOnSitus}
            onChange={(e) => setIsVisibleOnSitus(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm">
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {t('categories.labelVisibleOnSitus')}
            </span>
            <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
              {t('categories.helpVisibleOnSitus')}
            </span>
          </span>
        </label>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="brand" loading={loading}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}
