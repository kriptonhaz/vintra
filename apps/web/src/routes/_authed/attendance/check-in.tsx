import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MapPin, Clock, LogIn, LogOut, CheckCircle2, ShieldCheck } from 'lucide-react'
import {
  getMyTodayStatus,
  submitClockIn,
  submitClockOut,
} from '@/server/functions/attendance-checkin'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils' // JUR-137
import { Textarea } from '@/components/ui/textarea'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useToast } from '@/components/ui/toast'
import { usePermissions } from '@/hooks/use-permissions'
import { useBranch } from '@/hooks/use-branch'
import { GpsCheckIn, type GpsCapture } from '@/components/attendance/gps-check-in'
import { PhotoCheckIn } from '@/components/attendance/photo-check-in'
import { QrCheckIn } from '@/components/attendance/qr-check-in'

export const Route = createFileRoute('/_authed/attendance/check-in')({
  // Initial SSR pass uses the staff's home branch (no branchId). The
  // component swaps to a useQuery result the moment the topbar branch
  // switcher resolves to a different branch — so a supervisor visiting
  // outlet X gets that outlet's schedule + GPS area on first interaction.
  loader: () => getMyTodayStatus({ data: {} }),
  component: CheckInPage,
})

const DAY_LABEL_KEYS = [
  'branches.daySun',
  'branches.dayMon',
  'branches.dayTue',
  'branches.dayWed',
  'branches.dayThu',
  'branches.dayFri',
  'branches.daySat',
]

type Mode = 'in' | 'out'

