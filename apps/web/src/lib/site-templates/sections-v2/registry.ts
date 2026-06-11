/**
 * Section registry — central lookup keyed by section type.
 *
 * Adding a section type:
 *   1. Write the SectionDef + Render in `<type>.tsx`
 *   2. Import + add to `SECTIONS` here
 *   3. (Optional) Add to a preset in `presets.ts` so tenants get it
 *      by default when they pick that preset
 *
 * Order in `ADDABLE_SECTION_TYPES` drives the "+ Tambah Section"
 * picker — keep it user-facing, not alphabetical. System-managed
 * sections (footer) are excluded; they're added/maintained by the
 * normalizer, never by the editor.
 */
import type {
  SectionDef,
  SectionInstance,
  SectionSettings,
  SiteSettingsV2,
  SiteTheme,
} from '../v2-types'

import { heroSection } from './hero'
import { aboutSection } from './about'
import { servicesSection } from './services'
import { queueSection } from './queue'
import { branchesSection } from './branches'
import { hoursSection } from './hours'
import { mapsSection } from './maps'
import { gallerySection } from './gallery'
import { promosSection } from './promos'
import { stampsSection } from './stamps'
import { contactSection } from './contact'
import { ctaBannerSection } from './cta-banner'
import { footerSection } from './footer'

export const SECTIONS: Record<string, SectionDef> = {
  [heroSection.type]: heroSection,
  [aboutSection.type]: aboutSection,
  [servicesSection.type]: servicesSection,
  [queueSection.type]: queueSection,
  [branchesSection.type]: branchesSection,
  [hoursSection.type]: hoursSection,
  [mapsSection.type]: mapsSection,
  [gallerySection.type]: gallerySection,
  [promosSection.type]: promosSection,
  [stampsSection.type]: stampsSection,
  [contactSection.type]: contactSection,
  [ctaBannerSection.type]: ctaBannerSection,
  [footerSection.type]: footerSection,
}

/**
 * Types the tenant can add from the picker. Order shown in the UI.
 * System-managed sections (footer) are kept out — they're not user-
 * addable, the normalizer ensures they exist.
 */
export const ADDABLE_SECTION_TYPES: string[] = [
  heroSection.type,
  aboutSection.type,
  servicesSection.type,
  promosSection.type,
  stampsSection.type,
  queueSection.type,
  gallerySection.type,
  branchesSection.type,
  hoursSection.type,
  mapsSection.type,
  ctaBannerSection.type,
  contactSection.type,
]

export function getSection(type: string): SectionDef | null {
  return SECTIONS[type] ?? null
}

// ─── Defaults ────────────────────────────────────────────────────────

export const DEFAULT_THEME: SiteTheme = {
  brandColor: '#2563EB',
  accent: '#DBEAFE',
  font: 'inter',
}

/**
 * Builds an instance with the section's default settings. Caller is
 * responsible for assigning a UUID — the registry doesn't know about
 * runtime concerns like uniqueness.
 */
export function buildSectionInstance(type: string, id: string): SectionInstance | null {
  const def = SECTIONS[type]
  if (!def) return null
  return {
    id,
    type,
    enabled: true,
    settings: { ...def.defaultSettings },
  }
}

// ─── Asset key collection ────────────────────────────────────────────

/**
 * Walks every section's settings looking for image keys, including
 * repeater sub-items. Used by the SSR signing path so the renderer
 * gets a complete `{ key → signedUrl }` map without each section
 * having to know about S3.
 */
export function collectImageKeysV2(settings: SiteSettingsV2): string[] {
  const out: string[] = []

  const pushIfString = (v: unknown) => {
    if (typeof v === 'string' && v.length > 0) out.push(v)
  }

  // Top-level SEO og image + theme logo.
  pushIfString(settings.seo?.ogImageAssetKey)
  pushIfString(settings.theme?.logoAssetKey)

  for (const inst of settings.sections) {
    const def = SECTIONS[inst.type]
    if (!def) continue
    for (const field of def.fields) {
      if (field.type === 'image') {
        pushIfString(inst.settings[field.key])
      } else if (field.type === 'repeater') {
        const items = inst.settings[field.key]
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item && typeof item === 'object') {
              for (const subField of field.fields) {
                if (subField.type === 'image') {
                  pushIfString((item as Record<string, unknown>)[subField.key])
                }
              }
            }
          }
        }
      }
    }
  }

  return out
}

// ─── Lookup helpers ──────────────────────────────────────────────────

/**
 * For a given section instance + field key, return the upload kind
 * the field declares. Drives S3 tagging when the editor calls the
 * upload server fn.
 */
export function getImageFieldUploadKindV2(
  sectionType: string,
  fieldKey: string,
): 'logo' | 'hero' | 'gallery' | 'og' {
  const def = SECTIONS[sectionType]
  if (!def) return 'hero'
  for (const field of def.fields) {
    if (field.type === 'image' && field.key === fieldKey) {
      return field.uploadKind ?? 'hero'
    }
    if (field.type === 'repeater') {
      for (const subField of field.fields) {
        if (subField.type === 'image' && subField.key === fieldKey) {
          return subField.uploadKind ?? 'hero'
        }
      }
    }
  }
  return 'hero'
}

/**
 * Default theme + a single hero + footer — enough to render *something*
 * for a tenant that has nothing else set. Used as the safety floor in
 * `normalizeSettingsV2` and when a tenant first opens the editor.
 */
export function buildBlankSettings(idGen: () => string): SiteSettingsV2 {
  return {
    theme: { ...DEFAULT_THEME },
    sections: [
      {
        id: idGen(),
        type: 'hero',
        enabled: true,
        settings: { ...heroSection.defaultSettings },
      },
      {
        id: idGen(),
        type: 'footer',
        enabled: true,
        settings: {},
      },
    ],
    seo: {
      title: '',
      description: '',
      ogImageAssetKey: null,
    },
  }
}

// Re-export for callers that import them via the section directory.
export { gallerySection } from './gallery'
