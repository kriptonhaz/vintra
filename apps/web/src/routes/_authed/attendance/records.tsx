import { useState, useMemo, useRef, useEffect } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Archive,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react'
import {
  listAttendanceRecords,
  exportAttendanceCsv,
  exportAttendanceXlsx,
  getAttendancePhotoBundle,
  createAttendanceRecord,
  updateAttendanceRecord,
  deleteAttendanceRecord,
} from '@/server/functions/attendance-records'
import { listStaff } from '@/server/functions/attendance-staff'
import { listBranches } from '@/server/functions/attendance-branches'
import { listShifts } from '@/server/functions/attendance-shifts'
import { useBranch } from '@/hooks/use-branch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ImagePreviewModal } from '@/components/ui/image-preview-modal'
import { minutesFromScheduled } from '@/lib/jakarta-time'
import { formatDate } from '@/lib/utils' // JUR-137
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useToast } from '@/components/ui/toast'

export const Route = createFileRoute('/_authed/attendance/records')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    const perms = user?.permissions ?? []
    if (
      !perms.includes('attendance.manage') &&
      !perms.includes('attendance.report')
    ) {
      throw redirect({ to: '/attendance' })
    }
  },
  loader: async () => {
    const today = new Date()
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const toStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const initialFrom = toStr(monthStart)
    const initialTo = toStr(today)

    const [records, staff, branches, shifts] = await Promise.all([
      listAttendanceRecords({
        data: { from: initialFrom, to: initialTo, page: 1, pageSize: 25 },
      }),
      listStaff(),
      listBranches(),
      listShifts({ data: {} }),
    ])
    return { records, staff, branches, shifts, initialFrom, initialTo }
  },
  component: RecordsPage,
})

type RecordItem = Awaited<
  ReturnType<typeof listAttendanceRecords>
>['records'][number]

// ─── Manual record form (HR add / edit) ─────────────

const IN_STATUSES = ['present', 'on_time', 'late'] as const
const OUT_STATUSES = ['present', 'on_time', 'early_leave'] as const

const recordFormSchema = z
  .object({
    staffProfileId: z.string().min(1, 'Pilih staf'),
    date: z.string().min(1, 'Pilih tanggal'),
    clockInTime: z.string().optional(),
    clockInStatus: z.enum(IN_STATUSES),
    clockOutTime: z.string().optional(),
    clockOutStatus: z.enum(OUT_STATUSES),
    clockInNotes: z.string().optional(),
    clockOutNotes: z.string().optional(),
  })
  .refine((d) => !!d.clockInTime || !!d.clockOutTime, {
    message: 'Isi minimal jam masuk atau jam pulang',
    path: ['clockInTime'],
  })

type RecordFormValues = z.infer<typeof recordFormSchema>

/** A stored timestamp → "HH:mm" in Jakarta time, for the edit form. */
function toJakartaHHmm(at: Date | string | null): string {
  if (!at) return ''
  const d = new Date(at)
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(11, 16)
}

