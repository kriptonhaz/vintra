/**
 * Branches — card list of every active branch. Useful for multi-
 * location retail/chain. Single-branch tenants can keep this disabled
 * (the hero section already shows the main address).
 */
import { MapPin, Navigation } from 'lucide-react'
import type { SectionDef, SectionRenderProps } from '../v2-types'
import { resolveSectionBg, BG_COLOR_FIELD } from './section-bg'

function BranchesRender({ data, settings, theme }: SectionRenderProps) {
  if (data.branches.length === 0) return null

  const heading = (settings.heading as string)?.trim() || 'Lokasi Kami'
  const showMapsLink = settings.showMapsLink !== false

  const bg = resolveSectionBg(settings, 'bg-gray-50 dark:bg-gray-950')

  return (
    <section
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
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl lg:text-4xl dark:text-gray-100">
            {heading}
          </h2>
        </div>
        {/* Single column on phones (was 2-col at sm:640 — too cramped
            on common phone widths 360-414px). Two columns from md:768
            where each card has room to breathe, three from lg:1024. */}
        <ul className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.branches.map((b) => (
            <li
              key={b.id}
              className="rounded-2xl bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-5 dark:bg-gray-900"
            >
              {/* flex-wrap so the Utama badge falls to a second line on
                  narrow widths rather than clipping behind the name. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {b.name}
                </p>
                {b.isMain && (
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: theme.brandColor }}
                  >
                    Utama
                  </span>
                )}
              </div>
              {b.address && (
                <p className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-words">{b.address}</span>
                </p>
              )}
              {showMapsLink && b.address && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    b.address,
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition hover:bg-gray-100 dark:hover:bg-gray-800"
                  style={{ color: theme.brandColor }}
                >
                  <Navigation className="h-3.5 w-3.5" />
                  Buka di Google Maps
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export const branchesSection: SectionDef = {
  type: 'branches',
  name: 'Cabang',
  description: 'Daftar cabang aktif dengan alamat + tombol Google Maps.',
  icon: 'Store',
  allowMultiple: false,
  defaultSettings: {
    heading: 'Lokasi Kami',
    showMapsLink: true,
  },
  fields: [
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 60,
      default: 'Lokasi Kami',
    },
    {
      key: 'showMapsLink',
      type: 'toggle',
      label: 'Tampilkan tombol "Buka di Google Maps"',
      default: true,
    },
    BG_COLOR_FIELD,
  ],
  Render: BranchesRender,
}