function CheckInPage() {
  const initial = Route.useLoaderData()
  const { t } = useTranslation()
  const { role } = usePermissions()
  const { selectedBranchId, setSelectedBranchId } = useBranch()

  // Re-run the status query whenever the supervisor switches the topbar
  // branch — the loader seed is the home-branch view, so the first
  // render is instant; the swap to the visiting branch happens as soon
  // as `selectedBranchId` is non-null. We pass `?? undefined` so the
  // server falls back to the home branch when no global branch is set.
  const { data } = useQuery({
    queryKey: ['my-today-status', selectedBranchId ?? ''],
    queryFn: () =>
      getMyTodayStatus({
        data: { branchId: selectedBranchId ?? undefined },
      }),
    initialData: initial,
    staleTime: 30 * 1000,
  })

  const { profile, branch, todaySchedule, todayRecord, settings, jakartaDayOfWeek } = data

  // Owners/admins don't clock in themselves — they run the business.
  // Short-circuit with a friendly explanation so they don't get the
  // misleading "ask the owner to add you" message.
  const isManagementRole = role === 'owner' || role === 'admin'
  if (isManagementRole && !profile) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {t('checkIn.ownerOnlyStaffTitle')}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 dark:text-gray-400">
            {t('checkIn.ownerOnlyStaffBody')}
          </p>
        </div>
      </div>
    )
  }

  const todayLabel = t(DAY_LABEL_KEYS[jakartaDayOfWeek] ?? '')
  // Simple-mode branch — no fixed schedule, staff clock in/out any time.
  const simpleMode = !!branch && !branch.requiresSchedule
  const isWorkDay = todaySchedule?.isWorkDay ?? false
  // Clock-in is allowed on a work day (advanced branch) or always
  // (simple-mode branch — no work-day concept).
  const canCheckIn = simpleMode || isWorkDay
  const alreadyClockedIn = !!todayRecord?.clockInAt
  const alreadyClockedOut = !!todayRecord?.clockOutAt

  const modes = {
    gps: settings?.modeGpsEnabled ?? false,
    photo: settings?.modePhotoEnabled ?? false,
    qr: settings?.modeQrEnabled ?? false,
  }
  const hasAnyMode = modes.gps || modes.photo || modes.qr

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {profile
            ? t('checkIn.greeting', { name: profile.fullName })
            : t('checkIn.greetingNoProfile')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {todayLabel}
          {' · '}
          {formatDate(new Date(), 'dd MMMM yyyy')}
        </p>
      </div>

      {!profile && (
        <NotifyCard variant="amber">{t('checkIn.noProfile')}</NotifyCard>
      )}

      {profile && !branch && (
        <NotifyCard variant="amber">{t('checkIn.noBranch')}</NotifyCard>
      )}

      {data.accessibleBranches.length > 1 && (
        <TodayVisitsStrip
          branches={data.accessibleBranches}
          activeBranchId={branch?.id ?? null}
          onPick={setSelectedBranchId}
        />
      )}

      {branch && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <MapPin className="h-4 w-4" />
            {t('checkIn.branchLabel')}
          </div>
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {branch.name}
          </p>
          {branch.address && (
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
              {branch.address}
            </p>
          )}
        </div>
      )}

      {branch && isWorkDay && todaySchedule && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Clock className="h-4 w-4" />
            {t('checkIn.scheduleLabel')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('branches.colClockIn')}
              </p>
              <p className="mt-0.5 text-2xl font-bold text-gray-900 dark:text-gray-100">
                {todaySchedule.clockInTime?.slice(0, 5) ?? '—'}
              </p>
              {todayRecord?.clockInAt && (
                <p className="mt-1 text-xs text-success-700 dark:text-success-400">
                  {t('checkIn.clockedInAt', {
                    time: new Date(todayRecord.clockInAt).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Jakarta',
                    }),
                    status: todayRecord.clockInStatus ?? '',
                  })}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('branches.colClockOut')}
              </p>
              <p className="mt-0.5 text-2xl font-bold text-gray-900 dark:text-gray-100">
                {todaySchedule.clockOutTime?.slice(0, 5) ?? '—'}
              </p>
              {todayRecord?.clockOutAt && (
                <p className="mt-1 text-xs text-success-700 dark:text-success-400">
                  {t('checkIn.clockedOutAt', {
                    time: new Date(todayRecord.clockOutAt).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Jakarta',
                    }),
                  })}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {branch && simpleMode && (
        <NotifyCard variant="neutral">{t('checkIn.simpleModeNote')}</NotifyCard>
      )}

      {branch && !simpleMode && !isWorkDay && (
        <NotifyCard variant="neutral">{t('checkIn.offDay')}</NotifyCard>
      )}

      {!hasAnyMode && profile && (
        <NotifyCard variant="amber">{t('checkIn.noModeEnabled')}</NotifyCard>
      )}

      {profile && branch && canCheckIn && hasAnyMode && !alreadyClockedOut && (
        <CaptureForm
          mode={alreadyClockedIn ? 'out' : 'in'}
          modes={modes}
          branchId={selectedBranchId ?? null}
        />
      )}

      {alreadyClockedOut && (
        <div className="rounded-xl border border-success-200 bg-success-50 p-5 text-center dark:border-success-900 dark:bg-success-900/20">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-success-600 dark:text-success-400" />
          <p className="text-sm font-medium text-success-800 dark:text-success-200">
            {t('checkIn.allDoneToday')}
          </p>
        </div>
      )}
    </div>
  )
}

interface TodayVisitsStripProps {
  branches: Array<{
    id: string
    name: string
    isMain: boolean
    status: 'pending' | 'clocked-in' | 'clocked-out'
  }>
  activeBranchId: string | null
  onPick: (branchId: string) => void
}

/**
 * Per-branch status chips for multi-outlet staff. Each chip shows the
 * outlet and whether the user has clocked in / out / not yet today.
 * Tapping a chip switches the topbar branch — quick way to jump
 * between outlets without leaving the page.
 */
