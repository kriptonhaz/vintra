/**
 * Settings normalizer for v2.
 *
 * Three input shapes accepted:
 *   1. `null` / `{}` — no row yet → return blank settings
 *   2. v1 flat keys (`{ logoAssetKey, tagline, brandColor, ... }`) — convert
 *      to a default v2 shape using a "mini" preset, carry over shared keys
 *   3. v2 structured shape — pass through, just clamp + sanitize
 *
 * The output ALWAYS has a `footer` section as the last entry, even if
 * input didn't include one. Editor never lets the tenant remove or
 * reorder it.
 */
import { SECTIONS, buildBlankSettings } from './registry'
import type {
  SectionInstance,
  SiteFont,
  SiteSettingsV2,
  SiteTheme,
} from '../v2-types'

const VALID_FONTS: SiteFont[] = ['inter', 'poppins', 'lora', 'system']

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

// ─── Detect shape ────────────────────────────────────────────────────

function isV2Shape(raw: unknown): raw is Partial<SiteSettingsV2> {
  if (!raw || typeof raw !== 'object') return false
  const r = raw as Record<string, unknown>
  return Array.isArray(r.sections) || (typeof r.theme === 'object' && r.theme !== null)
}

// ─── V1 → V2 conversion ──────────────────────────────────────────────

/**
 * Carry-over heuristics for tenants migrating from v1 flat settings.
 * v1 keys we care about:
 *   - logoAssetKey, tagline, brandColor, aboutText
 *   - waNumber, waMessage, seoTitle, seoDescription, ogImageAssetKey
 *   - showQueue, showServices, showHours, showBranches
 *
 * We build a Mini-style section list pre-filled with whatever the
 * tenant already had. Result is functionally equivalent to v1 with
 * the new architecture underneath.
 */
function convertV1ToV2(v1: Record<string, unknown>): SiteSettingsV2 {
  const brand = isHexColor(v1.brandColor) ? (v1.brandColor as string) : '#2563EB'

  const theme: SiteTheme = {
    brandColor: brand,
    accent: `${brand}33`,
    font: 'inter',
    logoAssetKey:
      typeof v1.logoAssetKey === 'string' && v1.logoAssetKey.length > 0
        ? v1.logoAssetKey
        : null,
  }

  const sections: SectionInstance[] = []

  // Hero (always — we want the page to have a top section)
  sections.push({
    id: genId(),
    type: 'hero',
    enabled: true,
    settings: {
      layout: 'color-bg',
      heading: '',
      tagline: typeof v1.tagline === 'string' ? v1.tagline : '',
      ctaText: 'Hubungi Kami',
      ctaAction: 'whatsapp',
      waNumber: typeof v1.waNumber === 'string' ? v1.waNumber : '',
      waMessage: typeof v1.waMessage === 'string' ? v1.waMessage : '',
      heroImages: [],
      carouselAutoSlide: true,
      carouselDurationSec: 5,
      overlayDim: true,
    },
  })

  // About (only if v1 had body text)
  if (typeof v1.aboutText === 'string' && v1.aboutText.trim().length > 0) {
    sections.push({
      id: genId(),
      type: 'about',
      enabled: true,
      settings: {
        heading: 'Tentang Kami',
        body: v1.aboutText,
        layout: 'centered',
        imageAssetKey: null,
      },
    })
  }

  // Services, Hours, Branches (toggle-driven)
  if (v1.showServices !== false) {
    sections.push({
      id: genId(),
      type: 'services',
      enabled: true,
      settings: { layout: 'list', heading: 'Layanan & Harga', showDuration: true },
    })
  }

  if (v1.showQueue !== false) {
    sections.push({
      id: genId(),
      type: 'queue',
      enabled: true,
      settings: { heading: 'Antrian Sekarang' },
    })
  }

  if (v1.showHours !== false) {
    sections.push({
      id: genId(),
      type: 'hours',
      enabled: true,
      settings: { heading: 'Jam Operasional' },
    })
  }

  if (v1.showBranches === true) {
    sections.push({
      id: genId(),
      type: 'branches',
      enabled: true,
      settings: { heading: 'Lokasi Kami', showMapsLink: true },
    })
  }

  // Contact (only if v1 had a WA number)
  if (typeof v1.waNumber === 'string' && v1.waNumber.trim().length > 0) {
    sections.push({
      id: genId(),
      type: 'contact',
      enabled: true,
      settings: {
        heading: 'Hubungi Kami',
        tagline: '',
        waNumber: v1.waNumber,
        waMessage: typeof v1.waMessage === 'string' ? v1.waMessage : '',
        email: '',
        instagram: '',
        phone: '',
      },
    })
  }

  // Footer (always last)
  sections.push({
    id: genId(),
    type: 'footer',
    enabled: true,
    settings: {},
  })

  return {
    theme,
    sections,
    seo: {
      title: typeof v1.seoTitle === 'string' ? v1.seoTitle : '',
      description: typeof v1.seoDescription === 'string' ? v1.seoDescription : '',
      ogImageAssetKey:
        typeof v1.ogImageAssetKey === 'string' ? v1.ogImageAssetKey : null,
    },
  }
}

// ─── Per-field clamp (used after passthrough) ────────────────────────

