/**
 * Gallery — image grid for photo galleries (interior shots, food
 * photography, before/after, etc.). Uses the repeater field to let
 * tenants add multiple images. Each image is its own S3 upload tagged
 * `kind=tenant-site` → `kind=gallery`.
 */
import { ImageIcon } from 'lucide-react'
import type { SectionDef, SectionRenderProps } from '../v2-types'
import { resolveSectionBg, BG_COLOR_FIELD } from './section-bg'

function GalleryRender({ settings, theme, resolveAssetUrl }: SectionRenderProps) {
  const heading = (settings.heading as string)?.trim() || 'Galeri'
  const images = (settings.images as Array<{ imageAssetKey?: string; caption?: string }>) ?? []
  const columns = (settings.columns as string) ?? '3'

  const resolved = images
    .map((img) => ({
      url: resolveAssetUrl(img.imageAssetKey ?? null),
      caption: img.caption ?? '',
    }))
    .filter((img) => !!img.url)

  if (resolved.length === 0) return null

  const colClass =
    columns === '4'
      ? 'sm:grid-cols-3 lg:grid-cols-4'
      : columns === '2'
        ? 'sm:grid-cols-2'
        : 'sm:grid-cols-2 lg:grid-cols-3'

  const bg = resolveSectionBg(settings, 'bg-white dark:bg-gray-900')

  return (
    <section
      className={`py-12 sm:py-16 lg:py-20 ${bg.className}`}
      style={bg.style}
      data-section-surface={bg.surface}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 text-center sm:mb-10">
          <div
            className="mx-auto mb-3 h-1 w-12 rounded-full sm:mb-4"
            style={{ backgroundColor: theme.brandColor }}
          />
          <h2 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight text-gray-900 sm:gap-3 sm:text-3xl lg:text-4xl dark:text-gray-100">
            <ImageIcon className="h-6 w-6 sm:h-7 sm:w-7" style={{ color: theme.brandColor }} />
            {heading}
          </h2>
        </div>
        {/* 2-col on phones (single col looks lonely with food photos),
            larger col counts at sm+. colClass already encodes sm/lg. */}
        <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${colClass}`}>
          {resolved.map((img, i) => (
            <figure
              key={i}
              className="group relative overflow-hidden rounded-2xl shadow-sm transition hover:shadow-lg"
            >
              <img
                src={img.url ?? ''}
                alt={img.caption || `${heading} ${i + 1}`}
                className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-105"
                loading="lazy"
                decoding="async"
              />
              {img.caption && (
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-sm font-medium text-white">
                  {img.caption}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}

export const gallerySection: SectionDef = {
  type: 'gallery',
  name: 'Galeri Foto',
  description: 'Grid foto untuk suasana, menu, atau before/after.',
  icon: 'Image',
  allowMultiple: true,
  defaultSettings: {
    heading: 'Galeri',
    columns: '3',
    images: [],
  },
  fields: [
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 60,
      default: 'Galeri',
    },
    {
      key: 'columns',
      type: 'select',
      label: 'Jumlah kolom (desktop)',
      options: [
        { value: '2', label: '2 kolom' },
        { value: '3', label: '3 kolom' },
        { value: '4', label: '4 kolom' },
      ],
      default: '3',
    },
    {
      key: 'images',
      type: 'repeater',
      label: 'Foto',
      itemLabel: 'Foto',
      max: 24,
      fields: [
        {
          key: 'imageAssetKey',
          type: 'image',
          label: 'Foto',
          uploadKind: 'gallery',
          aspectHint: '4:3',
          maxEdge: 1600,
          maxKB: 1000,
        },
        {
          key: 'caption',
          type: 'text',
          label: 'Caption (opsional)',
          maxLen: 80,
        },
      ],
    },
    BG_COLOR_FIELD,
  ],
  Render: GalleryRender,
}
