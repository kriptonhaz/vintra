/**
 * JUR-176 v2: section-builder editor.
 *
 * Architecture: tenant's site is `{ theme, sections[], seo }`. The
 * editor renders sections as a vertical list — each row gets toggle /
 * up-arrow / down-arrow / expand-to-edit / delete. New sections come
 * from the "+ Tambah Section" picker. Visual themes (brand color,
 * accent, font) live in a Theme card at the top; SEO at the bottom.
 *
 * No drag-drop library — explicit up/down arrows are clearer for the
 * ~5-15 sections a tenant will have, and don't ship 30KB of dnd-kit.
 *
 * Live preview re-renders on every keystroke (no debounce). The
 * preview iframe convention from JUR-176 v1 was abandoned: an inline
 * render is faster, lets the editor share React state with the
 * preview, and dodges all the postMessage plumbing.
 */
import { useMemo, useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getMySiteSettings,
  saveSiteDraft,
  publishSite,
  getEditorPreviewData,
  listSitePublishHistory,
  restoreSitePublishSnapshot,
  setSiteMaintenanceMode,
  uploadSiteAsset,
} from '@/server/functions/tenant-site'
import { claimPublicSlug } from '@/server/functions/public-tenant'
import { SECTIONS, ADDABLE_SECTION_TYPES, getImageFieldUploadKindV2, buildSectionInstance } from '@/lib/site-templates/sections-v2/registry'
import { PRESETS, PRESET_ORDER } from '@/lib/site-templates/sections-v2/presets'
import { normalizeSettingsV2 } from '@/lib/site-templates/sections-v2/normalize'
import { PublicSiteRenderV2 } from '@/lib/site-templates/sections-v2/render'
import type {
  PublicSiteRenderData,
  SectionInstance,
  SiteFont,
  SiteSettingsV2,
  V2FieldSchema,
} from '@/lib/site-templates/v2-types'
import { PhotoUploadField } from '@/components/inventory/photo-upload-field'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  Eye,
  ExternalLink,
  Save,
  Send,
  Sparkles,
  AlertTriangle,
  History,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Layers,
  Palette,
  Search,
  Wrench,
  X,
  Globe,
  Copy,
  Check,
} from 'lucide-react'

// ─── Route ───────────────────────────────────────────────────────────

export const Route = createFileRoute('/_authed/site/edit')({
  beforeLoad: ({ context }) => {
    const user = (
      context as {
        user?: {
          permissions?: string[]
          moduleSubscriptions?: { pos?: { features?: ReadonlyArray<string> } }
        }
      }
    ).user
    if (!user?.permissions?.includes('booking.write')) {
      throw redirect({ to: '/dashboard' })
    }
    // Komplit-only — same gate as the Situs sidebar entry. Bounce
    // free/Toko tenants to the dedicated upsell page so the click
    // lands somewhere useful (Komplit pitch + Lihat Paket CTA)
    // instead of a generic redirect to dashboard.
    if (!user.moduleSubscriptions?.pos?.features?.includes('tenant_site')) {
      throw redirect({ to: '/site/locked' })
    }
  },
  loader: async () => {
    const [siteResp, preview] = await Promise.all([
      getMySiteSettings(),
      getEditorPreviewData(),
    ])
    return { siteResp, preview }
  },
  component: SiteEditorPage,
})

// ─── Util: generate uuids on the client ──────────────────────────────

function clientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

// ─── Public URL card ─────────────────────────────────────────────────

// Local mirror of the server-side check (public-tenant.ts) — instant
// feedback as the tenant types; the server claim is the source of truth.
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

/**
 * Turn a business name into a slug-shaped suggestion for the claim
 * input's placeholder. Lowercases, replaces every non-alphanumeric run
 * (spaces, accents, punctuation) with a single hyphen, trims hyphens,
 * and caps at 30 chars. Returns a generic fallback when the result is
 * too short to be a valid slug (min 3 chars).
 */
function suggestSlug(businessName: string): string {
  const slug = businessName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '')
  return slug.length >= 3 ? slug : 'usaha-saya'
}

/**
 * Claim / view the tenant's public subdomain. Lives in the site editor
 * (the URL belongs to the site, not booking). Shows the input form when
 * unclaimed, or the URL preview + copy/open when claimed; "Ubah URL"
 * re-opens the form. On success it invalidates the route loader so the
 * editor (top bar, preview footer) picks up the new slug.
 */
