/**
 * JUR-167: queue-mode view for cuci motor / IGD klinik tenants.
 *
 * Replaces the day/week/month calendar when `booking_settings.mode='queue'`.
 * One column per active resource; each column shows the in-progress ticket
 * (with a "Selesai" button) on top and the FIFO pending queue below.
 *
 * Server fns:
 *   createQueueTicket — auto-routes to shortest queue, assigns ticket number
 *   startQueueTicket   — pending → in_progress
 *   completeQueueTicket — in_progress → completed + endAt stamp
 *   cancelQueueTicket  — any active → cancelled
 *   toggleResourcePause — flips bookingResources.isPaused (router skips paused)
 *
 * Deferred (later tickets): WA notifications, drag-reorder, rolling-30d
 * wait estimates. v1 shows "Antrian: N" — number of tickets ahead — which
 * the operator already knows visually but is useful for verbal calling.
 */
import { useState, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  getBookingResources,
  getBookingServices,
  getQueueSnapshot,
  createQueueTicket,
  startQueueTicket,
  completeQueueTicket,
  cancelQueueTicket,
  toggleResourcePause,
  searchBookingCustomers,
} from '@/server/functions/booking'
import { formatRupiah } from '@/lib/currency'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { FormField } from '@/components/forms/form-field'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import {
  Play,
  Check,
  X as XIcon,
  Plus,
  PauseCircle,
  PlayCircle,
  Clock,
  Users,
} from 'lucide-react'

type Resource = Awaited<ReturnType<typeof getBookingResources>>[number]
type Ticket = Awaited<ReturnType<typeof getQueueSnapshot>>[number]
type Service = Awaited<ReturnType<typeof getBookingServices>>[number]

export function QueueView({
  branchId,
  resources,
  services,
}: {
  branchId: string | null
  resources: Resource[]
  services: Service[]
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [creatingForResourceId, setCreatingForResourceId] = useState<string | null | 'auto'>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  const { data: queue = [] } = useQuery({
    queryKey: ['booking', 'queue'],
    queryFn: () => getQueueSnapshot(),
    refetchInterval: 15_000,
  })

  const startMut = useMutation({
    mutationFn: (id: string) => startQueueTicket({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['booking', 'queue'] })
      await router.invalidate()
    },
    onError: (err) => toastError(t, toast, err),
  })

  const completeMut = useMutation({
    mutationFn: (id: string) => completeQueueTicket({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['booking', 'queue'] })
      await router.invalidate()
      toast({ title: t('queue.completed'), variant: 'success' })
    },
    onError: (err) => toastError(t, toast, err),
  })

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelQueueTicket({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['booking', 'queue'] })
      await router.invalidate()
      setCancelingId(null)
      toast({ title: t('queue.cancelled'), variant: 'success' })
    },
    onError: (err) => {
      toastError(t, toast, err)
      setCancelingId(null)
    },
  })

  const pauseMut = useMutation({
    mutationFn: ({ id, isPaused }: { id: string; isPaused: boolean }) =>
      toggleResourcePause({ data: { id, isPaused } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['booking'] })
      await router.invalidate()
    },
    onError: (err) => toastError(t, toast, err),
  })

  const displayResources = resources.filter((r) => r.isActive)
  const ticketsByResource = new Map<string, Ticket[]>()
  for (const r of displayResources) ticketsByResource.set(r.id, [])
  for (const t of queue) {
    if (!t.resourceId) continue
    const arr = ticketsByResource.get(t.resourceId)
    if (arr) arr.push(t)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Users className="h-4 w-4" />
          {t('queue.totalLabel', { count: queue.length })}
        </div>
        <Button
          variant="brand"
          size="sm"
          onClick={() => setCreatingForResourceId('auto')}
          disabled={displayResources.length === 0}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t('queue.addTicket')}
        </Button>
      </div>

      {displayResources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
          {t('queue.noResources')}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {displayResources.map((r) => (
            <ResourceColumn
              key={r.id}
              resource={r}
              tickets={ticketsByResource.get(r.id) ?? []}
              onAddTicket={() => setCreatingForResourceId(r.id)}
              onStart={(id) => startMut.mutate(id)}
              onComplete={(id) => completeMut.mutate(id)}
              onCancel={(id) => setCancelingId(id)}
              onTogglePause={() => pauseMut.mutate({ id: r.id, isPaused: !r.isPaused })}
              startPending={startMut.isPending}
              completePending={completeMut.isPending}
            />
          ))}
        </div>
      )}

      <CreateQueueTicketSheet
        resourceIdHint={
          creatingForResourceId === 'auto' || !creatingForResourceId
            ? null
            : creatingForResourceId
        }
        open={creatingForResourceId !== null}
        services={services}
        branchId={branchId}
        onClose={() => setCreatingForResourceId(null)}
        onCreated={async () => {
          await queryClient.invalidateQueries({ queryKey: ['booking', 'queue'] })
          await router.invalidate()
          setCreatingForResourceId(null)
        }}
      />

      <ConfirmDialog
        open={!!cancelingId}
        onCancel={() => setCancelingId(null)}
        onConfirm={() => cancelingId && cancelMut.mutate(cancelingId)}
        title={t('queue.cancelConfirmTitle')}
        description={t('queue.cancelConfirmDesc')}
        confirmText={t('queue.cancel')}
        variant="danger"
      />
    </div>
  )
}