function RecordsPage() {
  const loader = Route.useLoaderData()
  const { t } = useTranslation()
  const { toast } = useToast()
  const router = useRouter()

  const [from, setFrom] = useState(loader.initialFrom)
  const [to, setTo] = useState(loader.initialTo)
  const [staffId, setStaffId] = useState<string>('')
  // Branch filter comes from the global topbar switcher. Kept as a
  // string ('' = all) so the existing filter/query code is unchanged.
  const { selectedBranchId } = useBranch()
  const branchId = selectedBranchId ?? ''
  const [shiftId, setShiftId] = useState<string>('')
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [refreshing, setRefreshing] = useState(false)
  const [downloadingCsv, setDownloadingCsv] = useState(false)
  const [downloadingXlsx, setDownloadingXlsx] = useState(false)
  /** Tracks the bulk-photo ZIP build. While > 0, shows progress. */
  const [photoZipProgress, setPhotoZipProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const downloadMenuRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<{
    src: string
    caption: string
  } | null>(null)

  // Close the download dropdown on outside click / Escape
  useEffect(() => {
    if (!downloadMenuOpen) return
    function onDown(e: MouseEvent) {
      if (
        downloadMenuRef.current &&
        !downloadMenuRef.current.contains(e.target as Node)
      ) {
        setDownloadMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDownloadMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [downloadMenuOpen])

  const [records, setRecords] = useState(loader.records)

  // Manual record CRUD (HR reconciliation)
  const [recordForm, setRecordForm] = useState<
    { mode: 'create' } | { mode: 'edit'; record: RecordItem } | null
  >(null)
  const [deletingRecord, setDeletingRecord] = useState<RecordItem | null>(null)
  const [recordSaving, setRecordSaving] = useState(false)

  async function loadPage(nextPage: number) {
    setRefreshing(true)
    try {
      const res = await listAttendanceRecords({
        data: {
          from,
          to,
          staffId: staffId || undefined,
          branchId: branchId || undefined,
          shiftId: shiftId || undefined,
          page: nextPage,
          pageSize,
        },
      })
      setRecords(res)
      setPage(res.page)
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal memuat',
        variant: 'error',
      })
    } finally {
      setRefreshing(false)
    }
  }

  async function applyFilters() {
    // Reset to page 1 on filter change
    await loadPage(1)
  }

  // Reload when the global topbar branch switcher changes. The ref
  // skips the initial null→branch resolution's first tick so we don't
  // double-fetch on mount (the loader already primed page 1).
  const branchInitRef = useRef(true)
  useEffect(() => {
    if (branchInitRef.current) {
      branchInitRef.current = false
      return
    }
    setShiftId('')
    void loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId])

  async function handleSubmitRecord(values: RecordFormValues) {
    setRecordSaving(true)
    try {
      const inGiven = !!values.clockInTime
      const outGiven = !!values.clockOutTime
      if (recordForm?.mode === 'edit') {
        await updateAttendanceRecord({
          data: {
            id: recordForm.record.id,
            clockInTime: values.clockInTime || undefined,
            clockOutTime: values.clockOutTime || undefined,
            clockInStatus: inGiven ? values.clockInStatus : undefined,
            clockOutStatus: outGiven ? values.clockOutStatus : undefined,
            clockInNotes: values.clockInNotes || undefined,
            clockOutNotes: values.clockOutNotes || undefined,
          },
        })
      } else {
        await createAttendanceRecord({
          data: {
            staffProfileId: values.staffProfileId,
            date: values.date,
            clockInTime: values.clockInTime || undefined,
            clockOutTime: values.clockOutTime || undefined,
            clockInStatus: inGiven ? values.clockInStatus : undefined,
            clockOutStatus: outGiven ? values.clockOutStatus : undefined,
            clockInNotes: values.clockInNotes || undefined,
            clockOutNotes: values.clockOutNotes || undefined,
          },
        })
      }
      const wasEdit = recordForm?.mode === 'edit'
      setRecordForm(null)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('records.toastRecordSaved'),
        variant: 'success',
      })
      // Edits stay on the current page; new records may land anywhere
      // so jump to page 1 where the newest rows sort.
      await loadPage(wasEdit ? records.page : 1)
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal menyimpan',
        variant: 'error',
      })
    } finally {
      setRecordSaving(false)
    }
  }

  async function handleDeleteRecord() {
    if (!deletingRecord) return
    setRecordSaving(true)
    try {
      await deleteAttendanceRecord({ data: { id: deletingRecord.id } })
      setDeletingRecord(null)
      toast({
        title: t('common.toastDeletedTitle'),
        description: t('records.toastRecordDeleted'),
        variant: 'success',
      })
      await loadPage(records.page)
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal menghapus',
        variant: 'error',
      })
    } finally {
      setRecordSaving(false)
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function downloadCsv() {
    setDownloadingCsv(true)
    try {
      const res = await exportAttendanceCsv({
        data: {
          from,
          to,
          staffId: staffId || undefined,
          branchId: branchId || undefined,
          shiftId: shiftId || undefined,
        },
      })
      triggerDownload(
        new Blob([res.body], { type: 'text/csv;charset=utf-8' }),
        res.filename,
      )
      toast({
        title: t('common.toastSavedTitle'),
        description: t('records.toastExported', { count: res.count }),
        variant: 'success',
      })
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal export',
        variant: 'error',
      })
    } finally {
      setDownloadingCsv(false)
    }
  }

  /**
   * Build a ZIP of attendance photos client-side. The server returns a
   * list of {filename, signedUrl} pairs (limited to 500); the browser
   * fetches each image directly from S3 and packs them with jszip,
   * then triggers a single ZIP download via file-saver. Skips the
   * server as a bandwidth bottleneck.
   */
  async function downloadPhotosZip() {
    setPhotoZipProgress({ done: 0, total: 0 })
    try {
      const res = await getAttendancePhotoBundle({
        data: {
          from,
          to,
          staffId: staffId || undefined,
          branchId: branchId || undefined,
          shiftId: shiftId || undefined,
        },
      })

      const pendingItems = res.items.filter(
        (i): i is { filename: string; signedUrl: string } =>
          i.signedUrl !== null,
      )

      if (pendingItems.length === 0) {
        toast({
          title: t('common.toastFailedTitle'),
          description: t('records.photoZipEmpty'),
          variant: 'error',
        })
        return
      }

      setPhotoZipProgress({ done: 0, total: pendingItems.length })

      // Lazy-load jszip + file-saver. Both are ~100KB combined and
      // only this page needs them.
      const [{ default: JSZip }, { saveAs }] = await Promise.all([
        import('jszip'),
        import('file-saver'),
      ])
      const zip = new JSZip()

      // Fetch with limited concurrency to avoid hammering S3 / the
      // browser. 6 parallel matches typical browser per-host limits.
      const CONCURRENCY = 6
      let cursor = 0
      let completed = 0
      const failed: string[] = []

      async function worker() {
        while (cursor < pendingItems.length) {
          const idx = cursor++
          const item = pendingItems[idx]!
          try {
            const r = await fetch(item.signedUrl)
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const blob = await r.blob()
            zip.file(item.filename, blob)
          } catch (err) {
            // Most common cause is CORS on the S3 bucket — fetch
            // throws a TypeError with no useful body. Log so devs can
            // see it; the user-facing toast below summarises.
            console.error('[photo-zip] fetch failed for', item.filename, err)
            failed.push(item.filename)
          }
          completed++
          setPhotoZipProgress({
            done: completed,
            total: pendingItems.length,
          })
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, pendingItems.length) }, () =>
          worker(),
        ),
      )

      const successCount = pendingItems.length - failed.length

      // Hard fail: nothing succeeded. Almost always S3 CORS blocking
      // the browser fetch (image tags work for display but fetch needs
      // an explicit AllowedOrigin on the bucket). Surface clearly so
      // the owner knows it's a config issue, not their data.
      if (successCount === 0) {
        toast({
          title: t('common.toastFailedTitle'),
          description: t('records.photoZipAllFailed', {
            count: pendingItems.length,
          }),
          variant: 'error',
        })
        return
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      saveAs(blob, `absensi-foto-${from}-${to}.zip`)

      // Partial-failure toast tells the truth — some succeeded, some
      // didn't, here's the count. Keeps the success ZIP delivery but
      // doesn't pretend everything worked.
      const description =
        failed.length > 0
          ? t('records.photoZipPartial', {
              ok: successCount,
              failed: failed.length,
            })
          : res.truncated
            ? t('records.photoZipTruncated', {
                count: successCount,
                max: res.max,
                total: res.total,
              })
            : t('records.photoZipDone', { count: successCount })

      toast({
        title: t('common.toastSavedTitle'),
        description,
        variant: failed.length > 0 ? 'info' : 'success',
      })
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal',
        variant: 'error',
      })
    } finally {
      setPhotoZipProgress(null)
    }
  }

  async function downloadXlsx() {
    setDownloadingXlsx(true)
    try {
      const res = await exportAttendanceXlsx({
        data: {
          from,
          to,
          staffId: staffId || undefined,
          branchId: branchId || undefined,
          shiftId: shiftId || undefined,
        },
      })
      // Decode base64 → Uint8Array → Blob
      const binary = atob(res.bodyBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      triggerDownload(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        res.filename,
      )
      toast({
        title: t('common.toastSavedTitle'),
        description: t('records.toastExported', { count: res.count }),
        variant: 'success',
      })
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal export',
        variant: 'error',
      })
    } finally {
      setDownloadingXlsx(false)
    }
  }

  const staffOptions = useMemo(
    () => [
      { value: '', label: t('records.filterAllStaff') },
      ...loader.staff.map((s) => ({ value: s.id, label: s.fullName ?? '—' })),
    ],
    [loader.staff, t],
  )

  // Shift dropdown options: All / Reguler / any shift matching the selected
  // branch filter. Special value 'regular' = records without a shift attached.
  const shiftOptions = useMemo(() => {
    const filtered = branchId
      ? loader.shifts.filter((s) => s.branchId === branchId)
      : loader.shifts
    return [
      { value: '', label: t('records.filterAllShifts') },
      { value: 'regular', label: t('records.filterShiftRegular') },
      ...filtered.map((s) => ({ value: s.id, label: s.name })),
    ]
  }, [loader.shifts, branchId, t])

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('records.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('records.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setRecordForm({ mode: 'create' })}
          >
            <Plus className="h-4 w-4" />
            {t('records.addRecord')}
          </Button>
          <div ref={downloadMenuRef} className="relative">
          <Button
            variant="brand"
            onClick={() => setDownloadMenuOpen((v) => !v)}
            loading={downloadingXlsx || downloadingCsv}
            disabled={records.records.length === 0}
          >
            <Download className="h-4 w-4" />
            {t('records.download')}
            <ChevronDown className="h-4 w-4" />
          </Button>
          {downloadMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => {
                  setDownloadMenuOpen(false)
                  void downloadXlsx()
                }}
              >
                <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {t('records.downloadXlsxLabel')}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('records.downloadXlsxHint')}
                  </p>
                </div>
              </button>
              <div className="h-px bg-gray-200 dark:bg-gray-700" />
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => {
                  setDownloadMenuOpen(false)
                  void downloadCsv()
                }}
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {t('records.downloadCsvLabel')}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('records.downloadCsvHint')}
                  </p>
                </div>
              </button>
              <div className="h-px bg-gray-200 dark:bg-gray-700" />
              <button
                type="button"
                role="menuitem"
                disabled={photoZipProgress !== null}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-700"
                onClick={() => {
                  setDownloadMenuOpen(false)
                  void downloadPhotosZip()
                }}
              >
                <Archive className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {t('records.downloadPhotosLabel')}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('records.downloadPhotosHint')}
                  </p>
                </div>
              </button>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Photo ZIP build progress — surfaces a small inline status while
          the browser is fetching + zipping. Shown in lieu of a modal
          since the user can keep navigating filters. */}
      {photoZipProgress !== null && photoZipProgress.total > 0 && (
        <div className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-900 dark:border-primary-900/40 dark:bg-primary-900/20 dark:text-primary-200">
          <div className="flex items-center justify-between gap-2">
            <span>
              {t('records.photoZipProgress', {
                done: photoZipProgress.done,
                total: photoZipProgress.total,
              })}
            </span>
            <span className="font-mono text-xs">
              {Math.round(
                (photoZipProgress.done / photoZipProgress.total) * 100,
              )}
              %
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-primary-200 dark:bg-primary-900/40">
            <div
              className="h-full bg-primary-600 transition-all dark:bg-primary-400"
              style={{
                width: `${(photoZipProgress.done / photoZipProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <Filter className="h-4 w-4" />
          {t('records.filterTitle')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('records.filterFrom')}
            </label>
            <DateInput value={from} onChange={setFrom} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('records.filterTo')}
            </label>
            <DateInput value={to} onChange={setTo} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('records.filterStaff')}
            </label>
            <Select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              options={staffOptions}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('records.filterShift')}
            </label>
            <Select
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              options={shiftOptions}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="brand"
              onClick={applyFilters}
              loading={refreshing}
              className="w-full"
            >
              {t('records.applyFilters')}
            </Button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('records.showingTotal', { count: records.totalCount })}
          </p>
        </div>

        {records.records.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('records.empty')}
          </div>
        ) : (
          <>
            {/* Mobile card list — hidden at sm+ */}
            <ul className="divide-y divide-gray-200 sm:hidden dark:divide-gray-700">
              {records.records.map((r) => (
                <RecordCard
                  key={r.id}
                  record={r}
                  onPreview={(src, caption) => setPreview({ src, caption })}
                  onEdit={() => setRecordForm({ mode: 'edit', record: r })}
                  onDelete={() => setDeletingRecord(r)}
                />
              ))}
            </ul>

            {/* Desktop table — hidden below sm */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('records.colDate')}</TableHead>
                    <TableHead>{t('records.colStaff')}</TableHead>
                    <TableHead>{t('records.colBranch')}</TableHead>
                    <TableHead>{t('records.colShift')}</TableHead>
                    <TableHead>{t('records.colClockIn')}</TableHead>
                    <TableHead>{t('records.colClockOut')}</TableHead>
                    <TableHead>{t('records.colPhotos')}</TableHead>
                    <TableHead>{t('records.colNotes')}</TableHead>
                    <TableHead className="text-right">
                      {t('records.colActions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.records.map((r) => (
                    <RecordRow
                      key={r.id}
                      record={r}
                      onPreview={(src, caption) => setPreview({ src, caption })}
                      onEdit={() => setRecordForm({ mode: 'edit', record: r })}
                      onDelete={() => setDeletingRecord(r)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {/* Pagination footer — always shown */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('records.paginationHint', {
              page: records.page,
              totalPages: records.totalPages,
            })}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={records.page <= 1 || refreshing}
              onClick={() => loadPage(records.page - 1)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-xs font-medium text-gray-600 dark:text-gray-400 tabular-nums">
              {records.page} / {records.totalPages}
            </span>
            <button
              type="button"
              disabled={records.page >= records.totalPages || refreshing}
              onClick={() => loadPage(records.page + 1)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <ImagePreviewModal
        open={preview !== null}
        src={preview?.src ?? null}
        caption={preview?.caption}
        onClose={() => setPreview(null)}
      />

      {/* Subtle retention reminder. Owners doing audits past 60 days
          ago may find photos missing — telling them up-front keeps
          support requests down. */}
      <p className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t('attendance.recordsPhotoRetentionNote')}</span>
      </p>

      {recordForm && (
        <AttendanceRecordForm
          mode={recordForm.mode}
          record={recordForm.mode === 'edit' ? recordForm.record : null}
          staff={loader.staff}
          loading={recordSaving}
          onSubmit={handleSubmitRecord}
          onCancel={() => setRecordForm(null)}
        />
      )}

      <ConfirmDialog
        open={deletingRecord !== null}
        title={t('records.deleteTitle')}
        description={
          deletingRecord
            ? t('records.deleteConfirm', {
                name: deletingRecord.staffName,
                date: formatDate(deletingRecord.date, 'dd MMM yyyy'),
              })
            : ''
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        loading={recordSaving}
        onConfirm={handleDeleteRecord}
        onCancel={() => setDeletingRecord(null)}
      />
    </div>
  )
}

// ─── Manual record add / edit form ──────────────────

function AttendanceRecordForm({
  mode,
  record,
  staff,
  loading,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit'
  record: RecordItem | null
  staff: Array<{ id: string; fullName: string | null }>
  loading: boolean
  onSubmit: (values: RecordFormValues) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<RecordFormValues>({
    resolver: zodResolver(recordFormSchema),
    defaultValues: {
      staffProfileId: record?.staffId ?? '',
      date: record?.date ?? new Date().toISOString().slice(0, 10),
      clockInTime: toJakartaHHmm(record?.clockInAt ?? null),
      clockInStatus: (record?.clockInStatus as RecordFormValues['clockInStatus']) ?? 'present',
      clockOutTime: toJakartaHHmm(record?.clockOutAt ?? null),
      clockOutStatus:
        (record?.clockOutStatus as RecordFormValues['clockOutStatus']) ?? 'present',
      clockInNotes: record?.clockInNotes ?? '',
      clockOutNotes: record?.clockOutNotes ?? '',
    },
  })

  const isEdit = mode === 'edit'
  const inStatusOptions = IN_STATUSES.map((s) => ({
    value: s,
    label: t(STATUS_I18N[s] ?? s),
  }))
  const outStatusOptions = OUT_STATUSES.map((s) => ({
    value: s,
    label: t(STATUS_I18N[s] ?? s),
  }))

  return (
    <Sheet open={true} onClose={() => !loading && onCancel()}>
      <SheetHeader onClose={() => !loading && onCancel()}>
        <SheetTitle>
          {isEdit ? t('records.editRecordTitle') : t('records.addRecordTitle')}
        </SheetTitle>
        <SheetDescription>{t('records.recordFormDesc')}</SheetDescription>
      </SheetHeader>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* Staff + date are fixed once a record exists — change them
              by deleting and re-adding. */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('records.colStaff')}
            </label>
            {isEdit ? (
              <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                {record?.staffName}
              </p>
            ) : (
              <Select
                error={errors.staffProfileId?.message}
                {...register('staffProfileId')}
                options={[
                  { value: '', label: t('records.recordFormPickStaff') },
                  ...staff.map((s) => ({
                    value: s.id,
                    label: s.fullName ?? '—',
                  })),
                ]}
              />
            )}
          </div>
          <Controller
            name="date"
            control={control}
            render={({ field }) => (
              <DateInput
                label={t('records.colDate')}
                disabled={isEdit}
                error={errors.date?.message}
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
              />
            )}
          />

          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <p className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('records.colClockIn')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="time"
                label={t('records.recordFormTime')}
                error={errors.clockInTime?.message}
                {...register('clockInTime')}
              />
              <Select
                label={t('records.recordFormStatus')}
                {...register('clockInStatus')}
                options={inStatusOptions}
              />
            </div>
            <div className="mt-3">
              <Textarea
                label={t('records.notesIn')}
                rows={2}
                {...register('clockInNotes')}
              />
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <p className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('records.colClockOut')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="time"
                label={t('records.recordFormTime')}
                {...register('clockOutTime')}
              />
              <Select
                label={t('records.recordFormStatus')}
                {...register('clockOutStatus')}
                options={outStatusOptions}
              />
            </div>
            <div className="mt-3">
              <Textarea
                label={t('records.notesOut')}
                rows={2}
                {...register('clockOutNotes')}
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('records.recordFormHint')}
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={loading}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={loading}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

// Mobile card layout — shown below sm breakpoint. All fields visible inline,
// no horizontal scroll. Photo thumbnails on the right for quick visual scan.
function RecordCard({
  record,
  onPreview,
  onEdit,
  onDelete,
}: {
  record: RecordItem
  onPreview: (src: string, caption: string) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  return (
    <li className="space-y-2 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {formatDate(record.date, 'EEE, dd MMM yyyy')}
          </p>
          <p className="mt-0.5 font-semibold text-gray-900 dark:text-gray-100">
            {record.staffName}
          </p>
          {record.branchName && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span>{record.branchName}</span>
              <ShiftPill name={record.branchShiftName} size="xs" />
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {record.clockInPhotoUrl && (
            <button
              type="button"
              onClick={() =>
                onPreview(
                  record.clockInPhotoUrl!,
                  `${record.staffName} · ${record.date} · ${t('attendance.mode_photo')} masuk`,
                )
              }
              className="rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
              aria-label="Preview clock-in"
            >
              <img
                src={record.clockInPhotoUrl}
                alt="in"
                className="h-12 w-12 rounded object-cover ring-2 ring-success-300"
              />
            </button>
          )}
          {record.clockOutPhotoUrl && (
            <button
              type="button"
              onClick={() =>
                onPreview(
                  record.clockOutPhotoUrl!,
                  `${record.staffName} · ${record.date} · ${t('attendance.mode_photo')} pulang`,
                )
              }
              className="rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
              aria-label="Preview clock-out"
            >
              <img
                src={record.clockOutPhotoUrl}
                alt="out"
                className="h-12 w-12 rounded object-cover ring-2 ring-gray-300"
              />
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('records.colClockIn')}
          </p>
          <ClockCell
            at={record.clockInAt}
            status={record.clockInStatus}
            modes={record.clockInModes}
            scheduled={record.scheduledIn}
          />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('records.colClockOut')}
          </p>
          <ClockCell
            at={record.clockOutAt}
            status={record.clockOutStatus}
            modes={record.clockOutModes}
            scheduled={record.scheduledOut}
          />
        </div>
      </div>
      {(record.clockInNotes || record.clockOutNotes) && (
        <div className="space-y-1 rounded bg-gray-50 p-2 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
          {record.clockInNotes && (
            <p>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {t('records.notesIn')}:
              </span>{' '}
              <span className="whitespace-pre-wrap">{record.clockInNotes}</span>
            </p>
          )}
          {record.clockOutNotes && (
            <p>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {t('records.notesOut')}:
              </span>{' '}
              <span className="whitespace-pre-wrap">{record.clockOutNotes}</span>
            </p>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <Pencil className="h-3.5 w-3.5" />
          {t('common.edit')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-gray-700 dark:text-red-400 dark:hover:bg-red-900/30"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('common.delete')}
        </button>
      </div>
    </li>
  )
}

function RecordRow({
  record,
  onPreview,
  onEdit,
  onDelete,
}: {
  record: RecordItem
  onPreview: (src: string, caption: string) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  return (
    <TableRow>
      <TableCell className="text-sm">
        {formatDate(record.date, 'dd MMM yyyy')}
      </TableCell>
      <TableCell className="font-medium">{record.staffName}</TableCell>
      <TableCell className="text-sm text-gray-600 dark:text-gray-400">
        {record.branchName ?? <span className="italic text-gray-400">—</span>}
      </TableCell>
      <TableCell className="text-xs">
        <ShiftPill name={record.branchShiftName} />
      </TableCell>
      <TableCell>
        <ClockCell
          at={record.clockInAt}
          status={record.clockInStatus}
          modes={record.clockInModes}
          scheduled={record.scheduledIn}
        />
      </TableCell>
      <TableCell>
        <ClockCell
          at={record.clockOutAt}
          status={record.clockOutStatus}
          modes={record.clockOutModes}
          scheduled={record.scheduledOut}
        />
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          {record.clockInPhotoUrl && (
            <button
              type="button"
              onClick={() =>
                onPreview(
                  record.clockInPhotoUrl!,
                  `${record.staffName} · ${record.date} · ${t('attendance.mode_photo')} masuk`,
                )
              }
              className="rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
              aria-label="Preview clock-in"
            >
              <img
                src={record.clockInPhotoUrl}
                alt="in"
                className="h-10 w-10 rounded object-cover ring-2 ring-success-300"
              />
            </button>
          )}
          {record.clockOutPhotoUrl && (
            <button
              type="button"
              onClick={() =>
                onPreview(
                  record.clockOutPhotoUrl!,
                  `${record.staffName} · ${record.date} · ${t('attendance.mode_photo')} pulang`,
                )
              }
              className="rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
              aria-label="Preview clock-out"
            >
              <img
                src={record.clockOutPhotoUrl}
                alt="out"
                className="h-10 w-10 rounded object-cover ring-2 ring-gray-300"
              />
            </button>
          )}
          {!record.clockInPhotoUrl && !record.clockOutPhotoUrl && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <ImageIcon className="h-3 w-3" />
              —
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="max-w-xs align-top">
        {record.clockInNotes || record.clockOutNotes ? (
          <div className="space-y-1 text-xs">
            {record.clockInNotes && (
              <p
                className="whitespace-pre-wrap text-gray-700 dark:text-gray-300"
                title={record.clockInNotes}
              >
                <span className="font-semibold">{t('records.notesIn')}:</span>{' '}
                {record.clockInNotes}
              </p>
            )}
            {record.clockOutNotes && (
              <p
                className="whitespace-pre-wrap text-gray-700 dark:text-gray-300"
                title={record.clockOutNotes}
              >
                <span className="font-semibold">{t('records.notesOut')}:</span>{' '}
                {record.clockOutNotes}
              </p>
            )}
          </div>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={t('common.edit')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('common.delete')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </TableCell>
    </TableRow>
  )
}

const STATUS_I18N: Record<string, string> = {
  on_time: 'records.statusOnTime',
  late: 'records.statusLate',
  early_leave: 'records.statusEarlyLeave',
  present: 'records.statusPresent',
  corrected: 'records.statusCorrected',
}

function ClockCell({
  at,
  status,
  modes,
  scheduled,
}: {
  at: Date | null
  status: string | null
  modes: string[] | null
  scheduled: string | null
}) {
  const { t } = useTranslation()
  if (!at) return <span className="text-gray-400">—</span>
  const timeStr = new Date(at).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  })
  const statusColor =
    status === 'on_time'
      ? 'text-success-700 dark:text-success-400'
      : status === 'late' || status === 'early_leave'
        ? 'text-warning-700 dark:text-warning-400'
        : 'text-gray-600 dark:text-gray-400'

  const statusLabel =
    status && STATUS_I18N[status] ? t(STATUS_I18N[status]!) : (status ?? '—')

  // Minutes delta vs scheduled time for late/early-leave rows only
  let diffLabel: string | null = null
  if (scheduled && (status === 'late' || status === 'early_leave')) {
    const mins = minutesFromScheduled(scheduled, new Date(at))
    if (status === 'late' && mins > 0) diffLabel = `+${mins} menit`
    if (status === 'early_leave' && mins < 0) diffLabel = `${mins} menit`
  }

  return (
    <div>
      <p className="font-mono text-sm tabular-nums">{timeStr}</p>
      <p className={`mt-0.5 text-xs ${statusColor}`}>
        {statusLabel}
        {diffLabel && <span className="ml-1 font-semibold">· {diffLabel}</span>}
        {modes && modes.length > 0 && (
          <span className="ml-1 text-gray-400">· {modes.join('+')}</span>
        )}
      </p>
    </div>
  )
}

// Compact pill used in both the desktop table (size='sm') and mobile card
// (size='xs'). Keeps the name on one line even in narrow columns.
function ShiftPill({
  name,
  size = 'sm',
}: {
  name: string | null | undefined
  size?: 'xs' | 'sm'
}) {
  const { t } = useTranslation()
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs'
  const pad = size === 'xs' ? 'px-1.5 py-0.5' : 'px-2 py-0.5'
  const iconSize = size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3'

  if (!name) {
    return (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 ${pad} font-medium text-gray-500 dark:bg-gray-700/50 dark:text-gray-400 ${textSize}`}
      >
        {t('records.shiftRegular')}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-brand-100 ${pad} font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 ${textSize}`}
    >
      <Clock className={iconSize} />
      {name}
    </span>
  )
}
