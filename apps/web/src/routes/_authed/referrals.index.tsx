import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listMyReferralCodes,
  createReferralCode,
  updateReferralCode,
  toggleReferralCode,
  getReferralCap,
} from '@/server/functions/referrals'
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
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { Plus, Pencil, Copy, RefreshCw, Check, Share2, MessageCircle, Send, ExternalLink, X as XIcon } from 'lucide-react'

export const Route = createFileRoute('/_authed/referrals/')({
  loader: async () => ({
    codes: await listMyReferralCodes(),
    cap: await getReferralCap(),
  }),
  component: ReferralsPage,
})

type ReferralCode = Awaited<ReturnType<typeof listMyReferralCodes>>[number]

function ReferralsPage() {
  const initial = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  // Loader-fetched data is the seed; React Query keeps it fresh after
  // mutations so toggle/edit changes show immediately without a full
  // router.invalidate() round trip.
  const { data: codes = initial.codes } = useQuery({
    queryKey: ['tenant', 'referral-codes'],
    queryFn: () => listMyReferralCodes(),
    initialData: initial.codes,
    staleTime: 30_000,
  })
  const { data: capData = initial.cap } = useQuery({
    queryKey: ['referral-cap'],
    queryFn: () => getReferralCap(),
    initialData: initial.cap,
    staleTime: 10 * 60_000,
  })
  const cap = capData.capPct

  const [showCreateSheet, setShowCreateSheet] = useState(false)
  const [editingCode, setEditingCode] = useState<ReferralCode | null>(null)
  const [sharingCode, setSharingCode] = useState<ReferralCode | null>(null)
  const [mutationLoading, setMutationLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function refresh() {
    queryClient.invalidateQueries({ queryKey: ['tenant', 'referral-codes'] })
    await router.invalidate()
  }

  async function handleCreate(input: CodeFormInput) {
    setMutationLoading(true)
    try {
      await createReferralCode({
        data: {
          code: input.code,
          label: input.label,
          discountPct: input.discountPct,
          commissionPct: input.commissionPct,
          maxClaims: input.maxClaims,
        },
      })
      setShowCreateSheet(false)
      toast({ title: 'Kode referral dibuat', variant: 'success' })
      await refresh()
    } catch (err) {
      toast({ title: 'Gagal membuat kode', description: (err as Error).message, variant: 'error' })
    } finally {
      setMutationLoading(false)
    }
  }

  async function handleUpdate(input: CodeFormInput) {
    if (!editingCode) return
    setMutationLoading(true)
    try {
      await updateReferralCode({
        data: {
          id: editingCode.id,
          label: input.label,
          discountPct: input.discountPct,
          commissionPct: input.commissionPct,
          maxClaims: input.maxClaims,
        },
      })
      setEditingCode(null)
      toast({ title: 'Kode referral disimpan', variant: 'success' })
      await refresh()
    } catch (err) {
      toast({ title: 'Gagal menyimpan kode', description: (err as Error).message, variant: 'error' })
    } finally {
      setMutationLoading(false)
    }
  }

  async function handleToggle(code: ReferralCode) {
    try {
      await toggleReferralCode({ data: { id: code.id, isActive: !code.isActive } })
      await refresh()
    } catch (err) {
      toast({ title: 'Gagal mengubah status', description: (err as Error).message, variant: 'error' })
    }
  }

  async function handleCopy(code: ReferralCode) {
    try {
      await navigator.clipboard.writeText(code.code)
      setCopiedId(code.id)
      // Reset the copied-state checkmark after 1.5s so a second copy
      // of the same row still gives visual feedback.
      window.setTimeout(() => setCopiedId((c) => (c === code.id ? null : c)), 1500)
    } catch {
      toast({ title: 'Gagal menyalin kode', variant: 'error' })
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Kode Referral</CardTitle>
              <CardDescription className="mt-1">
                Buat dan kelola kode yang akan Anda bagikan.
              </CardDescription>
            </div>
            <Button
              variant="brand"
              className="mt-3 w-full sm:mt-0 sm:w-auto"
              onClick={() => setShowCreateSheet(true)}
            >
              <Plus className="h-4 w-4" />
              Buat Kode Baru
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {codes.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Belum ada kode referral
              </p>
              <p className="mt-1 max-w-md text-center text-sm text-gray-500 dark:text-gray-400">
                Buat kode pertama Anda. Bagikan ke teman pengusaha lewat WhatsApp atau Instagram,
                dan dapatkan komisi setiap kali mereka berlangganan.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('referrals.colCode')}</TableHead>
                  <TableHead>{t('referrals.colLabel')}</TableHead>
                  <TableHead className="text-right">{t('referrals.colDiscount')}</TableHead>
                  <TableHead className="text-right">{t('referrals.colCommission')}</TableHead>
                  <TableHead className="text-right">{t('referrals.colAttributions')}</TableHead>
                  <TableHead>{t('referrals.colStatus')}</TableHead>
                  <TableHead className="w-20 text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.map((code) => (
                  <TableRow key={code.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold">{code.code}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(code)}
                          aria-label="Salin kode"
                          className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                        >
                          {copiedId === code.id ? (
                            <Check className="h-3.5 w-3.5 text-success-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                      {code.label || '—'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {parseFloat(code.discountPct).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {parseFloat(code.commissionPct).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="inline-flex items-center gap-1.5">
                        {code.attributionCount > 0 ? (
                          <Link
                            to="/referrals/pendaftar"
                            search={{ codeId: code.id, page: 1 }}
                            className="rounded px-2 py-0.5 font-semibold text-brand-700 hover:bg-brand-50 hover:underline dark:text-brand-400 dark:hover:bg-brand-900/30"
                            aria-label={`Lihat ${code.attributionCount} pendaftar kode ${code.code}`}
                          >
                            {code.attributionCount}
                          </Link>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                        {code.maxClaims != null && (
                          <span
                            className={
                              'text-xs ' +
                              (code.attributionCount >= code.maxClaims
                                ? 'font-medium text-danger-600 dark:text-danger-400'
                                : 'text-gray-400')
                            }
                            title={
                              code.attributionCount >= code.maxClaims
                                ? `Kuota penuh (${code.maxClaims})`
                                : `Batas: ${code.maxClaims}`
                            }
                          >
                            / {code.maxClaims}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => handleToggle(code)}
                        className={
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ' +
                          (code.isActive
                            ? 'bg-success-100 text-success-700 hover:bg-success-200 dark:bg-success-900/30 dark:text-success-300'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400')
                        }
                      >
                        <span className={'h-1.5 w-1.5 rounded-full ' + (code.isActive ? 'bg-success-500' : 'bg-gray-400')} />
                        {code.isActive ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-brand-50 hover:text-brand-600 dark:text-gray-500 dark:hover:bg-brand-900/30 dark:hover:text-brand-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                          aria-label="Bagikan kode"
                          disabled={!code.isActive}
                          onClick={() => setSharingCode(code)}
                        >
                          <Share2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                          aria-label={t('common.edit')}
                          onClick={() => setEditingCode(code)}
                        >
                          <Pencil className="h-4 w-4" />
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

      <Sheet open={showCreateSheet} onClose={() => setShowCreateSheet(false)}>
        <SheetHeader onClose={() => setShowCreateSheet(false)}>
          <SheetTitle>Buat Kode Referral</SheetTitle>
          <SheetDescription>
            Atur kode unik dan bagaimana cap {cap.toFixed(0)}% dibagi antara diskon untuk pendaftar dan komisi untuk Anda.
          </SheetDescription>
        </SheetHeader>
        <CodeForm
          mode="create"
          cap={cap}
          onSubmit={handleCreate}
          onCancel={() => setShowCreateSheet(false)}
          loading={mutationLoading}
        />
      </Sheet>

      <Sheet open={!!editingCode} onClose={() => setEditingCode(null)}>
        <SheetHeader onClose={() => setEditingCode(null)}>
          <SheetTitle>Edit Kode Referral</SheetTitle>
          <SheetDescription>
            Kode tidak dapat diubah agar tautan yang sudah dibagikan tetap berfungsi.
            Anda bisa mengubah label dan pembagian persentase.
          </SheetDescription>
        </SheetHeader>
        {editingCode && (
          <CodeForm
            mode="edit"
            cap={cap}
            defaultValues={{
              code: editingCode.code,
              label: editingCode.label ?? '',
              discountPct: editingCode.discountPct,
              commissionPct: editingCode.commissionPct,
              maxClaims: editingCode.maxClaims ?? null,
            }}
            onSubmit={handleUpdate}
            onCancel={() => setEditingCode(null)}
            loading={mutationLoading}
          />
        )}
      </Sheet>

      <ShareDialog code={sharingCode} onClose={() => setSharingCode(null)} />
    </div>
  )
}

// ─── Form ─────────────────────────────────────────────

interface CodeFormInput {
  code: string
  label: string
  discountPct: string
  commissionPct: string
  // Null = unlimited claims. UI represents this as an empty input.
  maxClaims: number | null
}

interface CodeFormProps {
  mode: 'create' | 'edit'
  cap: number
  defaultValues?: CodeFormInput
  onSubmit: (input: CodeFormInput) => void
  onCancel: () => void
  loading?: boolean
}

// Default split: 75% of the cap goes to discount, 25% to commission.
// Generous to the referee (the one bringing the new customer to Vintra)
// while leaving meaningful commission. Tenant can rebalance freely.
function defaultSplit(cap: number) {
  const discount = (cap * 0.75).toFixed(2)
  const commission = (cap * 0.25).toFixed(2)
  return { discount, commission }
}

function randomCode(): string {
  // 6-char A-Z0-9, no ambiguous chars (0/O, 1/I/L) to keep codes
  // readable when shared verbally or in screenshots.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

function CodeForm({ mode, cap, defaultValues, onSubmit, onCancel, loading }: CodeFormProps) {
  const split = defaultSplit(cap)
  const [code, setCode] = useState(defaultValues?.code ?? '')
  const [label, setLabel] = useState(defaultValues?.label ?? '')
  const [discountPct, setDiscountPct] = useState(defaultValues?.discountPct ?? split.discount)
  const [commissionPct, setCommissionPct] = useState(defaultValues?.commissionPct ?? split.commission)
  // Stored as string so the input can be empty (= unlimited) without
  // an uncontrolled-input warning. Parsed to number on submit.
  const [maxClaims, setMaxClaims] = useState<string>(
    defaultValues?.maxClaims != null ? String(defaultValues.maxClaims) : '',
  )
  const [errors, setErrors] = useState<Partial<Record<keyof CodeFormInput, string>>>({})

  const discountNum = parseFloat(discountPct) || 0
  const commissionNum = parseFloat(commissionPct) || 0
  const sum = discountNum + commissionNum
  const overCap = sum > cap + 1e-9

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}

    if (mode === 'create') {
      if (!/^[A-Z0-9_-]{4,20}$/.test(code)) {
        next.code = 'Huruf besar/angka/underscore/dash, 4-20 karakter'
      }
    }
    if (!/^\d+(\.\d{1,2})?$/.test(discountPct)) next.discountPct = 'Angka tidak valid'
    if (!/^\d+(\.\d{1,2})?$/.test(commissionPct)) next.commissionPct = 'Angka tidak valid'
    if (overCap) next.commissionPct = `Total melebihi cap ${cap}%`

    let parsedMaxClaims: number | null = null
    const trimmedMax = maxClaims.trim()
    if (trimmedMax !== '') {
      if (!/^\d+$/.test(trimmedMax)) {
        next.maxClaims = 'Angka bulat positif (kosongkan untuk tanpa batas)'
      } else {
        const n = parseInt(trimmedMax, 10)
        if (n < 1 || n > 1_000_000) {
          next.maxClaims = 'Maksimum klaim antara 1 dan 1.000.000'
        } else {
          parsedMaxClaims = n
        }
      }
    }

    setErrors(next)
    if (Object.keys(next).length > 0) return

    onSubmit({
      code,
      label: label.trim(),
      discountPct,
      commissionPct,
      maxClaims: parsedMaxClaims,
    })
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Kode</label>
          <div className="flex gap-2">
            <Input
              placeholder="MISAL: HEMAT20"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={mode === 'edit'}
              error={errors.code}
              autoFocus={mode === 'create'}
            />
            {mode === 'create' && (
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => setCode(randomCode())}
                aria-label="Buat kode acak"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
          {mode === 'create' && (
            <p className="text-xs text-gray-500">
              Kode akan ditampilkan di tautan referral Anda. Tidak bisa diubah setelah dibuat.
            </p>
          )}
        </div>

        <Input
          label="Label internal (opsional)"
          placeholder="MISAL: Instagram launch"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Discount (%)"
            type="number"
            step="0.01"
            min="0"
            max={cap}
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value)}
            error={errors.discountPct}
          />
          <Input
            label="Komisi (%)"
            type="number"
            step="0.01"
            min="0"
            max={cap}
            value={commissionPct}
            onChange={(e) => setCommissionPct(e.target.value)}
            error={errors.commissionPct}
          />
        </div>

        {/* Running sum chip so the tenant sees in real time whether
            they're inside the cap. Mirrors the validation that the
            server re-runs on submit. */}
        <div
          className={
            'flex items-center justify-between rounded-lg border px-3 py-2 text-sm ' +
            (overCap
              ? 'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-900/40 dark:bg-danger-900/20 dark:text-danger-300'
              : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300')
          }
        >
          <span>Total discount + komisi</span>
          <span className="font-semibold tabular-nums">
            {sum.toFixed(2)}% / {cap.toFixed(2)}%
          </span>
        </div>

        <div className="space-y-1">
          <Input
            label="Maks. klaim (opsional)"
            type="number"
            step="1"
            min="1"
            placeholder="Kosongkan untuk tanpa batas"
            value={maxClaims}
            onChange={(e) => setMaxClaims(e.target.value)}
            error={errors.maxClaims}
          />
          <p className="text-xs text-gray-500">
            Setelah jumlah ini tercapai, kode akan dianggap penuh dan pendaftar baru
            tidak akan mendapat diskon dari kode ini.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" variant="brand" loading={loading} disabled={overCap}>
          Simpan
        </Button>
      </div>
    </form>
  )
}

// ─── Share dialog ────────────────────────────────────
// Builds a deep link of the form `<origin>/?ref=CODE`. The landing
// page (routes/index.tsx) and the register form both call
// captureRefFromUrl(), so either route preserves attribution into the
// `jq_ref` cookie. Pre-filled WhatsApp message is in Bahasa because
// every tenant on this page is an Indonesian business owner sharing with
// fellow business owners.

interface ShareDialogProps {
  code: ReferralCode | null
  onClose: () => void
}

function ShareDialog({ code, onClose }: ShareDialogProps) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  // Render nothing when closed so the next opening rebuilds state.
  if (!code) {
    return (
      <Dialog open={false} onClose={onClose} placement="center">
        <div />
      </Dialog>
    )
  }

  // window.location.origin is safe here — the dialog is only rendered
  // after a click in the browser. SSR path is short-circuited by the
  // `!code` guard above.
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://vintra.my.id'
  const shareUrl = `${origin}/?ref=${code.code}`
  const discountPct = parseFloat(code.discountPct).toFixed(0)
  const message =
    `Halo! Aku pakai Vintra buat kelola usaha — HPP, POS, inventaris, sampai absensi karyawan, semua dalam satu app.\n\n` +
    `Pakai kode referralku *${code.code}* saat daftar, dapat diskon ${discountPct}% buat berlangganan modul berbayar.\n\n` +
    `Daftar di sini: ${shareUrl}`

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast({ title: 'Gagal menyalin link', variant: 'error' })
    }
  }

  function handleWhatsApp() {
    // wa.me works both in the web client and deep-links to the native
    // app on mobile (iOS + Android). Newline-friendly when URL-encoded.
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  function handleTelegram() {
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  function handleFacebook() {
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  async function handleNativeShare() {
    try {
      await navigator.share({
        title: 'Vintra',
        text: message,
        url: shareUrl,
      })
    } catch (err) {
      // User dismissed the picker — silent. AbortError is the common
      // case; anything else surfaces a toast so we notice real bugs.
      if ((err as DOMException)?.name !== 'AbortError') {
        toast({ title: 'Gagal membuka share', variant: 'error' })
      }
    }
  }

  // Web Share API is mobile-first. Hide the button on desktop where
  // it's almost always unavailable and would just confuse users.
  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <Dialog open={!!code} onClose={onClose} placement="center">
      <DialogHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <DialogTitle>Bagikan Kode Referral</DialogTitle>
            <DialogDescription>
              Bagikan tautan ini ke teman pengusaha — kode akan otomatis terisi saat mereka daftar.
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      </DialogHeader>
      <DialogContent className="space-y-5">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Tautan referral
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-200">
              {shareUrl}
            </div>
            <Button
              type="button"
              variant={copied ? 'outline' : 'brand'}
              size="md"
              onClick={handleCopyLink}
              aria-label="Salin tautan"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Tersalin
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Salin
                </>
              )}
            </Button>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Bagikan ke
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={handleWhatsApp}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:border-success-300 hover:bg-success-50 hover:text-success-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-success-700 dark:hover:bg-success-900/20 dark:hover:text-success-300"
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </button>
            <button
              type="button"
              onClick={handleTelegram}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-brand-700 dark:hover:bg-brand-900/20 dark:hover:text-brand-300"
            >
              <Send className="h-4 w-4" />
              Telegram
            </button>
            <button
              type="button"
              onClick={handleFacebook}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-brand-700 dark:hover:bg-brand-900/20 dark:hover:text-brand-300"
            >
              <ExternalLink className="h-4 w-4" />
              Facebook
            </button>
            {canNativeShare && (
              <button
                type="button"
                onClick={handleNativeShare}
                className="col-span-2 flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-brand-700 dark:hover:bg-brand-900/20 dark:hover:text-brand-300 sm:col-span-3"
              >
                <Share2 className="h-4 w-4" />
                Aplikasi lain…
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Pratinjau pesan
          </label>
          <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
            {message}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
