import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Megaphone, Send } from 'lucide-react'
import { listTenants } from '@/server/functions/admin'
import { listRoles } from '@/server/functions/rbac'
import {
  broadcastNotification,
  previewBroadcastRecipientCount,
} from '@/server/functions/admin-notifications'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'

type AudienceMode = 'all' | 'tenants' | 'roles' | 'modules'

interface Audience {
  mode: AudienceMode
  tenantIds: string[]
  roleKeys: string[]
  moduleKeys: string[]
}

export const Route = createFileRoute('/admin/notifications')({
  loader: async () => {
    // Fetch a large page so the audience picker covers every tenant. The
// admin notifications recipient list is platform-wide; the new paginated
// listTenants is for the tenants table page, but here we just need
// {id, businessName} pairs without paging.
const [tenants, roles] = await Promise.all([
  listTenants({ data: { page: 1, pageSize: 100, search: '' } }),
  listRoles(),
])
    return { tenants, roles }
  },
  component: BroadcastPage,
})

function BroadcastPage() {
  const { tenants, roles } = Route.useLoaderData()
  const { t } = useTranslation()
  const { toast } = useToast()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [audience, setAudience] = useState<Audience>({
    mode: 'all',
    tenantIds: [],
    roleKeys: [],
    moduleKeys: [],
  })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)

  const audiencePayload = useMemo(() => buildAudiencePayload(audience), [audience])

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['admin', 'broadcast-preview', audiencePayload],
    queryFn: () => {
      // `enabled: audiencePayload !== null` already gates this, but
      // useQuery's queryFn types don't narrow off `enabled`, so we
      // assert here.
      if (audiencePayload === null) throw new Error('audience missing')
      return previewBroadcastRecipientCount({
        data: { audience: audiencePayload },
      })
    },
    enabled: audiencePayload !== null,
  })

  const canSubmit =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    audiencePayload !== null &&
    (preview?.count ?? 0) > 0

  async function handleSend() {
    if (!audiencePayload) return
    setSending(true)
    try {
      const res = await broadcastNotification({
        data: {
          title: title.trim(),
          body: body.trim(),
          url: url.trim() || undefined,
          audience: audiencePayload,
        },
      })
      toast({
        title: t('admin.notifications.successToast', {
          count: res.recipientCount,
        }),
        variant: 'success',
      })
      setTitle('')
      setBody('')
      setUrl('')
      setConfirmOpen(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengirim'
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-brand-600 dark:text-brand-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('admin.notifications.title')}
          </h1>
        </div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('admin.notifications.subtitle')}
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('admin.notifications.fieldTitle')}
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder={t('admin.notifications.fieldTitlePlaceholder')}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('admin.notifications.fieldBody')}
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={280}
            rows={3}
            placeholder={t('admin.notifications.fieldBodyPlaceholder')}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-gray-600 dark:bg-gray-800"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {body.length}/280
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('admin.notifications.fieldUrl')}
          </label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            placeholder="https://..."
          />
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('admin.notifications.audience')}
        </p>

        <AudienceRadio
          mode="all"
          current={audience.mode}
          onSelect={(m) => setAudience((a) => ({ ...a, mode: m }))}
          label={t('admin.notifications.audienceAll')}
        />
        <AudienceRadio
          mode="tenants"
          current={audience.mode}
          onSelect={(m) => setAudience((a) => ({ ...a, mode: m }))}
          label={t('admin.notifications.audienceTenants')}
        />
        {audience.mode === 'tenants' && (
          <CheckGroup
            options={tenants.rows.map((tenant) => ({
              value: tenant.id,
              label: tenant.businessName,
            }))}
            selected={audience.tenantIds}
            onChange={(v) => setAudience((a) => ({ ...a, tenantIds: v }))}
          />
        )}

        <AudienceRadio
          mode="roles"
          current={audience.mode}
          onSelect={(m) => setAudience((a) => ({ ...a, mode: m }))}
          label={t('admin.notifications.audienceRoles')}
        />
        {audience.mode === 'roles' && (
          <CheckGroup
            options={roles.map((r) => ({ value: r.key, label: r.label }))}
            selected={audience.roleKeys}
            onChange={(v) => setAudience((a) => ({ ...a, roleKeys: v }))}
          />
        )}

        <AudienceRadio
          mode="modules"
          current={audience.mode}
          onSelect={(m) => setAudience((a) => ({ ...a, mode: m }))}
          label={t('admin.notifications.audienceModules')}
        />
        {audience.mode === 'modules' && (
          <CheckGroup
            options={[{ value: 'attendance', label: 'Absensi' }]}
            selected={audience.moduleKeys}
            onChange={(v) => setAudience((a) => ({ ...a, moduleKeys: v }))}
          />
        )}

        <p className="border-t border-gray-200 pt-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
          {previewLoading
            ? '…'
            : t('admin.notifications.recipientCount', {
                count: preview?.count ?? 0,
              })}
        </p>
      </div>

      <div className="flex justify-end">
        <Button
          variant="brand"
          disabled={!canSubmit}
          onClick={() => setConfirmOpen(true)}
        >
          <Send className="mr-1 h-4 w-4" />
          {t('admin.notifications.send')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        title={t('admin.notifications.sendConfirmTitle')}
        description={t('admin.notifications.sendConfirmDesc', {
          count: preview?.count ?? 0,
        })}
        confirmText={t('admin.notifications.send')}
        loading={sending}
        onConfirm={handleSend}
      />
    </div>
  )
}

function AudienceRadio({
  mode,
  current,
  onSelect,
  label,
}: {
  mode: AudienceMode
  current: AudienceMode
  onSelect: (m: AudienceMode) => void
  label: string
}) {
  const id = `aud-${mode}`
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 rounded-lg p-1"
    >
      <input
        id={id}
        type="radio"
        name="audience-mode"
        checked={current === mode}
        onChange={() => onSelect(mode)}
        className="h-4 w-4 text-brand-600"
      />
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
    </label>
  )
}

function CheckGroup({
  options,
  selected,
  onChange,
}: {
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v])
  }
  return (
    <div className="ml-6 flex flex-wrap gap-2">
      {options.map((o) => {
        const active = selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Translate the local form state into the discriminated-union shape
 * the server function expects. Returns null when the current mode is
 * missing required sub-selections (e.g. "tenants" mode with no
 * tenant selected) — callers treat null as "audience incomplete".
 */
function buildAudiencePayload(a: Audience):
  | { mode: 'all' }
  | { mode: 'tenants'; tenantIds: string[] }
  | { mode: 'roles'; roleKeys: string[] }
  | { mode: 'modules'; moduleKeys: string[] }
  | null {
  switch (a.mode) {
    case 'all':
      return { mode: 'all' }
    case 'tenants':
      return a.tenantIds.length === 0
        ? null
        : { mode: 'tenants', tenantIds: a.tenantIds }
    case 'roles':
      return a.roleKeys.length === 0
        ? null
        : { mode: 'roles', roleKeys: a.roleKeys }
    case 'modules':
      return a.moduleKeys.length === 0
        ? null
        : { mode: 'modules', moduleKeys: a.moduleKeys }
  }
}
