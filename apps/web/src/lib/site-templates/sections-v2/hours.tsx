/**
 * Hours — operating hours table. Pulls from the main branch's
 * business_hours JSON. Today's row is highlighted with the brand
 * color so customers can scan it in one glance.
 */
import { Clock } from 'lucide-react'
import type { SectionDef, SectionRenderProps } from '../v2-types'
import { resolveSectionBg, BG_COLOR_FIELD } from './section-bg'

const DAY_LABELS_ID = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
]

function HoursRender({ data, settings, theme }: SectionRenderProps) {
  const mainBranch = data.branches.find((b) => b.isMain) ?? data.branches[0] ?? null
  if (!mainBranch?.businessHours || mainBranch.businessHours.length === 0) return null

  const heading = (settings.heading as string)?.trim() || 'Jam Operasional'
  const today = new Date().getDay()

  const bg = resolveSectionBg(settings, 'bg-white dark:bg-gray-900')

  return (
    <section
      className={`py-12 sm:py-16 lg:py-20 ${bg.className}`}
      style={bg.style}
      data-section-surface={bg.surface}
    >
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 text-center sm:mb-8">
          <div
            className="mx-auto mb-3 h-1 w-12 rounded-full sm:mb-4"
            style={{ backgroundColor: theme.brandColor }}
          />
          <h2 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight text-gray-900 sm:gap-3 sm:text-3xl lg:text-4xl dark:text-gray-100">
            <Clock className="h-6 w-6 sm:h-7 sm:w-7" style={{ color: theme.brandColor }} />
            {heading}
          </h2>
        </div>
        <div className="overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-950">
          <table className="w-full">
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                const h = mainBranch.businessHours?.find((x) => x.day === d)
                const isToday = d === today
                return (
                  <tr
                    key={d}
                    className={
                      isToday
                        ? 'font-semibold'
                        : ''
                    }
                    style={
                      isToday
                        ? { backgroundColor: `${theme.brandColor}15` }
                        : undefined
                    }
                  >
                    <td className="px-5 py-3 text-sm text-gray-900 dark:text-gray-100">
                      {DAY_LABELS_ID[d]}
                      {isToday && (
                        <span
                          className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                          style={{ backgroundColor: theme.brandColor }}
                        >
                          Hari ini
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-sm text-gray-600 dark:text-gray-400">
                      {h ? `${h.open} – ${h.close}` : 'Tutup'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export const hoursSection: SectionDef = {
  type: 'hours',
  name: 'Jam Operasional',
  description: 'Tabel jam buka per hari dari cabang utama.',
  icon: 'Clock',
  allowMultiple: false,
  defaultSettings: {
    heading: 'Jam Operasional',
  },
  fields: [
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 60,
      default: 'Jam Operasional',
    },
    BG_COLOR_FIELD,
  ],
  Render: HoursRender,
}