function PublicUrlCard({
  slug,
  businessName,
}: {
  slug: string | null
  businessName: string
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [copied, setCopied] = useState(false)

  const slugPlaceholder = suggestSlug(businessName)

  const localError = (() => {
    const v = input.trim()
    if (!v) return null
    if (!SLUG_REGEX.test(v))
      return 'Pakai huruf kecil, angka, dan tanda hubung. 3–30 karakter.'
    return null
  })()

  const mut = useMutation({
    mutationFn: (s: string) => claimPublicSlug({ data: { slug: s } }),
    onSuccess: async () => {
      toast({ variant: 'success', title: 'URL berhasil diklaim.' })
      setEditing(false)
      setInput('')
      await router.invalidate()
    },
    onError: (err: Error) =>
      toast({
        variant: 'error',
        title: 'Gagal mengklaim URL.',
        description: err.message,
      }),
  })

  const fullUrl = slug ? `${slug}.vintra.my.id` : ''

  async function handleCopy() {
    if (!fullUrl) return
    try {
      await navigator.clipboard.writeText(`https://${fullUrl}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ variant: 'error', title: 'Gagal menyalin URL.' })
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-1 flex items-center gap-2">
        <Globe className="h-5 w-5 text-gray-500" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          URL Publik
        </h2>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Alamat web situs Anda. Bagikan ke pelanggan agar mereka bisa membuka
        halaman ini.
      </p>

      {slug && !editing ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
            <code className="flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
              https://{fullUrl}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
              aria-label="Salin URL"
            >
              {copied ? (
                <Check className="h-4 w-4 text-success-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
            <a
              href={`https://${fullUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
              aria-label="Buka di tab baru"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(true)
              setInput(slug)
            }}
            className="text-xs text-brand-700 hover:underline dark:text-brand-400"
          >
            Ubah URL
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (localError || !input.trim()) return
            mut.mutate(input.trim().toLowerCase())
          }}
          className="space-y-3"
        >
          <div className="flex items-stretch gap-2">
            <div className="flex flex-1 items-center rounded-lg border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-900/40">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value.toLowerCase())}
                placeholder={slugPlaceholder}
                className="flex-1 border-0 bg-transparent px-0 focus:ring-0"
                autoFocus={editing}
              />
              <span className="text-sm text-gray-500">.vintra.my.id</span>
            </div>
            <Button
              type="submit"
              variant="brand"
              loading={mut.isPending}
              disabled={!input.trim() || !!localError}
            >
              Klaim
            </Button>
            {slug && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(false)
                  setInput('')
                }}
              >
                Batal
              </Button>
            )}
          </div>
          {localError && <p className="text-xs text-danger-600">{localError}</p>}
          {slug && editing && (
            <p className="text-xs text-warning-700 dark:text-warning-400">
              Mengubah URL akan membuat link lama tidak bisa diakses.
            </p>
          )}
        </form>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────

