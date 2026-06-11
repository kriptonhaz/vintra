/**
 * About — story/positioning block. Either text-only centered, or text-
 * with-image-side-by-side. Designed to feel editorial — generous
 * line-height, restrained max-width so paragraphs read smoothly.
 */
import type { SectionDef, SectionRenderProps } from '../v2-types'

function AboutRender({ settings, theme, resolveAssetUrl }: SectionRenderProps) {
  const heading = (settings.heading as string)?.trim() || 'Tentang Kami'
  const body = (settings.body as string)?.trim() ?? ''
  const layout = (settings.layout as string) ?? 'centered'
  const imageUrl = resolveAssetUrl(settings.imageAssetKey as string | null)

  if (!body) return null

  if (layout === 'side-by-side' && imageUrl) {
    return (
      <section className="bg-white py-12 sm:py-16 lg:py-20 dark:bg-gray-900">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 sm:gap-12 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
          <div className="order-2 lg:order-1">
            <div
              className="mb-3 inline-block h-1 w-12 rounded-full sm:mb-4"
              style={{ backgroundColor: theme.brandColor }}
            />
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl lg:text-4xl dark:text-gray-100">
              {heading}
            </h2>
            <div className="mt-4 space-y-4 text-sm leading-relaxed text-gray-600 whitespace-pre-line sm:mt-6 sm:text-base dark:text-gray-400">
              {body}
            </div>
          </div>
          <img
            src={imageUrl}
            alt={heading}
            loading="lazy"
            decoding="async"
            className="order-1 aspect-[4/3] w-full rounded-2xl object-cover shadow-lg sm:rounded-3xl lg:order-2"
          />
        </div>
      </section>
    )
  }

  return (
    <section className="bg-white py-12 sm:py-16 lg:py-20 dark:bg-gray-900">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <div
          className="mx-auto mb-3 h-1 w-12 rounded-full sm:mb-4"
          style={{ backgroundColor: theme.brandColor }}
        />
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl lg:text-4xl dark:text-gray-100">
          {heading}
        </h2>
        <div className="mt-4 space-y-4 text-sm leading-relaxed text-gray-600 whitespace-pre-line sm:mt-6 sm:text-base dark:text-gray-400">
          {body}
        </div>
      </div>
    </section>
  )
}

export const aboutSection: SectionDef = {
  type: 'about',
  name: 'Tentang',
  description: 'Cerita singkat tentang usaha, visi, atau differensiasi.',
  icon: 'BookOpen',
  defaultSettings: {
    layout: 'centered',
    heading: 'Tentang Kami',
    body: '',
    imageAssetKey: null,
  },
  fields: [
    {
      key: 'layout',
      type: 'select',
      label: 'Tampilan',
      options: [
        { value: 'centered', label: 'Teks di tengah' },
        { value: 'side-by-side', label: 'Teks + foto bersebelahan' },
      ],
      default: 'centered',
    },
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 60,
      default: 'Tentang Kami',
    },
    {
      key: 'body',
      type: 'textarea',
      label: 'Cerita',
      help: 'Maksimal 600 karakter. Pakai baris baru untuk pisah paragraf.',
      maxLen: 600,
      rows: 6,
    },
    {
      key: 'imageAssetKey',
      type: 'image',
      label: 'Foto pendamping',
      help: 'Hanya muncul jika tampilan "teks + foto" dipilih.',
      uploadKind: 'hero',
      aspectHint: '4:3',
      maxKB: 500,
    },
  ],
  Render: AboutRender,
}
