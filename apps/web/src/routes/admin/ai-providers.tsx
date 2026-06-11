import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm, Controller, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, Trash2, Star, CheckCircle, XCircle } from 'lucide-react'
import {
  listAiProviderConfigs,
  createAiProviderConfig,
  updateAiProviderConfig,
  deleteAiProviderConfig,
  type AiProviderConfig,
  type AiCapabilityKind,
} from '@/server/functions/admin-ai-providers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/admin/ai-providers')({
  loader: async () => {
    const configs = await listAiProviderConfigs()
    return { configs }
  },
  component: AiProvidersPage,
})

// ─── Provider presets ────────────────────────────────────────────────────────
// `providerType` is the wire format used by the Go adapters:
//   "openai"  → OpenAI chat/completions API (most providers are compatible)
//   "gemini"  → Google Gemini generateContent API

type ProviderPreset = {
  label: string
  providerType: 'openai' | 'gemini'
  baseUrl: string
  models: string[]
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: {
    label: 'OpenAI',
    providerType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  gemini: {
    label: 'Google Gemini',
    providerType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      'gemini-2.0-flash-exp',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-3-pro-image',
    ],
  },
  deepseek: {
    label: 'DeepSeek',
    providerType: 'openai',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro'],
  },
  groq: {
    label: 'Groq',
    providerType: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  },
  mistral: {
    label: 'Mistral AI',
    providerType: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'open-mistral-nemo'],
  },
  together: {
    label: 'Together AI',
    providerType: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
  },
  openrouter: {
    label: 'OpenRouter',
    providerType: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.3-70b-instruct'],
  },
  xai: {
    label: 'xAI (Grok)',
    providerType: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-2-latest', 'grok-beta'],
  },
  ollama: {
    label: 'Ollama (Local)',
    providerType: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.2', 'llama3.1', 'qwen2.5', 'phi4', 'mistral', 'deepseek-r1'],
  },
  azure: {
    label: 'Azure OpenAI',
    providerType: 'openai',
    baseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
  custom: {
    label: 'Custom / Other',
    providerType: 'openai',
    baseUrl: '',
    models: [],
  },
}

function guessPresetKey(baseUrl: string): string {
  for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
    if (key !== 'custom' && preset.baseUrl && baseUrl.startsWith(preset.baseUrl)) return key
  }
  return 'custom'
}

const CAPABILITY_KINDS: AiCapabilityKind[] = ['text', 'image', 'video']

// ─── Form schema ──────────────────────────────────────────────────────────────

// Empty string means "leave the column NULL". Validate as decimal string so
// tiny rates like 0.0028 (DeepSeek cache hit) round-trip cleanly.
const priceField = z
  .string()
  .regex(/^(\d+(\.\d+)?)?$/, 'Harus angka desimal')

const creditsField = z.string().regex(/^\d+$/, 'Angka bulat')

// Image resolution tiers — order matters for the rendered table.
const RESOLUTION_TIERS = ['1k', '2k', '4k'] as const

const resTierFormSchema = z.object({
  credits: creditsField,
  priceUsd: priceField,
})

const capabilityFormSchema = z.object({
  capability: z.enum(['text', 'image', 'video']),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  inputPricePer1mUsd: priceField,
  inputCacheHitPricePer1mUsd: priceField,
  outputPricePer1mUsd: priceField,
  imageResolutionPricing: z.object({
    '1k': resTierFormSchema,
    '2k': resTierFormSchema,
    '4k': resTierFormSchema,
  }),
  pricePerSecondUsd: priceField,
})

const formSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi').max(100),
  providerType: z.enum(['openai', 'gemini']),
  model: z.string().min(1, 'Model wajib diisi'),
  baseUrl: z.string().url('URL tidak valid'),
  apiKey: z.string(),
  isActive: z.boolean(),
  capabilities: z
    .array(capabilityFormSchema)
    .min(1, 'Minimal satu kapabilitas')
    .refine(
      (arr) => new Set(arr.map((c) => c.capability)).size === arr.length,
      'Kapabilitas tidak boleh ganda',
    ),
})
type FormValues = z.infer<typeof formSchema>
type CapabilityFormValue = z.infer<typeof capabilityFormSchema>