function SiteEditorPage() {
  const { siteResp, preview } = Route.useLoaderData()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const initial: SiteSettingsV2 = useMemo(
    () => normalizeSettingsV2(siteResp.settings),
    [siteResp.settings],
  )
  const [settings, setSettings] = useState<SiteSettingsV2>(initial)
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>(siteResp.assetUrls)
  const [dirty, setDirty] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addPickerOpen, setAddPickerOpen] = useState(false)
  const [presetPickerOpen, setPresetPickerOpen] = useState(false)
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(null)

  function mutateSettings(fn: (prev: SiteSettingsV2) => SiteSettingsV2) {
    setSettings((prev) => fn(prev))
    setDirty(true)
  }

  function handleSectionUpdate(id: string, settings: Record<string, unknown>) {
    mutateSettings((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === id ? { ...s, settings: { ...s.settings, ...settings } } : s,
      ),
    }))
  }

  function handleToggleEnabled(id: string) {
    mutateSettings((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s,
      ),
    }))
  }

  function handleMove(id: string, delta: 1 | -1) {
    mutateSettings((prev) => {
      const idx = prev.sections.findIndex((s) => s.id === id)
      if (idx < 0) return prev
      const target = idx + delta
      // Don't move past the footer (always last) and don't move
      // above index 0.
      if (target < 0 || target >= prev.sections.length) return prev
      const targetSection = prev.sections[target]
      if (targetSection?.type === 'footer') return prev
      const next = [...prev.sections]
      const [moved] = next.splice(idx, 1)
      next.splice(target, 0, moved!)
      return { ...prev, sections: next }
    })
  }

  function handleDelete(id: string) {
    mutateSettings((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.id !== id),
    }))
    setExpandedId((cur) => (cur === id ? null : cur))
  }

  function handleAddSection(type: string) {
    const inst = buildSectionInstance(type, clientId())
    if (!inst) return
    mutateSettings((prev) => {
      // Insert before the footer (which is always last).
      const footerIdx = prev.sections.findIndex((s) => s.type === 'footer')
      const next = [...prev.sections]
      if (footerIdx === -1) {
        next.push(inst)
      } else {
        next.splice(footerIdx, 0, inst)
      }
      return { ...prev, sections: next }
    })
    setAddPickerOpen(false)
    setExpandedId(inst.id)
  }

  function handleApplyPreset(presetId: string) {
    const preset = PRESETS[presetId]
    if (!preset) return
    setSettings(normalizeSettingsV2(preset.build()))
    setDirty(true)
    setPendingPresetId(null)
    setPresetPickerOpen(false)
    setExpandedId(null)
  }

  function handleAssetUploaded(key: string, signedUrl: string) {
    setAssetUrls((prev) => ({ ...prev, [key]: signedUrl }))
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      saveSiteDraft({
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          settings: settings as any,
        },
      }),
    onSuccess: () => {
      setDirty(false)
      toast({ variant: 'success', title: 'Draft tersimpan.' })
      queryClient.invalidateQueries({ queryKey: ['site-settings'] })
    },
    onError: (err: Error) => {
      toast({ variant: 'error', title: 'Gagal menyimpan.', description: err.message })
    },
  })

  const publishMutation = useMutation({
    mutationFn: async () => {
      await saveSiteDraft({
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          settings: settings as any,
        },
      })
      return publishSite()
    },
    onSuccess: () => {
      setDirty(false)
      toast({
        variant: 'success',
        title: 'Situs dipublikasikan!',
        description: preview.tenant.publicSlug
          ? `Sudah live di ${preview.tenant.publicSlug}.vintra.my.id`
          : 'Klaim URL Publik di panel kiri agar customer bisa akses.',
      })
      queryClient.invalidateQueries({ queryKey: ['site-settings'] })
      queryClient.invalidateQueries({ queryKey: ['site-publish-history'] })
    },
    onError: (err: Error) => {
      toast({
        variant: 'error',
        title: 'Gagal mempublikasikan.',
        description: err.message,
      })
    },
  })

  const publicSlug = preview.tenant.publicSlug

  // ─── Preview data ──────────────────────────────────────────────────

  const renderData: PublicSiteRenderData = useMemo(
    () => ({
      tenant: preview.tenant,
      mode: preview.mode as PublicSiteRenderData['mode'],
      branches: preview.branches,
      services: preview.services,
      resources: preview.resources,
      queue: preview.queue,
      tax: preview.tax,
      promos: preview.promos ?? [],
      stampPrograms: preview.stampPrograms ?? [],
    }),
    [preview],
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <ModuleBreadcrumb />

      <div className="mx-auto max-w-[1600px] px-4 pt-4 pb-12 sm:px-6 lg:px-8">
        {/* Top bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
              <Sparkles className="h-6 w-6 text-brand-600" />
              Editor Situs
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Atur tampilan halaman publik —{' '}
              {publicSlug ? (
                <span className="font-mono">{publicSlug}.vintra.my.id</span>
              ) : (
                <span className="italic">URL publik (belum diklaim)</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPresetPickerOpen(true)}
              className="gap-1.5"
            >
              <Layers className="h-4 w-4" />
              Ganti Preset
            </Button>
            {publicSlug && siteResp.published && (
              <a
                href={`https://${publicSlug}.vintra.my.id`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <ExternalLink className="h-4 w-4" />
                Halaman publik
              </a>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || publishMutation.isPending || !dirty}
              className="gap-1.5"
            >
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? 'Menyimpan…' : 'Simpan'}
            </Button>
            <Button
              type="button"
              variant="brand"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className="gap-1.5"
            >
              <Send className="h-4 w-4" />
              {publishMutation.isPending ? 'Mempublikasikan…' : 'Publikasikan'}
            </Button>
          </div>
        </div>

        {dirty && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:border-warning-900/40 dark:bg-warning-950/20 dark:text-warning-200">
            <AlertTriangle className="h-4 w-4" />
            Ada perubahan yang belum disimpan.
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid gap-6 lg:grid-cols-[5fr_6fr]">
          {/* LEFT — editor controls */}
          <div className="space-y-4">
            <PublicUrlCard
              slug={publicSlug}
              businessName={preview.tenant.businessName}
            />

            <MaintenanceCard
              initialEnabled={siteResp.maintenance?.mode ?? false}
              initialMessage={siteResp.maintenance?.message ?? null}
            />

            <ThemeCard
              theme={settings.theme}
              assetUrls={assetUrls}
              onChange={(theme) =>
                mutateSettings((prev) => ({ ...prev, theme }))
              }
              onAssetUploaded={handleAssetUploaded}
            />

            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">
                Section Halaman
              </h2>
              <p className="mb-4 text-xs text-gray-500">
                Atur urutan, tampilkan/sembunyikan, atau hapus tiap bagian.
              </p>
              <ul className="space-y-2">
                {settings.sections.map((inst, idx) => {
                  const def = SECTIONS[inst.type]
                  if (!def) return null
                  const isFooter = inst.type === 'footer'
                  const isFirst = idx === 0
                  const isLastBeforeFooter =
                    settings.sections[idx + 1]?.type === 'footer'
                  return (
                    <SectionRow
                      key={inst.id}
                      instance={inst}
                      defName={def.name}
                      defDescription={def.description}
                      defIcon={def.icon}
                      isSystemManaged={!!def.systemManaged}
                      expanded={expandedId === inst.id}
                      canMoveUp={!isFirst && !isFooter}
                      canMoveDown={!isLastBeforeFooter && !isFooter}
                      fields={def.fields}
                      assetUrls={assetUrls}
                      branches={preview.branches}
                      onToggleExpand={() =>
                        setExpandedId(expandedId === inst.id ? null : inst.id)
                      }
                      onToggleEnabled={() => handleToggleEnabled(inst.id)}
                      onMoveUp={() => handleMove(inst.id, -1)}
                      onMoveDown={() => handleMove(inst.id, 1)}
                      onDelete={() => handleDelete(inst.id)}
                      onSettingsChange={(s) => handleSectionUpdate(inst.id, s)}
                      onAssetUploaded={handleAssetUploaded}
                    />
                  )
                })}
              </ul>
              <button
                type="button"
                onClick={() => setAddPickerOpen(true)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-gray-600 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-brand-950/20"
              >
                <Plus className="h-4 w-4" />
                Tambah Section
              </button>
            </div>

            <SeoCard
              seo={settings.seo}
              assetUrls={assetUrls}
              onChange={(seo) => mutateSettings((prev) => ({ ...prev, seo }))}
              onAssetUploaded={handleAssetUploaded}
            />

            <PublishHistoryCard
              onRestored={(restoredSettings) => {
                setSettings(normalizeSettingsV2(restoredSettings))
                setDirty(true)
                setExpandedId(null)
              }}
            />
          </div>

          {/* RIGHT — live preview */}
          <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
            <div className="mb-2 flex items-center gap-2 px-1 text-xs uppercase tracking-wide text-gray-500">
              <Eye className="h-3.5 w-3.5" />
              Pratinjau Live
            </div>
            <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm dark:border-gray-700">
              <PublicSiteRenderV2
                settings={settings}
                data={renderData}
                resolveAssetUrl={(key) =>
                  key ? (assetUrls[key] ?? null) : null
                }
                isEditorPreview
              />
            </div>
            <p className="mt-2 px-1 text-xs text-gray-500">
              Tampilan persis seperti yang dilihat customer di{' '}
              {publicSlug ? `${publicSlug}.vintra.my.id` : 'subdomain Anda nanti'}.
            </p>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AddSectionDialog
        open={addPickerOpen}
        onClose={() => setAddPickerOpen(false)}
        currentSections={settings.sections}
        onAdd={handleAddSection}
      />

      <PresetPickerDialog
        open={presetPickerOpen}
        onClose={() => setPresetPickerOpen(false)}
        currentPresetId={null}
        onPick={(id) => setPendingPresetId(id)}
      />

      <ConfirmDialog
        open={!!pendingPresetId}
        title="Ganti preset?"
        description="Ini akan menimpa draft saat ini. Yakin lanjut?"
        confirmText="Ya, ganti"
        onConfirm={() => {
          if (pendingPresetId) handleApplyPreset(pendingPresetId)
        }}
        onCancel={() => setPendingPresetId(null)}
      />
    </div>
  )
}

