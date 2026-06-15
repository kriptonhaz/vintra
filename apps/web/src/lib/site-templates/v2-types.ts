/**
 * JUR-176 v2: section-builder architecture.
 *
 * Replaces the flat-key template model from v1. Each tenant's site is
 * now an ordered list of *section instances*, each typed by a key in
 * the section registry. Tenants enable/disable, reorder, and edit
 * each section's settings independently.
 *
 * Settings shape:
 *   {
 *     theme: { brandColor, accent, font },
 *     sections: [{ id, type, enabled, settings: { ... } }, ...],
 *     seo:   { title, description, ogImageAssetKey }
 *   }
 *
 * Templates aren't a thing anymore — they were "fixed layouts with
 * a few editable fields". v2 ships starter *presets*: initial
 * `{ theme, sections }` snapshots a tenant picks once. After picking,
 * everything is editable. Picking a different preset replaces the
 * draft (or merges, depending on what the editor offers).
 *
 * Old v1 settings (flat keys) are read-compatible — the normalizer
 * detects shape and converts on the fly. We never migrate the
 * underlying rows; the next save just writes the v2 shape.
 */
import type { ReactNode } from 'react'

// ─── Theme + meta ────────────────────────────────────────────────────

export type SiteFont = 'inter' | 'poppins' | 'lora' | 'system'

export type SiteTheme = {
  brandColor: string
  /** Secondary accent for chip backgrounds, hover states. */
  accent: string
  /** Font family for headings + body. Loaded by the public layout. */
  font: SiteFont
  /**
   * Optional business logo (S3 asset key). Site-wide branding —
   * currently consumed by the Maps section as the marker icon, and
   * available to any section via the `theme` prop. `null` / absent
   * means no logo uploaded.
   */
  logoAssetKey?: string | null
}

export type SiteSeo = {
  title: string
  description: string
  ogImageAssetKey: string | null
}

// ─── Field schema (reused conceptually from v1, slimmed down) ────────

type BaseField = {
  key: string
  label: string
  help?: string
}

export type V2TextField = BaseField & {
  type: 'text'
  maxLen?: number
  placeholder?: string
  default?: string
}

export type V2TextAreaField = BaseField & {
  type: 'textarea'
  maxLen?: number
  rows?: number
  placeholder?: string
  default?: string
}

export type V2ColorField = BaseField & {
  type: 'color'
  default?: string
}

export type V2ImageField = BaseField & {
  type: 'image'
  maxKB?: number
  aspectHint?: string
  uploadKind?: 'logo' | 'hero' | 'gallery' | 'og'
  /**
   * Longest-edge cap for client-side resize (px). Banners/hero images
   * want a large value (~1920) to stay sharp at full width; small
   * thumbnails can stay low. Defaults applied in the renderer.
   */
  maxEdge?: number
}

export type V2SelectField = BaseField & {
  type: 'select'
  options: Array<{ value: string; label: string }>
  default?: string
}

/**
 * Checkbox list of the tenant's branches. Options are NOT static — the
 * editor injects them from the live branch list. The stored value is
 * an array of branch UUIDs; an empty array means "all branches". The
 * normalizer defaults it to `[]`, so no `default` field here.
 */
export type V2BranchMultiSelectField = BaseField & {
  type: 'branchMultiSelect'
}

export type V2ToggleField = BaseField & {
  type: 'toggle'
  default?: boolean
}

export type V2UrlField = BaseField & {
  type: 'url'
  placeholder?: string
  default?: string
}

/**
 * Repeatable group of fields — useful for gallery images, FAQ items,
 * social links. Editor renders this as a list with add/remove buttons.
 */
export type V2RepeaterField = BaseField & {
  type: 'repeater'
  itemLabel: string
  max?: number
  /** Sub-fields rendered per item. Cannot be repeaters themselves. */
  fields: Array<V2TextField | V2TextAreaField | V2ImageField | V2UrlField>
}

export type V2FieldSchema =
  | V2TextField
  | V2TextAreaField
  | V2ColorField
  | V2ImageField
  | V2SelectField
  | V2BranchMultiSelectField
  | V2ToggleField
  | V2UrlField
  | V2RepeaterField

// ─── Section definition ──────────────────────────────────────────────

export type SectionSettings = Record<string, unknown>

export type SectionInstance = {
  /** Stable identifier — UUID. Reordering doesn't change this. */
  id: string
  /** Section type key — must match an entry in the registry. */
  type: string
  /** Visibility toggle. Disabled sections still persist; they just
   *  don't render on the public page. */
  enabled: boolean
  settings: SectionSettings
}

export type SectionRenderProps = {
  /** Tenant-level info (business name + branches + services + queue) */
  data: PublicSiteRenderData
  /** This section instance's settings */
  settings: SectionSettings
  /** Theme passed down so every section can use brand color consistently */
  theme: SiteTheme
  /** Asset key → signed URL resolver */
  resolveAssetUrl: (key: string | null | undefined) => string | null
  /**
   * True when rendered inside the editor's preview pane. Lets sections
   * surface authoring hints (e.g. "no resources configured — add some
   * in /booking/settings") that should NOT appear on the live public
   * site. Default false on the public renderer.
   */
  isEditorPreview?: boolean
}