function ResourceColumn({
  resource,
  tickets,
  onAddTicket,
  onStart,
  onComplete,
  onCancel,
  onTogglePause,
  startPending,
  completePending,
}: {
  resource: Resource
  tickets: Ticket[]
  onAddTicket: () => void
  onStart: (id: string) => void
  onComplete: (id: string) => void
  onCancel: (id: string) => void
  onTogglePause: () => void
  startPending: boolean
  completePending: boolean
}) {
  const { t } = useTranslation()
  const inProgress = tickets.find((tk) => tk.status === 'in_progress')
  const pending = tickets.filter((tk) => tk.status !== 'in_progress')

  return (
    <div
      className={`flex flex-col rounded-xl border bg-white dark:bg-gray-800 ${
        resource.isPaused
          ? 'border-warning-200 dark:border-warning-900/40'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex items-center justify-between border-b border-gray-200 p-3 dark:border-gray-700">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-gray-900 dark:text-gray-100">
            {resource.name}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {t('queue.queueLength', { count: pending.length })}
            {resource.isPaused && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] font-medium text-warning-800 dark:bg-warning-900/30 dark:text-warning-300">
                {t('queue.pausedBadge')}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onTogglePause}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
          aria-label={resource.isPaused ? t('queue.unpause') : t('queue.pause')}
          title={resource.isPaused ? t('queue.unpause') : t('queue.pause')}
        >
          {resource.isPaused ? (
            <PlayCircle className="h-4 w-4" />
          ) : (
            <PauseCircle className="h-4 w-4" />
          )}
        </button>
      </div>

      {inProgress && (
        <div className="border-b border-gray-200 bg-success-50 p-3 dark:border-gray-700 dark:bg-success-950/20">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-lg font-bold text-gray-900 dark:text-gray-100">
                  {inProgress.ticketNumber ?? '#?'}
                </span>
                <span className="rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success-800 dark:bg-success-900/30 dark:text-success-300">
                  {t('queue.inProgress')}
                </span>
              </div>
              <p className="mt-0.5 truncate text-sm text-gray-700 dark:text-gray-300">
                {inProgress.publicName ?? 'Pelanggan'}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                <Clock className="mr-1 inline h-3 w-3" />
                {t('queue.startedAt', {
                  time: new Date(inProgress.startAt).toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </p>
            </div>
            <Button
              type="button"
              variant="brand"
              size="sm"
              onClick={() => onComplete(inProgress.id)}
              disabled={completePending}
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              {t('queue.complete')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 divide-y divide-gray-100 dark:divide-gray-700">
        {pending.length === 0 && !inProgress && (
          <div className="px-3 py-6 text-center text-xs text-gray-400">
            {t('queue.empty')}
          </div>
        )}
        {pending.map((tk, idx) => (
          <div key={tk.id} className="flex items-start gap-2 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {tk.ticketNumber ?? '#?'}
                </span>
                <span className="text-[10px] text-gray-400">
                  {t('queue.positionShort', { n: idx + 1 + (inProgress ? 1 : 0) })}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-gray-700 dark:text-gray-300">
                {tk.publicName ?? 'Pelanggan'}
              </p>
            </div>
            {idx === 0 && !inProgress && (
              <Button
                type="button"
                variant="brand"
                size="sm"
                onClick={() => onStart(tk.id)}
                disabled={startPending}
                className="shrink-0"
              >
                <Play className="mr-1 h-3 w-3" />
                {t('queue.start')}
              </Button>
            )}
            <button
              type="button"
              onClick={() => onCancel(tk.id)}
              className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
              aria-label={t('queue.cancel')}
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 p-2 dark:border-gray-700">
        <button
          type="button"
          onClick={onAddTicket}
          disabled={resource.isPaused}
          className="flex w-full items-center justify-center gap-1 rounded py-1.5 text-xs text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-950/20"
        >
          <Plus className="h-3 w-3" />
          {t('queue.addToThisResource')}
        </button>
      </div>
    </div>
  )
}

function CreateQueueTicketSheet({
  open,
  resourceIdHint,
  services,
  branchId,
  onClose,
  onCreated,
}: {
  open: boolean
  resourceIdHint: string | null
  services: Service[]
  branchId: string | null
  onClose: () => void
  onCreated: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Array<{ id: string; name: string; phone: string | null }>>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string } | null>(null)
  const [publicName, setPublicName] = useState('')
  const [publicPhone, setPublicPhone] = useState('')
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const mut = useMutation({
    mutationFn: () =>
      createQueueTicket({
        data: {
          branchId,
          customerId: selectedCustomer?.id,
          publicName: selectedCustomer ? undefined : publicName.trim() || undefined,
          publicPhone: selectedCustomer ? undefined : publicPhone.trim() || undefined,
          resourceId: resourceIdHint ?? undefined,
          serviceIds: selectedServiceIds,
          note: note.trim() || undefined,
          source: 'walk_in',
        },
      }),
    onSuccess: async (booking) => {
      toast({
        title: t('queue.ticketCreated', { number: booking?.ticketNumber ?? '#?' }),
        variant: 'success',
      })
      setCustomerSearch('')
      setSelectedCustomer(null)
      setPublicName('')
      setPublicPhone('')
      setSelectedServiceIds([])
      setNote('')
      await onCreated()
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
        <SheetTitle>{t('queue.addTicket')}</SheetTitle>
        <SheetDescription>
          {resourceIdHint ? t('queue.addToSpecificDesc') : t('queue.addAutoDesc')}
        </SheetDescription>
      </SheetHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          if (!selectedCustomer && !publicName.trim()) return
          mut.mutate()
        }}
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <FormField label={t('queue.customer')}>
            <div className="relative">
              <Input
                placeholder={t('queue.customerPlaceholder')}
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
                      <span className="font-medium text-gray-900 dark:text-gray-100">{c.name}</span>
                      {c.phone && <span className="ml-2 text-gray-500">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </FormField>

          {!selectedCustomer && (
            <>
              <FormField label={t('queue.publicName')}>
                <Input value={publicName} onChange={(e) => setPublicName(e.target.value)} />
              </FormField>
              <FormField label={t('queue.publicPhone')}>
                <Input value={publicPhone} onChange={(e) => setPublicPhone(e.target.value)} />
              </FormField>
            </>
          )}

          <FormField label={t('queue.service')}>
            {services.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/40">
                {t('booking.serviceEmpty')}
              </p>
            ) : (
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
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {formatRupiah(Number(s.price))}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </FormField>

          <FormField label={t('queue.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            disabled={(!selectedCustomer && !publicName.trim()) || mut.isPending}
            loading={mut.isPending}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('queue.addTicket')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toastError(t: (k: string) => string, toast: any, err: unknown) {
  let message = err instanceof Error ? err.message : 'Gagal'
  try {
    const parsed = JSON.parse(message)
    if (parsed?.message) message = parsed.message
  } catch {
    // Plain string error — keep as-is.
  }
  toast({ title: t('common.toastFailedTitle'), description: message, variant: 'error' })
}