// ─── Theme card ──────────────────────────────────────────────────────

function ThemeCard({
  theme,
  assetUrls,
  onChange,
  onAssetUploaded,
}: {
  theme: SiteSettingsV2['theme']
  assetUrls: Record<string, string>
  onChange: (next: SiteSettingsV2['theme']) => void
  onAssetUploaded: (key: string, signedUrl: string) => void
}) {
  const { toast } = useToast()
  // Pass the current key as `replacesKey` so the server deletes the
  // previous logo object from S3 once the new one lands.
  const logoUploadMutation = useMutation({
    mutationFn: async (dataUrl: string) =>
      uploadSiteAsset({
        data: {
          kind: 'logo',
          dataUrl,
          replacesKey: theme.logoAssetKey ?? undefined,
        },
      }),
    onSuccess: (result, dataUrl) => {
      onAssetUploaded(result.key, dataUrl)
      onChange({ ...theme, logoAssetKey: result.key })
    },
    onError: (err: Error) => {
      toast({
        variant: 'error',
        title: 'Gagal upload logo.',
        description: err.message,
      })
    },
  })

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <Palette className="h-4 w-4" />
        Tema
      </h2>
      <p className="mt-0.5 text-xs text-gray-500">
        Warna utama, aksen, dan font yang dipakai di seluruh halaman.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Warna utama
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={theme.brandColor}
              onChange={(e) => onChange({ ...theme, brandColor: e.target.value })}
              className="h-10 w-14 cursor-pointer rounded-lg border border-gray-300 dark:border-gray-700"
            />
            <Input
              value={theme.brandColor}
              onChange={(e) => onChange({ ...theme, brandColor: e.target.value })}
              maxLength={7}
              className="font-mono"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Warna aksen
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={theme.accent}
              onChange={(e) => onChange({ ...theme, accent: e.target.value })}
              className="h-10 w-14 cursor-pointer rounded-lg border border-gray-300 dark:border-gray-700"
            />
            <Input
              value={theme.accent}
              onChange={(e) => onChange({ ...theme, accent: e.target.value })}
              maxLength={7}
              className="font-mono"
            />
          </div>
        </div>
        <div className="sm:col-span-2">
          <Select
            label="Font"
            value={theme.font}
            onChange={(e) =>
              onChange({ ...theme, font: e.target.value as SiteFont })
            }
            options={[
              { value: 'inter', label: 'Inter (modern, sans-serif)' },
              { value: 'poppins', label: 'Poppins (ramah, geometric)' },
              { value: 'lora', label: 'Lora (elegan, serif)' },
              { value: 'system', label: 'Default system' },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Logo usaha
          </label>
          <PhotoUploadField
            value={
              theme.logoAssetKey
                ? (assetUrls[theme.logoAssetKey] ?? null)
                : null
            }
            onChange={(next) => {
              if (next === null) {
                onChange({ ...theme, logoAssetKey: null })
                return
              }
              logoUploadMutation.mutate(next)
            }}
            disabled={logoUploadMutation.isPending}
          />
          <p className="text-[11px] text-gray-500">
            Dipakai sebagai penanda di Peta Lokasi. PNG transparan
            disarankan, maks 500KB. Ganti logo otomatis menghapus yang lama.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── SEO card ────────────────────────────────────────────────────────

// ─── Maintenance status card ─────────────────────────────────────────

function MaintenanceCard({
  initialEnabled,
  initialMessage,
}: {
  initialEnabled: boolean
  initialMessage: string | null
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  // Local mirror so the toggle feels instant; the mutation writes
  // through and the invalidation refreshes the loader on next nav.
  const [enabled, setEnabled] = useState(initialEnabled)
  const [message, setMessage] = useState(initialMessage ?? '')

  const mutation = useMutation({
    mutationFn: (next: { enabled: boolean; message: string | null }) =>
      setSiteMaintenanceMode({ data: next }),
    onSuccess: (_result, vars) => {
      toast({
        variant: 'success',
        title: vars.enabled
          ? 'Mode perbaikan diaktifkan.'
          : 'Mode perbaikan dimatikan.',
        description: vars.enabled
          ? 'Pengunjung akan melihat halaman "sedang dalam perbaikan".'
          : 'Halaman publik Anda kembali online.',
      })
      queryClient.invalidateQueries({ queryKey: ['site-settings'] })
    },
    onError: (err: Error) => {
      toast({
        variant: 'error',
        title: 'Gagal mengubah status.',
        description: err.message,
      })
    },
  })

  function commit(nextEnabled: boolean, nextMessage: string) {
    const trimmed = nextMessage.trim()
    mutation.mutate({
      enabled: nextEnabled,
      message: trimmed.length > 0 ? trimmed : null,
    })
  }

  return (
    <div
      className={cn(
        'rounded-2xl border p-5 transition',
        enabled
          ? 'border-warning-300 bg-warning-50 dark:border-warning-900/40 dark:bg-warning-950/20'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            enabled
              ? 'bg-warning-500 text-white'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
          )}
        >
          <Wrench className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Mode Perbaikan
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Sembunyikan halaman publik sementara — pengunjung melihat pesan
            "sedang diperbaiki" alih-alih situs Anda.
          </p>
        </div>
      </div>

      {/* Status pill + explicit on/off control. Replaces the ambiguous
          "Aktifkan" label that read as "go live" when it actually
          means "switch to offline mode". */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900/40">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-block h-2.5 w-2.5 rounded-full',
              enabled ? 'bg-warning-500' : 'bg-success-500',
            )}
          />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {enabled
                ? 'Situs sedang offline (mode perbaikan)'
                : 'Situs online — pengunjung melihat isi situs Anda'}
            </p>
          </div>
        </div>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-2">
          <span className="text-xs text-gray-500">
            {enabled ? 'Aktif' : 'Nonaktif'}
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked)
              commit(e.target.checked, message)
            }}
            disabled={mutation.isPending}
            className="h-4 w-4 rounded border-gray-300 text-warning-600 focus:ring-warning-500"
          />
        </label>
      </div>

      {enabled && (
        <div className="mt-4">
          <Textarea
            label="Pesan untuk pengunjung (opsional)"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onBlur={() => commit(true, message)}
            maxLength={500}
            placeholder="Halaman publik usaha kami sedang diperbarui. Silakan kembali sebentar lagi — terima kasih atas pengertiannya!"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Kosongkan untuk pakai pesan default. Maksimal 500 karakter.
            Tersimpan otomatis saat Anda klik di luar kotak.
          </p>
        </div>
      )}

      {/* Clarifier — explicit about the difference vs Publikasikan,
          because the toggle and the publish button are easy to
          confuse for first-time editors. */}
      <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-500 dark:bg-gray-900/40">
        <strong className="text-gray-700 dark:text-gray-300">Beda dengan "Publikasikan":</strong>{' '}
        tombol Publikasikan di atas mengupdate isi situs yang dilihat pengunjung.
        Mode Perbaikan menyembunyikan situs sementara tanpa menghapus konten —
        matikan untuk menampilkannya kembali.
      </p>
    </div>
  )
}

