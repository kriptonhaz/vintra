import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus, Wifi, WifiOff, Trash2, AlertTriangle } from 'lucide-react'
import { formatDate, formatNumberID } from '@/lib/utils' // JUR-137
import { listWaInstances, createWaInstance, deleteWaInstance, getWaSubscription } from '@/server/functions/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { Sheet, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export const Route = createFileRoute('/_authed/whatsapp/')({
  loader: async () => {
    const subscription = await getWaSubscription().catch(() => null)
    return { subscription }
  },
  component: WhatsappListPage,
})

const STATUS_LABEL: Record<string, string> = {
  connected: 'Tersambung',
  connecting: 'Menyambung',
  qr: 'Pindai QR',
  disconnected: 'Terputus',
  logged_out: 'Logout',
  banned: 'Diblokir',
}

const STATUS_COLOR: Record<string, string> = {
  connected: 'text-success-600 bg-success-50 dark:bg-success-900/20',
  connecting: 'text-warning-700 bg-warning-50 dark:bg-warning-900/20',
  qr: 'text-primary-600 bg-primary-50 dark:bg-primary-900/20',
  disconnected: 'text-gray-500 bg-gray-100 dark:bg-gray-700',
  logged_out: 'text-red-600 bg-red-50 dark:bg-red-900/20',
  banned: 'text-red-700 bg-red-100 dark:bg-red-900/30',
}

function WhatsappListPage() {
  const { subscription } = Route.useLoaderData()
  // canManage is forwarded from the _authed/whatsapp layout. Supervisors
  // have whatsapp.read but not whatsapp.manage — they can browse the
  // list but shouldn't see pair-new / delete affordances.
  const { wa } = Route.useRouteContext() as { wa: { canManage: boolean } }
  const canManage = wa?.canManage ?? false
  const { toast } = useToast()
  const [showCreate, setShowCreate] = React.useState(false)
  const [label, setLabel] = React.useState('')
  const [deleteId, setDeleteId] = React.useState<string | null>(null)

  const { data: instances = [], refetch } = useQuery({
    queryKey: ['wa-instances'],
    queryFn: () => listWaInstances(),
    refetchInterval: 5_000,
  })

  const create = useMutation({
    mutationFn: () => createWaInstance({ data: { label: label.trim() } }),
    onSuccess: () => {
      toast({ title: 'Instance dibuat', variant: 'success' })
      setShowCreate(false)
      setLabel('')
      refetch()
    },
    onError: (e: Error) => toast({ title: 'Gagal', description: e.message, variant: 'error' }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteWaInstance({ data: { id } }),
    onSuccess: () => {
      toast({ title: 'Instance dihapus', variant: 'success' })
      setDeleteId(null)
      refetch()
    },
    onError: (e: Error) => toast({ title: 'Gagal', description: e.message, variant: 'error' }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">WhatsApp</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Kelola akun WhatsApp untuk otomasi pesan.
          </p>
        </div>
        {canManage &&
          (() => {
            // Disable "Tambah WhatsApp" when the tenant has already hit
            // their subscription's maxInstances. Tooltip explains why so
            // the operator doesn't blame us. subscription==null (rare —
            // fallback when getWaSubscription fails at loader) is treated
            // as "no cap" so the user isn't locked out by a transient error.
            const atLimit =
              subscription !== null &&
              subscription.maxInstances > 0 &&
              instances.length >= subscription.maxInstances
            return (
              <Button
                variant="brand"
                onClick={() => setShowCreate(true)}
                disabled={atLimit}
                title={
                  atLimit
                    ? `Paket ${TIER_LABEL[subscription!.tier] ?? subscription!.tier} hanya mendukung ${subscription!.maxInstances} instansi. Upgrade untuk menambah.`
                    : undefined
                }
              >
                <Plus className="h-4 w-4" /> Tambah WhatsApp
              </Button>
            )
          })()}
      </div>

      {/* Subscription usage card */}
      {subscription && subscription.maxMonthlyReplies > 0 && (
        <SubscriptionCard subscription={subscription} />
      )}

      {instances.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center dark:border-gray-600">
          <Wifi className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-500">Belum ada akun WhatsApp. Tambah sekarang.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {instances.map((inst: { id: string; label: string; status: string; phoneNumber?: string }) => (
            <div
              key={inst.id}
              className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-gray-900 dark:text-gray-100">
                    {inst.label}
                  </p>
                  {inst.phoneNumber && (
                    <p className="text-xs text-gray-500">+{inst.phoneNumber}</p>
                  )}
                </div>
                {canManage && (
                  <button
                    onClick={() => setDeleteId(inst.id)}
                    className="ml-2 rounded p-1 text-gray-400 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[inst.status] ?? STATUS_COLOR.disconnected}`}
                >
                  {inst.status === 'connected' ? (
                    <Wifi className="h-3 w-3" />
                  ) : (
                    <WifiOff className="h-3 w-3" />
                  )}
                  {STATUS_LABEL[inst.status] ?? inst.status}
                </span>
                <Link
                  to="/whatsapp/$id"
                  params={{ id: inst.id }}
                  className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  Kelola →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create sheet */}
      <Sheet open={showCreate} onClose={() => setShowCreate(false)}>
        <SheetHeader onClose={() => setShowCreate(false)}>
          <SheetTitle>Tambah Akun WhatsApp</SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col px-6 py-5">
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Label *
          </label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="mis. Toko Pusat"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Batal</Button>
          <Button
            variant="brand"
            disabled={!label.trim() || create.isPending}
            onClick={() => create.mutate()}
            loading={create.isPending}
          >
            Buat
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!deleteId}
        title="Hapus instance?"
        description="Semua pesan dan kontak terkait akan ikut terhapus."
        confirmText="Hapus"
        variant="danger"
        onConfirm={() => deleteId && remove.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
        loading={remove.isPending}
      />
    </div>
  )
}

// ─── Subscription usage card ─────────────────────────────────────────────────

const TIER_LABEL: Record<string, string> = {
  basic: 'Basic',
  komplit: 'Komplit',
  enterprise: 'Enterprise',
}

function SubscriptionCard({ subscription }: {
  subscription: { tier: string; maxInstances: number; maxMonthlyReplies: number; usedReplies: number; subscriptionExpiresAt: string | null }
}) {
  const pct = Math.min(100, Math.round((subscription.usedReplies / subscription.maxMonthlyReplies) * 100))
  const nearLimit = pct >= 90

  return (
    <div className={`rounded-xl border p-5 ${nearLimit ? 'border-warning-300 bg-warning-50 dark:border-warning-700 dark:bg-warning-900/20' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
            {TIER_LABEL[subscription.tier] ?? subscription.tier}
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Maks. {subscription.maxInstances} instansi
          </span>
          {subscription.subscriptionExpiresAt && (
            <span className="text-xs text-gray-400">
              Aktif s/d {formatDate(subscription.subscriptionExpiresAt, 'dd MMM yyyy')}
            </span>
          )}
        </div>
        {nearLimit && (
          <span className="flex items-center gap-1 text-sm font-medium text-warning-700 dark:text-warning-400">
            <AlertTriangle className="h-4 w-4" /> Hampir mencapai batas
          </span>
        )}
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Balasan AI bulan ini</span>
          <span>{formatNumberID(subscription.usedReplies)} / {formatNumberID(subscription.maxMonthlyReplies)}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className={`h-2 rounded-full transition-all ${nearLimit ? 'bg-warning-500' : 'bg-brand-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}
