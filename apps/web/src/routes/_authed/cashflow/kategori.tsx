import { useEffect, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Lock, Plus, Pencil, Trash2, Tag } from 'lucide-react'
import {
  getCashflowOverview,
  listCashflowCategories,
  createCashflowCategory,
  updateCashflowCategory,
  deleteCashflowCategory,
} from '@/server/functions/cashflow'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'

export const Route = createFileRoute('/_authed/cashflow/kategori')({
  loader: async () => {
    const overview = await getCashflowOverview()
    if (!overview.hasAccess) return { locked: true as const }
    const categories = await listCashflowCategories()
    return { locked: false as const, categories }
  },
  component: CashflowCategoriesPage,
})

type Category = {
  id: string
  name: string
  kind: 'income' | 'expense'
  isSystem: boolean
}

function CashflowCategoriesPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [deleting, setDeleting] = useState<Category | null>(null)
  const [busy, setBusy] = useState(false)

  if (data.locked) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-accent-200 bg-accent-50 p-8 text-center dark:border-accent-900/40 dark:bg-accent-900/20">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
            <Lock className="h-6 w-6 text-accent-700 dark:text-accent-400" />
          </div>
          <h2 className="text-lg font-semibold text-accent-900 dark:text-accent-200">
            Cashflow Monitoring
          </h2>
          <p className="mt-1 text-sm text-accent-800 dark:text-accent-300">
            Fitur ini termasuk dalam paket Komplit.
          </p>
        </div>
      </div>
    )
  }

  const income = data.categories.filter((c) => c.kind === 'income')
  const expense = data.categories.filter((c) => c.kind === 'expense')

  async function handleCreate(values: { name: string; kind: 'income' | 'expense' }) {
    setBusy(true)
    try {
      await createCashflowCategory({ data: values })
      toast({ title: 'Kategori dibuat', variant: 'success' })
      setCreateOpen(false)
      await router.invalidate()
    } catch (err) {
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Gagal membuat kategori.',
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdate(name: string) {
    if (!editing) return
    setBusy(true)
    try {
      await updateCashflowCategory({ data: { id: editing.id, name } })
      toast({ title: 'Kategori diperbarui', variant: 'success' })
      setEditing(null)
      await router.invalidate()
    } catch (err) {
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Gagal memperbarui.',
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteCashflowCategory({ data: { id: deleting.id } })
      toast({ title: 'Kategori dihapus', variant: 'success' })
      setDeleting(null)
      await router.invalidate()
    } catch (err) {
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Gagal menghapus.',
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            to="/cashflow"
            className="mb-1 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Catatan Kas
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Kategori Arus Kas
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Kategori bawaan tidak bisa diubah. Tambahkan kategori sendiri sesuai
            kebutuhan usaha Anda.
          </p>
        </div>
        <Button variant="brand" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Tambah Kategori
        </Button>
      </div>

      <CategorySection
        title="Pemasukan"
        categories={income}
        onEdit={setEditing}
        onDelete={setDeleting}
      />
      <CategorySection
        title="Pengeluaran"
        categories={expense}
        onEdit={setEditing}
        onDelete={setDeleting}
      />

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)}>
        <SheetHeader onClose={() => setCreateOpen(false)}>
          <SheetTitle>Tambah Kategori</SheetTitle>
          <SheetDescription>
            Buat kategori baru untuk mengelompokkan catatan kas.
          </SheetDescription>
        </SheetHeader>
        <CategoryForm
          mode="create"
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={busy}
        />
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)}>
        <SheetHeader onClose={() => setEditing(null)}>
          <SheetTitle>Ubah Kategori</SheetTitle>
          <SheetDescription>Ganti nama kategori.</SheetDescription>
        </SheetHeader>
        <CategoryForm
          mode="edit"
          defaultName={editing?.name}
          defaultKind={editing?.kind}
          onSubmit={({ name }) => handleUpdate(name)}
          onCancel={() => setEditing(null)}
          loading={busy}
        />
      </Sheet>

      <ConfirmDialog
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Hapus kategori?"
        description={`Kategori "${deleting?.name ?? ''}" akan dihapus.`}
        confirmText="Hapus"
        variant="danger"
        loading={busy}
      />
    </div>
  )
}

function CategorySection({
  title,
  categories,
  onEdit,
  onDelete,
}: {
  title: string
  categories: Category[]
  onEdit: (c: Category) => void
  onDelete: (c: Category) => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-200 px-5 py-3 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h2>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {categories.map((cat) => (
          <li key={cat.id} className="flex items-center gap-3 px-5 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/30">
              <Tag className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            </div>
            <span className="flex-1 font-medium text-gray-900 dark:text-gray-100">
              {cat.name}
            </span>
            {cat.isSystem ? (
              <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                Bawaan
              </span>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Ubah"
                  onClick={() => onEdit(cat)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Hapus"
                  onClick={() => onDelete(cat)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CategoryForm({
  mode,
  defaultName = '',
  defaultKind = 'expense',
  onSubmit,
  onCancel,
  loading,
}: {
  mode: 'create' | 'edit'
  defaultName?: string
  defaultKind?: 'income' | 'expense'
  onSubmit: (values: { name: string; kind: 'income' | 'expense' }) => void
  onCancel: () => void
  loading: boolean
}) {
  const [name, setName] = useState(defaultName)
  const [kind, setKind] = useState<'income' | 'expense'>(defaultKind)
  const [error, setError] = useState('')

  useEffect(() => {
    setName(defaultName)
    setKind(defaultKind)
    setError('')
  }, [defaultName, defaultKind])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Nama kategori wajib diisi.')
      return
    }
    setError('')
    onSubmit({ name: trimmed, kind })
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {mode === 'create' && (
          <Select
            label="Jenis"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'income' | 'expense')}
            options={[
              { label: 'Pemasukan', value: 'income' },
              { label: 'Pengeluaran', value: 'expense' },
            ]}
          />
        )}
        <Input
          label="Nama kategori"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (error) setError('')
          }}
          error={error}
          placeholder="mis. Catering, Sewa motor"
          autoFocus
        />
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" variant="brand" loading={loading}>
          Simpan
        </Button>
      </div>
    </form>
  )
}
