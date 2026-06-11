/**
 * Pengumuman admin — owners/admins/supervisors compose, edit, list, and
 * delete broadcasts to their staff. Pengumuman is its own channel
 * (separate from the notification bell); it surfaces in the mobile home
 * card + list screen and is read-tracked per user when opened.
 *
 * Gated on `announcements.manage`; staff/cashier never reach it.
 */
import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  Plus,
  Trash2,
  Pin,
  Megaphone,
  Pencil,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  listAnnouncementsAdmin,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '@/server/functions/announcements'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DateInput } from '@/components/ui/date-input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'

const PAGE_SIZE = 20

type AdminList = Awaited<ReturnType<typeof listAnnouncementsAdmin>>
type Row = AdminList['items'][number]
type Editing = { kind: 'create' } | { kind: 'edit'; row: Row }

export const Route = createFileRoute('/_authed/settings/announcements')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('announcements.manage')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  loader: async () => ({
    list: await listAnnouncementsAdmin({ data: { page: 1, pageSize: PAGE_SIZE } }),
  }),
  component: AnnouncementsPage,
})

function AnnouncementsPage() {
  const { list: initial } = Route.useLoaderData()
  const { toast } = useToast()
  const [list, setList] = useState<AdminList>(initial)
  const [paging, setPaging] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize))

  async function loadPage(page: number) {
    setPaging(true)
    try {
      setList(await listAnnouncementsAdmin({ data: { page, pageSize: PAGE_SIZE } }))
    } finally {
      setPaging(false)
    }
  }

  async function handleSaved(wasEdit: boolean) {
    setEditing(null)
    // New items sort to the top; edits stay on the current page.
    await loadPage(wasEdit ? list.page : 1)
    toast({
      title: wasEdit ? 'Pengumuman diperbarui' : 'Pengumuman terkirim',
      description: wasEdit
        ? 'Perubahan langsung terlihat oleh anggota tim.'
        : 'Semua anggota tim akan melihatnya di beranda aplikasi.',
      variant: 'success',
    })
  }

  async function handleDelete() {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await deleteAnnouncement({ data: { id: deleting.id } })
      setDeleting(null)
      await loadPage(list.page)
      toast({ title: 'Pengumuman dihapus', variant: 'success' })
    } catch (err) {
      toast({
        title: 'Gagal menghapus',
        description: err instanceof Error ? err.message : 'Terjadi kesalahan.',
        variant: 'error',
      })
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Pengumuman
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Kirim informasi ke seluruh anggota tim. Muncul di beranda aplikasi
            mereka.
          </p>
        </div>
        <Button variant="brand" onClick={() => setEditing({ kind: 'create' })}>
          <Plus className="h-4 w-4" />
          Buat Pengumuman
        </Button>
      </div>

      {list.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-300 py-14 text-center dark:border-gray-700">
          <Megaphone className="h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Belum ada pengumuman. Buat yang pertama untuk tim Anda.
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {list.items.map((a) => {
              const expired =
                !!a.expiresAt && new Date(a.expiresAt).getTime() < Date.now()
              return (
                <li
                  key={a.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {a.pinned && (
                          <Pin className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                        )}
                        <h3 className="truncate font-semibold text-gray-900 dark:text-gray-100">
                          {a.title}
                        </h3>
                        {expired && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                            Kedaluwarsa
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">
                        {a.body}
                      </p>
                      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                        {formatDate(a.publishedAt ?? a.createdAt)}
                        {a.expiresAt
                          ? ` · berakhir ${formatDateShort(a.expiresAt)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing({ kind: 'edit', row: a })}
                        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                        aria-label="Edit pengumuman"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(a)}
                        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/20"
                        aria-label="Hapus pengumuman"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                disabled={list.page <= 1 || paging}
                onClick={() => loadPage(list.page - 1)}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 text-xs font-medium tabular-nums text-gray-600 dark:text-gray-400">
                {list.page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={list.page >= totalPages || paging}
                onClick={() => loadPage(list.page + 1)}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)}>
        <SheetHeader onClose={() => setEditing(null)}>
          <SheetTitle>
            {editing?.kind === 'edit' ? 'Edit Pengumuman' : 'Buat Pengumuman'}
          </SheetTitle>
          <SheetDescription>
            Akan terlihat oleh seluruh anggota tim usaha Anda.
          </SheetDescription>
        </SheetHeader>
        {editing && (
          <AnnouncementForm
            editing={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => handleSaved(editing.kind === 'edit')}
          />
        )}
      </Sheet>

      <ConfirmDialog
        open={!!deleting}
        title="Hapus pengumuman?"
        description={
          deleting ? `"${deleting.title}" akan dihapus permanen.` : undefined
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

function AnnouncementForm({
  editing,
  onCancel,
  onSaved,
}: {
  editing: Editing
  onCancel: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const existing = editing.kind === 'edit' ? editing.row : null
  const [title, setTitle] = useState(existing?.title ?? '')
  const [body, setBody] = useState(existing?.body ?? '')
  const [pinned, setPinned] = useState(existing?.pinned ?? false)
  // DateInput speaks ISO yyyy-mm-dd; expiresAt on the wire is a full datetime.
  const [expiry, setExpiry] = useState(
    existing?.expiresAt
      ? new Date(existing.expiresAt).toISOString().slice(0, 10)
      : '',
  )
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next: { title?: string; body?: string } = {}
    if (!title.trim()) next.title = 'Judul wajib diisi'
    if (!body.trim()) next.body = 'Isi pengumuman wajib diisi'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    // Expiry date → end-of-day ISO datetime (hidden once that day passes).
    const expiresAt = expiry
      ? new Date(`${expiry}T23:59:59`).toISOString()
      : null

    setSubmitting(true)
    try {
      if (editing.kind === 'edit') {
        await updateAnnouncement({
          data: { id: editing.row.id, title: title.trim(), body: body.trim(), pinned, expiresAt },
        })
      } else {
        await createAnnouncement({
          data: { title: title.trim(), body: body.trim(), pinned, expiresAt },
        })
      }
      onSaved()
    } catch (err) {
      toast({
        title: 'Gagal menyimpan',
        description: err instanceof Error ? err.message : 'Terjadi kesalahan.',
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <Input
          label="Judul"
          placeholder="cth. Libur Hari Raya"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.title}
          maxLength={160}
        />
        <Textarea
          label="Isi pengumuman"
          placeholder="Tulis informasi untuk tim Anda…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={errors.body}
          rows={6}
          maxLength={5000}
        />
        <DateInput
          label="Tampil sampai (opsional)"
          value={expiry}
          onChange={setExpiry}
          placeholder="dd/mm/yyyy"
          min={new Date().toISOString().slice(0, 10)}
        />
        <p className="-mt-2 text-xs text-gray-400 dark:text-gray-500">
          Kosongkan jika ingin pengumuman tampil terus. Setelah tanggal ini,
          otomatis hilang dari aplikasi staf.
        </p>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          Sematkan di atas (pin)
        </label>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Batal
        </Button>
        <Button type="submit" variant="brand" loading={submitting}>
          {editing.kind === 'edit' ? 'Simpan Perubahan' : 'Kirim Pengumuman'}
        </Button>
      </div>
    </form>
  )
}

function formatDate(value: Date | string | null): string {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
}

function formatDateShort(value: Date | string | null): string {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value))
  } catch {
    return ''
  }
}