function SeoCard({
  seo,
  assetUrls,
  onChange,
  onAssetUploaded,
}: {
  seo: SiteSettingsV2['seo']
  assetUrls: Record<string, string>
  onChange: (next: SiteSettingsV2['seo']) => void
  onAssetUploaded: (key: string, signedUrl: string) => void
}) {
  const { toast } = useToast()
  const ogUploadMutation = useMutation({
    mutationFn: async (dataUrl: string) =>
      uploadSiteAsset({ data: { kind: 'og', dataUrl } }),
    onSuccess: (result, dataUrl) => {
      onAssetUploaded(result.key, dataUrl)
      onChange({ ...seo, ogImageAssetKey: result.key })
    },
    onError: (err: Error) => {
      toast({ variant: 'error', title: 'Gagal upload OG image.', description: err.message })
    },
  })

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        SEO &amp; Share
      </h2>
      <p className="mt-0.5 text-xs text-gray-500">
        Bagaimana halaman muncul di Google dan saat dibagikan di WhatsApp / IG.
      </p>
      <div className="mt-4 space-y-3">
        <Input
          label="Judul halaman (max 60)"
          value={seo.title}
          onChange={(e) => onChange({ ...seo, title: e.target.value })}
          maxLength={60}
        />
        <Textarea
          label="Deskripsi halaman (max 160)"
          rows={2}
          value={seo.description}
          onChange={(e) => onChange({ ...seo, description: e.target.value })}
          maxLength={160}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Gambar share (OG image)
          </label>
          <PhotoUploadField
            value={
              seo.ogImageAssetKey ? (assetUrls[seo.ogImageAssetKey] ?? null) : null
            }
            onChange={(next) => {
              if (next === null) {
                onChange({ ...seo, ogImageAssetKey: null })
                return
              }
              ogUploadMutation.mutate(next)
            }}
            disabled={ogUploadMutation.isPending}
          />
          <p className="text-[11px] text-gray-500">
            1200×630 piksel, max 500KB. Muncul saat URL dibagikan.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Section row + accordion ─────────────────────────────────────────

function SectionRow({
  instance,
  defName,
  defDescription,
  defIcon: _defIcon,
  isSystemManaged,
  expanded,
  canMoveUp,
  canMoveDown,
  fields,
  assetUrls,
  branches,
  onToggleExpand,
  onToggleEnabled,
  onMoveUp,
  onMoveDown,
  onDelete,
  onSettingsChange,
  onAssetUploaded,
}: {
  instance: SectionInstance
  defName: string
  defDescription: string
  defIcon: string
  isSystemManaged: boolean
  expanded: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  fields: V2FieldSchema[]
  assetUrls: Record<string, string>
  branches: Array<{ id: string; name: string }>
  onToggleExpand: () => void
  onToggleEnabled: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onSettingsChange: (s: Record<string, unknown>) => void
  onAssetUploaded: (key: string, signedUrl: string) => void
}) {
  return (
    <li className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2.5',
          instance.enabled
            ? 'bg-gray-50 dark:bg-gray-900/40'
            : 'bg-gray-100 opacity-60 dark:bg-gray-900/60',
        )}
      >
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="rounded p-0.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-gray-700"
            aria-label="Naikkan"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="rounded p-0.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-gray-700"
            aria-label="Turunkan"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {defName}
            {isSystemManaged && (
              <span className="ml-2 rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                Sistem
              </span>
            )}
          </p>
          <p className="truncate text-xs text-gray-500">{defDescription}</p>
        </div>
        {!isSystemManaged && (
          <label
            className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400"
            title={instance.enabled ? 'Tampilkan section ini' : 'Section tersembunyi'}
          >
            <input
              type="checkbox"
              checked={instance.enabled}
              onChange={onToggleEnabled}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Aktif
          </label>
        )}
        {!isSystemManaged && fields.length > 0 && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            aria-label={expanded ? 'Tutup pengaturan' : 'Buka pengaturan'}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}
        {!isSystemManaged && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
            aria-label="Hapus section"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {expanded && !isSystemManaged && (
        <div className="space-y-3 border-t border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          {fields.map((field) => (
            <V2FieldRenderer
              key={field.key}
              field={field}
              value={instance.settings[field.key]}
              sectionType={instance.type}
              assetUrls={assetUrls}
              branches={branches}
              onChange={(v) => onSettingsChange({ [field.key]: v })}
              onAssetUploaded={onAssetUploaded}
            />
          ))}
        </div>
      )}
    </li>
  )
}

