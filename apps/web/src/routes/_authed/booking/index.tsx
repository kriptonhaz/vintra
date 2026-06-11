import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, useMemo, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  getBookingSettings,
  getBookingResources,
  getBookingServices,
  getBookings,
  createBooking,
  updateBookingStatus,
  deleteBooking,
  searchBookingCustomers,
  listBookingBranches,
} from '@/server/functions/booking'
import { formatRupiah } from '@/lib/currency'
import { useBranch } from '@/hooks/use-branch'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { FormField } from '@/components/forms/form-field'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
  Sparkles,
} from 'lucide-react'
import { QueueView } from '@/components/booking/queue-view'

export const Route = createFileRoute('/_authed/booking/')({
  component: BookingCalendarPage,
})

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7)
const DAY_NAMES_SHORT = ['weekSun', 'weekMon', 'weekTue', 'weekWed', 'weekThu', 'weekFri', 'weekSat'] as const
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  confirmed: 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400',
  in_progress: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  completed: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  no_show: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
}

type ViewMode = 'week' | 'day' | 'month'
type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'

function BookingCalendarPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [creatingSlot, setCreatingSlot] = useState<{ resourceId: string; startAt: Date } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  // JUR-183: bookings + greying scope to a branch. The selection now
  // comes from the global topbar branch switcher (seeded from the main
  // branch by BranchProvider) instead of a per-page picker.
  const { selectedBranchId } = useBranch()

  const { data: settings } = useQuery({
    queryKey: ['booking', 'settings'],
    queryFn: () => getBookingSettings(),
  })

  const { data: resources = [] } = useQuery({
    queryKey: ['booking', 'resources'],
    queryFn: () => getBookingResources(),
  })

  const { data: services = [] } = useQuery({
    queryKey: ['booking', 'services'],
    queryFn: () => getBookingServices(),
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['booking', 'branches'],
    queryFn: () => listBookingBranches(),
  })

  const selectedBranch = branches.find((b) => b.id === selectedBranchId) ?? null

  const dateRange = useMemo(() => {
    const start = new Date(currentDate)
    const end = new Date(currentDate)
    if (viewMode === 'week') {
      const day = start.getDay()
      start.setDate(start.getDate() - day)
      start.setHours(0, 0, 0, 0)
      end.setDate(start.getDate() + 6)
    } else if (viewMode === 'month') {
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      end.setMonth(end.getMonth() + 1)
      end.setDate(0)
    }
    end.setHours(23, 59, 59, 999)
    return { startDate: start.toISOString(), endDate: end.toISOString() }
  }, [currentDate, viewMode])

  const { data: rawBookingList = [] } = useQuery({
    queryKey: ['booking', 'list', dateRange],
    queryFn: () => getBookings({ data: dateRange }),
  })

  const bookingList = useMemo(
    () =>
      rawBookingList
        // JUR-183: scope to selected branch. Legacy bookings with null
        // branch_id show in every branch view (until the admin retro-
        // assigns them — could happen via direct SQL or a future tool).
        .filter((b) => !selectedBranchId || !b.branchId || b.branchId === selectedBranchId)
        .map((b) => ({
          ...b,
          startAt: b.startAt.toISOString(),
          endAt: b.endAt?.toISOString() ?? null,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
        })),
    [rawBookingList, selectedBranchId],
  )

  const weekDays = useMemo(() => {
    if (viewMode !== 'week') return []
    const days: Date[] = []
    const start = new Date(dateRange.startDate)
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      days.push(d)
    }
    return days
  }, [dateRange])

  const createMut = useMutation({
    mutationFn: (data: { resourceId: string; startAt: string; customerId?: string; publicName?: string; publicPhone?: string; serviceIds: string[]; note?: string; source: 'walk_in' | 'public_page' | 'wa' | 'manual' }) =>
      createBooking({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking', 'list'] })
      setCreatingSlot(null)
    },
  })

  const updateStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BookingStatus }) =>
      updateBookingStatus({ data: { id, status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking', 'list'] }),
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteBooking({ data: { id: deleteId! } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking', 'list'] })
      setDeleteId(null)
    },
  })

  function navigate(direction: -1 | 1) {
    const d = new Date(currentDate)
    if (viewMode === 'week') d.setDate(d.getDate() + direction * 7)
    else if (viewMode === 'day') d.setDate(d.getDate() + direction)
    else d.setMonth(d.getMonth() + direction)
    setCurrentDate(d)
  }

  function goToday() {
    setCurrentDate(new Date())
  }

  const headerLabel = useMemo(() => {
    if (viewMode === 'month') {
      return currentDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    }
    if (viewMode === 'week') {
      const start = weekDays[0]
      const end = weekDays[6]
      if (!start || !end) return ''
      const fmtStart = start.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
      const fmtEnd = end.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
      return `${fmtStart} - ${fmtEnd}`
    }
    return currentDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }, [currentDate, viewMode, weekDays])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (settings && !settings.setupCompleted) {
    return (
      <div className="mx-auto max-w-lg py-20">
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title={t('booking.noSetup')}
          description={t('booking.noSetupDesc')}
          action={
            <Button variant="brand" onClick={() => router.navigate({ to: '/booking/settings' })}>
              {t('booking.startSetup')}
            </Button>
          }
        />
      </div>
    )
  }

  // JUR-167: queue-mode tenants get a totally different UI — no day /
  // week / month calendar, no time slots. Render the FIFO queue view
  // and bail before the calendar scaffolding.
  if (settings?.mode === 'queue') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ModuleBreadcrumb />
        </div>
        <QueueView branchId={selectedBranchId} resources={resources} services={services} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <ModuleBreadcrumb />
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
            {(['week', 'day', 'month'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-brand-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
              >
                {t(`booking.${mode}View`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <ChevronLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </button>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {headerLabel}
              </h2>
              <button
                type="button"
                onClick={() => navigate(1)}
                className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <ChevronRight className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="brand"
                size="sm"
                onClick={() => {
                  // Pre-select first active resource + next hour for quick
                  // entry. Empty resources case is rare (settings would
                  // gate it earlier), but guard just in case.
                  if (resources.length === 0) return
                  const startAt = new Date()
                  startAt.setMinutes(0, 0, 0)
                  startAt.setHours(startAt.getHours() + 1)
                  setCreatingSlot({ resourceId: resources[0]!.id, startAt })
                }}
                disabled={resources.length === 0}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('booking.createBookingBtn')}
              </Button>
              <Button variant="ghost" size="sm" onClick={goToday}>
                {t('booking.today')}
              </Button>
            </div>
          </div>

          {viewMode === 'month' ? (
            <MonthView
              date={currentDate}
              bookingList={bookingList}
              today={today}
              onDayClick={(day) => {
                setCurrentDate(day)
                setViewMode('day')
              }}
            />
          ) : (
            <DayColumnView
              days={viewMode === 'week' ? weekDays : [currentDate]}
              hours={HOURS}
              resources={resources}
              bookingList={bookingList}
              today={today}
              slotDurationMin={settings?.slotDurationMin ?? 30}
              businessHours={selectedBranch?.businessHours ?? null}
              onSlotClick={(resourceId, startAt) => setCreatingSlot({ resourceId, startAt })}
              onBookingClick={(id) => setEditingId(id)}
            />
          )}
        </CardContent>
      </Card>

      <CreateBookingSheet
        slot={creatingSlot}
        resources={resources}
        services={services}
        branchId={selectedBranchId}
        onClose={() => setCreatingSlot(null)}
        onSubmit={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />

      <EditBookingSheet
        bookingId={editingId}
        booking={bookingList.find((b) => b.id === editingId) ?? null}
        resources={resources}
        services={services}
        onClose={() => setEditingId(null)}
        onUpdateStatus={(id, status) => updateStatusMut.mutate({ id, status })}
        onDelete={(id) => setDeleteId(id)}
      />

      <ConfirmDialog
        open={!!deleteId}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate()}
        title="Hapus Booking"
        description="Yakin ingin menghapus booking ini?"
        confirmText="Hapus"
        variant="danger"
      />
    </div>
  )
}

type BusinessHours = Array<{ day: number; open: string; close: string }> | null

function DayColumnView({
  days,
  hours,
  resources,
  bookingList,
  today,
  businessHours,
  onSlotClick,
  onBookingClick,
}: {
  days: Date[]
  hours: number[]
  resources: Array<{ id: string; name: string; kind: string }>
  bookingList: Array<{ id: string; resourceId: string | null; publicName: string | null; startAt: string; endAt: string | null; status: string }>
  today: Date
  slotDurationMin: number
  businessHours: BusinessHours
  onSlotClick: (resourceId: string, startAt: Date) => void
  onBookingClick: (id: string) => void
}) {
  const { t } = useTranslation()

  const getBookingsForSlot = useCallback(
    (resourceId: string, hour: number, day: Date) => {
      const slotStart = new Date(day)
      slotStart.setHours(hour, 0, 0, 0)
      const slotEnd = new Date(slotStart)
      slotEnd.setHours(hour + 1, 0, 0, 0)
      return bookingList.filter((b) => {
        if (b.resourceId !== resourceId) return false
        const bs = new Date(b.startAt)
        return bs >= slotStart && bs < slotEnd
      })
    },
    [bookingList],
  )

  /**
   * JUR-183: returns true when the (day, hour) slot is within the
   * branch's business hours. When businessHours is null (branch not
   * configured) we always allow — same null-gating server-side enforcement
   * uses, so the UI stays consistent with what createBooking accepts.
   */
  const isWithinHours = useCallback(
    (day: Date, hour: number): boolean => {
      if (!businessHours || businessHours.length === 0) return true
      const dayHours = businessHours.find((h) => h.day === day.getDay())
      if (!dayHours) return false
      const timeStr = `${hour.toString().padStart(2, '0')}:00`
      return timeStr >= dayHours.open && timeStr < dayHours.close
    },
    [businessHours],
  )

  const displayResources = resources.length > 0 ? resources : [{ id: 'none', name: 'Tanpa Staf', kind: 'staff' as const }]

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[500px]">
        {days.map((day, di) => {
          const isToday = day.getTime() === today.getTime()
          const dayKey = DAY_NAMES_SHORT[day.getDay()]! as string
          return (
            <div key={di} className={di > 0 ? 'mt-6' : ''}>
              <div
                className="grid border-b border-gray-200 dark:border-gray-700"
                style={{ gridTemplateColumns: `60px repeat(${displayResources.length}, 1fr)` }}
              >
                <div />
                {displayResources.map((r) => (
                  <div key={r.id} className="px-1">
                    <div
                      className={`px-2 py-2 text-center text-xs font-medium ${
                        isToday
                          ? 'rounded-t-lg bg-brand-50 text-brand-700 dark:bg-brand-950/20 dark:text-brand-400'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <div>{t(dayKey)}</div>
                      <div className="text-lg font-bold">{day.getDate()}</div>
                    </div>
                    <div className="text-center text-xs text-gray-400">{r.name}</div>
                  </div>
                ))}
              </div>
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="grid border-b border-gray-100 dark:border-gray-700"
                  style={{ gridTemplateColumns: `60px repeat(${displayResources.length}, 1fr)` }}
                >
                  <div className="border-r border-gray-100 py-3 pr-2 text-right text-xs text-gray-400 dark:border-gray-700">
                    {hour.toString().padStart(2, '0')}:00
                  </div>
                  {displayResources.map((r) => {
                    const slotBookings = getBookingsForSlot(r.id, hour, day)
                    const inHours = isWithinHours(day, hour)
                    return (
                      <div
                        key={r.id}
                        className={`relative min-h-[52px] border-r border-gray-100 p-0.5 transition-colors dark:border-gray-700 ${
                          inHours
                            ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800'
                            : 'cursor-not-allowed bg-gray-50 dark:bg-gray-800/40'
                        }`}
                      >
                        {slotBookings.map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => onBookingClick(b.id)}
                            className={`mb-0.5 w-full truncate rounded px-1.5 py-1 text-left text-xs font-medium ${
                              STATUS_COLORS[b.status] ?? STATUS_COLORS.confirmed
                            }`}
                          >
                            {b.publicName ?? 'Pelanggan'}
                          </button>
                        ))}
                        {slotBookings.length === 0 && inHours && (
                          <button
                            type="button"
                            className="absolute inset-0"
                            onClick={() => {
                              const startAt = new Date(day)
                              startAt.setHours(hour, 0, 0, 0)
                              onSlotClick(r.id, startAt)
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthView({
  date,
  bookingList,
  today,
  onDayClick,
}: {
  date: Date
  bookingList: Array<{ id: string; startAt: string; publicName: string | null; status: string }>
  today: Date
  onDayClick: (day: Date) => void
}) {
  const { t } = useTranslation()
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const startPad = firstDay.getDay()
  const totalDays = lastDay.getDate()

  const cells: Array<Date | null> = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) {
    cells.push(new Date(date.getFullYear(), date.getMonth(), d))
  }

  const getBookingsForDay = useCallback(
    (day: Date) => {
      const dayStart = new Date(day)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(day)
      dayEnd.setHours(23, 59, 59, 999)
      return bookingList.filter((b) => {
        const bs = new Date(b.startAt)
        return bs >= dayStart && bs <= dayEnd
      })
    },
    [bookingList],
  )

  return (
    <div>
      <div className="mb-1 grid grid-cols-7">
        {DAY_NAMES_SHORT.map((key) => (
          <div
            key={key}
            className="py-1 text-center text-xs font-medium text-gray-500 dark:text-gray-400"
          >
            {t(key)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-t border-l border-gray-200 dark:border-gray-700">
        {cells.map((cell, i) => {
          if (!cell) {
            return (
              <div
                key={i}
                className="border-b border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
              />
            )
          }
          const isToday = cell.getTime() === today.getTime()
          const dayBookings = getBookingsForDay(cell)
          return (
            <button
              key={i}
              type="button"
              onClick={() => onDayClick(cell)}
              className={`min-h-[80px] border-b border-r border-gray-200 p-1 text-left transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 ${
                isToday ? 'bg-brand-50/30 dark:bg-brand-950/10' : ''
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  isToday
                    ? 'bg-brand-600 font-bold text-white'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {cell.getDate()}
              </span>
              <div className="mt-0.5 space-y-0.5">
                {dayBookings.slice(0, 3).map((b) => (
                  <div
                    key={b.id}
                    className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${
                      STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-500 dark:bg-gray-700'
                    }`}
                  >
                    {b.publicName ?? 'Booking'}
                  </div>
                ))}
                {dayBookings.length > 3 && (
                  <div className="text-[10px] text-gray-400">
                    +{dayBookings.length - 3}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CreateBookingSheet({
  slot,
  resources,
  services,
  branchId,
  onClose,
  onSubmit,
  loading,
}: {
  slot: { resourceId: string; startAt: Date } | null
  resources: Array<{ id: string; name: string; kind: string }>
  services: Array<{ id: string; name: string; durationMin: number; price: string; color: string | null; linkedHppProductId?: string | null }>
  branchId: string | null
  onClose: () => void
  onSubmit: (data: { resourceId: string; startAt: string; branchId?: string | null; customerId?: string; publicName?: string; publicPhone?: string; serviceIds: string[]; note?: string; source: 'walk_in' | 'public_page' | 'wa' | 'manual' }) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Array<{ id: string; name: string; phone: string | null }>>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string } | null>(null)
  const [publicName, setPublicName] = useState('')
  const [publicPhone, setPublicPhone] = useState('')
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedResource = resources.find((r) => r.id === slot?.resourceId)

  function handleCustomerSearch(q: string) {
    setCustomerSearch(q)
    setSelectedCustomer(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (q.length < 2) {
      setCustomerResults([])
      setShowDropdown(false)
      return
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await searchBookingCustomers({ data: { search: q } })
        setCustomerResults(results)
        setShowDropdown(results.length > 0)
      } catch {
        setCustomerResults([])
      }
    }, 300)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    if (!slot) return
    if (!selectedCustomer && !publicName.trim()) {
      setSubmitError('Nama pelanggan wajib diisi')
      return
    }
    onSubmit({
      resourceId: slot.resourceId,
      startAt: slot.startAt.toISOString(),
      branchId,
      customerId: selectedCustomer?.id,
      publicName: selectedCustomer ? undefined : (publicName.trim() || undefined),
      publicPhone: selectedCustomer ? undefined : (publicPhone.trim() || undefined),
      serviceIds: selectedServiceIds,
      note: note.trim() || undefined,
      source: 'manual',
    })
  }

  // JUR-183: show an HPP-deduction hint when ANY picked service is
  // linked to an HPP product. Sets expectation that completing the
  // booking will eventually trigger BOM-driven stock deduction (full
  // auto-conversion lands in JUR-178 tenant public site; for now the
  // hint just primes the tenant for that flow).
  const anySelectedServiceLinksHpp = services.some(
    (s) => selectedServiceIds.includes(s.id) && s.linkedHppProductId,
  )

  if (!slot) return null

  return (
    <Sheet open={!!slot} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('booking.createBooking')}</SheetTitle>
        <SheetDescription>
          {slot.startAt.toLocaleDateString('id-ID', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}{' '}
          {slot.startAt.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {selectedResource ? ` — ${selectedResource.name}` : ''}
        </SheetDescription>
      </SheetHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <FormField label={t('booking.customer')}>
            <div className="relative">
              <Input
                placeholder={t('booking.customerPlaceholder')}
                value={customerSearch}
                onChange={(e) => handleCustomerSearch(e.target.value)}
                onFocus={() => {
                  if (customerResults.length > 0) setShowDropdown(true)
                }}
              />
              {showDropdown && customerResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                  {customerResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                      onClick={() => {
                        setSelectedCustomer(c)
                        setCustomerSearch(c.name)
                        setShowDropdown(false)
                      }}
                    >
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {c.name}
                      </span>
                      {c.phone && (
                        <span className="ml-2 text-gray-500">{c.phone}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </FormField>

          {!selectedCustomer && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-gray-700" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-2 text-xs text-gray-400 dark:bg-gray-900">
                    atau isi data pelanggan baru
                  </span>
                </div>
              </div>

              <FormField label={t('booking.publicName')}>
                <Input value={publicName} onChange={(e) => setPublicName(e.target.value)} />
              </FormField>

              <FormField label={t('booking.publicPhone')}>
                <Input value={publicPhone} onChange={(e) => setPublicPhone(e.target.value)} />
              </FormField>
            </>
          )}

          <FormField label={t('booking.service')}>
            {services.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/40">
                {t('booking.serviceEmpty')}
              </p>
            ) : null}
            <div className="space-y-1.5">
              {services.map((s) => {
                const sel = selectedServiceIds.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setSelectedServiceIds((prev) =>
                        prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                      )
                    }
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      sel
                        ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/20'
                        : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: s.color ?? '#677084' }}
                      />
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {s.name}
                      </span>
                      <span className="text-xs text-gray-500">{s.durationMin} menit</span>
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {formatRupiah(Number(s.price))}
                    </span>
                  </button>
                )
              })}
            </div>
          </FormField>

          {anySelectedServiceLinksHpp && (
            <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs text-brand-800 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-200">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t('booking.hppLinkHint')}</span>
            </div>
          )}

          <FormField label={t('booking.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>

          {submitError && <p className="text-sm text-danger-500">{submitError}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" disabled={loading}>
            {loading ? 'Memproses...' : t('booking.createBooking')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function EditBookingSheet({
  bookingId,
  booking,
  resources,
  services,
  onClose,
  onUpdateStatus,
  onDelete,
}: {
  bookingId: string | null
  booking: {
    id: string
    status: string
    publicName: string | null
    startAt: string
    endAt: string | null
    note: string | null
    customerId: string | null
    serviceIds: string[]
    resourceId: string | null
  } | null
  resources: Array<{ id: string; name: string; kind: string }>
  services: Array<{ id: string; name: string }>
  onClose: () => void
  onUpdateStatus: (id: string, status: BookingStatus) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  if (!booking) return null

  const resource = resources.find((r) => r.id === booking.resourceId)
  const bookingSvcs = services.filter((s) => booking.serviceIds.includes(s.id))

  const statusActions: Array<{ label: string; status: BookingStatus }> = [
    { label: t('booking.statusConfirmed'), status: 'confirmed' },
    { label: t('booking.statusInProgress'), status: 'in_progress' },
    { label: t('booking.statusCompleted'), status: 'completed' },
    { label: t('booking.statusCancelled'), status: 'cancelled' },
    { label: t('booking.statusNoShow'), status: 'no_show' },
  ]

  return (
    <Sheet open={!!bookingId} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('booking.editBooking')}</SheetTitle>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              {booking.publicName ?? 'Tanpa Nama'}
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {new Date(booking.startAt).toLocaleDateString('id-ID', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}{' '}
              {new Date(booking.startAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
              {booking.endAt &&
                ` - ${new Date(booking.endAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
            {resource && <p className="text-sm text-gray-500">{resource.name}</p>}
            {bookingSvcs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {bookingSvcs.map((s) => (
                  <Badge key={s.id}>{s.name}</Badge>
                ))}
              </div>
            )}
            {booking.note && <p className="mt-2 text-sm text-gray-500">{booking.note}</p>}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Status</p>
            <div className="flex flex-wrap gap-2">
              {statusActions.map((action) => {
                const isActive = booking.status === action.status
                return (
                  <button
                    key={action.status}
                    type="button"
                    onClick={() => onUpdateStatus(booking.id, action.status)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950/20 dark:text-brand-400'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800'
                    }`}
                  >
                    {action.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <button
              type="button"
              onClick={() => onDelete(booking.id)}
              className="text-sm font-medium text-danger-500 hover:text-danger-600"
            >
              Hapus booking
            </button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            Tutup
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