export type SectionDef = {
  /** Type key (e.g. 'hero', 'services'). Used in section.type. */
  type: string
  /** UI label in the editor + Add Section picker. */
  name: string
  /** Indonesian one-liner for the Add Section picker. */
  description: string
  /** Lucide icon name — picked up by the editor via dynamic import shim. */
  icon: string
  /** Default settings shape for a freshly-added instance. */
  defaultSettings: SectionSettings
  /** Field schema — drives the editor's form. */
  fields: V2FieldSchema[]
  /** Whether the tenant can add multiple of this type. Defaults true. */
  allowMultiple?: boolean
  /** If true, this section is hidden from the Add picker (auto-managed). */
  systemManaged?: boolean
  /** React renderer for the public page. */
  Render: (props: SectionRenderProps) => ReactNode
}

// ─── Tenant data passed to every section renderer ────────────────────

export type PublicSiteRenderData = {
  tenant: { businessName: string; publicSlug: string | null }
  mode: 'slot' | 'queue' | 'stay' | null
  branches: Array<{
    id: string
    name: string
    address: string | null
    businessHours: Array<{ day: number; open: string; close: string }> | null
    isMain: boolean
    /** Geo coordinates — used by the Maps section to drop a pin per
     *  branch. Stored on every branch (attendance geofencing needs
     *  them); a `0,0` pair means "not set" and is skipped. */
    latitude: number
    longitude: number
  }>
  services: Array<{
    id: string
    name: string
    color: string | null
    /** Booking duration in minutes. Only meaningful when `isBookable`. */
    durationMin: number
    price: string
    /** True for inventory items flagged `is_bookable=true`. The Services
     *  section uses this to decide whether to display the duration badge
     *  — POS-only items (instant noodles) get no minute label. */
    isBookable: boolean
    /** Category name from `tenant_categories`, or `null` when the item
     *  has no category assigned. The Services section uses this to
     *  group items under headings when `groupByCategory` is enabled. */
    category: string | null
    /** Pre-signed URL to the item's catalog photo, or `null` when the
     *  item has no photo. The Services section renders this only when
     *  the `showImage` toggle is on. */
    imageUrl: string | null
  }>
  resources: Array<{
    id: string
    name: string
    kind: string
    isPaused: boolean
  }>
  queue: Array<{
    resourceId: string | null
    ticketNumber: string | null
    firstName: string | null
    status: string
  }>
  /**
   * Tenant tax stack summary. Aggregated from `pos_settings.taxes` —
   * sum of every active tax row's percent. When > 0, the Services
   * section adds a "harga belum termasuk pajak" footnote. We expose
   * the label list too so the footnote can say "+ PPN 11% + PB1 10%"
   * for tenants with stacked taxes.
   */
  tax: {
    totalPercent: number
    labels: string[]
  }
  /**
   * Active tenant promotions — drives the Promo section. Pre-resolved
   * on the server so the renderer doesn't need a second round trip
   * for image URLs or product names.
   */
  promos: Array<{
    id: string
    name: string
    /** Redemption code for triggerType='code'; null for auto promos. */
    code: string | null
    triggerType:
      | 'code'
      | 'auto_product'
      | 'auto_products'
      | 'auto_category'
      | 'auto_cart'
    /** "20%" / "Rp 25.000" — pre-formatted on the server. */
    discountLabel: string
    /** "Berlaku s/d 31 Mei 2026" or null when no end date. */
    validityLabel: string | null
    /** For auto_product promos — name of the product the promo targets. */
    productName: string | null
    /** Pre-signed URL to the promo's banner image, or null. */
    imageUrl: string | null
  }>
  /**
   * Active stamp / punch-card programs — drives the Stamp section.
   * `rewardLabel` is pre-built ("1× Cuci Motor" or "1× Teh Original + 1× Candy")
   * so the renderer doesn't have to discriminate on rewardMode.
   */
  stampPrograms: Array<{
    id: string
    name: string
    stampsRequired: number
    rewardLabel: string
    imageUrl: string | null
  }>
}

// ─── Top-level site settings (v2) ────────────────────────────────────

export type SiteSettingsV2 = {
  theme: SiteTheme
  sections: SectionInstance[]
  seo: SiteSeo
}

// ─── Preset ──────────────────────────────────────────────────────────

export type SitePreset = {
  id: string
  name: string
  category: string
  description: string
  /** Brief tagline shown in the picker — distinct from `description`
   *  so we can preview "vibe" in 5 words. */
  vibe: string
  /** Default site state when a tenant picks this preset. Section
   *  instances get fresh UUIDs at apply-time so the same preset can
   *  be applied multiple times without ID collisions. */
  build: () => SiteSettingsV2
}
