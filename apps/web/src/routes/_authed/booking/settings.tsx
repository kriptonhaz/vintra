/**
 * JUR-184 (+ follow-up): unified /booking/settings page.
 *
 * Sections:
 *   1. Mode + slot duration + max-concurrent cap (booking_settings)
 *   2. Staff = (a) Anggota Tim with bookable-toggle + (b) staf tanpa akun
 *   3. Hari libur (placeholder)
 *
 * Staff list reads from BOTH tenant_members (with a toggle that flips
 * booking_resources visibility) AND from booking_resources where
 * member_id IS NULL (resource-only entries for staff who don't log in).
 */
import { useState } from 'react'
import { createFileRoute, redirect, useRouter, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  getBookingSettingsState,
  saveBookingSettings,
  addBookingStaff,
  deleteBookingResource,
  toggleMemberBookable,
} from '@/server/functions/booking'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import {
  Users,
  Calendar,
  Plus,
  Trash2,
  User,
  UserPlus,
  Settings as SettingsIcon,
} from 'lucide-react'

export const Route = createFileRoute('/_authed/booking/settings')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('booking.write')) {
      throw redirect({ to: '/booking' })
    }
  },
  loader: () => getBookingSettingsState(),
  component: BookingSettingsPage,
})

type StateData = Awaited<ReturnType<typeof getBookingSettingsState>>
type MemberRow = StateData['members'][number]
type ResourceOnlyRow = StateData['resourceOnly'][number]

const MODE_OPTIONS = [
  { value: 'slot', titleKey: 'booking.modeSlotTitle', descKey: 'booking.modeSlotDesc' },
  { value: 'queue', titleKey: 'booking.modeQueueTitle', descKey: 'booking.modeQueueDesc' },
  { value: 'stay', titleKey: 'booking.modeStayTitle', descKey: 'booking.modeStayDesc' },
] as const

function displayMemberName(m: MemberRow): string {
  const full = `${m.firstName ?? ''}${m.lastName ? ' ' + m.lastName : ''}`.trim()
  return full || 'Anggota Tim'
}

function initials(name: string): string {
  return (
    name
      .split(' ')
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || ''
  )
}

function BookingSettingsPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const initial = Route.useLoaderData() as StateData

  const { data: state = initial } = useQuery({
    queryKey: ['booking', 'settingsState'],
    queryFn: () => getBookingSettingsState(),
    initialData: initial,
  })

  const [mode, setMode] = useState<'slot' | 'queue' | 'stay'>(
    (state.settings?.mode as 'slot' | 'queue' | 'stay') ?? 'slot',
  )
  const [slotDurationMin, setSlotDurationMin] = useState<number>(
    state.settings?.slotDurationMin ?? 30,
  )
  const [maxConcurrentSlots, setMaxConcurrentSlots] = useState<string>(
    state.settings?.maxConcurrentSlots != null ? String(state.settings.maxConcurrentSlots) : '',
  )

  const [addStaffOpen, setAddStaffOpen] = useState(false)
  const [deletingResourceId, setDeletingResourceId] = useState<string | null>(null)

  const saveMut = useMutation({
    mutationFn: () =>
      saveBookingSettings({
        data: {
          mode,
          slotDurationMin,
          maxConcurrentSlots: maxConcurrentSlots ? parseInt(maxConcurrentSlots, 10) : null,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['booking'] })
      await router.invalidate()
      toast({ title: t('booking.settingsSaved'), variant: 'success' })
    },
    onError: (err) =>
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      }),
  })

  const toggleMut = useMutation({
    mutationFn: ({ memberId, enable }: { memberId: string; enable: boolean }) =>
      toggleMemberBookable({ data: { memberId, enable } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['booking'] })
      await router.invalidate()
    },
    onError: (err) =>
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      }),
  })

  const deleteResourceMut = useMutation({
    mutationFn: (id: string) => deleteBookingResource({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['booking', 'settingsState'] })
      await router.invalidate()
      setDeletingResourceId(null)
      toast({ title: t('booking.resourceDeleted'), variant: 'success' })
    },
    onError: (err) => {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      })
      setDeletingResourceId(null)
    },
  })

  const setupCompleted = state.settings?.setupCompleted ?? false

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('booking.settingsTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('booking.settingsSubtitle')}
        </p>
      </div>

      {!setupCompleted && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-200">
          {t('booking.settingsFirstTimeHint')}
        </div>
      )}

      {/* Section 1 — Konfigurasi slot */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('booking.settingsSection1')}
          </h2>
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('booking.modeLabel')}
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  mode === opt.value
                    ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/20'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                }`}
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {t(opt.titleKey)}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {t(opt.descKey)}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('booking.slotDurationLabel')}
            </label>
            <Input
              type="number"
              min={5}
              max={720}
              value={slotDurationMin}
              onChange={(e) => setSlotDurationMin(parseInt(e.target.value, 10) || 30)}
            />
            <p className="mt-1 text-xs text-gray-500">{t('booking.slotDurationHint')}</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('booking.maxConcurrentLabel')}
            </label>
            <Input
              type="number"
              min={1}
              max={99}
              value={maxConcurrentSlots}
              onChange={(e) => setMaxConcurrentSlots(e.target.value)}
              placeholder={t('booking.maxConcurrentPlaceholder')}
            />
            <p className="mt-1 text-xs text-gray-500">{t('booking.maxConcurrentHint')}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            type="button"
            variant="brand"
            onClick={() => saveMut.mutate()}
            loading={saveMut.isPending}
          >
            {t('booking.saveSettings')}
          </Button>
        </div>
      </section>

      {/* Section 2 — Staf (Anggota Tim toggles + Tanpa akun) */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-gray-500" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t('booking.settingsSection2')}
              </h2>
            </div>
            <p className="mt-1 text-xs text-gray-500">{t('booking.staffSectionDesc')}</p>
          </div>
          <Link
            to="/settings/members"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {t('booking.addTeamMemberLink')}
          </Link>
        </div>

        {/* Sublist A — Anggota Tim */}
        <div className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t('booking.staffSectionTeam')}
          </h3>
          {state.members.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40">
              {t('booking.noMembers')}{' '}
              <Link
                to="/settings/members"
                className="font-medium text-brand-700 hover:underline dark:text-brand-400"
              >
                {t('booking.addTeamMemberLink')}
              </Link>
              .
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {state.members.map((m) => {
                const name = displayMemberName(m)
                const isOn = m.resourceId !== null
                const togglePending =
                  toggleMut.isPending && toggleMut.variables?.memberId === m.memberId
                return (
                  <li key={m.memberId} className="flex items-center gap-3 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {initials(name) || <User className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                          {name}
                        </p>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {m.role}
                        </span>
                      </div>
                      {m.phone && <p className="mt-0.5 text-xs text-gray-500">{m.phone}</p>}
                    </div>
                    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
                      <span className="text-gray-600 dark:text-gray-400">
                        {t('booking.bookableToggleLabel')}
                      </span>
                      <input
                        type="checkbox"
                        checked={isOn}
                        disabled={togglePending}
                        onChange={(e) =>
                          toggleMut.mutate({
                            memberId: m.memberId,
                            enable: e.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Sublist B — Staf tanpa akun */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t('booking.staffSectionResourceOnly')}
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAddStaffOpen(true)}
              className="text-xs"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('booking.addStaffNoLogin')}
            </Button>
          </div>
          {state.resourceOnly.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40">
              {t('booking.emptyResourceOnly')}
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {state.resourceOnly.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {initials(r.name) || <User className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                      {r.name}
                    </p>
                    {!r.isActive && (
                      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                        {t('booking.staffInactiveBadge')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeletingResourceId(r.id)}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                    aria-label={t('booking.staffDelete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Section 3 — Hari libur */}
      <BlackoutDatesSection
        initial={state.settings?.blackoutDates ?? []}
        currentSettings={{
          mode,
          slotDurationMin,
          maxConcurrentSlots: maxConcurrentSlots ? parseInt(maxConcurrentSlots, 10) : null,
        }}
        onSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: ['booking', 'settingsState'] })
          await router.invalidate()
        }}
      />

      <AddStaffSheet
        open={addStaffOpen}
        onClose={() => setAddStaffOpen(false)}
        onSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: ['booking', 'settingsState'] })
          await router.invalidate()
          setAddStaffOpen(false)
        }}
      />

      <ConfirmDialog
        open={!!deletingResourceId}
        onCancel={() => setDeletingResourceId(null)}
        onConfirm={() =>
          deletingResourceId && deleteResourceMut.mutate(deletingResourceId)
        }
        title={t('booking.deleteResourceTitle')}
        description={t('booking.deleteResourceConfirm')}
        confirmText={t('booking.staffDelete')}
        variant="danger"
      />
    </div>
  )
}

/**
 * JUR-183: blackout dates editor. Tenant-wide holidays that block
 * booking creation across all branches. createBooking already enforces
 * via assertNotBlackoutDate (from JUR-184). This UI is just the
 * surface to edit `booking_settings.blackout_dates` (jsonb string[]).
 *
 * Persists through saveBookingSettings, which means we have to send
 * the rest of the settings payload too — we accept the current values
 * via prop so we don't accidentally overwrite mode/slot/cap with
 * stale state.
 */
function BlackoutDatesSection({
  initial,
  currentSettings,
  onSaved,
}: {
  initial: string[]
  currentSettings: {
    mode: 'slot' | 'queue' | 'stay'
    slotDurationMin: number
    maxConcurrentSlots: number | null
  }
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [dates, setDates] = useState<string[]>(() => [...initial].sort())
  const [pending, setPending] = useState('')

  const mut = useMutation({
    mutationFn: (next: string[]) =>
      saveBookingSettings({
        data: {
          ...currentSettings,
          blackoutDates: next,
        },
      }),
    onSuccess: async () => {
      toast({ title: t('booking.blackoutSaved'), variant: 'success' })
      await onSaved()
    },
    onError: (err) =>
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      }),
  })

  function addDate() {
    if (!pending) return
    if (dates.includes(pending)) {
      toast({ title: t('booking.blackoutDuplicate'), variant: 'error' })
      return
    }
    const next = [...dates, pending].sort()
    setDates(next)
    setPending('')
    mut.mutate(next)
  }

  function removeDate(d: string) {
    const next = dates.filter((x) => x !== d)
    setDates(next)
    mut.mutate(next)
  }

  const todayIso = new Date().toISOString().split('T')[0]!

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center gap-2">
        <Calendar className="h-5 w-5 text-gray-500" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t('booking.settingsSection3')}
        </h2>
      </div>
      <p className="mb-3 text-xs text-gray-500">{t('booking.blackoutsHint')}</p>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('booking.blackoutAddLabel')}
          </label>
          <DateInput
            value={pending}
            min={todayIso}
            onChange={setPending}
            className="w-44"
          />
        </div>
        <Button
          type="button"
          variant="brand"
          size="sm"
          onClick={addDate}
          disabled={!pending || mut.isPending}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('booking.blackoutAdd')}
        </Button>
      </div>

      {dates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40">
          {t('booking.blackoutsEmpty')}
        </div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {dates.map((d) => {
            const dateObj = new Date(d + 'T00:00:00')
            const label = dateObj.toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
            return (
              <li
                key={d}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200"
              >
                {label}
                <button
                  type="button"
                  onClick={() => removeDate(d)}
                  className="rounded-full p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
                  aria-label={t('booking.blackoutRemove')}
                  disabled={mut.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function AddStaffSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [name, setName] = useState('')

  const mut = useMutation({
    mutationFn: () => addBookingStaff({ data: { name: name.trim() } }),
    onSuccess: async () => {
      setName('')
      toast({ title: t('booking.staffAdded'), variant: 'success' })
      await onSaved()
    },
    onError: (err) =>
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      }),
  })

  if (!open) return null

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('booking.addStaffNoLogin')}</SheetTitle>
        <SheetDescription>{t('booking.addStaffNoLoginDesc')}</SheetDescription>
      </SheetHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          mut.mutate()
        }}
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('booking.staffNameLabel')}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('booking.staffNamePlaceholder')}
              autoFocus
              required
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            disabled={!name.trim()}
            loading={mut.isPending}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
