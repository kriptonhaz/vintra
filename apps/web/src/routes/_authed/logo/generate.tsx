import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Sparkles,
  Download,
  ImageIcon,
  AlertTriangle,
  Coins,
} from 'lucide-react'
import {
  getLogoStatus,
  getLogoPromptConfig,
  generateLogo,
  getLogoDownloadUrl,
} from '@/server/functions/logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { downloadImageFromUrl } from '@/lib/download-image'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/logo/generate')({
  loader: async () => {
    const [status, config] = await Promise.all([
      getLogoStatus(),
      getLogoPromptConfig(),
    ])
    return { status, config }
  },
  component: LogoGeneratePage,
})

const CUSTOM_CHOICE = '__custom__'

function LogoGeneratePage() {
  const { status, config } = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const { toast } = useToast()

  const [balance, setBalance] = useState(status.balance)
  // select-type fields: optionId | CUSTOM_CHOICE | ''
  const [fieldChoice, setFieldChoice] = useState<Record<string, string>>({})
  // text-type fields OR select+CUSTOM_CHOICE: the typed value.
  const [fieldText, setFieldText] = useState<Record<string, string>>({})
  const [resolution, setResolution] = useState<string>('1k')
  const [result, setResult] = useState<{ url: string; id: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedCredits =
    status.resolutions.find((r) => r.key === resolution)?.credits ?? 1
  const enoughCredits = balance >= selectedCredits

  const guidedValid = config.fields.every((f) => {
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
    config.fields.length > 0 &&
    guidedValid

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

      const res = await generateLogo({
        data: {
          selections,
          resolution: resolution as '1k',
        },
      })
      setResult({ url: res.resultImageUrl, id: res.logoId })
      setBalance(res.balance)
      toast({
        title: t('logo.generateSuccessTitle'),
        description: t('logo.generateSuccessDesc'),
        variant: 'success',
      })
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description:
          err instanceof Error ? err.message : t('logo.generateError'),
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDownload() {
    if (!result) return
    try {
      const { url } = await getLogoDownloadUrl({
        data: { id: result.id },
      })
      await downloadImageFromUrl(url, `logo-${result.id}.png`)
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
            {t('logo.generateTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('logo.generateSubtitle')}
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

      {!status.hasImageProvider && <Notice text={t('konten.noProvider')} />}
      {status.hasImageProvider && !enoughCredits && (
        <Notice
          text={t('konten.noCredits')}
          action={{ to: '/studio/billing', label: t('konten.buyCredits') }}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: inputs */}
        <div className="space-y-5">
          {config.fields.length === 0 ? (
            <Notice text={t('logo.noFields')} />
          ) : (
            <div className="space-y-4">
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
                        setFieldText((prev) => ({
                          ...prev,
                          [field.key]: e.target.value,
                        }))
                      }
                    />
                  ) : (
                    <>
                      <select
                        value={fieldChoice[field.key] ?? ''}
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
                      {fieldChoice[field.key] === CUSTOM_CHOICE && (
                        <Input
                          className="mt-2"
                          value={fieldText[field.key] ?? ''}
                          onChange={(e) =>
                            setFieldText((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                          placeholder={t('konten.customValuePlaceholder')}
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
            </div>
          )}

          {/* Resolution — hidden when only one tier is available (logos
              are capped at 1K; see LOGO_RESOLUTIONS). */}
          {status.resolutions.length > 1 && (
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
          )}

          <Button
            variant="brand"
            className="w-full"
            disabled={!canGenerate}
            loading={busy}
            onClick={handleGenerate}
          >
            <Sparkles className="h-4 w-4" />
            {t('logo.generateCta', { credits: selectedCredits })}
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
                {t('logo.generating')}
              </p>
            </div>
          ) : result ? (
            <div className="mt-4 space-y-3">
              <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-brand-200 bg-gray-50 p-2 dark:border-brand-800 dark:bg-gray-900">
                <img
                  src={result.url}
                  alt=""
                  className="h-full w-full rounded-lg object-contain"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="brand"
                  className="flex-1"
                  onClick={handleDownload}
                >
                  <Download className="h-4 w-4" />
                  {t('konten.download')}
                </Button>
                <Button variant="ghost" asChild>
                  <Link to="/logo">{t('konten.viewGallery')}</Link>
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
