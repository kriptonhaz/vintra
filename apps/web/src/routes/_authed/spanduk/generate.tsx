import { useMemo, useRef, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Sparkles,
  Download,
  ImageIcon,
  AlertTriangle,
  Coins,
  Ruler,
  FileText,
  Plus,
  X,
  Camera,
} from 'lucide-react'
import {
  getSpandukStatus,
  getSpandukConfig,
  generateSpanduk,
  commitSpandukPreview,
  getSpandukDownloadUrl,
  type SpandukSizeOption,
} from '@/server/functions/spanduk'
import type { SpandukType } from '@vintra/db/schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { CameraCaptureModal } from '@/components/ui/camera-capture-modal'
import { compressImage } from '@/lib/image-compress'
import { downloadImageFromUrl } from '@/lib/download-image'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/spanduk/generate')({
  loader: async () => {
    const [status, config] = await Promise.all([
      getSpandukStatus(),
      getSpandukConfig(),
    ])
    return { status, config }
  },
  component: SpandukGeneratePage,
})

const CUSTOM_CHOICE = '__custom__'
const CUSTOM_SIZE = '__custom_size__'
const MAX_SOURCE_IMAGES = 4
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const RESIZE_MAX_DIM = 1536

const SPANDUK_TYPES: ReadonlyArray<{ key: SpandukType; label: string }> = [
  { key: 'xbanner', label: 'X-Banner' },
  { key: 'spanduk', label: 'Spanduk' },
]

/**
 * Indonesian orientation label for a given W×H pair. Tolerances of 10%
 * either way so a near-square (e.g. 100×95) doesn't flip-flop between
 * mendatar/tegak depending on rounding.
 */
function getOrientationLabel(widthCm: number, heightCm: number): string {
  if (heightCm <= 0) return ''
  const aspect = widthCm / heightCm
  if (aspect > 1.1) return 'Mendatar'
  if (aspect < 0.9) return 'Tegak'
  return 'Persegi'
}

/**
 * Proportional thumbnail + dimensions for the size grid. Mirrors how
 * Canva surfaces canvas presets — a tiny rectangle scaled to the
 * actual aspect ratio so users can see at a glance which way the
 * banner runs without parsing "1×2" vs "2×1".
 */
function SizeCard({
  widthCm,
  heightCm,
  label,
  sublabel,
  selected,
  onClick,
}: {
  widthCm: number
  heightCm: number
  label: string
  sublabel?: string
  selected: boolean
  onClick: () => void
}) {
  // Thumbnail container is 64×40px; rectangle scales to fit while
  // preserving the source aspect ratio.
  const MAX_THUMB_W = 64
  const MAX_THUMB_H = 40
  const scale = Math.min(MAX_THUMB_W / widthCm, MAX_THUMB_H / heightCm)
  const thumbW = Math.max(8, Math.round(widthCm * scale))
  const thumbH = Math.max(6, Math.round(heightCm * scale))
  const orientation = getOrientationLabel(widthCm, heightCm)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-lg border p-2 text-center transition-colors',
        selected
          ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20'
          : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800',
      )}
    >
      <div
        className="flex items-center justify-center"
        style={{ height: MAX_THUMB_H }}
      >
        <div
          className={cn(
            'rounded-sm border-2',
            selected
              ? 'border-brand-500 bg-brand-100 dark:border-brand-400 dark:bg-brand-900/40'
              : 'border-gray-400 bg-gray-100 dark:border-gray-500 dark:bg-gray-700',
          )}
          style={{ width: thumbW, height: thumbH }}
          aria-hidden
        />
      </div>
      <span className="block text-xs font-semibold text-gray-900 dark:text-gray-100">
        {label}
      </span>
      <span className="block text-[10px] text-gray-500 dark:text-gray-400">
        {sublabel ?? orientation}
      </span>
    </button>
  )
}

