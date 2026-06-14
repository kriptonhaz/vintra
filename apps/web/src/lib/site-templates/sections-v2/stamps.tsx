/**
 * Stamps — public-facing list of active loyalty stamp programs.
 * Auto-pulls from the server (`data.stampPrograms`). Pre-built
 * `rewardLabel` covers both single rewards ("Cuci Motor") and bundle
 * rewards ("1× Teh Original + 1× Candy") so the renderer stays simple.
 *
 * Two layouts:
 *   - 'grid': big card with optional image; best when programs have
 *     custom banners.
 *   - 'list': compact row; best for tenants with many programs.
 *
 * Customer progress is intentionally not shown here — the public page
 * is anonymous (no login). Cashiers see live progress in /pos/cashier.
 */
import { Stamp } from 'lucide-react'
import type { SectionDef, SectionRenderProps } from '../v2-types'
import { resolveSectionBg, BG_COLOR_FIELD } from './section-bg'

function StampsRender({ data, settings, theme }: SectionRenderProps) {
  if (data.stampPrograms.length === 0) return null

  const heading = (settings.heading as string)?.trim() || 'Program Stempel'
  const subheading = (settings.subheading as string)?.trim() ?? ''
  const layout = (settings.layout as string) ?? 'grid'
  const showImage = settings.showImage !== false
  const showReward = settings.showReward !== false

  const gridColumns = (() => {
    const v = String(settings.columns ?? '3')
    return v === '2' || v === '3' ? v : '3'
  })()
  const gridColsClass =
    gridColumns === '2' ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'

  const bg = resolveSectionBg(settings, 'bg-gray-50 dark:bg-gray-950')

  return (
    <section
      id="stamps"
      className={`py-12 sm:py-16 lg:py-20 ${bg.className}`}
      style={bg.style}
      data-section-surface={bg.surface}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 text-center sm:mb-10">
          <div
            className="mx-auto mb-3 h-1 w-12 rounded-full sm:mb-4"
            style={{ backgroundColor: theme.brandColor }}
          />
          <h2 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight text-gray-900 sm:gap-3 sm:text-3xl lg:text-4xl dark:text-gray-100">
            <Stamp
              className="h-6 w-6 sm:h-7 sm:w-7"
              style={{ color: theme.brandColor }}
            />
            {heading}
          </h2>
          {subheading && (
            <p className="mx-auto mt-3 max-w-2xl text-sm text-gray-600 sm:text-base dark:text-gray-400">
              {subheading}
            </p>
          )}
        </div>

        {layout === 'list' ? (
          <ul className="mx-auto max-w-2xl space-y-2">
            {data.stampPrograms.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm dark:bg-gray-900"
              >
                {showImage && s.imageUrl ? (
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                    <img
                      src={s.imageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${theme.brandColor}22` }}
                  >
                    <Stamp
                      className="h-6 w-6"
                      style={{ color: theme.brandColor }}
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-gray-900 dark:text-gray-100">
                    {s.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Beli {s.stampsRequired}x
                    {showReward ? ` → gratis ${s.rewardLabel}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className={`grid grid-cols-1 gap-4 ${gridColsClass}`}>
            {data.stampPrograms.map((s) => (
              <div
                key={s.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
              >
                {showImage && s.imageUrl ? (
                  <div className="aspect-[4/3] w-full overflow-hidden bg-gray-50 dark:bg-gray-800">
                    <img
                      src={s.imageUrl}
                      alt={s.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div
                    className="flex aspect-[4/3] w-full items-center justify-center text-white"
                    style={{
                      backgroundImage: `linear-gradient(135deg, ${theme.brandColor} 0%, ${theme.brandColor}cc 100%)`,
                    }}
                  >
                    <div className="text-center">
                      <Stamp className="mx-auto h-12 w-12 opacity-80" />
                      <p className="mt-2 text-3xl font-bold tracking-tight">
                        {s.stampsRequired}×
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {s.name}
                  </p>
                  <p
                    className="mt-1 text-sm font-bold"
                    style={{ color: theme.brandColor }}
                  >
                    Beli {s.stampsRequired}× gratis 1
                  </p>
                  {showReward && (
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      Hadiah: {s.rewardLabel}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export const stampsSection: SectionDef = {
  type: 'stamps',
  name: 'Program Stempel',
  description:
    'Daftar program stempel (kartu loyalty) yang sedang aktif, otomatis dari POS > Loyalty.',
  icon: 'Stamp',
  allowMultiple: false,
  defaultSettings: {
    heading: 'Program Stempel',
    subheading: '',
    layout: 'grid',
    columns: '3',
    showImage: true,
    showReward: true,
  },
  fields: [
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 60,
      default: 'Program Stempel',
    },
    {
      key: 'subheading',
      type: 'textarea',
      label: 'Sub-judul (opsional)',
      help: 'Penjelasan singkat di bawah judul.',
      maxLen: 160,
      rows: 2,
    },
    {
      key: 'layout',
      type: 'select',
      label: 'Tampilan',
      options: [
        { value: 'grid', label: 'Kartu (grid)' },
        { value: 'list', label: 'Daftar ringkas' },
      ],
      default: 'grid',
    },
    {
      key: 'columns',
      type: 'select',
      label: 'Jumlah kolom (desktop)',
      help: 'Hanya untuk tampilan "Kartu". Mobile selalu 1 kolom.',
      options: [
        { value: '2', label: '2 kolom' },
        { value: '3', label: '3 kolom (default)' },
      ],
      default: '3',
    },
    {
      key: 'showImage',
      type: 'toggle',
      label: 'Tampilkan gambar program',
      help:
        'Pakai gambar yang sudah diunggah di POS > Loyalty. Jika tidak ada, kartu pakai warna brand sebagai latar.',
      default: true,
    },
    {
      key: 'showReward',
      type: 'toggle',
      label: 'Tampilkan detail hadiah',
      help: 'Misal "1× Teh Original + 1× Candy" untuk bundle, atau nama produk untuk single.',
      default: true,
    },
    BG_COLOR_FIELD,
  ],
  Render: StampsRender,
}