function clampSectionSettings(
  type: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const def = SECTIONS[type]
  if (!def) return {}

  // Per-section pre-migration. Hero used to store a single image at
  // `heroImageAssetKey`; the carousel rebuild moved that to a repeater
  // named `heroImages`. If the input still has the old key and no new
  // array, promote it so the tenant's hero image survives the upgrade
  // (and gets re-saved in the new shape on the next draft save).
  if (type === 'hero') {
    const legacyKey = raw.heroImageAssetKey
    const newArr = raw.heroImages
    if (
      typeof legacyKey === 'string' &&
      legacyKey.length > 0 &&
      (!Array.isArray(newArr) || newArr.length === 0)
    ) {
      raw = { ...raw, heroImages: [{ imageAssetKey: legacyKey, alt: '' }] }
    }
  }

  const out: Record<string, unknown> = {}
  for (const field of def.fields) {
    const value = raw[field.key]
    switch (field.type) {
      case 'text':
      case 'textarea':
      case 'url': {
        const s = typeof value === 'string' ? value : (field.default ?? '')
        const maxLen = field.type === 'url' ? 2000 : (field.maxLen ?? 10_000)
        out[field.key] = s.length > maxLen ? s.slice(0, maxLen) : s
        break
      }
      case 'color': {
        const s = typeof value === 'string' ? value : (field.default ?? '#2563EB')
        out[field.key] = isHexColor(s) ? s : (field.default ?? '#2563EB')
        break
      }
      case 'image': {
        out[field.key] = typeof value === 'string' && value.length > 0 ? value : null
        break
      }
      case 'select': {
        const s = typeof value === 'string' ? value : (field.default ?? '')
        const valid = field.options.some((o) => o.value === s)
        out[field.key] = valid ? s : (field.default ?? field.options[0]?.value ?? '')
        break
      }
      case 'branchMultiSelect': {
        // Array of branch UUIDs; `[]` means "all branches". We can't
        // validate ids against the live branch list here (normalizer
        // has no DB access) — stale ids are dropped by the renderer.
        out[field.key] = Array.isArray(value)
          ? value.filter((v): v is string => typeof v === 'string')
          : []
        break
      }
      case 'toggle': {
        out[field.key] = typeof value === 'boolean' ? value : (field.default ?? false)
        break
      }
      case 'repeater': {
        const arr = Array.isArray(value) ? value : []
        const max = field.max ?? 50
        const subOut = arr.slice(0, max).map((item) => {
          const itm = (item ?? {}) as Record<string, unknown>
          const sub: Record<string, unknown> = {}
          for (const subField of field.fields) {
            const v = itm[subField.key]
            switch (subField.type) {
              case 'text':
              case 'textarea':
              case 'url':
                sub[subField.key] = typeof v === 'string' ? v : ''
                break
              case 'image':
                sub[subField.key] = typeof v === 'string' && v.length > 0 ? v : null
                break
            }
          }
          return sub
        })
        out[field.key] = subOut
        break
      }
    }
  }
  return out
}

// ─── Top-level normalize ─────────────────────────────────────────────

export function normalizeSettingsV2(raw: unknown): SiteSettingsV2 {
  // Empty / null → blank shape.
  if (!raw || (typeof raw === 'object' && Object.keys(raw).length === 0)) {
    return buildBlankSettings(genId)
  }

  // V1 flat-key shape → convert.
  if (!isV2Shape(raw)) {
    return convertV1ToV2(raw as Record<string, unknown>)
  }

  // V2 shape — clamp and ensure invariants.
  const r = raw as Partial<SiteSettingsV2>
  const theme: SiteTheme = {
    brandColor: isHexColor(r.theme?.brandColor) ? r.theme!.brandColor : '#2563EB',
    accent: isHexColor(r.theme?.accent) ? r.theme!.accent : '#DBEAFE',
    font:
      r.theme?.font && VALID_FONTS.includes(r.theme.font as SiteFont)
        ? (r.theme.font as SiteFont)
        : 'inter',
    logoAssetKey:
      typeof r.theme?.logoAssetKey === 'string' && r.theme.logoAssetKey.length > 0
        ? r.theme.logoAssetKey
        : null,
  }

  const inputSections = Array.isArray(r.sections) ? r.sections : []
  const sections: SectionInstance[] = []
  let hasFooter = false

  for (const inst of inputSections) {
    if (!inst || typeof inst !== 'object') continue
    const i = inst as Partial<SectionInstance>
    if (typeof i.type !== 'string') continue
    if (!SECTIONS[i.type]) continue // drop unknown types
    if (i.type === 'footer') hasFooter = true
    sections.push({
      id: typeof i.id === 'string' && i.id.length > 0 ? i.id : genId(),
      type: i.type,
      enabled: i.enabled !== false,
      settings: clampSectionSettings(i.type, (i.settings ?? {}) as Record<string, unknown>),
    })
  }

  // Invariant: footer is always last, always exists.
  if (!hasFooter) {
    sections.push({
      id: genId(),
      type: 'footer',
      enabled: true,
      settings: {},
    })
  } else {
    // Move existing footer to the end if it's not already there.
    const footerIdx = sections.findIndex((s) => s.type === 'footer')
    if (footerIdx !== -1 && footerIdx !== sections.length - 1) {
      const [footer] = sections.splice(footerIdx, 1)
      sections.push(footer!)
    }
  }

  const seo = (r.seo ?? {}) as Partial<SiteSettingsV2['seo']>
  return {
    theme,
    sections,
    seo: {
      title: typeof seo.title === 'string' ? seo.title.slice(0, 80) : '',
      description: typeof seo.description === 'string' ? seo.description.slice(0, 200) : '',
      ogImageAssetKey:
        typeof seo.ogImageAssetKey === 'string' && seo.ogImageAssetKey.length > 0
          ? seo.ogImageAssetKey
          : null,
    },
  }
}
