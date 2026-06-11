import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, Download } from 'lucide-react'
import {
  importCustomers,
  getCustomerImportTemplate,
} from '@/server/functions/customers-io'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatNumberId } from '@/lib/currency'

type Preview = Extract<
  Awaited<ReturnType<typeof importCustomers>>,
  { committed: false }
>

/**
 * Two-step Qasir-compatible import:
 *   1. file picker → POST preview → show counts + caveats
 *   2. user confirms → POST commit → toast + invalidate list
 *
 * The file bytes (base64) are kept in component state between steps so
 * the user can't change the file mid-flow without re-uploading. The
 * server re-parses on commit anyway, so this is just UX safety.
 */
export function ImportCustomersDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [bodyBase64, setBodyBase64] = React.useState<string | null>(null)
  const [filename, setFilename] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<Preview | null>(null)
  // Opt-in: when ticked, existing customers' loyalty balances are
  // overwritten to the file's value (with an 'adjust' ledger row).
  // Default off because the safe assumption is the file is older than
  // the live balance.
  const [overrideLoyalty, setOverrideLoyalty] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setBodyBase64(null)
      setFilename(null)
      setPreview(null)
      setOverrideLoyalty(false)
    }
  }, [open])

  const previewMut = useMutation({
    mutationFn: (b64: string) =>
      importCustomers({
        data: { bodyBase64: b64, mode: 'preview', overrideLoyalty },
      }),
    onSuccess: (data) => {
      // Preview path always returns committed:false — the type guard
      // narrows correctly here.
      if (data.committed === false) setPreview(data)
    },
    onError: (err: Error) => {
      toast({
        title: 'Gagal membaca file',
        description: err.message,
        variant: 'error',
      })
    },
  })

  const templateMut = useMutation({
    mutationFn: () => getCustomerImportTemplate(),
    onSuccess: (data) => {
      // base64 → Blob → object-URL download. Same pattern other
      // download flows in this app use (e.g. P&L PDF export).
      const bytes = Uint8Array.from(atob(data.bodyBase64), (c) =>
        c.charCodeAt(0),
      )
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = data.filename
      a.click()
      URL.revokeObjectURL(url)
    },
    onError: (err: Error) => {
      toast({
        title: 'Gagal mengunduh template',
        description: err.message,
        variant: 'error',
      })
    },
  })

  const commitMut = useMutation({
    mutationFn: (b64: string) =>
      importCustomers({
        data: { bodyBase64: b64, mode: 'commit', overrideLoyalty },
      }),
    onSuccess: async (data) => {
      // Defensive: a proxy hiccup (Cloudflare 524 etc.) can resolve
      // the promise with undefined even though the server's
      // transaction committed. Show a fallback toast instead of
      // crashing on data.toCreate.
      if (!data || typeof data !== 'object') {
        toast({
          title: 'Import selesai',
          description:
            'Server tidak mengirim ringkasan, tapi data kemungkinan sudah masuk. Refresh halaman untuk verifikasi.',
          variant: 'success',
        })
      } else {
        toast({
          title: 'Import berhasil',
          description: `${data.toCreate} baru, ${data.toUpdate} diperbarui.`,
          variant: 'success',
        })
      }
      await qc.invalidateQueries({ queryKey: ['pos', 'customers'] })
      onClose()
    },
    onError: (err: Error) => {
      toast({
        title: 'Gagal import',
        description: err.message,
        variant: 'error',
      })
    },
  })

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking same file
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'File terlalu besar',
        description: 'Maksimal 10 MB.',
        variant: 'error',
      })
      return
    }
    const buf = await file.arrayBuffer()
    // Base64-encode in chunks to avoid the stack overflow that
    // String.fromCharCode(...largeArray) triggers on big xlsx files.
    const bytes = new Uint8Array(buf)
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + CHUNK) as unknown as number[],
      )
    }
    const b64 = btoa(bin)
    setBodyBase64(b64)
    setFilename(file.name)
    previewMut.mutate(b64)
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Import Pelanggan</DialogTitle>
        <DialogDescription>
          Unggah file Excel format Qasir (kolom: Nama Pelanggan, Email,
          Nomor Telepon, Transaksi, Kasbon, Poin). Data yang sudah ada
          akan diperbarui berdasarkan nomor HP.
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        {!preview ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Belum punya file? Unduh template kosong di samping —
                isi pakai Excel/Google Sheets, lalu upload kembali.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => templateMut.mutate()}
                loading={templateMut.isPending}
              >
                <Download className="h-3.5 w-3.5" />
                Unduh Template
              </Button>
            </div>
            <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
              {previewMut.isPending ? (
                <>
                  <FileSpreadsheet className="h-7 w-7 animate-pulse" />
                  <span>Memproses {filename}…</span>
                </>
              ) : (
                <>
                  <Upload className="h-7 w-7" />
                  <span>Pilih file .xlsx</span>
                  <span className="text-xs">Maksimal 10 MB</span>
                </>
              )}
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFile}
                className="hidden"
                disabled={previewMut.isPending}
              />
            </label>
            <div className="rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
              <p className="font-medium">Catatan import:</p>
              <ul className="ml-4 mt-0.5 list-disc space-y-0.5">
                <li>
                  Pelanggan yang sudah ada (cocok nomor HP) akan diperbarui
                  nama, email, dan jumlah transaksi-nya.
                </li>
                <li>
                  <strong>Poin</strong> hanya di-set untuk pelanggan baru —
                  saldo poin yang sudah ada tidak akan ditimpa
                  {' '}<em>(kecuali opsi di bawah dicentang)</em>.
                </li>
                <li>
                  <strong>Kasbon</strong> dibuat sebagai bon pelanggan baru.
                  File yang sama tidak akan membuat bon dobel saat di-upload
                  ulang.
                </li>
              </ul>
            </div>

            {/* Opt-in override. Default off so a stale Qasir export can
                never accidentally clobber a live balance — owner only
                ticks this when the file is the authoritative source
                (e.g. cutover migration at end of business day). */}
            <label className="flex items-start gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <input
                type="checkbox"
                checked={overrideLoyalty}
                onChange={(e) => setOverrideLoyalty(e.target.checked)}
                disabled={previewMut.isPending}
                className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                <strong>Timpa saldo poin pelanggan yang sudah ada.</strong>
                {' '}Setiap penimpaan dicatat di riwayat poin pelanggan
                (tipe "adjust") agar bisa ditelusuri. Aktifkan hanya
                kalau file ini adalah sumber terbaru.
              </span>
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 dark:border-gray-700 dark:bg-gray-800/40">
              <p className="text-xs text-gray-500">{filename}</p>
              <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                {formatNumberId(preview.parsed)} baris siap diproses
                {preview.skipped.length > 0 && (
                  <span className="text-warning-700 dark:text-warning-400">
                    {' · '}
                    {preview.skipped.length} dilewati
                  </span>
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <SummaryRow
                label="Pelanggan baru"
                value={preview.toCreate}
                tone="success"
              />
              <SummaryRow
                label="Diperbarui"
                value={preview.toUpdate}
                tone="default"
              />
              <SummaryRow
                label="Saldo poin di-seed"
                value={preview.poinToSeed}
                tone="default"
              />
              {preview.poinOverridden > 0 && (
                <SummaryRow
                  label="Poin di-override"
                  value={preview.poinOverridden}
                  tone="success"
                />
              )}
              <SummaryRow
                label="Bon kasbon dibuat"
                value={preview.kasbonToInsert}
                tone="default"
              />
            </div>

            {(preview.poinSkippedExisting > 0 ||
              preview.poinSkippedNoFeature > 0 ||
              preview.kasbonSkippedDup > 0) && (
              <div className="rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
                <p className="mb-1 flex items-center gap-1 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Beberapa data dilewati
                </p>
                <ul className="ml-4 list-disc space-y-0.5">
                  {preview.poinSkippedExisting > 0 && (
                    <li>
                      {preview.poinSkippedExisting} baris poin diabaikan —
                      pelanggan sudah ada, saldo poin tidak ditimpa.
                    </li>
                  )}
                  {preview.poinSkippedNoFeature > 0 && (
                    <li>
                      {preview.poinSkippedNoFeature} baris poin diabaikan —
                      fitur loyalty poin belum aktif (paket Komplit).
                    </li>
                  )}
                  {preview.kasbonSkippedDup > 0 && (
                    <li>
                      {preview.kasbonSkippedDup} baris kasbon diabaikan —
                      pelanggan sudah punya bon dari import sebelumnya.
                    </li>
                  )}
                </ul>
              </div>
            )}

            {preview.skipped.length > 0 && (
              <div className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-900 dark:border-warning-800/40 dark:bg-warning-900/20 dark:text-warning-200">
                <p className="mb-1 font-medium">
                  {preview.skipped.length} baris dilewati
                </p>
                <div className="max-h-32 overflow-y-auto">
                  <ul className="ml-4 list-disc space-y-0.5">
                    {preview.skipped.slice(0, 20).map((s) => (
                      <li key={s.rowNumber}>
                        Baris {s.rowNumber} ({s.name}): {s.reason}
                      </li>
                    ))}
                    {preview.skipped.length > 20 && (
                      <li>
                        … dan {preview.skipped.length - 20} baris lain.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}

            <div className="rounded-md bg-success-50 px-3 py-2 text-xs text-success-700 dark:bg-success-900/20 dark:text-success-300">
              <p className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Siap untuk dikomit. Klik "Konfirmasi Import" untuk
                menyimpan ke database.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={commitMut.isPending}>
          Batal
        </Button>
        {preview && (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null)
                setBodyBase64(null)
                setFilename(null)
              }}
              disabled={commitMut.isPending}
            >
              Ganti file
            </Button>
            <Button
              variant="brand"
              onClick={() => bodyBase64 && commitMut.mutate(bodyBase64)}
              loading={commitMut.isPending}
              disabled={preview.parsed === 0}
            >
              Konfirmasi Import
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  )
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'success' | 'default'
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
      <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
      <span
        className={`text-base font-semibold tabular-nums ${
          tone === 'success'
            ? 'text-success-700 dark:text-success-400'
            : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {formatNumberId(value)}
      </span>
    </div>
  )
}
