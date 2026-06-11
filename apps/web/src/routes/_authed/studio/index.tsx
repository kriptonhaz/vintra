import { useEffect, useState, useMemo } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Sparkles,
  Palette,
  Download,
  Trash2,
  Plus,
  ImageIcon,
  X,
  Image as BannerIcon,
  FileText,
  Coins,
  CheckCircle2,
} from 'lucide-react'
import {
  listStudioGenerations,
  deleteStudioGeneration,
  getStudioDownloadUrl,
  type StudioRow,
  type StudioGenerationKind,
} from '@/server/functions/studio'
import { commitSpandukPreview } from '@/server/functions/spanduk'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { downloadImageFromUrl } from '@/lib/download-image'

export const Route = createFileRoute('/_authed/studio/')({
  loader: () => listStudioGenerations(),
  component: StudioGalleryPage,
})

async function downloadStudioImage(
  id: string,
  kind: StudioGenerationKind,
  format: 'png' | 'pdf' = 'png',
) {
  const { url } = await getStudioDownloadUrl({ data: { id, kind, format } })
  await downloadImageFromUrl(url, `${kind}-${id}.${format}`)
}

type FilterKind = 'all' | StudioGenerationKind

function KindBadge({ kind }: { kind: StudioGenerationKind }) {
  const { t } = useTranslation()
  const tone =
    kind === 'konten'
      ? 'bg-brand-50/95 text-brand-700 dark:bg-brand-900/60 dark:text-brand-300'
      : kind === 'logo'
        ? 'bg-violet-50/95 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300'
        : 'bg-accent-50/95 text-accent-700 dark:bg-accent-900/60 dark:text-accent-300'
  return (
    <span
      className={cn(
        'absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shadow-sm',
        tone,
      )}
    >
      {kind === 'konten' ? (
        <Sparkles className="h-3 w-3" />
      ) : kind === 'logo' ? (
        <Palette className="h-3 w-3" />
      ) : (
        <BannerIcon className="h-3 w-3" />
      )}
      {t(`studio.kind_${kind}`)}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  if (status === 'success') return null
  return (
    <span
      className={cn(
        'absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-medium',
        status === 'pending'
          ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
          : 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300',
      )}
    >
      {t(`konten.status_${status}`, { defaultValue: status })}
    </span>
  )
}

/**
 * Banner overlay marking a spanduk row as a 1K preview. `hasCommit`
 * shifts the tone from "needs action" to "already done" so users don't
 * accidentally commit twice from the gallery.
 */
function SpandukPreviewBadge({
  isPreview,
  hasCommit,
}: {
  isPreview: boolean
  hasCommit: boolean
}) {
  if (!isPreview) return null
  if (hasCommit) {
    return (
      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-brand-100/95 px-2 py-0.5 text-[11px] font-semibold text-brand-700 shadow-sm dark:bg-brand-900/60 dark:text-brand-300">
        <CheckCircle2 className="h-3 w-3" />
        Preview · sudah dicetak
      </span>
    )
  }
  return (
    <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-warning-100/95 px-2 py-0.5 text-[11px] font-semibold text-warning-700 shadow-sm dark:bg-warning-900/60 dark:text-warning-300">
      Preview 1K
    </span>
  )
}

function SelectionDisplay({
  row,
  compact,
}: {
  row: StudioRow
  compact?: boolean
}) {
  const { t } = useTranslation()

  if (row.kind === 'konten' && row.promptMode === 'custom') {
    return (
      <div className="space-y-1">
        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {t('konten.customModeTag')}
        </span>
        <p
          className={cn(
            'text-xs text-gray-600 dark:text-gray-400',
            compact && 'line-clamp-2',
          )}
        >
          {row.prompt}
        </p>
      </div>
    )
  }

  if (row.selections.length === 0) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {t('konten.noSelections')}
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-1">
      {row.selections.map((s, i) => (
        <span
          key={i}
          className={cn(
            'inline-flex flex-wrap items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-700 dark:bg-brand-900/30 dark:text-brand-400',
          )}
        >
          <span className="font-medium">{s.fieldLabel}:</span>
          {s.value}
          {s.textInputs && s.textInputs.length > 0 && !compact && (
            <span className="ml-1 flex flex-wrap gap-1 text-gray-600 dark:text-gray-400">
              {s.textInputs.map((ti) => (
                <span
                  key={ti.key}
                  className="rounded bg-white/70 px-1 dark:bg-gray-800/60"
                >
                  <span className="font-medium">{ti.label}:</span> &ldquo;
                  {ti.value}&rdquo;
                </span>
              ))}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

function StudioGalleryPage() {
  const rows = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const { toast } = useToast()
  const [filter, setFilter] = useState<FilterKind>('all')
  const [deleting, setDeleting] = useState<StudioRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [viewing, setViewing] = useState<StudioRow | null>(null)

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.kind === filter)),
    [rows, filter],
  )

  const counts = useMemo(() => {
    let konten = 0
    let logo = 0
    let spanduk = 0
    for (const r of rows) {
      if (r.kind === 'konten') konten++
      else if (r.kind === 'logo') logo++
      else spanduk++
    }
    return { all: rows.length, konten, logo, spanduk }
  }, [rows])

  async function handleDelete() {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await deleteStudioGeneration({
        data: { id: deleting.id, kind: deleting.kind },
      })
      setDeleting(null)
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : '',
        variant: 'error',
      })
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('studio.galleryTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('studio.gallerySubtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="brand" asChild>
            <Link to="/konten/generate">
              <Sparkles className="h-4 w-4" />
              {t('studio.createKontenCta')}
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/logo/generate">
              <Palette className="h-4 w-4" />
              {t('studio.createLogoCta')}
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/spanduk/generate">
              <BannerIcon className="h-4 w-4" />
              {t('studio.createSpandukCta')}
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'konten', 'logo', 'spanduk'] as FilterKind[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === f
                ? 'bg-brand-600 text-white dark:bg-brand-500'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600',
            )}
          >
            {f === 'all'
              ? t('studio.filterAll')
              : f === 'konten'
                ? t('studio.kind_konten')
                : f === 'logo'
                  ? t('studio.kind_logo')
                  : t('studio.kind_spanduk')}
            <span className="ml-0.5 rounded-full bg-white/30 px-1.5 text-[10px] tabular-nums">
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white px-8 py-16 text-center dark:border-gray-600 dark:bg-gray-800">
          <Sparkles className="h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            {t('studio.galleryEmpty')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((row) => (
            <button
              key={`${row.kind}-${row.id}`}
              type="button"
              onClick={() => setViewing(row)}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white text-left transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="relative aspect-square bg-gray-50 dark:bg-gray-900">
                {row.resultImageUrl ? (
                  <img
                    src={row.resultImageUrl}
                    alt=""
                    className={cn(
                      'h-full w-full',
                      row.kind === 'logo'
                        ? 'object-contain p-2'
                        : row.kind === 'spanduk'
                          ? 'object-contain'
                          : 'object-cover',
                    )}
                  />
                ) : row.sourceImageUrl ? (
                  <img
                    src={row.sourceImageUrl}
                    alt=""
                    className="h-full w-full object-cover opacity-40"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-gray-300 dark:text-gray-600" />
                  </div>
                )}
                <KindBadge kind={row.kind} />
                <StatusBadge status={row.status} />
                <SpandukPreviewBadge
                  isPreview={row.isPreview}
                  hasCommit={row.hasCommit}
                />
              </div>
              <div className="space-y-2 p-3">
                <SelectionDisplay row={row} compact />
                {row.status === 'error' && row.errorMessage && (
                  <p className="line-clamp-2 text-xs text-danger-600">
                    {row.errorMessage}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    {formatDate(row.createdAt, 'dd MMM yyyy')}
                    {row.creditsCharged !== null &&
                      row.creditsCharged > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-gray-500 dark:text-gray-400">
                          <Coins className="h-2.5 w-2.5" />
                          {row.creditsCharged}
                        </span>
                      )}
                  </span>
                  <div className="flex items-center gap-1">
                    {row.resultImageUrl && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          void downloadStudioImage(row.id, row.kind)
                        }}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-700"
                        title={t('konten.download')}
                      >
                        <Download className="h-4 w-4" />
                      </span>
                    )}
                    {row.kind === 'spanduk' && row.resultImageUrl && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          void downloadStudioImage(row.id, row.kind, 'pdf')
                        }}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-700"
                        title="Unduh PDF"
                      >
                        <FileText className="h-4 w-4" />
                      </span>
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleting(row)
                      }}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30"
                      title={t('konten.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {viewing && (
        <StudioLightbox
          row={viewing}
          onClose={() => setViewing(null)}
          onDelete={() => {
            const r = viewing
            setViewing(null)
            setDeleting(r)
          }}
          onCommitted={async () => {
            setViewing(null)
            await router.invalidate()
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
        title={t('studio.deleteTitle')}
        description={t('studio.deleteDesc')}
        confirmText={t('konten.delete')}
        cancelText={t('common.cancel')}
        loading={deleteLoading}
        variant="danger"
      />
    </div>
  )
}

/** Fullscreen detail view — Konten shows a before/after toggle, Logo shows
 *  just the result. Frame is a fixed square so the modal doesn't jump. */
function StudioLightbox({
  row,
  onClose,
  onDelete,
  onCommitted,
}: {
  row: StudioRow
  onClose: () => void
  onDelete: () => void
  onCommitted: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [committing, setCommitting] = useState(false)
  const canCommit =
    row.kind === 'spanduk' &&
    row.isPreview &&
    !row.hasCommit &&
    row.status === 'success'
  const hasToggle =
    row.kind === 'konten' && !!row.resultImageUrl && !!row.sourceImageUrl
  const [view, setView] = useState<'result' | 'source'>(
    row.resultImageUrl ? 'result' : 'source',
  )

  async function handleCommit() {
    setCommitting(true)
    try {
      await commitSpandukPreview({
        // Gallery commit — server fetches source images from S3 using
        // the preview row's stored keys.
        data: { id: row.id },
      })
      toast({
        title: 'Spanduk 4K berhasil dibuat',
        description: 'PNG dan PDF tersimpan di galeri.',
        variant: 'success',
      })
      await onCommitted()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description:
          err instanceof Error ? err.message : 'Gagal commit ke 4K.',
        variant: 'error',
      })
    } finally {
      setCommitting(false)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const mainUrl =
    view === 'result'
      ? (row.resultImageUrl ?? row.sourceImageUrl)
      : (row.sourceImageUrl ?? row.resultImageUrl)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fixed inset-0 bg-black/80"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-[61] flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-800">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.cancel')}
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-md hover:bg-gray-100 dark:bg-gray-700/90 dark:text-gray-200"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex-1 overflow-y-auto">
          <div className="flex aspect-square w-full items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
            {mainUrl ? (
              <img
                src={mainUrl}
                alt=""
                className="h-full w-full rounded-lg object-contain"
              />
            ) : (
              <ImageIcon className="h-10 w-10 text-gray-300 dark:text-gray-600" />
            )}
          </div>

          <div className="space-y-3 p-5">
            {/* Kind label */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  row.kind === 'konten'
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                    : row.kind === 'logo'
                      ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                      : 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300',
                )}
              >
                {row.kind === 'konten' ? (
                  <Sparkles className="h-3 w-3" />
                ) : row.kind === 'logo' ? (
                  <Palette className="h-3 w-3" />
                ) : (
                  <BannerIcon className="h-3 w-3" />
                )}
                {t(`studio.kind_${row.kind}`)}
              </span>
            </div>

            {/* Before/after toggle — Konten only */}
            {hasToggle && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setView('source')}
                  className={cn(
                    'group flex flex-col items-center rounded-lg p-1 transition-colors',
                    view === 'source'
                      ? 'bg-brand-50 dark:bg-brand-900/20'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700',
                  )}
                  aria-pressed={view === 'source'}
                >
                  <img
                    src={row.sourceImageUrl!}
                    alt=""
                    className={cn(
                      'h-20 w-20 rounded-lg border object-cover transition-colors',
                      view === 'source'
                        ? 'border-brand-500 ring-2 ring-brand-200 dark:border-brand-400 dark:ring-brand-900'
                        : 'border-gray-200 dark:border-gray-700',
                    )}
                  />
                  <span
                    className={cn(
                      'mt-1 text-[11px] font-medium',
                      view === 'source'
                        ? 'text-brand-600 dark:text-brand-400'
                        : 'text-gray-400',
                    )}
                  >
                    {t('konten.beforeLabel')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setView('result')}
                  className={cn(
                    'group flex flex-col items-center rounded-lg p-1 transition-colors',
                    view === 'result'
                      ? 'bg-brand-50 dark:bg-brand-900/20'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700',
                  )}
                  aria-pressed={view === 'result'}
                >
                  <img
                    src={row.resultImageUrl!}
                    alt=""
                    className={cn(
                      'h-20 w-20 rounded-lg border object-cover transition-colors',
                      view === 'result'
                        ? 'border-brand-500 ring-2 ring-brand-200 dark:border-brand-400 dark:ring-brand-900'
                        : 'border-gray-200 dark:border-gray-700',
                    )}
                  />
                  <span
                    className={cn(
                      'mt-1 text-[11px] font-medium',
                      view === 'result'
                        ? 'text-brand-600 dark:text-brand-400'
                        : 'text-gray-400',
                    )}
                  >
                    {t('konten.afterLabel')}
                  </span>
                </button>
              </div>
            )}

            <SelectionDisplay row={row} />

            <p className="flex items-center gap-2 text-xs text-gray-400">
              {formatDate(row.createdAt, 'dd MMM yyyy HH:mm')}
              {row.resolution ? ` · ${row.resolution.toUpperCase()}` : ''}
              {row.creditsCharged !== null && row.creditsCharged > 0 && (
                <span className="inline-flex items-center gap-0.5 text-gray-500 dark:text-gray-400">
                  · <Coins className="h-3 w-3" /> {row.creditsCharged} kredit
                </span>
              )}
            </p>

            {canCommit && (
              <div className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800 dark:border-warning-900/50 dark:bg-warning-900/20 dark:text-warning-300">
                Ini masih <strong>Preview 1K</strong>. Periksa ejaan teks
                dan nomor HP. Kalau sudah pas, klik <strong>Setujui &amp;
                Cetak 4K</strong> di bawah untuk versi cetak final.
              </div>
            )}
            {row.kind === 'spanduk' && row.isPreview && row.hasCommit && (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:border-brand-900/50 dark:bg-brand-900/20 dark:text-brand-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Preview ini sudah dilanjutkan ke versi cetak 4K.
              </div>
            )}

            {row.status === 'error' && row.errorMessage && (
              <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700 dark:bg-danger-900/20 dark:text-danger-300">
                {row.errorMessage}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <Button variant="ghost" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
            {t('konten.delete')}
          </Button>
          {canCommit && (
            <Button
              variant="brand"
              loading={committing}
              onClick={handleCommit}
            >
              <Sparkles className="h-4 w-4" />
              Setujui &amp; Cetak 4K
            </Button>
          )}
          {row.kind === 'spanduk' && row.resultImageUrl && !row.isPreview && (
            <Button
              variant="ghost"
              onClick={() => downloadStudioImage(row.id, row.kind, 'pdf')}
            >
              <FileText className="h-4 w-4" />
              PDF
            </Button>
          )}
          {row.resultImageUrl && (
            <Button
              variant="brand"
              onClick={() => downloadStudioImage(row.id, row.kind)}
            >
              <Download className="h-4 w-4" />
              {row.kind === 'spanduk' ? 'PNG' : t('konten.download')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
