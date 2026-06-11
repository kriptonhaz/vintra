import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { MapPin, Camera, QrCode, Check, Bell, Info } from 'lucide-react'
import {
  getAttendanceOverview,
  updateModeToggles,
  updateQrRotation,
  updateAttendanceReminderSettings,
} from '@/server/functions/attendance-settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'

export const Route = createFileRoute('/_authed/attendance/settings')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('attendance.manage')) {
      throw redirect({ to: '/attendance' })
    }
  },
  loader: () => getAttendanceOverview(),
  component: SettingsPage,
})

function SettingsPage() {
  const { settings } = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const { toast } = useToast()

  const [gps, setGps] = useState(settings.modeGpsEnabled)
  const [photo, setPhoto] = useState(settings.modePhotoEnabled)
  const [qr, setQr] = useState(settings.modeQrEnabled)
  const [rotation, setRotation] = useState<number>(
    settings.qrRotationSeconds ?? 30,
  )
  const [saving, setSaving] = useState(false)
  const [rotationSaving, setRotationSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const atLeastOne = gps || photo || qr

  async function handleToggle(which: 'gps' | 'photo' | 'qr', next: boolean) {
    const nextGps = which === 'gps' ? next : gps
    const nextPhoto = which === 'photo' ? next : photo
    const nextQr = which === 'qr' ? next : qr

    if (!nextGps && !nextPhoto && !nextQr) {
      setError(t('attendance.modeNeedAtLeastOne'))
      return
    }

    setError(null)
    setSaving(true)
    try {
      await updateModeToggles({
        data: { gps: nextGps, photo: nextPhoto, qr: nextQr },
      })
      if (which === 'gps') setGps(next)
      if (which === 'photo') setPhoto(next)
      if (which === 'qr') setQr(next)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('attendance.toastModeUpdated'),
        variant: 'success',
      })
      await router.invalidate()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan'
      setError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleRotationSave() {
    setError(null)
    setRotationSaving(true)
    try {
      await updateQrRotation({ data: { seconds: rotation } })
      toast({
        title: t('common.toastSavedTitle'),
        description: t('attendance.toastQrRotationUpdated'),
        variant: 'success',
      })
      await router.invalidate()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan'
      setError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    } finally {
      setRotationSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('attendance.settingsTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('attendance.settingsSubtitle')}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('attendance.modeTitle')}
        </h2>
        <p className="mb-5 text-sm text-gray-600 dark:text-gray-400">
          {t('attendance.modeSubtitleMulti')}
        </p>
        <div className="space-y-3">
          <ModeToggle
            icon={<MapPin className="h-5 w-5" />}
            title={t('attendance.mode_gps')}
            description={t('attendance.mode_gps_desc')}
            enabled={gps}
            disabled={saving}
            onChange={(v) => handleToggle('gps', v)}
          />
          <ModeToggle
            icon={<Camera className="h-5 w-5" />}
            title={t('attendance.mode_photo')}
            description={t('attendance.mode_photo_desc')}
            enabled={photo}
            disabled={saving}
            onChange={(v) => handleToggle('photo', v)}
          />
          {/* Inline retention notice — sits right under the Foto Selfie
              toggle, inside the same card, so the owner reads the
              60-day policy in context with the toggle they're about
              to flip. Always visible (not gated on `photo`) so they
              see it BEFORE enabling for the first time. */}
          <div className="flex items-start gap-2 rounded-lg border border-primary-200 bg-primary-50 p-3 text-xs text-primary-800 dark:border-primary-900/40 dark:bg-primary-900/20 dark:text-primary-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600 dark:text-primary-400" />
            <div>
              <span className="font-semibold">
                {t('attendance.photoRetentionTitle')}:
              </span>{' '}
              {t('attendance.photoRetentionBody')}
            </div>
          </div>
          <ModeToggle
            icon={<QrCode className="h-5 w-5" />}
            title={t('attendance.mode_qr')}
            description={t('attendance.mode_qr_desc')}
            enabled={qr}
            disabled={saving}
            onChange={(v) => handleToggle('qr', v)}
          />
        </div>
        {!atLeastOne && (
          <p className="mt-4 text-xs text-danger-600">
            {t('attendance.modeNeedAtLeastOne')}
          </p>
        )}
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
          <Check className="h-3 w-3 shrink-0" />
          {t('attendance.modeCombinedNote')}
        </p>
      </div>

      {qr && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('attendance.qrRotationTitle')}
          </h2>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {t('attendance.qrRotationSubtitle')}
          </p>
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('attendance.qrRotationLabel')}
              </label>
              <Input
                type="number"
                min={15}
                max={120}
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
              />
            </div>
            <Button
              variant="brand"
              loading={rotationSaving}
              onClick={handleRotationSave}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}

      <ReminderCard initialSettings={settings} onSaved={() => router.invalidate()} />

      {error && (
        <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>
      )}
    </div>
  )
}

interface ReminderCardSettings {
  clockinReminderEnabled: boolean
  clockinReminderMinutes: number
  clockinReminderDirection: string
  clockoutReminderEnabled: boolean
  clockoutReminderMinutes: number
  clockoutReminderDirection: string
}

function ReminderCard({
  initialSettings,
  onSaved,
}: {
  initialSettings: ReminderCardSettings
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [inEnabled, setInEnabled] = useState(initialSettings.clockinReminderEnabled)
  const [inMinutes, setInMinutes] = useState(initialSettings.clockinReminderMinutes)
  const [inDirection, setInDirection] = useState<'before' | 'after'>(
    initialSettings.clockinReminderDirection === 'after' ? 'after' : 'before',
  )
  const [outEnabled, setOutEnabled] = useState(initialSettings.clockoutReminderEnabled)
  const [outMinutes, setOutMinutes] = useState(initialSettings.clockoutReminderMinutes)
  const [outDirection, setOutDirection] = useState<'before' | 'after'>(
    initialSettings.clockoutReminderDirection === 'after' ? 'after' : 'before',
  )
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await updateAttendanceReminderSettings({
        data: {
          clockinReminderEnabled: inEnabled,
          clockinReminderMinutes: inMinutes,
          clockinReminderDirection: inDirection,
          clockoutReminderEnabled: outEnabled,
          clockoutReminderMinutes: outMinutes,
          clockoutReminderDirection: outDirection,
        },
      })
      toast({
        title: t('common.toastSavedTitle'),
        description: t('attendance.settings.reminderSavedToast'),
        variant: 'success',
      })
      onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan'
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-1 flex items-center gap-2">
        <Bell className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('attendance.settings.reminderSection')}
        </h2>
      </div>
      <p className="mb-5 text-sm text-gray-600 dark:text-gray-400">
        {t('attendance.settings.reminderSubtitle')}
      </p>

      <div className="space-y-4">
        <ReminderRow
          label={t('attendance.settings.clockInReminder')}
          enabled={inEnabled}
          minutes={inMinutes}
          direction={inDirection}
          onEnabledChange={setInEnabled}
          onMinutesChange={setInMinutes}
          onDirectionChange={setInDirection}
          kind="clockin"
        />
        <ReminderRow
          label={t('attendance.settings.clockOutReminder')}
          enabled={outEnabled}
          minutes={outMinutes}
          direction={outDirection}
          onEnabledChange={setOutEnabled}
          onMinutesChange={setOutMinutes}
          onDirectionChange={setOutDirection}
          kind="clockout"
        />
      </div>

      <div className="mt-5 flex justify-end">
        <Button variant="brand" loading={saving} onClick={save}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

function ReminderRow({
  label,
  enabled,
  minutes,
  direction,
  onEnabledChange,
  onMinutesChange,
  onDirectionChange,
  kind,
}: {
  label: string
  enabled: boolean
  minutes: number
  direction: 'before' | 'after'
  onEnabledChange: (v: boolean) => void
  onMinutesChange: (v: number) => void
  onDirectionChange: (v: 'before' | 'after') => void
  kind: 'clockin' | 'clockout'
}) {
  const { t } = useTranslation()
  const hintKey =
    direction === 'before'
      ? 'attendance.settings.reminderHintBefore'
      : 'attendance.settings.reminderHintAfter'
  const typeLabel =
    kind === 'clockin'
      ? t('attendance.settings.typeClockIn')
      : t('attendance.settings.typeClockOut')

  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-gray-900 dark:text-gray-100">{label}</p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onEnabledChange(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
            enabled ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      <div className={`mt-3 space-y-2 ${enabled ? '' : 'opacity-50'}`}>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={1}
            max={120}
            disabled={!enabled}
            value={minutes}
            onChange={(e) => onMinutesChange(Number(e.target.value))}
            className="w-24"
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {t('attendance.settings.minutesUnit')}
          </span>
          <div className="flex gap-1 rounded-lg border border-gray-300 p-1 dark:border-gray-600">
            <button
              type="button"
              disabled={!enabled}
              onClick={() => onDirectionChange('before')}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                direction === 'before'
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {t('attendance.settings.directionBefore')}
            </button>
            <button
              type="button"
              disabled={!enabled}
              onClick={() => onDirectionChange('after')}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                direction === 'after'
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {t('attendance.settings.directionAfter')}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t(hintKey, { minutes, type: typeLabel })}
        </p>
      </div>
    </div>
  )
}

function ModeToggle({
  icon,
  title,
  description,
  enabled,
  disabled,
  onChange,
}: {
  icon: React.ReactNode
  title: string
  description: string
  enabled: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-lg border-2 p-4 transition-colors ${
        enabled
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
      }`}
    >
      <div className="flex min-w-0 gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
            enabled
              ? 'bg-brand-600 text-white'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-gray-900 dark:text-gray-100">{title}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {description}
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}
