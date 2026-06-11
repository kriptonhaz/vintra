/**
 * Queue — live antrian card for queue-mode tenants (cuci motor, klinik
 * walk-in, etc.). Two display modes:
 *
 *   - 'per-staff' (default): one card per resource — useful for salons
 *     where customers pick a stylist and want to see that specific
 *     person's queue length.
 *   - 'aggregate': one big total number — fits cuci motor / klinik
 *     where the staff assignment is internal and customers think
 *     "how many people in line right now?", not "which bay is busy?".
 *
 * Booking settings are untouched by this — the underlying scheduler
 * still tracks per-resource (it has to, for auto-routing). This
 * setting only controls how the PUBLIC PAGE summarizes that data.
 *
 * Auto-hides on public sites when booking mode isn't 'queue' or there
 * are no active resources; surfaces an editor-only hint in the editor
 * preview when that happens.
 */
import { Users, AlertCircle, ExternalLink, Activity, PauseCircle } from 'lucide-react'
import type { SectionDef, SectionRenderProps } from '../v2-types'

function QueueRender({ data, settings, theme, isEditorPreview }: SectionRenderProps) {
  // Editor-only hint: surface the configuration gap (mode is wrong OR
  // no active resources) so the tenant knows why the section is empty.
  const missingQueueMode = data.mode !== 'queue'
  const missingResources = data.resources.length === 0
  if (missingQueueMode || missingResources) {
    if (!isEditorPreview) return null
    return (
      <section className="bg-gray-50 py-10 dark:bg-gray-950">
        <div className="mx-auto max-w-3xl px-4">
          <div className="rounded-2xl border-2 border-dashed border-warning-300 bg-warning-50 p-5 dark:border-warning-900/40 dark:bg-warning-950/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning-700 dark:text-warning-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-warning-900 dark:text-warning-200">
                  Antrian Live belum bisa tampil
                </p>
                <p className="mt-1 text-xs text-warning-800 dark:text-warning-300">
                  {missingQueueMode
                    ? 'Mode booking saat ini bukan "Queue". '
                    : 'Belum ada resource antrian aktif (bay/operator/meja). '}
                  Atur di{' '}
                  <a
                    href="/booking/settings"
                    className="inline-flex items-center gap-0.5 font-medium underline hover:no-underline"
                  >
                    Pengaturan Booking
                    <ExternalLink className="h-3 w-3" />
                  </a>{' '}
                  agar section ini muncul di halaman publik.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const heading = (settings.heading as string)?.trim() || 'Antrian Sekarang'
  const subText =
    (settings.subText as string)?.trim() ||
    'Datang langsung untuk ambil tiket. Update otomatis tiap 15 detik.'
  const displayMode =
    settings.displayMode === 'aggregate' ? 'aggregate' : 'per-staff'

  return (
    <section id="queue" className="bg-white py-12 sm:py-16 lg:py-20 dark:bg-gray-900">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <QueueHeader heading={heading} theme={theme} />
        {displayMode === 'aggregate' ? (
          <QueueAggregate data={data} theme={theme} />
        ) : (
          <QueuePerStaff data={data} theme={theme} />
        )}
        {subText && (
          <p className="mt-6 text-center text-sm leading-relaxed text-gray-500">
            {subText}
          </p>
        )}
      </div>
    </section>
  )
}

// ─── Header (shared between modes) ───────────────────────────────────

function QueueHeader({
  heading,
  theme,
}: {
  heading: string
  theme: { brandColor: string }
}) {
  return (
    <div className="mb-6 sm:mb-8">
      <div
        className="mb-3 inline-block h-1 w-12 rounded-full"
        style={{ backgroundColor: theme.brandColor }}
      />
      {/* Heading on its own row above the LIVE badge — no flex layout
          that could force truncation of "Antrian Sekarang". The badge
          drops to a second visual row on narrow screens. Title text
          wraps naturally with `leading-tight`. */}
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="flex items-start gap-2 text-2xl font-bold leading-tight tracking-tight text-gray-900 sm:gap-3 sm:text-3xl lg:text-4xl dark:text-gray-100">
          <Users
            className="mt-1 h-6 w-6 shrink-0 sm:h-7 sm:w-7"
            style={{ color: theme.brandColor }}
          />
          <span className="break-words">{heading}</span>
        </h2>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-success-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success-500" />
          </span>
          Live
        </span>
      </div>
    </div>
  )
}

// ─── Aggregate mode (cuci motor / klinik walk-in) ────────────────────

function QueueAggregate({
  data,
  theme,
}: {
  data: SectionRenderProps['data']
  theme: { brandColor: string }
}) {
  const waitingCount = data.queue.filter((q) => q.status !== 'in_progress').length
  const inProgressCount = data.queue.filter((q) => q.status === 'in_progress').length
  const activeStaffCount = data.resources.filter((r) => !r.isPaused).length

  return (
    <div
      className="overflow-hidden rounded-3xl border-2 border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900/40"
    >
      <div
        className="h-2 w-full"
        style={{ backgroundColor: theme.brandColor }}
      />
      <div className="px-6 py-8 text-center sm:py-12">
        <p className="text-sm font-medium text-gray-500 sm:text-base">
          Antrian saat ini
        </p>
        <p className="mt-3 flex items-baseline justify-center gap-2 sm:mt-4">
          <span
            className="text-7xl font-bold leading-none sm:text-8xl"
            style={{ color: theme.brandColor }}
          >
            {waitingCount}
          </span>
          <span className="text-base font-medium text-gray-500 sm:text-lg">
            {waitingCount === 1 ? 'orang' : 'orang'}
          </span>
        </p>
        {/* Two pill-stats below: in-progress + active staff. Mobile
            stacks them; sm+ puts them on one row. */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          {inProgressCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-3 py-1.5 text-xs font-medium text-success-700 dark:bg-success-900/20 dark:text-success-400">
              <Activity className="h-3.5 w-3.5" />
              {inProgressCount} sedang dikerjakan
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <Users className="h-3.5 w-3.5" />
            {activeStaffCount} staf aktif
          </span>
          {data.resources.some((r) => r.isPaused) && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-3 py-1.5 text-xs font-medium text-warning-700 dark:bg-warning-900/20 dark:text-warning-300">
              <PauseCircle className="h-3.5 w-3.5" />
              {data.resources.filter((r) => r.isPaused).length} jeda
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Per-staff mode (salon, barbershop) ──────────────────────────────

function QueuePerStaff({
  data,
  theme,
}: {
  data: SectionRenderProps['data']
  theme: { brandColor: string }
}) {
  // 2-col on phones, 3-col from md. Same container-query pattern as
  // services so card-internal text scales with card width, not viewport.
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
      {data.resources.map((r) => {
        const inProgress = data.queue.find(
          (q) => q.resourceId === r.id && q.status === 'in_progress',
        )
        const waiting = data.queue.filter(
          (q) => q.resourceId === r.id && q.status !== 'in_progress',
        )
        return (
          <div
            key={r.id}
            className={`@container overflow-hidden rounded-2xl border-2 ${
              r.isPaused
                ? 'border-warning-200 bg-warning-50 dark:border-warning-900/40 dark:bg-warning-950/20'
                : 'border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900/40'
            }`}
          >
            <div
              className="h-1.5"
              style={{ backgroundColor: r.isPaused ? '#d4881f' : theme.brandColor }}
            />
            <div className="min-w-0 p-2.5 @xs:p-3 @sm:p-4">
              {/* Name + optional Jeda badge — `flex-wrap` so the badge
                  drops below the name rather than clipping it. Name
                  wraps via overflow-wrap rather than truncating; the
                  container query keeps font tight in narrow cards. */}
              <div className="flex flex-wrap items-baseline gap-1.5">
                <p
                  className="text-[11px] font-medium leading-tight text-gray-700 @xs:text-xs @sm:text-sm dark:text-gray-300"
                  style={{ overflowWrap: 'anywhere', hyphens: 'auto' }}
                >
                  {r.name}
                </p>
                {r.isPaused && (
                  <span className="shrink-0 rounded-full bg-warning-100 px-1.5 py-0.5 text-[9px] font-medium text-warning-800 dark:bg-warning-900/30 dark:text-warning-300">
                    Jeda
                  </span>
                )}
              </div>
              {/* Waiting count — large number scales with card width. */}
              <p className="mt-2 flex items-baseline gap-1 @sm:mt-3 @sm:gap-1.5">
                <span
                  className="text-3xl font-bold leading-none @xs:text-4xl @sm:text-5xl"
                  style={{ color: theme.brandColor }}
                >
                  {waiting.length}
                </span>
                <span className="text-[10px] font-medium text-gray-500 @xs:text-xs @sm:text-sm">
                  antrian
                </span>
              </p>
              {inProgress && (
                <p className="mt-2 truncate rounded-lg bg-success-50 px-2 py-1.5 text-[10px] text-success-700 @sm:mt-3 @sm:px-3 @sm:py-2 @sm:text-xs dark:bg-success-900/20 dark:text-success-400">
                  ⏵{' '}
                  <span className="font-mono font-semibold">
                    {inProgress.ticketNumber}
                  </span>
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Schema ──────────────────────────────────────────────────────────

export const queueSection: SectionDef = {
  type: 'queue',
  name: 'Antrian Live',
  description:
    'Otomatis muncul jika mode booking diatur "Queue". Sembunyi sendiri kalau bukan.',
  icon: 'Users',
  allowMultiple: false,
  defaultSettings: {
    heading: 'Antrian Sekarang',
    subText: 'Datang langsung untuk ambil tiket. Update otomatis tiap 15 detik.',
    displayMode: 'per-staff',
  },
  fields: [
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 60,
      default: 'Antrian Sekarang',
    },
    {
      key: 'displayMode',
      type: 'select',
      label: 'Cara tampil',
      help:
        'Per Staf = satu card per orang/bay (cocok untuk salon, barber). Total = satu angka besar untuk antrian keseluruhan (cocok untuk cuci motor, klinik walk-in).',
      options: [
        { value: 'per-staff', label: 'Per staf (kotak terpisah)' },
        { value: 'aggregate', label: 'Total saja (angka besar)' },
      ],
      default: 'per-staff',
    },
    {
      key: 'subText',
      type: 'textarea',
      label: 'Teks pendukung di bawah card',
      maxLen: 160,
      rows: 2,
      default: 'Datang langsung untuk ambil tiket. Update otomatis tiap 15 detik.',
    },
  ],
  Render: QueueRender,
}