// Default credit cost per resolution tier — higher tiers cost more.
const DEFAULT_TIER_CREDITS: Record<string, string> = {
  '1k': '1',
  '2k': '2',
  '4k': '4',
}

function emptyResolutionPricing(): CapabilityFormValue['imageResolutionPricing'] {
  return {
    '1k': { credits: DEFAULT_TIER_CREDITS['1k']!, priceUsd: '' },
    '2k': { credits: DEFAULT_TIER_CREDITS['2k']!, priceUsd: '' },
    '4k': { credits: DEFAULT_TIER_CREDITS['4k']!, priceUsd: '' },
  }
}

function emptyCapability(capability: AiCapabilityKind): CapabilityFormValue {
  return {
    capability,
    isDefault: false,
    isActive: true,
    inputPricePer1mUsd: '',
    inputCacheHitPricePer1mUsd: '',
    outputPricePer1mUsd: '',
    imageResolutionPricing: emptyResolutionPricing(),
    pricePerSecondUsd: '',
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

function AiProvidersPage() {
  const { configs } = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AiProviderConfig | null>(null)
  const [deleting, setDeleting] = useState<AiProviderConfig | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete() {
    if (!deleting) return
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      await deleteAiProviderConfig({ data: { id: deleting.id } })
      setDeleting(null)
      await router.invalidate()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('admin.aiProviders.deleteError'))
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('admin.aiProviders.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('admin.aiProviders.subtitle')}
          </p>
        </div>
        <Button variant="brand" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          {t('admin.aiProviders.newProvider')}
        </Button>
      </div>

      {configs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-8 py-16 text-center dark:border-gray-600 dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('admin.aiProviders.empty')}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.aiProviders.colName')}</TableHead>
                <TableHead>{t('admin.aiProviders.colProvider')}</TableHead>
                <TableHead>{t('admin.aiProviders.colModel')}</TableHead>
                <TableHead>{t('admin.aiProviders.colCapabilities')}</TableHead>
                <TableHead>{t('admin.aiProviders.colStatus')}</TableHead>
                <TableHead className="w-24 text-right">{t('admin.aiProviders.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configs.map((cfg) => (
                <TableRow key={cfg.id}>
                  <TableCell>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {cfg.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                      {cfg.providerType}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-gray-700 dark:text-gray-300">
                    {cfg.model}
                  </TableCell>
                  <TableCell>
                    {cfg.capabilities.length === 0 ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {cfg.capabilities.map((cap) => (
                          <span
                            key={cap.id}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
                              cap.isActive
                                ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                                : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
                            )}
                          >
                            {cap.isDefault && <Star className="h-3 w-3 fill-current" />}
                            {t(`admin.aiProviders.cap_${cap.capability}`)}
                          </span>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {cfg.isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success-600 dark:text-success-400">
                        <CheckCircle className="h-3.5 w-3.5" />
                        {t('admin.aiProviders.statusActive')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 dark:text-gray-500">
                        <XCircle className="h-3.5 w-3.5" />
                        {t('admin.aiProviders.statusInactive')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(cfg)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(cfg)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && (
        <ProviderSheet
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false)
            await router.invalidate()
          }}
        />
      )}

      {editing && (
        <ProviderSheet
          mode="edit"
          config={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await router.invalidate()
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleting(null)
          setDeleteError(null)
        }}
        title={t('admin.aiProviders.deleteTitle')}
        description={
          deleteError ??
          t('admin.aiProviders.deleteDesc', { name: deleting?.name ?? '' })
        }
        confirmText={t('admin.aiProviders.deleteCta')}
        cancelText={t('common.cancel')}
        loading={deleteLoading}
        variant="danger"
      />
    </div>
  )
}

// ─── Sheet form ───────────────────────────────────────────────────────────────

function ProviderSheet({
  mode,
  config,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  config?: AiProviderConfig
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [serverError, setServerError] = useState<string | null>(null)

  // Track the selected preset key separately — it's a UI helper, not stored in DB.
  const [presetKey, setPresetKey] = useState<string>(() => {
    if (mode === 'edit' && config) return guessPresetKey(config.baseUrl)
    return 'openai'
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: config?.name ?? PROVIDER_PRESETS['openai']!.label,
      providerType: (config?.providerType as 'openai' | 'gemini') ?? 'openai',
      model: config?.model ?? PROVIDER_PRESETS['openai']!.models[0] ?? '',
      baseUrl: config?.baseUrl ?? PROVIDER_PRESETS['openai']!.baseUrl,
      apiKey: '',
      isActive: config?.isActive ?? true,
      capabilities:
        config && config.capabilities.length > 0
          ? config.capabilities.map((c) => {
              const pricing = emptyResolutionPricing()
              for (const tier of RESOLUTION_TIERS) {
                const t2 = c.imageResolutionPricing?.[tier]
                if (t2) {
                  pricing[tier] = {
                    credits: String(t2.credits),
                    priceUsd: t2.priceUsd ?? '',
                  }
                }
              }
              return {
                capability: c.capability,
                isDefault: c.isDefault,
                isActive: c.isActive,
                inputPricePer1mUsd: c.inputPricePer1mUsd ?? '',
                inputCacheHitPricePer1mUsd: c.inputCacheHitPricePer1mUsd ?? '',
                outputPricePer1mUsd: c.outputPricePer1mUsd ?? '',
                imageResolutionPricing: pricing,
                pricePerSecondUsd: c.pricePerSecondUsd ?? '',
              }
            })
          : [emptyCapability('text')],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'capabilities',
  })
  const capabilities = form.watch('capabilities')

  const currentPreset = PROVIDER_PRESETS[presetKey] ?? PROVIDER_PRESETS.custom!
  const modelSuggestions = currentPreset.models
  const isCustom = presetKey === 'custom'

  function handlePresetChange(key: string) {
    const preset = PROVIDER_PRESETS[key]
    if (!preset) return
    setPresetKey(key)
    form.setValue('providerType', preset.providerType)
    form.setValue('baseUrl', preset.baseUrl)
    if (preset.models[0]) form.setValue('model', preset.models[0])
    const currentName = form.getValues('name')
    const wasAutoName = Object.values(PROVIDER_PRESETS).some((p) => p.label === currentName)
    if (!currentName || wasAutoName) form.setValue('name', preset.label)
  }

  // Capability kinds not yet added — offered by the "add capability" control.
  const usedKinds = new Set((capabilities ?? []).map((c) => c.capability))
  const availableKinds = CAPABILITY_KINDS.filter((k) => !usedKinds.has(k))

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      // Zero out pricing fields irrelevant to each capability so unrelated
      // stale values don't get persisted, and shape the image tiers into
      // the {credits:number, priceUsd:string} the server expects.
      const capabilities = values.capabilities.map((c) => ({
        capability: c.capability,
        isDefault: c.isDefault,
        isActive: c.isActive,
        inputPricePer1mUsd: c.capability === 'text' ? c.inputPricePer1mUsd : '',
        inputCacheHitPricePer1mUsd:
          c.capability === 'text' ? c.inputCacheHitPricePer1mUsd : '',
        outputPricePer1mUsd: c.capability === 'text' ? c.outputPricePer1mUsd : '',
        pricePerSecondUsd: c.capability === 'video' ? c.pricePerSecondUsd : '',
        imageResolutionPricing:
          c.capability === 'image'
            ? {
                '1k': {
                  credits: Number(c.imageResolutionPricing['1k'].credits) || 1,
                  priceUsd: c.imageResolutionPricing['1k'].priceUsd,
                },
                '2k': {
                  credits: Number(c.imageResolutionPricing['2k'].credits) || 2,
                  priceUsd: c.imageResolutionPricing['2k'].priceUsd,
                },
                '4k': {
                  credits: Number(c.imageResolutionPricing['4k'].credits) || 4,
                  priceUsd: c.imageResolutionPricing['4k'].priceUsd,
                },
              }
            : null,
      }))
      const payload = { ...values, capabilities }
      if (mode === 'create') {
        if (!values.apiKey) {
          form.setError('apiKey', { message: t('admin.aiProviders.apiKeyRequired') })
          return
        }
        await createAiProviderConfig({ data: payload })
      } else if (config) {
        await updateAiProviderConfig({ data: { ...payload, id: config.id } })
      }
      await onSaved()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('admin.aiProviders.saveError'))
    }
  }

  const capabilitiesError = form.formState.errors.capabilities

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {mode === 'create'
            ? t('admin.aiProviders.sheetCreateTitle')
            : t('admin.aiProviders.sheetEditTitle', { name: config?.name ?? '' })}
        </SheetTitle>
        <SheetDescription>{t('admin.aiProviders.sheetDescription')}</SheetDescription>
      </SheetHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">

          {/* Provider preset selector */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.aiProviders.fieldPreset')}
            </label>
            <select
              value={presetKey}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-400"
            >
              {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
            {!isCustom && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('admin.aiProviders.fieldPresetHint')}
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.aiProviders.fieldName')}
            </label>
            <Input
              {...form.register('name')}
              placeholder={t('admin.aiProviders.fieldNamePlaceholder')}
            />
            {form.formState.errors.name && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          {/* Model */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.aiProviders.fieldModel')}
            </label>
            <Input
              {...form.register('model')}
              placeholder={modelSuggestions[0] ?? 'e.g. gpt-4o-mini'}
              list="model-suggestions"
            />
            {modelSuggestions.length > 0 && (
              <datalist id="model-suggestions">
                {modelSuggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('admin.aiProviders.fieldModelHint')}
            </p>
            {form.formState.errors.model && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.model.message}
              </p>
            )}
          </div>

          {/* Base URL */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.aiProviders.fieldBaseUrl')}
            </label>
            <Input
              {...form.register('baseUrl')}
              placeholder="https://api.example.com/v1"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('admin.aiProviders.fieldBaseUrlHint')}
            </p>
            {form.formState.errors.baseUrl && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.baseUrl.message}
              </p>
            )}
          </div>

          {/* API Key */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.aiProviders.fieldApiKey')}
            </label>
            <Input
              {...form.register('apiKey')}
              type="password"
              placeholder={
                mode === 'edit'
                  ? t('admin.aiProviders.fieldApiKeyEditPlaceholder')
                  : t('admin.aiProviders.fieldApiKeyPlaceholder')
              }
              autoComplete="off"
            />
            {mode === 'edit' && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('admin.aiProviders.fieldApiKeyEditHint')}
              </p>
            )}
            {form.formState.errors.apiKey && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.apiKey.message}
              </p>
            )}
          </div>

          {/* API Format — always shown, auto-set by preset, editable for custom */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.aiProviders.fieldApiFormat')}
            </label>
            <Controller
              control={form.control}
              name="providerType"
              render={({ field }) => (
                <div className="flex gap-3">
                  {(['openai', 'gemini'] as const).map((pt) => (
                    <label
                      key={pt}
                      className={cn(
                        'flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                        field.value === pt
                          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-900/20 dark:text-brand-400'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400',
                      )}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        checked={field.value === pt}
                        onChange={() => field.onChange(pt)}
                      />
                      <span className="font-medium">
                        {pt === 'openai' ? 'OpenAI-compatible' : 'Google Gemini'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('admin.aiProviders.fieldApiFormatHint')}
            </p>
          </div>

          {/* Capabilities — one card per (capability × pricing). */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.aiProviders.capabilities')}
              </label>
              {availableKinds.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      append(emptyCapability(e.target.value as AiCapabilityKind))
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  <option value="">+ {t('admin.aiProviders.addCapability')}</option>
                  {availableKinds.map((k) => (
                    <option key={k} value={k}>
                      {t(`admin.aiProviders.cap_${k}`)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              {t('admin.aiProviders.capabilitiesHint')}
            </p>

            <div className="space-y-3">
              {fields.map((field, i) => {
                const kind = capabilities?.[i]?.capability ?? 'text'
                return (
                  <div
                    key={field.id}
                    className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/30"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="inline-flex items-center rounded-md bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                        {t(`admin.aiProviders.cap_${kind}`)}
                      </span>
                      {fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => remove(i)}
                          className="rounded p-1 text-gray-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30"
                          title={t('admin.aiProviders.removeCapability')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Text pricing */}
                    {kind === 'text' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                              {t('admin.aiProviders.fieldInputPrice')}
                            </label>
                            <Input
                              {...form.register(`capabilities.${i}.inputPricePer1mUsd`)}
                              type="text"
                              inputMode="decimal"
                              placeholder="0.14"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                              {t('admin.aiProviders.fieldOutputPrice')}
                            </label>
                            <Input
                              {...form.register(`capabilities.${i}.outputPricePer1mUsd`)}
                              type="text"
                              inputMode="decimal"
                              placeholder="0.28"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                            {t('admin.aiProviders.fieldInputCacheHitPrice')}
                          </label>
                          <Input
                            {...form.register(
                              `capabilities.${i}.inputCacheHitPricePer1mUsd`,
                            )}
                            type="text"
                            inputMode="decimal"
                            placeholder="0.0028"
                          />
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {t('admin.aiProviders.fieldInputCacheHitPriceHint')}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Image pricing — per resolution tier */}
                    {kind === 'image' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                          {t('admin.aiProviders.fieldImagePrice')}
                        </label>
                        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                          <div className="grid grid-cols-[1fr_5rem_1fr] gap-2 bg-gray-100 px-2 py-1.5 text-[11px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            <span>{t('admin.aiProviders.colResolution')}</span>
                            <span>{t('admin.aiProviders.colCredits')}</span>
                            <span>{t('admin.aiProviders.colPriceUsd')}</span>
                          </div>
                          {RESOLUTION_TIERS.map((tier) => (
                            <div
                              key={tier}
                              className="grid grid-cols-[1fr_5rem_1fr] items-center gap-2 px-2 py-1.5"
                            >
                              <span className="text-xs font-medium uppercase text-gray-700 dark:text-gray-300">
                                {tier}
                              </span>
                              <Input
                                {...form.register(
                                  `capabilities.${i}.imageResolutionPricing.${tier}.credits`,
                                )}
                                type="text"
                                inputMode="numeric"
                                placeholder="1"
                              />
                              <Input
                                {...form.register(
                                  `capabilities.${i}.imageResolutionPricing.${tier}.priceUsd`,
                                )}
                                type="text"
                                inputMode="decimal"
                                placeholder="0.039"
                              />
                            </div>
                          ))}
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {t('admin.aiProviders.fieldImagePriceHint')}
                        </p>
                      </div>
                    )}

                    {/* Video pricing */}
                    {kind === 'video' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                          {t('admin.aiProviders.fieldVideoPrice')}
                        </label>
                        <Input
                          {...form.register(`capabilities.${i}.pricePerSecondUsd`)}
                          type="text"
                          inputMode="decimal"
                          placeholder="0.10"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {t('admin.aiProviders.fieldVideoPriceHint')}
                        </p>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-4">
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          {...form.register(`capabilities.${i}.isDefault`)}
                          className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        />
                        {t('admin.aiProviders.capDefault')}
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          {...form.register(`capabilities.${i}.isActive`)}
                          className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        />
                        {t('admin.aiProviders.capActive')}
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
            {capabilitiesError && (
              <p className="mt-1 text-xs text-danger-600">
                {capabilitiesError.message ??
                  capabilitiesError.root?.message}
              </p>
            )}
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.aiProviders.fieldActive')}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('admin.aiProviders.fieldActiveHint')}
              </p>
            </div>
            <Controller
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <button
                  type="button"
                  role="switch"
                  aria-checked={field.value}
                  onClick={() => field.onChange(!field.value)}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
                    field.value
                      ? 'bg-brand-600 dark:bg-brand-500'
                      : 'bg-gray-200 dark:bg-gray-700',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
                      field.value ? 'translate-x-6' : 'translate-x-1',
                    )}
                  />
                </button>
              )}
            />
          </div>

          {serverError && <p className="text-sm text-danger-600">{serverError}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={form.formState.isSubmitting}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