function TodayVisitsStrip({
  branches,
  activeBranchId,
  onPick,
}: TodayVisitsStripProps) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {t('checkIn.todayVisitsLabel')}
      </p>
      <div className="flex flex-wrap gap-2">
        {branches.map((b) => {
          const isActive = b.id === activeBranchId
          const icon =
            b.status === 'clocked-out'
              ? '✓'
              : b.status === 'clocked-in'
                ? '⏱'
                : '⏳'
          const tone =
            b.status === 'clocked-out'
              ? 'border-success-300 bg-success-50 text-success-800 dark:border-success-800 dark:bg-success-900/30 dark:text-success-200'
              : b.status === 'clocked-in'
                ? 'border-warning-300 bg-warning-50 text-warning-800 dark:border-warning-800 dark:bg-warning-900/30 dark:text-warning-200'
                : 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onPick(b.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-shadow ${tone} ${
                isActive
                  ? 'ring-2 ring-brand-500 ring-offset-2 dark:ring-offset-gray-800'
                  : 'hover:shadow-sm'
              }`}
            >
              <span aria-hidden>{icon}</span>
              <span>{b.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NotifyCard({
  children,
  variant,
}: {
  children: React.ReactNode
  variant: 'amber' | 'neutral'
}) {
  const cls =
    variant === 'amber'
      ? 'border-warning-200 bg-warning-50 text-warning-800 dark:border-warning-900 dark:bg-warning-900/20 dark:text-warning-200'
      : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
  return (
    <div className={`rounded-xl border p-4 text-sm ${cls}`}>{children}</div>
  )
}

// ─── Capture form ──────────────────────────────────

interface CaptureFormProps {
  mode: Mode
  modes: { gps: boolean; photo: boolean; qr: boolean }
  /** Visiting-branch override from the topbar branch switcher. When
   *  null, the server falls back to the staff's home branch. */
  branchId: string | null
}

function CaptureForm({ mode, modes, branchId }: CaptureFormProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const router = useRouter()

  const [gps, setGps] = useState<GpsCapture | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready =
    (!modes.gps || gps !== null) &&
    (!modes.photo || photo !== null) &&
    (!modes.qr || qr !== null)

  async function handleSubmit() {
    setError(null)
    setSubmitting(true)
    try {
      const payload = {
        lat: modes.gps && gps ? gps.lat : undefined,
        lng: modes.gps && gps ? gps.lng : undefined,
        photoDataUrl: modes.photo && photo ? photo : undefined,
        qrToken: modes.qr && qr ? qr : undefined,
        notes: notes.trim() || undefined,
        branchId: branchId ?? undefined,
      }
      if (mode === 'in') {
        await submitClockIn({ data: payload })
        toast({
          title: t('common.toastSavedTitle'),
          description: t('checkIn.toastClockInSuccess'),
          variant: 'success',
        })
      } else {
        await submitClockOut({ data: payload })
        toast({
          title: t('common.toastSavedTitle'),
          description: t('checkIn.toastClockOutSuccess'),
          variant: 'success',
        })
      }
      setGps(null)
      setPhoto(null)
      setQr(null)
      setNotes('')
      await router.invalidate()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('checkIn.submitFailed')
      setError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {mode === 'in' ? t('checkIn.clockInStep') : t('checkIn.clockOutStep')}
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('checkIn.stepIntro')}
        </p>
      </div>

      {modes.gps && <GpsCheckIn captured={gps} onCapture={setGps} />}
      {modes.photo && <PhotoCheckIn captured={photo} onCapture={setPhoto} />}
      {modes.qr && <QrCheckIn captured={qr} onCapture={setQr} />}

      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('checkIn.notesLabel')}
        </label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={t('checkIn.notesPlaceholder')}
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('checkIn.notesHint', { length: notes.length })}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-900/20 dark:text-danger-400">
          {error}
        </div>
      )}

      <Button
        type="button"
        variant="brand"
        size="lg"
        disabled={!ready}
        loading={submitting}
        onClick={handleSubmit}
        className="w-full sm:w-auto"
      >
        {mode === 'in' ? (
          <>
            <LogIn className="h-5 w-5" />
            {t('checkIn.clockInBtn')}
          </>
        ) : (
          <>
            <LogOut className="h-5 w-5" />
            {t('checkIn.clockOutBtn')}
          </>
        )}
      </Button>
    </div>
  )
}