// ─── Field renderer (v2) ─────────────────────────────────────────────

function V2FieldRenderer({
  field,
  value,
  sectionType,
  assetUrls,
  branches,
  onChange,
  onAssetUploaded,
}: {
  field: V2FieldSchema
  value: unknown
  sectionType: string
  assetUrls: Record<string, string>
  branches: Array<{ id: string; name: string }>
  onChange: (next: unknown) => void
  onAssetUploaded: (key: string, signedUrl: string) => void
}) {
  switch (field.type) {
    case 'text':
      return (
        <div className="flex flex-col gap-1">
          <Input
            label={field.label}
            placeholder={field.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            maxLength={field.maxLen}
          />
          {field.help && <p className="text-xs text-gray-500">{field.help}</p>}
        </div>
      )

    case 'url':
      return (
        <div className="flex flex-col gap-1">
          <Input
            label={field.label}
            placeholder={field.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            maxLength={2000}
          />
          {field.help && <p className="text-xs text-gray-500">{field.help}</p>}
        </div>
      )

    case 'textarea':
      return (
        <div className="flex flex-col gap-1">
          <Textarea
            label={field.label}
            rows={field.rows ?? 3}
            placeholder={field.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            maxLength={field.maxLen}
          />
          {field.help && <p className="text-xs text-gray-500">{field.help}</p>}
        </div>
      )

    case 'color':
      return (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {field.label}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={typeof value === 'string' ? value : (field.default ?? '#2547a4')}
              onChange={(e) => onChange(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-gray-300 dark:border-gray-700"
            />
            <Input
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(e.target.value)}
              maxLength={7}
              className="font-mono"
            />
          </div>
          {field.help && <p className="text-xs text-gray-500">{field.help}</p>}
        </div>
      )

    case 'select':
      return (
        <div className="flex flex-col gap-1">
          <Select
            label={field.label}
            value={typeof value === 'string' ? value : (field.default ?? '')}
            onChange={(e) => onChange(e.target.value)}
            options={field.options}
          />
          {field.help && <p className="text-xs text-gray-500">{field.help}</p>}
        </div>
      )

    case 'branchMultiSelect': {
      // Dynamic checkbox list built from the live branch list. Value is
      // an array of branch ids; empty = "all branches".
      const selectedIds = Array.isArray(value)
        ? (value.filter((v) => typeof v === 'string') as string[])
        : []
      const toggleBranch = (id: string) =>
        onChange(
          selectedIds.includes(id)
            ? selectedIds.filter((x) => x !== id)
            : [...selectedIds, id],
        )
      return (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {field.label}
          </label>
          <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-gray-900/40">
            {branches.length === 0 ? (
              <p className="text-xs text-gray-500">Belum ada cabang.</p>
            ) : (
              branches.map((b) => (
                <label
                  key={b.id}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(b.id)}
                    onChange={() => toggleBranch(b.id)}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-sm text-gray-900 dark:text-gray-100">
                    {b.name}
                  </span>
                </label>
              ))
            )}
          </div>
          {field.help && <p className="text-xs text-gray-500">{field.help}</p>}
        </div>
      )
    }

    case 'toggle':
      return (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900/40 dark:hover:bg-gray-900/60">
          <input
            type="checkbox"
            checked={typeof value === 'boolean' ? value : (field.default ?? false)}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {field.label}
            </p>
            {field.help && <p className="text-xs text-gray-500">{field.help}</p>}
          </div>
        </label>
      )

    case 'image':
      return (
        <V2ImageField
          field={field}
          value={typeof value === 'string' ? value : null}
          assetUrl={
            typeof value === 'string' ? (assetUrls[value] ?? null) : null
          }
          sectionType={sectionType}
          onChange={(v) => onChange(v)}
          onAssetUploaded={onAssetUploaded}
        />
      )

    case 'repeater':
      return (
        <V2RepeaterField
          field={field}
          value={Array.isArray(value) ? value : []}
          sectionType={sectionType}
          assetUrls={assetUrls}
          onChange={onChange}
          onAssetUploaded={onAssetUploaded}
        />
      )
  }
}

function V2ImageField({
  field,
  value,
  assetUrl,
  sectionType,
  onChange,
  onAssetUploaded,
}: {
  field: import('@/lib/site-templates/v2-types').V2ImageField
  value: string | null
  assetUrl: string | null
  sectionType: string
  onChange: (next: string | null) => void
  onAssetUploaded: (key: string, signedUrl: string) => void
}) {
  const { toast } = useToast()
  const uploadMutation = useMutation({
    mutationFn: async (dataUrl: string) => {
      const kind = getImageFieldUploadKindV2(sectionType, field.key)
      return uploadSiteAsset({ data: { kind, dataUrl } })
    },
    onSuccess: (result, dataUrl) => {
      onAssetUploaded(result.key, dataUrl)
      onChange(result.key)
    },
    onError: (err: Error) => {
      toast({ variant: 'error', title: 'Gagal upload gambar.', description: err.message })
    },
  })

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {field.label}
      </label>
      <PhotoUploadField
        value={assetUrl}
        onChange={(next) => {
          if (next === null) {
            onChange(null)
            return
          }
          uploadMutation.mutate(next)
        }}
        disabled={uploadMutation.isPending}
      />
      <p className="text-[11px] text-gray-500">
        {field.aspectHint ? `Rasio ${field.aspectHint}` : 'Ukuran fleksibel'}
        {field.maxKB ? ` · max ${field.maxKB} KB` : ''}
        {value && ' · tersimpan'}
      </p>
      {field.help && <p className="text-xs text-gray-500">{field.help}</p>}
    </div>
  )
}

function V2RepeaterField({
  field,
  value,
  sectionType,
  assetUrls,
  onChange,
  onAssetUploaded,
}: {
  field: import('@/lib/site-templates/v2-types').V2RepeaterField
  value: Array<Record<string, unknown>>
  sectionType: string
  assetUrls: Record<string, string>
  onChange: (next: unknown) => void
  onAssetUploaded: (key: string, signedUrl: string) => void
}) {
  function updateItem(idx: number, patch: Record<string, unknown>) {
    const next = value.map((item, i) =>
      i === idx ? { ...item, ...patch } : item,
    )
    onChange(next)
  }
  function addItem() {
    const blank: Record<string, unknown> = {}
    for (const sub of field.fields) {
      blank[sub.key] = sub.type === 'image' ? null : ''
    }
    onChange([...value, blank])
  }
  function removeItem(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }
  function moveItem(idx: number, delta: 1 | -1) {
    const target = idx + delta
    if (target < 0 || target >= value.length) return
    const next = [...value]
    const [moved] = next.splice(idx, 1)
    next.splice(target, 0, moved!)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {field.label}
      </label>
      <ul className="space-y-2">
        {value.map((item, idx) => (
          <li
            key={idx}
            className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                {field.itemLabel} #{idx + 1}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => moveItem(idx, -1)}
                  disabled={idx === 0}
                  className="rounded p-1 text-gray-400 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-700"
                  aria-label="Naikkan"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(idx, 1)}
                  disabled={idx === value.length - 1}
                  className="rounded p-1 text-gray-400 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-700"
                  aria-label="Turunkan"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                  aria-label="Hapus"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {field.fields.map((sub) => (
                <V2FieldRenderer
                  key={sub.key}
                  field={sub}
                  value={item[sub.key]}
                  sectionType={sectionType}
                  assetUrls={assetUrls}
                  // Repeater sub-fields are never `branchMultiSelect` —
                  // the V2RepeaterField type forbids it — so no list
                  // needed.
                  branches={[]}
                  onChange={(v) => updateItem(idx, { [sub.key]: v })}
                  onAssetUploaded={onAssetUploaded}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
      {(!field.max || value.length < field.max) && (
        <button
          type="button"
          onClick={addItem}
          className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 transition hover:border-brand-400 hover:text-brand-700 dark:border-gray-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Tambah {field.itemLabel}
        </button>
      )}
    </div>
  )
}

// ─── Add Section dialog ──────────────────────────────────────────────

function AddSectionDialog({
  open,
  onClose,
  currentSections,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  currentSections: SectionInstance[]
  onAdd: (type: string) => void
}) {
  const [query, setQuery] = useState('')

  const items = ADDABLE_SECTION_TYPES.map((type) => SECTIONS[type]).filter((d) => {
    if (!d) return false
    // Hide already-added singletons.
    if (!d.allowMultiple) {
      const exists = currentSections.some((s) => s.type === d.type)
      if (exists) return false
    }
    if (!query) return true
    const q = query.toLowerCase()
    return (
      d.name.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q)
    )
  })

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Tambah Section
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
          aria-label="Tutup"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-5 py-4">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari section…"
            className="pl-9"
          />
        </div>
        <ul className="max-h-96 space-y-2 overflow-y-auto">
          {items.map((def) =>
            def ? (
              <li key={def.type}>
                <button
                  type="button"
                  onClick={() => onAdd(def.type)}
                  className="flex w-full flex-col gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-brand-400 hover:bg-brand-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-brand-950/20"
                >
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {def.name}
                  </span>
                  <span className="text-xs text-gray-500">
                    {def.description}
                  </span>
                </button>
              </li>
            ) : null,
          )}
          {items.length === 0 && (
            <li className="rounded-lg bg-gray-50 px-3 py-6 text-center text-xs text-gray-500 dark:bg-gray-900/40">
              {query
                ? 'Section tidak ditemukan.'
                : 'Semua section sudah ditambahkan.'}
            </li>
          )}
        </ul>
      </div>
    </Dialog>
  )
}

// ─── Preset picker dialog ────────────────────────────────────────────

function PresetPickerDialog({
  open,
  onClose,
  currentPresetId,
  onPick,
}: {
  open: boolean
  onClose: () => void
  currentPresetId: string | null
  onPick: (id: string) => void
}) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Pilih Preset
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Preset adalah titik awal — semua section masih bisa Anda ubah setelah dipilih.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
          aria-label="Tutup"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
        {PRESET_ORDER.map((id) => {
          const preset = PRESETS[id]
          if (!preset) return null
          const isCurrent = id === currentPresetId
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              className={cn(
                'flex flex-col rounded-xl border-2 px-4 py-3 text-left transition',
                isCurrent
                  ? 'border-brand-500 bg-brand-50/40 dark:border-brand-500 dark:bg-brand-950/30'
                  : 'border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50/30 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-brand-950/20',
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {preset.name}
                </span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  {preset.category}
                </span>
              </div>
              <span className="mt-1 text-xs italic text-gray-500">
                {preset.vibe}
              </span>
              <span className="mt-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                {preset.description}
              </span>
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}

// ─── Publish history card ────────────────────────────────────────────

function PublishHistoryCard({
  onRestored,
}: {
  onRestored: (settings: unknown) => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: entries = [] } = useQuery({
    queryKey: ['site-publish-history'],
    queryFn: () => listSitePublishHistory(),
  })
  const restoreMutation = useMutation({
    mutationFn: (snapshotId: string) =>
      restoreSitePublishSnapshot({ data: { snapshotId } }),
    onSuccess: (result) => {
      onRestored(result.settings)
      toast({ variant: 'success', title: 'Versi dipulihkan ke draft.' })
      queryClient.invalidateQueries({ queryKey: ['site-settings'] })
    },
    onError: (err: Error) => {
      toast({ variant: 'error', title: 'Gagal memulihkan.', description: err.message })
    },
  })

  if (entries.length === 0) return null

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <History className="h-4 w-4 text-gray-500" />
        Riwayat Publikasi
      </h2>
      <p className="mt-0.5 text-xs text-gray-500">
        5 publikasi terakhir. Pulihkan ke draft jika perlu rollback.
      </p>
      <ul className="mt-3 space-y-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/40"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500">
                {new Date(entry.publishedAt).toLocaleString('id-ID', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Jakarta',
                })}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => restoreMutation.mutate(entry.id)}
              disabled={
                restoreMutation.isPending && restoreMutation.variables === entry.id
              }
              className="gap-1"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Pulihkan
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
