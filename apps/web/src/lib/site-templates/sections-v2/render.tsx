/**
 * Public renderer for v2 sites. Walks the section list in order,
 * renders each enabled section through its `SectionDef.Render`.
 *
 * Theme is injected into a CSS variable + applied as a body font
 * via Tailwind classes. Sections that need brand color read it from
 * the `theme` prop directly — no globals.
 */
import { SECTIONS } from './registry'
import type { PublicSiteRenderData, SiteSettingsV2 } from '../v2-types'

const FONT_CLASSES: Record<string, string> = {
  inter: 'font-sans',
  poppins: '[font-family:Poppins,system-ui,sans-serif]',
  lora: '[font-family:Lora,Georgia,serif]',
  system: 'font-sans',
}

export function PublicSiteRenderV2({
  settings,
  data,
  resolveAssetUrl,
  isEditorPreview = false,
}: {
  settings: SiteSettingsV2
  data: PublicSiteRenderData
  resolveAssetUrl: (key: string | null | undefined) => string | null
  /** Set to true by the editor's inline preview so sections can show
   *  authoring hints that don't ship to public visitors. */
  isEditorPreview?: boolean
}) {
  const fontClass = FONT_CLASSES[settings.theme.font] ?? FONT_CLASSES.inter

  return (
    <div
      className={`${fontClass} bg-white antialiased dark:bg-gray-900`}
      style={
        {
          '--site-brand': settings.theme.brandColor,
          '--site-accent': settings.theme.accent,
        } as React.CSSProperties
      }
    >
      {settings.sections
        .filter((s) => s.enabled)
        .map((inst) => {
          const def = SECTIONS[inst.type]
          if (!def) return null
          // Render as a JSX element (not a bare `def.Render(...)` call)
          // so each section gets its own fiber — sections that use
          // hooks (e.g. Services pagination state) need that isolation.
          const SectionRender = def.Render
          return (
            <SectionWrapper key={inst.id}>
              <SectionRender
                data={data}
                settings={inst.settings}
                theme={settings.theme}
                resolveAssetUrl={resolveAssetUrl}
                isEditorPreview={isEditorPreview}
              />
            </SectionWrapper>
          )
        })}
    </div>
  )
}

/**
 * Thin wrapper so every section gets a consistent DOM neighbor for
 * future scroll-snap / scroll-spy work. Currently a passthrough.
 */
function SectionWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
