import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Sparkles,
  Upload,
  Download,
  ImageIcon,
  Camera,
  AlertTriangle,
  Coins,
  X,
} from 'lucide-react'
import { CameraCaptureModal } from '@/components/ui/camera-capture-modal'
import { downloadImageFromUrl } from '@/lib/download-image'
import {
  getKontenStatus,
  getKontenPromptConfig,
  generateKontenImage,
  getKontenImageDownloadUrl,
} from '@/server/functions/konten'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { compressImage } from '@/lib/image-compress'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/konten/generate')({
  loader: async () => {
    const [status, config] = await Promise.all([
      getKontenStatus(),
      getKontenPromptConfig(),
    ])
    return { status, config }
  },
  component: KontenGeneratePage,
})

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const RESIZE_MAX_DIM = 1536
const CUSTOM_CHOICE = '__custom__'

function KontenGeneratePage() {
  const { status, config } = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [balance, setBalance] = useState(status.balance)
  const [sourceDataUrl, setSourceDataUrl] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  // Optional second source photo — the person to feature in the
  // result. Only shown when the user picks a non-default "Subjek
  // Utama" (any value other than "Produk Saja"); fused with the
  // product in a single Gemini call.
  const [personDataUrl, setPersonDataUrl] = useState<string | null>(null)
  const personFileInputRef = useRef<HTMLInputElement>(null)
  const [personCameraOpen, setPersonCameraOpen] = useState(false)
  const [mode, setMode] = useState<'guided' | 'custom'>('guided')
  // fieldKey -> selected optionId, or CUSTOM_CHOICE, or '' (unset)
  const [fieldChoice, setFieldChoice] = useState<Record<string, string>>({})
  const [fieldCustom, setFieldCustom] = useState<Record<string, string>>({})
  const [customPrompt, setCustomPrompt] = useState('')
  // Free-text values typed into the selected option's text inputs.
  // Shape: { [fieldKey]: { [inputKey]: value } }
  const [fieldTextInputs, setFieldTextInputs] = useState<
    Record<string, Record<string, string>>
  >({})
  const [resolution, setResolution] = useState<string>('1k')
  const [result, setResult] = useState<{ url: string; id: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedCredits =
    status.resolutions.find((r) => r.key === resolution)?.credits ?? 1
  const enoughCredits = balance >= selectedCredits

  // Show the optional person-photo upload tile when the user picks a
  // UGC-leaning Subjek Utama (anything other than "Produk Saja"). The
  // server fuses both images in a single Gemini call when present.
  const subjekField = config.fields.find((f) => f.key === 'subjek')
  const subjekChoiceId = fieldChoice['subjek']
  const subjekLabel =
    subjekField?.options.find((o) => o.id === subjekChoiceId)?.label ?? null
  const showPersonUpload =
    mode === 'guided' && !!subjekChoiceId && subjekLabel !== 'Produk Saja'
  // Drop a stale person photo if the user switches Subjek back to
  // "Produk Saja" or away from guided mode — otherwise the server fn
  // would silently fuse it into a generation that the form claims is
  // product-only.
  useEffect(() => {
    if (!showPersonUpload && personDataUrl) setPersonDataUrl(null)
  }, [showPersonUpload, personDataUrl])

  const guidedValid = config.fields.every((f) => {
    const choice = fieldChoice[f.key]
    // If the selected option carries text inputs, require at least one to
    // be filled — picking "Pakai teks saya" with no text doesn't make sense.
    if (choice && choice !== CUSTOM_CHOICE) {
      const opt = f.options.find((o) => o.id === choice)
      if (opt?.textInputs && opt.textInputs.length > 0) {
        const filled = opt.textInputs.some(
          (ti) =>
            (fieldTextInputs[f.key]?.[ti.key] ?? '').trim().length > 0,
        )
        if (!filled) return false
      }
    }
    if (!f.required) return true
    if (!choice) return false
    if (choice === CUSTOM_CHOICE)
      return (fieldCustom[f.key] ?? '').trim().length > 0
    return true
  })
  const canGenerate =
    !!sourceDataUrl &&
    status.hasImageProvider &&
    enoughCredits &&
    !busy &&
    (mode === 'custom'
      ? customPrompt.trim().length > 0
      : config.fields.length > 0 && guidedValid)

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({
        title: t('common.toastFailedTitle'),
        description: t('konten.uploadTooLarge'),
        variant: 'error',
      })
      return
    }
    try {
      const { dataUrl } = await compressImage(file, {
        maxEdge: RESIZE_MAX_DIM,
        quality: 0.9,
      })
      setSourceDataUrl(dataUrl)
      setResult(null)
    } catch {
      toast({
        title: t('common.toastFailedTitle'),
        description: t('konten.uploadFailed'),
        variant: 'error',
      })
    }
  }

  async function handlePersonFile(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({
        title: t('common.toastFailedTitle'),
        description: t('konten.uploadTooLarge'),
        variant: 'error',
      })
      return
    }
    try {
      const { dataUrl } = await compressImage(file, {
        maxEdge: RESIZE_MAX_DIM,
        quality: 0.9,
      })
      setPersonDataUrl(dataUrl)
    } catch {
      toast({
        title: t('common.toastFailedTitle'),
        description: t('konten.uploadFailed'),
        variant: 'error',
      })
    }
  }

  async function handleGenerate() {
    if (!sourceDataUrl) return
    setBusy(true)
    try {
      const selections =
        mode === 'guided'
          ? config.fields
              .map((f) => {
                const choice = fieldChoice[f.key]
                if (!choice) return null
                if (choice === CUSTOM_CHOICE) {
                  const custom = (fieldCustom[f.key] ?? '').trim()
                  return custom ? { fieldKey: f.key, customValue: custom } : null
                }
                const opt = f.options.find((o) => o.id === choice)
                const textInputs =
                  opt?.textInputs && opt.textInputs.length > 0
                    ? (fieldTextInputs[f.key] ?? {})
                    : undefined
                return {
                  fieldKey: f.key,
                  optionId: choice,
                  ...(textInputs ? { textInputs } : {}),
                }
              })
              .filter((s): s is NonNullable<typeof s> => s !== null)
          : []
      const res = await generateKontenImage({
        data: {
          sourceImageDataUrl: sourceDataUrl,
          personImageDataUrl:
            showPersonUpload && personDataUrl ? personDataUrl : undefined,
          mode,
          selections,
          customPrompt: mode === 'custom' ? customPrompt.trim() : undefined,
          resolution: resolution as '1k' | '2k' | '4k',
        },
      })
      setResult({ url: res.resultImageUrl, id: res.imageId })
      setBalance(res.balance)
      toast({
        title: t('konten.generateSuccessTitle'),
        description: t('konten.generateSuccessDesc'),
        variant: 'success',
      })
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description:
          err instanceof Error ? err.message : t('konten.generateError'),
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('konten.generateTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('konten.generateSubtitle')}
          </p>
        </div>
        <Link
          to="/studio/billing"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-400 dark:hover:bg-brand-900/50"
        >
          <Coins className="h-4 w-4" />
          {t('konten.creditBalance', { count: balance })}
        </Link>
      </div>

      {!status.hasImageProvider && (
        <Notice text={t('konten.noProvider')} />
      )}
      {status.hasImageProvider && !enoughCredits && (
        <Notice
          text={t('konten.noCredits')}
          action={{ to: '/studio/billing', label: t('konten.buyCredits') }}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: inputs */}
        <div className="space-y-5">
          {/* Upload */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('konten.uploadLabel')}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <div className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-white px-6 py-6 text-center dark:border-gray-600 dark:bg-gray-800">
              {sourceDataUrl ? (
                <img
                  src={sourceDataUrl}
                  alt=""
                  className="max-h-48 rounded-lg object-contain"
                />
              ) : (
                <>
                  <Upload className="h-7 w-7 text-gray-400" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t('konten.uploadHint')}
                  </span>
                </>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-brand-500"
                >
                  <ImageIcon className="h-4 w-4" />
                  {t('konten.sourceGallery')}
                </button>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-brand-500"
                >
                  <Camera className="h-4 w-4" />
                  {t('konten.sourceCamera')}
                </button>
              </div>
            </div>
          </div>

          <CameraCaptureModal
            open={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onCapture={(dataUrl) => {
              setSourceDataUrl(dataUrl)
              setResult(null)
            }}
          />

          {/* Optional person photo — only when Subjek != "Produk Saja".
              Fused with the product in a single Gemini call. */}
          {showPersonUpload && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Foto Orang (opsional)
              </label>
              <input
                ref={personFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handlePersonFile(e.target.files?.[0])}
              />
              <div className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-white px-6 py-6 text-center dark:border-gray-600 dark:bg-gray-800">
                {personDataUrl ? (
                  <div className="relative">
                    <img
                      src={personDataUrl}
                      alt=""
                      className="max-h-40 rounded-lg object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setPersonDataUrl(null)}
                      aria-label="Hapus foto orang"
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-gray-400" />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Upload foto kamu, staff, atau model — AI akan
                      memadukannya dengan produk.
                    </span>
                  </>
                )}
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => personFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-brand-500"
                  >
                    <ImageIcon className="h-4 w-4" />
                    Galeri
                  </button>
                  <button
                    type="button"
                    onClick={() => setPersonCameraOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-brand-500"
                  >
                    <Camera className="h-4 w-4" />
                    Kamera
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Tip: foto orang dengan pose netral + pencahayaan terang
                memberi hasil paling baik. Pastikan kamu punya izin orang
                yang difoto.
              </p>
              {!personDataUrl && (
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Kosongkan kalau ingin AI membuat sendiri orangnya
                  (wajah AI bisa terlihat aneh atau berulang).
                </p>
              )}
            </div>
          )}

          <CameraCaptureModal
            open={personCameraOpen}
            onClose={() => setPersonCameraOpen(false)}
            onCapture={(dataUrl) => setPersonDataUrl(dataUrl)}
          />

          {/* Mode toggle */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('konten.modeLabel')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['guided', 'custom'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    mode === m
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-900/20 dark:text-brand-400'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
                  )}
                >
                  {m === 'guided'
                    ? t('konten.modeGuided')
                    : t('konten.modeCustom')}
                </button>
              ))}
            </div>
          </div>

          {/* Guided fields */}
          {mode === 'guided' &&
            (config.fields.length === 0 ? (
              <Notice text={t('konten.noFields')} />
            ) : (
              <div className="space-y-4">
                {config.fields.map((field) => {
                  const choice = fieldChoice[field.key] ?? ''
                  return (
                    <div key={field.key}>
                      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                        {field.label}
                        {field.required && (
                          <span className="text-danger-500"> *</span>
                        )}
                      </label>
                      <select
                        value={choice}
                        onChange={(e) =>
                          setFieldChoice((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      >
                        <option value="">
                          {t('konten.selectPlaceholder')}
                        </option>
                        {field.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                        {field.allowsCustom && (
                          <option value={CUSTOM_CHOICE}>
                            {t('konten.customOption')}
                          </option>
                        )}
                      </select>
                      {choice === CUSTOM_CHOICE && (
                        <Input
                          className="mt-2"
                          value={fieldCustom[field.key] ?? ''}
                          onChange={(e) =>
                            setFieldCustom((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                          placeholder={t('konten.customValuePlaceholder')}
                        />
                      )}
                      {/* Option-declared text inputs (e.g. headline / sub /
                          CTA for "Pakai teks saya"). Reveal once the option
                          is picked; values feed into the prompt fragment. */}
                      {(() => {
                        if (!choice || choice === CUSTOM_CHOICE) return null
                        const opt = field.options.find((o) => o.id === choice)
                        if (!opt?.textInputs || opt.textInputs.length === 0)
                          return null
                        return (
                          <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/30">
                            {opt.textInputs.map((ti) => (
                              <div key={ti.key}>
                                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                                  {ti.label}
                                </label>
                                {ti.multiline ? (
                                  <Textarea
                                    rows={2}
                                    value={
                                      fieldTextInputs[field.key]?.[ti.key] ?? ''
                                    }
                                    onChange={(e) =>
                                      setFieldTextInputs((prev) => ({
                                        ...prev,
                                        [field.key]: {
                                          ...(prev[field.key] ?? {}),
                                          [ti.key]: e.target.value,
                                        },
                                      }))
                                    }
                                    maxLength={ti.maxLength}
                                    placeholder={ti.placeholder}
                                  />
                                ) : (
                                  <Input
                                    value={
                                      fieldTextInputs[field.key]?.[ti.key] ?? ''
                                    }
                                    onChange={(e) =>
                                      setFieldTextInputs((prev) => ({
                                        ...prev,
                                        [field.key]: {
                                          ...(prev[field.key] ?? {}),
                                          [ti.key]: e.target.value,
                                        },
                                      }))
                                    }
                                    maxLength={ti.maxLength}
                                    placeholder={ti.placeholder}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                      {field.helpText && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {field.helpText}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}

          {/* Custom prompt */}
          {mode === 'custom' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('konten.customPromptModeLabel')}
              </label>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={5}
                placeholder={t('konten.customPromptModePlaceholder')}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('konten.customPromptModeHint')}
              </p>
            </div>
          )}

          {/* Resolution */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('konten.resolutionLabel')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {status.resolutions.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setResolution(r.key)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-center transition-colors',
                    resolution === r.key
                      ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20'
                      : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800',
                  )}
                >
                  <span className="block text-sm font-semibold uppercase text-gray-900 dark:text-gray-100">
                    {r.key}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    {t('konten.resCost', { count: r.credits })}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('konten.resolutionHint')}
            </p>
          </div>

          <Button
            variant="brand"
            className="w-full"
            disabled={!canGenerate}
            loading={busy}
            onClick={handleGenerate}
          >
            <Sparkles className="h-4 w-4" />
            {t('konten.generateCta', { credits: selectedCredits })}
          </Button>
        </div>

        {/* Right: result */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('konten.resultTitle')}
          </h2>
          {busy ? (
            <div className="mt-4 flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Sparkles className="h-8 w-8 animate-pulse text-brand-500" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('konten.generating')}
              </p>
            </div>
          ) : result ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <figure>
                  <img
                    src={sourceDataUrl ?? ''}
                    alt=""
                    className="aspect-square w-full rounded-lg border border-gray-200 object-cover dark:border-gray-700"
                  />
                  <figcaption className="mt-1 text-center text-xs text-gray-400">
                    {t('konten.beforeLabel')}
                  </figcaption>
                </figure>
                <figure>
                  <img
                    src={result.url}
                    alt=""
                    className="aspect-square w-full rounded-lg border border-brand-200 object-cover dark:border-brand-800"
                  />
                  <figcaption className="mt-1 text-center text-xs text-brand-500">
                    {t('konten.afterLabel')}
                  </figcaption>
                </figure>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="brand"
                  className="flex-1"
                  onClick={async () => {
                    try {
                      const { url } = await getKontenImageDownloadUrl({
                        data: { id: result.id, variant: 'result' },
                      })
                      await downloadImageFromUrl(url, `konten-${result.id}.png`)
                    } catch (err) {
                      toast({
                        title: t('common.toastFailedTitle'),
                        description:
                          err instanceof Error ? err.message : '',
                        variant: 'error',
                      })
                    }
                  }}
                >
                  <Download className="h-4 w-4" />
                  {t('konten.download')}
                </Button>
                <Button variant="ghost" asChild>
                  <Link to="/konten">{t('konten.viewGallery')}</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col items-center justify-center gap-2 py-16 text-center">
              <ImageIcon className="h-8 w-8 text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-400 dark:text-gray-500">
                {t('konten.resultEmpty')}
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
