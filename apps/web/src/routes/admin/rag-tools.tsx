import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import {
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  CheckCircle,
  XCircle,
  Plus,
  Sparkles,
  ChevronRight,
} from 'lucide-react'
import {
  listRagTools,
  createRagTool,
  updateRagTool,
  deleteRagTool,
  moveRagTool,
  previewRagTools,
  listTenantsForRagPreview,
  type RagTool,
  type RagPreviewResponse,
} from '@/server/functions/admin-rag-tools'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import i18n from '@/lib/i18n' // JUR-140

export const Route = createFileRoute('/admin/rag-tools')({
  loader: async () => ({
    tools: await listRagTools(),
    tenants: await listTenantsForRagPreview(),
  }),
  component: RagToolsPage,
})

const RETRIEVAL_TYPES = [
  'inventory_price',
  'inventory_stock',
  'store_address',
  'operating_hours',
  'payment_methods',
  'promotions',
  'loyalty_points',
  'loyalty_stamps',
  'order_history',
  'recipe_availability',
] as const
const TIERS = ['basic', 'komplit', 'enterprise'] as const
const TRIGGER_MODES = ['always', 'on_keyword', 'on_customer_match'] as const

const TIER_COLORS: Record<string, string> = {
  basic: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  komplit: 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400',
  enterprise: 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400',
}

const formSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable(),
  retrievalType: z.enum(RETRIEVAL_TYPES),
  minTier: z.enum(TIERS),
  triggerMode: z.enum(TRIGGER_MODES),
  triggerKeywordsRaw: z.string().max(800),
  isActive: z.boolean(),
})
type FormValues = z.infer<typeof formSchema>

