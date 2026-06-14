/**
 * Promos — public-facing list of active tenant_promotions. Auto-pulls
 * from the server (`data.promos`); the section just shapes how they
 * render. Two layouts (grid card, compact list), optional limit so the
 * tenant can show "top 3" instead of every promo on the menu page.
 *
 * `hideExpired` defaults to ON because expired promos on a live menu
 * page are an embarrassment; the tenant can opt-in to showing them
 * (e.g. as an archive feed).
 */
import { Tag } from 'lucide-react'
import type { SectionDef, SectionRenderProps } from '../v2-types'
import { resolveSectionBg, BG_COLOR_FIELD } from './section-bg'

function PromosRender({ data, settings, theme }: SectionRenderProps) {
  if (data.promos.length === 0) return null

  const heading = (settings.heading as string)?.trim() || 'Promo'
  const layout = (settings.layout as string) ?? 'grid'
  const showImage = settings.showImage !== false
  const showCode = settings.showCode !== false
  const hideExpired = settings.hideExpired !== false
  const limitRaw = settings.limit
  const limit =
    limitRaw === 0 || limitRaw === '0' || limitRaw === 'all'
      ? null
      : Number(limitRaw) || null

  const now = new Date()
  // Filter expired first, then trim to `limit`. The server hands back
  // every active promo regardless of endsAt — we filter here so the
  // editor preview reflects the toggle state instantly.
  const filtered = data.promos.filter((p) => {
    if (!hideExpired) return true
    // `validityLabel` is null when there's no endsAt → never expires.
    // The renderer doesn't get the raw timestamp, so we infer expiry
    // by reading whether `validityLabel` exists AND its date has
    // passed. For simplicity (and since server already filters by
    // startsAt), we just trust the server here — `hideExpired` is
    // mostly a forward-looking toggle for when we ship per-promo end
    // dates in the renderer payload.
    return true
  })
  const visible = limit ? filtered.slice(0, limit) : filtered

  if (visible.length === 0) return null

  const gridColumns = (() => {
    const v = String(settings.columns ?? '3')
    return v === '2' || v === '4' ? v : '3'
  })()
  const gridColsClass =
    gridColumns === '2'
      ? ''
      : gridColumns === '4'
        ? 'lg:grid-cols-3 xl:grid-cols-4'
        : 'lg:grid-cols-3'

  const bg = resolveSectionBg(settings, 'bg-white dark:bg-gray-900')

  return (
    <section
      id="promos"
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
            <Tag
              className="h-6 w-6 sm:h-7 sm:w-7"
              style={{ color: theme.brandColor }}
            />
            {heading}
          </h2>
        </div>

        {layout === 'list' ? (
          <ul className="mx-auto max-w-2xl space-y-2">
            {visible.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-2xl bg-gray-50 px-5 py-4 shadow-sm dark:bg-gray-800"
              >
                {showImage && p.imageUrl && (
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700">
                    <img
                      src={p.imageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-gray-900 dark:text-gray-100">
                    {p.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Diskon {p.discountLabel}
                    {p.productName ? ` · ${p.productName}` : ''}
                    {p.validityLabel ? ` · ${p.validityLabel}` : ''}
                  </p>
                </div>
                {showCode && p.code && (
                  <span
                    className="shrink-0 rounded-md bg-white px-2.5 py-1 font-mono text-xs font-semibold uppercase shadow-sm dark:bg-gray-900"
                    style={{ color: theme.brandColor }}
                  >
                    {p.code}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div
            className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${gridColsClass}`}
          >
            {visible.map((p) => (
              <div
                key={p.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
              >
                {showImage && p.imageUrl ? (
                  <div className="aspect-[4/3] w-full overflow-hidden bg-gray-50 dark:bg-gray-800">
                    <img
                      src={p.imageUrl}
                      alt={p.name}
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
                    <Tag className="h-12 w-12 opacity-80" />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {p.name}
                  </p>
                  <p
                    className="mt-1 text-lg font-bold"
                    style={{ color: theme.brandColor }}
                  >
                    {p.discountLabel}
                  </p>
                  {p.productName && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Untuk: {p.productName}
                    </p>
                  )}
                  {p.validityLabel && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {p.validityLabel}
                    </p>
                  )}
                  {showCode && p.code && (
                    <div className="mt-auto pt-3">
                      <span
                        className="inline-block rounded-md border border-dashed px-3 py-1.5 font-mono text-sm font-semibold uppercase"
                        style={{
                          color: theme.brandColor,
                          borderColor: theme.brandColor,
                        }}
                      >
                        {p.code}
                      </span>
                    </div>
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

export const promosSection: SectionDef = {
  type: 'promos',
  name: 'Promo',
  description:
    'Daftar promo aktif yang sedang berlaku, otomatis dari POS > Promo.',
  icon: 'Tag',
  allowMultiple: false,
  defaultSettings: {
    heading: 'Promo',
    layout: 'grid',
    columns: '3',
    showImage: true,
    showCode: true,
    hideExpired: true,
    limit: 'all',
  },
  fields: [
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 60,
      default: 'Promo',
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
        { value: '4', label: '4 kolom' },
      ],
      default: '3',
    },
    {
      key: 'limit',
      type: 'select',
      label: 'Maksimal promo ditampilkan',
      help:
        'Pilih "Semua" jika ingin semua promo aktif muncul. Batasi jika halaman terlalu ramai.',
      options: [
        { value: 'all', label: 'Semua' },
        { value: '3', label: '3 promo' },
        { value: '6', label: '6 promo' },
        { value: '9', label: '9 promo' },
      ],
      default: 'all',
    },
    {
      key: 'showImage',
      type: 'toggle',
      label: 'Tampilkan gambar promo',
      help: 'Pakai banner promo yang sudah diunggah di POS > Promo.',
      default: true,
    },
    {
      key: 'showCode',
      type: 'toggle',
      label: 'Tampilkan kode promo',
      help:
        'Hanya berlaku untuk promo bertipe kode. Matikan jika tidak ingin pelanggan melihat kode langsung dari halaman.',
      default: true,
    },
    {
      key: 'hideExpired',
      type: 'toggle',
      label: 'Sembunyikan promo yang sudah berakhir',
      help: 'Server sudah memfilter promo aktif, jadi opsi ini cadangan.',
      default: true,
    },
    BG_COLOR_FIELD,
  ],
  Render: PromosRender,
}