function SpandukGeneratePage() {
  const { status, config } = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const { toast } = useToast()

  const [balance, setBalance] = useState(status.balance)

  // Preview-first toggle. Default on: 1K preview costs 1 credit and
  // lets the user iterate cheaply before committing to a 4K print.
  // Opt out for direct 4K when the user is already confident.
  const [previewFirst, setPreviewFirst] = useState(true)

  // Type selection (also filters the available size presets)
  const [type, setType] = useState<SpandukType>('spanduk')

  // Size: either preset id or CUSTOM_SIZE
  const sizesForType = useMemo<SpandukSizeOption[]>(
    () => config.sizes.filter((s) => s.type === type),
    [config.sizes, type],
  )
  const [sizeChoice, setSizeChoice] = useState<string>(() => {
    const first = config.sizes.find((s) => s.type === 'spanduk')
    return first?.id ?? CUSTOM_SIZE
  })
  const [customWidthM, setCustomWidthM] = useState<string>('3')
  const [customHeightM, setCustomHeightM] = useState<string>('1')

  // Selected dimensions (cm)
  const dims = useMemo(() => {
    if (sizeChoice === CUSTOM_SIZE) {
      const w = Math.round((Number(customWidthM) || 0) * 100)
      const h = Math.round((Number(customHeightM) || 0) * 100)
      return { widthCm: w, heightCm: h }
    }
    const preset = sizesForType.find((s) => s.id === sizeChoice)
    return preset
      ? { widthCm: preset.widthCm, heightCm: preset.heightCm }
      : { widthCm: 0, heightCm: 0 }
  }, [sizeChoice, sizesForType, customWidthM, customHeightM])

  // Prompt field selections
  const [fieldChoice, setFieldChoice] = useState<Record<string, string>>({})
  const [fieldText, setFieldText] = useState<Record<string, string>>({})

  // Product reference photos (0..4)
  const [sourceImages, setSourceImages] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [cameraOpen, setCameraOpen] = useState(false)

  // Text overlay
  const [headline, setHeadline] = useState('')
  const [subheadline, setSubheadline] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')

  const [result, setResult] = useState<{
    id: string
    url: string
    widthCm: number
    heightCm: number
    isPreview: boolean
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [committing, setCommitting] = useState(false)

  // Cost for the next action: preview (1) or direct 4K (full).
  const nextCost = previewFirst
    ? status.previewCreditCost
    : status.creditCost
  const enoughCredits = balance >= nextCost

  const sizeValid =
    sizeChoice !== CUSTOM_SIZE ||
    (dims.widthCm >= 20 && dims.heightCm >= 20 && dims.widthCm <= 2000 &&
      dims.heightCm <= 2000)

  const fieldsValid = config.fields.every((f) => {
    if (!f.required) return true
    if (f.fieldType === 'text')
      return (fieldText[f.key] ?? '').trim().length > 0
    const choice = fieldChoice[f.key]
    if (!choice) return false
    if (choice === CUSTOM_CHOICE)
      return (fieldText[f.key] ?? '').trim().length > 0
    return true
  })

  const canGenerate =
    status.hasImageProvider &&
    enoughCredits &&
    !busy &&
    config.sizes.length > 0 &&
    sizeValid &&
    fieldsValid &&
    headline.trim().length > 0

  async function handleAddFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const remaining = MAX_SOURCE_IMAGES - sourceImages.length
    if (remaining <= 0) {
      toast({
        title: 'Foto produk sudah maksimal',
        description: `Maksimal ${MAX_SOURCE_IMAGES} foto.`,
        variant: 'error',
      })
      return
    }
    const accepted = Array.from(files).slice(0, remaining)
    const added: string[] = []
    for (const file of accepted) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast({
          title: t('common.toastFailedTitle'),
          description: `Foto melebihi ${MAX_UPLOAD_BYTES / 1024 / 1024} MB: ${file.name}`,
          variant: 'error',
        })
        continue
      }
      try {
        const { dataUrl } = await compressImage(file, {
          maxEdge: RESIZE_MAX_DIM,
          quality: 0.9,
        })
        added.push(dataUrl)
      } catch {
        toast({
          title: t('common.toastFailedTitle'),
          description: `Gagal memproses foto: ${file.name}`,
          variant: 'error',
        })
      }
    }
    if (added.length > 0) {
      setSourceImages((prev) => [...prev, ...added].slice(0, MAX_SOURCE_IMAGES))
    }
    // Reset the input so the same file can be picked again later.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleRemoveSource(index: number) {
    setSourceImages((prev) => prev.filter((_, i) => i !== index))
  }

  function handleCameraCapture(dataUrl: string) {
    setSourceImages((prev) => {
      if (prev.length >= MAX_SOURCE_IMAGES) {
        toast({
          title: 'Foto produk sudah maksimal',
          description: `Maksimal ${MAX_SOURCE_IMAGES} foto.`,
          variant: 'error',
        })
        return prev
      }
      return [...prev, dataUrl]
    })
  }

  async function handleGenerate() {
    setBusy(true)
    try {
      const selections = config.fields
        .map((f) => {
          if (f.fieldType === 'text') {
            const v = (fieldText[f.key] ?? '').trim()
            return v ? { fieldKey: f.key, customValue: v } : null
          }
          const choice = fieldChoice[f.key]
          if (!choice) return null
          if (choice === CUSTOM_CHOICE) {
            const v = (fieldText[f.key] ?? '').trim()
            return v ? { fieldKey: f.key, customValue: v } : null
          }
          return { fieldKey: f.key, optionId: choice }
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)

      const res = await generateSpanduk({
        data: {
          type,
          sizePresetId:
            sizeChoice === CUSTOM_SIZE ? undefined : sizeChoice,
          customWidthCm:
            sizeChoice === CUSTOM_SIZE ? dims.widthCm : undefined,
          customHeightCm:
            sizeChoice === CUSTOM_SIZE ? dims.heightCm : undefined,
          selections,
          headline: headline.trim() || undefined,
          subheadline: subheadline.trim() || undefined,
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
          sourceImageDataUrls: sourceImages,
          preview: previewFirst,
        },
      })
      setResult({
        id: res.spandukId,
        url: res.pngImageUrl,
        widthCm: dims.widthCm,
        heightCm: dims.heightCm,
        isPreview: res.isPreview,
      })
      setBalance(res.balance)
      toast({
        title: res.isPreview
          ? 'Preview siap'
          : 'Spanduk berhasil dibuat',
        description: res.isPreview
          ? 'Periksa preview — kalau OK, lanjut commit ke 4K untuk versi cetak.'
          : 'PNG dan PDF tersimpan di galeri.',
        variant: 'success',
      })
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description:
          err instanceof Error ? err.message : 'Gagal membuat spanduk.',
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleCommit() {
    if (!result || !result.isPreview) return
    setCommitting(true)
    try {
      const res = await commitSpandukPreview({
        data: {
          id: result.id,
          sourceImageDataUrls: sourceImages,
        },
      })
      setResult({
        id: res.spandukId,
        url: res.pngImageUrl,
        widthCm: result.widthCm,
        heightCm: result.heightCm,
        isPreview: false,
      })
      setBalance(res.balance)
      toast({
        title: 'Spanduk 4K berhasil dibuat',
        description: 'PNG dan PDF tersimpan di galeri.',
        variant: 'success',
      })
      await router.invalidate()
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

  async function handleDownload(format: 'png' | 'pdf') {
    if (!result) return
    try {
      const { url } = await getSpandukDownloadUrl({
        data: { id: result.id, format },
      })
      await downloadImageFromUrl(url, `spanduk-${result.id}.${format}`)
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : '',
        variant: 'error',
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Buat Spanduk AI
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Rancang spanduk siap cetak — AI buat background-nya, teks
            ditambahkan agar tetap tajam saat dicetak besar.
          </p>
        </div>
        <Link
          to="/studio/billing"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-400 dark:hover:bg-brand-900/50"
        >
          <Coins className="h-4 w-4" />
          Sisa kredit: {balance}
        </Link>
      </div>

      {/* AI disclaimer — always visible. Spanduk generation is fully
          AI-driven (no human-curated layout), so output can drift from
          the user's mental model — typos in long phone numbers, slight
          composition changes, unexpected color choices. Surfacing this
          up-front sets expectations and nudges toward the preview flow. */}
      <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800 dark:border-warning-900/50 dark:bg-warning-900/20 dark:text-warning-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Hasil dibuat oleh AI</strong> — kadang tidak sesuai
          dengan yang diharapkan (typo teks, komposisi geser, warna
          beda). Harap menyadari risiko ini. Kami sarankan pakai mode{' '}
          <strong>Preview 1K dulu</strong> untuk cek hasil sebelum
          mencetak versi 4K final.
        </span>
      </div>

      {!status.hasImageProvider && (
        <Notice text="Provider gambar AI belum dikonfigurasi. Hubungi admin." />
      )}
      {status.hasImageProvider && !enoughCredits && (
        <Notice
          text={`Saldo kredit kurang. Butuh ${nextCost} kredit.`}
          action={{ to: '/studio/billing', label: 'Beli Kredit' }}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: inputs */}
        <div className="space-y-6">
          {/* Type + size */}
          <section className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Jenis Spanduk <span className="text-danger-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {SPANDUK_TYPES.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setType(opt.key)
                      // reset size to first preset of this type, or custom
                      const first = config.sizes.find(
                        (s) => s.type === opt.key,
                      )
                      setSizeChoice(first?.id ?? CUSTOM_SIZE)
                    }}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-center transition-colors',
                      type === opt.key
                        ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20'
                        : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800',
                    )}
                  >
                    <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Ukuran <span className="text-danger-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sizesForType.map((s) => (
                  <SizeCard
                    key={s.id}
                    widthCm={s.widthCm}
                    heightCm={s.heightCm}
                    label={`${s.widthCm} × ${s.heightCm} cm`}
                    selected={sizeChoice === s.id}
                    onClick={() => setSizeChoice(s.id)}
                  />
                ))}
                <SizeCard
                  widthCm={Math.max(20, dims.widthCm || 300)}
                  heightCm={Math.max(20, dims.heightCm || 100)}
                  label="Kustom"
                  sublabel="atur sendiri"
                  selected={sizeChoice === CUSTOM_SIZE}
                  onClick={() => setSizeChoice(CUSTOM_SIZE)}
                />
              </div>
              {sizeChoice === CUSTOM_SIZE && (
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/30">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      Panjang (meter)
                    </label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0.2"
                      max="20"
                      value={customWidthM}
                      onChange={(e) => setCustomWidthM(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      Lebar (meter)
                    </label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0.2"
                      max="20"
                      value={customHeightM}
                      onChange={(e) => setCustomHeightM(e.target.value)}
                    />
                  </div>
                </div>
              )}
              {dims.widthCm > 0 && dims.heightCm > 0 && (
                <p className="mt-2 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <Ruler className="h-3 w-3" />
                  Cetak {dims.widthCm} × {dims.heightCm} cm ·{' '}
                  {getOrientationLabel(dims.widthCm, dims.heightCm)}
                </p>
              )}
            </div>
          </section>

          {/* Preview-first toggle */}
          <section className="space-y-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Cara Pembuatan
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPreviewFirst(true)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  previewFirst
                    ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20'
                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800',
                )}
              >
                <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Preview 1K dulu
                </span>
                <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                  {status.previewCreditCost} kredit • hemat kalau ragu
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewFirst(false)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  !previewFirst
                    ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20'
                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800',
                )}
              >
                <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Langsung 4K
                </span>
                <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                  {status.creditCost} kredit • kalau sudah yakin
                </span>
              </button>
            </div>
          </section>

          {/* Product reference photos */}
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Foto Produk (opsional, maks {MAX_SOURCE_IMAGES})
              </h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Unggah foto produk yang ingin tampil di spanduk — mis. mie
                ayam, bakso, es jeruk. AI akan menggabungkannya ke dalam
                desain.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleAddFiles(e.target.files)}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {sourceImages.map((url, i) => (
                <div
                  key={i}
                  className="relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
                >
                  <img
                    src={url}
                    alt={`Foto produk ${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveSource(i)}
                    aria-label="Hapus foto"
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {sourceImages.length < MAX_SOURCE_IMAGES && (
                <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-white p-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  <Plus className="h-5 w-5" />
                  <div className="flex w-full flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-brand-500"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      Galeri
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraOpen(true)}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-brand-500"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      Kamera
                    </button>
                  </div>
                </div>
              )}
            </div>

            <CameraCaptureModal
              open={cameraOpen}
              onClose={() => setCameraOpen(false)}
              onCapture={handleCameraCapture}
            />
            {sourceImages.length === 0 && (
              <p className="text-xs text-gray-400">
                Tip: foto produk yang jelas dan terang akan menghasilkan
                spanduk lebih baik.
              </p>
            )}
          </section>

          {/* Prompt fields */}
          {config.fields.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Gaya Background AI
              </h2>
              {config.fields.map((field) => (
                <div key={field.key}>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {field.label}
                    {field.required && (
                      <span className="text-danger-500"> *</span>
                    )}
                  </label>
                  {field.fieldType === 'text' ? (
                    <Input
                      value={fieldText[field.key] ?? ''}
                      onChange={(e) =>
                        setFieldText((p) => ({ ...p, [field.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <>
                      <select
                        value={fieldChoice[field.key] ?? ''}
                        onChange={(e) =>
                          setFieldChoice((p) => ({
                            ...p,
                            [field.key]: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      >
                        <option value="">— Pilih —</option>
                        {field.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                        {field.allowsCustom && (
                          <option value={CUSTOM_CHOICE}>Lainnya...</option>
                        )}
                      </select>
                      {fieldChoice[field.key] === CUSTOM_CHOICE && (
                        <Input
                          className="mt-2"
                          value={fieldText[field.key] ?? ''}
                          onChange={(e) =>
                            setFieldText((p) => ({
                              ...p,
                              [field.key]: e.target.value,
                            }))
                          }
                          placeholder="Tulis pilihan kamu sendiri"
                        />
                      )}
                    </>
                  )}
                  {field.helpText && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {field.helpText}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Text overlay */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Teks Spanduk
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Teks ini ditambahkan dengan font cetak — bukan oleh AI — agar
              tetap tajam saat dicetak besar.
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Headline <span className="text-danger-500">*</span>
              </label>
              <Input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="GRAND OPENING"
                maxLength={120}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Subheadline / Tagline
              </label>
              <Input
                value={subheadline}
                onChange={(e) => setSubheadline(e.target.value)}
                placeholder="Diskon 50% selama minggu pertama"
                maxLength={160}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Nomor HP / WhatsApp
                </label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0812-3456-7890"
                  maxLength={40}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Alamat (opsional)
                </label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Jl. Mawar No. 12, Jakarta"
                  maxLength={200}
                />
              </div>
            </div>
          </section>

          <Button
            variant="brand"
            className="w-full"
            disabled={!canGenerate}
            loading={busy}
            onClick={handleGenerate}
          >
            <Sparkles className="h-4 w-4" />
            {previewFirst
              ? `Buat Preview 1K (${status.previewCreditCost} kredit)`
              : `Buat Spanduk 4K (${status.creditCost} kredit)`}
          </Button>
        </div>

        {/* Right: result preview */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Hasil
          </h2>
          {busy || committing ? (
            <div className="mt-4 flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Sparkles className="h-8 w-8 animate-pulse text-brand-500" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {committing
                  ? 'Render ulang di resolusi 4K dengan komposisi yang sama... ' +
                    'bisa memakan waktu 30–60 detik.'
                  : 'AI sedang merancang spanduk lengkap dengan teks... ' +
                    'bisa memakan waktu 20–40 detik.'}
              </p>
            </div>
          ) : result ? (
            <div className="mt-4 space-y-3">
              {result.isPreview && (
                <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800 dark:border-warning-900/50 dark:bg-warning-900/20 dark:text-warning-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>Preview 1K</strong> — periksa hasil, terutama
                    ejaan teks dan nomor HP. Jika sudah pas, lanjut commit
                    ke 4K untuk versi cetak ({status.commitFromPreviewCreditCost}{' '}
                    kredit lagi).
                  </span>
                </div>
              )}
              <div
                className="flex w-full items-center justify-center overflow-hidden rounded-lg border border-brand-200 bg-gray-50 dark:border-brand-800 dark:bg-gray-900"
                style={{
                  aspectRatio: `${result.widthCm} / ${result.heightCm}`,
                }}
              >
                <img
                  src={result.url}
                  alt=""
                  className="h-full w-full rounded-lg object-contain"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {result.widthCm} × {result.heightCm} cm
              </p>
              {result.isPreview ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="brand"
                    className="flex-1"
                    disabled={
                      balance < status.commitFromPreviewCreditCost || committing
                    }
                    loading={committing}
                    onClick={handleCommit}
                  >
                    <Sparkles className="h-4 w-4" />
                    Setujui &amp; Cetak 4K (
                    {status.commitFromPreviewCreditCost} kredit)
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setResult(null)}
                    disabled={busy}
                  >
                    Coba lagi
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="brand"
                    className="flex-1"
                    onClick={() => handleDownload('png')}
                  >
                    <Download className="h-4 w-4" />
                    Unduh PNG
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={() => handleDownload('pdf')}
                  >
                    <FileText className="h-4 w-4" />
                    Unduh PDF
                  </Button>
                </div>
              )}
              <Button variant="ghost" asChild>
                <Link to="/studio">Lihat di Galeri</Link>
              </Button>
            </div>
          ) : (
            <div className="mt-4 flex flex-col items-center justify-center gap-2 py-16 text-center">
              <ImageIcon className="h-8 w-8 text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-400 dark:text-gray-500">
                Spanduk yang kamu buat akan muncul di sini.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Notice({
  text,
  action,
}: {
  text: string
  action?: { to: string; label: string }
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800 dark:border-warning-900/50 dark:bg-warning-900/20 dark:text-warning-300 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{text}</span>
      </div>
      {action && (
        <Link
          to={action.to}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-accent-700"
        >
          <Coins className="h-3 w-3" />
          {action.label}
        </Link>
      )}
    </div>
  )
}