function RagToolsPage() {
  const { t } = useTranslation()
  const { tools, tenants } = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()
  const [editing, setEditing] = useState<RagTool | null>(null)
  const [creating, setCreating] = useState(false)

  function triggerLabel(mode: string): string {
    return t(`admin.ragTools.trigger.${mode}`, { defaultValue: mode })
  }

  async function handleMove(id: string, direction: 'up' | 'down') {
    try {
      await moveRagTool({ data: { id, direction } })
      await router.invalidate()
    } catch (e) {
      toast({
        title: t('admin.ragTools.errorMove'),
        description: (e as Error).message,
        variant: 'error',
      })
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(t('admin.ragTools.deleteConfirmTpl', { name }))) return
    try {
      await deleteRagTool({ data: { id } })
      toast({ title: t('admin.ragTools.toolDeletedToast'), variant: 'success' })
      await router.invalidate()
    } catch (e) {
      toast({
        title: t('admin.ragTools.errorDelete'),
        description: (e as Error).message,
        variant: 'error',
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('admin.ragTools.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('admin.ragTools.subtitle')}
          </p>
        </div>
        <Button variant="brand" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('admin.ragTools.newTool')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{t('admin.ragTools.col.order')}</TableHead>
              <TableHead>{t('admin.ragTools.col.name')}</TableHead>
              <TableHead>{t('admin.ragTools.col.type')}</TableHead>
              <TableHead>{t('admin.ragTools.col.tier')}</TableHead>
              <TableHead>{t('admin.ragTools.col.trigger')}</TableHead>
              <TableHead>{t('admin.ragTools.col.keywords')}</TableHead>
              <TableHead>{t('admin.ragTools.col.status')}</TableHead>
              <TableHead className="w-20 text-right">{t('admin.ragTools.col.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.map((tool, i) => (
              <TableRow key={tool.id}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleMove(tool.id, 'up')}
                      disabled={i === 0}
                      className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 dark:hover:bg-gray-700"
                      aria-label={t('admin.ragTools.moveUp')}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(tool.id, 'down')}
                      disabled={i === tools.length - 1}
                      className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 dark:hover:bg-gray-700"
                      aria-label={t('admin.ragTools.moveDown')}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{tool.name}</div>
                  {tool.description && (
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {tool.description}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                    {tool.retrievalType}
                  </code>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                      TIER_COLORS[tool.minTier],
                    )}
                  >
                    {tool.minTier}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                  {triggerLabel(tool.triggerMode)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {tool.triggerKeywords.length === 0 ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      tool.triggerKeywords.slice(0, 4).map((kw) => (
                        <span
                          key={kw}
                          className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        >
                          {kw}
                        </span>
                      ))
                    )}
                    {tool.triggerKeywords.length > 4 && (
                      <span className="text-xs text-gray-400">
                        +{tool.triggerKeywords.length - 4}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {tool.isActive ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-success-600 dark:text-success-400">
                      <CheckCircle className="h-3.5 w-3.5" /> {t('admin.ragTools.statusActive')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400">
                      <XCircle className="h-3.5 w-3.5" /> {t('admin.ragTools.statusInactive')}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(tool)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                      aria-label={t('admin.ragTools.edit')}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(tool.id, tool.name)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                      aria-label={t('admin.ragTools.delete')}
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

      <PreviewPanel tenants={tenants} />

      {(editing || creating) && (
        <ToolSheet
          tool={editing}
          onClose={() => {
            setEditing(null)
            setCreating(false)
          }}
          onSaved={async () => {
            setEditing(null)
            setCreating(false)
            await router.invalidate()
          }}
        />
      )}
    </div>
  )
}

// ─── Tool create/edit sheet ────────────────────────────────────────────────

function ToolSheet({
  tool,
  onClose,
  onSaved,
}: {
  tool: RagTool | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: tool?.name ?? '',
      description: tool?.description ?? '',
      retrievalType: (tool?.retrievalType as (typeof RETRIEVAL_TYPES)[number]) ?? 'inventory_price',
      minTier: (tool?.minTier as (typeof TIERS)[number]) ?? 'basic',
      triggerMode: (tool?.triggerMode as (typeof TRIGGER_MODES)[number]) ?? 'on_keyword',
      triggerKeywordsRaw: tool?.triggerKeywords.join(', ') ?? '',
      isActive: tool?.isActive ?? true,
    },
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const triggerKeywords = values.triggerKeywordsRaw
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)

    const payload = {
      name: values.name,
      description: values.description?.trim() ? values.description : null,
      retrievalType: values.retrievalType,
      minTier: values.minTier,
      triggerMode: values.triggerMode,
      triggerKeywords,
      isActive: values.isActive,
    }

    try {
      if (tool) {
        await updateRagTool({ data: { id: tool.id, ...payload } })
      } else {
        await createRagTool({ data: payload })
      }
      toast({
        title: tool ? t('admin.ragTools.sheet.savedEditToast') : t('admin.ragTools.sheet.savedNewToast'),
        variant: 'success',
      })
      await onSaved()
    } catch (e) {
      setServerError(e instanceof Error ? e.message : i18n.t('admin.ragTools.sheet.errorSave'))
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {tool
            ? t('admin.ragTools.sheet.titleEditTpl', { name: tool.name })
            : t('admin.ragTools.sheet.titleNew')}
        </SheetTitle>
        <SheetDescription>{t('admin.ragTools.sheet.description')}</SheetDescription>
      </SheetHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.ragTools.sheet.labelName')}
            </label>
            <Input {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="mt-1 text-xs text-red-600">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.ragTools.sheet.labelDescription')}
            </label>
            <textarea
              {...form.register('description')}
              rows={2}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.ragTools.sheet.labelRetrievalType')}
            </label>
            <Controller
              control={form.control}
              name="retrievalType"
              render={({ field }) => (
                <select
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  {RETRIEVAL_TYPES.map((rt) => (
                    <option key={rt} value={rt}>
                      {rt}
                    </option>
                  ))}
                </select>
              )}
            />
            <p className="mt-1 text-xs text-gray-400">
              {t('admin.ragTools.sheet.helpRetrievalType')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.ragTools.sheet.labelMinTier')}
              </label>
              <Controller
                control={form.control}
                name="minTier"
                render={({ field }) => (
                  <select
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm capitalize dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    {TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.ragTools.sheet.labelTriggerMode')}
              </label>
              <Controller
                control={form.control}
                name="triggerMode"
                render={({ field }) => (
                  <select
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    {TRIGGER_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`admin.ragTools.trigger.${mode}`, { defaultValue: mode })}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.ragTools.sheet.labelKeywords')}
            </label>
            <Input
              {...form.register('triggerKeywordsRaw')}
              placeholder={t('admin.ragTools.sheet.keywordsPlaceholder')}
            />
            <p className="mt-1 text-xs text-gray-400">{t('admin.ragTools.sheet.helpKeywords')}</p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.ragTools.sheet.labelIsActive')}
            </p>
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
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                    field.value ? 'bg-brand-600 dark:bg-brand-500' : 'bg-gray-200 dark:bg-gray-700',
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

          {serverError && <p className="text-sm text-red-600">{serverError}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('admin.ragTools.sheet.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={form.formState.isSubmitting}>
            {t('admin.ragTools.sheet.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

// ─── Preview panel ─────────────────────────────────────────────────────────

function PreviewPanel({
  tenants,
}: {
  tenants: Array<{ id: string; businessName: string }>
}) {
  const { t } = useTranslation()
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '')
  const [message, setMessage] = useState('berapa harga kopi?')
  const [remoteJid, setRemoteJid] = useState('')
  const [result, setResult] = useState<RagPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedRaw, setExpandedRaw] = useState<Record<string, boolean>>({})

  async function runPreview() {
    if (!tenantId || !message.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await previewRagTools({
        data: {
          tenantId,
          message: message.trim(),
          remoteJid: remoteJid.trim() || undefined,
        },
      })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.ragTools.preview.errorRun'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t('admin.ragTools.preview.title')}
        </h2>
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        {t('admin.ragTools.preview.subtitle')}
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('admin.ragTools.preview.labelTenant')}
          </label>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          >
            {tenants.map((ten) => (
              <option key={ten.id} value={ten.id}>
                {ten.businessName}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('admin.ragTools.preview.labelMessage')}
          </label>
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('admin.ragTools.preview.messagePlaceholder')}
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('admin.ragTools.preview.labelRemoteJid')}
          </label>
          <Input
            value={remoteJid}
            onChange={(e) => setRemoteJid(e.target.value)}
            placeholder={t('admin.ragTools.preview.remoteJidPlaceholder')}
          />
        </div>
        <div className="flex items-end">
          <Button variant="brand" onClick={runPreview} loading={loading} disabled={!tenantId}>
            {t('admin.ragTools.preview.runCta')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('admin.ragTools.preview.contextHeading')}
            </div>
            {result.snippets.length === 0 ? (
              <p className="text-sm italic text-gray-500 dark:text-gray-400">
                {t('admin.ragTools.preview.noActiveTools')}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {result.snippets.map((s) => (
                  <li
                    key={s.toolId + s.source}
                    className="text-sm text-gray-800 dark:text-gray-200"
                  >
                    <span className="mr-2 inline-block rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                      {s.source}
                    </span>
                    {s.text}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {t('admin.ragTools.preview.metricsTpl', {
                snippets: result.snippets.length,
                ms: result.totalMs,
                tokens: result.estimatedTokens,
              })}
            </div>
          </div>

          {result.rawRows.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('admin.ragTools.preview.rawHeading')}
              </div>
              {result.rawRows.map((rr) => {
                const expanded = expandedRaw[rr.toolId] ?? false
                return (
                  <div
                    key={rr.toolId}
                    className="rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRaw((s) => ({ ...s, [rr.toolId]: !expanded }))
                      }
                      className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        {rr.toolName}
                        <span className="ml-2 text-xs text-gray-400">
                          {t('admin.ragTools.preview.rawSummaryTpl', {
                            rows: rr.rows.length,
                            ms: rr.latencyMs,
                          })}
                        </span>
                      </span>
                      <ChevronRight
                        className={cn(
                          'h-4 w-4 text-gray-400 transition-transform',
                          expanded && 'rotate-90',
                        )}
                      />
                    </button>
                    {expanded && (
                      <pre className="overflow-x-auto border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                        {JSON.stringify(rr.rows, null, 2)}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
