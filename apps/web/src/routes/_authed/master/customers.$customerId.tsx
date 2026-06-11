/**
 * Customer detail page (JUR-6) — profile + recent sales timeline.
 * Mobile-responsive: profile stacks above timeline on phone, side-by-side
 * grid on tablet+.
 */
import { useState } from 'react'
import {
  createFileRoute,
  Link,
  useRouter,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Pencil,
  Trash2,
  UserCircle2,
  Phone,
  Mail,
  StickyNote,
  Calendar,
  Sparkles,
  Plus,
  Minus,
  HandCoins,
  Stamp,
  Settings2,
} from 'lucide-react'
import {
  getCustomer,
  upsertCustomer,
  deleteCustomer,
} from '@/server/functions/customers'
import {
  getCustomerLoyaltySummary,
  getPOSSettings,
} from '@/server/functions/pos'
import { getCustomerStampCards } from '@/server/functions/loyalty-stamps'
import { getCustomerKasbon } from '@/server/functions/cashflow-ar'
import { posTierLimits } from '@vintra/shared'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { CustomerFormSheet } from '@/components/pos/customer-form-sheet'
import { AdjustLoyaltyDialog } from '@/components/customer/adjust-loyalty-dialog'
import { formatRupiah } from '@/lib/currency'
import { formatDate, formatNumberID } from '@/lib/utils' // JUR-137

export const Route = createFileRoute('/_authed/master/customers/$customerId')({
  loader: async ({ params }) =>
    getCustomer({ data: { id: params.customerId } }),
  component: CustomerDetailPage,
})

function CustomerDetailPage() {
  const customer = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [adjustPointsOpen, setAdjustPointsOpen] = useState(false)
  // Per-stamp-program adjust dialog — null when closed; programId when open.
  const [adjustStampProgramId, setAdjustStampProgramId] = useState<
    string | null
  >(null)

  // Loyalty section is shown on the customer detail page only when
  // the tenant's POS tier includes `loyalty_points`. We pull settings
  // once for the gate; the actual balance + ledger come from
  // `getCustomerLoyaltySummary`.
  const settings = useQuery({
    queryKey: ['pos', 'settings'],
    queryFn: () => getPOSSettings(),
    staleTime: 5 * 60 * 1000,
  })
  const loyaltyAvailable = settings.data
    ? posTierLimits(settings.data.tier).features.includes('loyalty_points')
    : false
  const loyaltySummary = useQuery({
    queryKey: ['pos', 'loyalty-summary', customer.id],
    queryFn: () =>
      getCustomerLoyaltySummary({ data: { customerId: customer.id } }),
    enabled: loyaltyAvailable,
    staleTime: 30 * 1000,
  })
  // JUR-195: stamp cards. Same Komplit gate as the points balance.
  const stampCards = useQuery({
    queryKey: ['pos', 'stamp-cards', customer.id],
    queryFn: () =>
      getCustomerStampCards({ data: { customerId: customer.id } }),
    enabled: loyaltyAvailable,
    staleTime: 30 * 1000,
  })

  // JUR-191: outstanding kasbon. The server fn returns kasbonEnabled
  // false for non-Komplit tenants, so the card simply doesn't render.
  const kasbonSummary = useQuery({
    queryKey: ['pos', 'kasbon-summary', customer.id],
    queryFn: () => getCustomerKasbon({ data: { customerId: customer.id } }),
    staleTime: 30 * 1000,
  })

  const editMut = useMutation({
    mutationFn: (input: {
      id?: string
      name: string
      phone?: string | null
      email?: string | null
      notes?: string | null
    }) => upsertCustomer({ data: input }),
    onSuccess: async () => {
      setEditOpen(false)
      toast({ title: 'Pelanggan diperbarui', variant: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['pos', 'customers'] })
      await router.invalidate()
    },
    onError: (err) =>
      toast({
        title: 'Gagal menyimpan',
        description: err instanceof Error ? err.message : 'Coba lagi.',
        variant: 'error',
      }),
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteCustomer({ data: { id: customer.id } }),
    onSuccess: async () => {
      toast({ title: 'Pelanggan dihapus', variant: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['pos', 'customers'] })
      navigate({ to: '/master/customers' })
    },
    onError: (err) =>
      toast({
        title: 'Gagal menghapus',
        description: err instanceof Error ? err.message : 'Coba lagi.',
        variant: 'error',
      }),
  })

  return (
    <div className="space-y-6">
      {/* Back nav — mobile-friendly tap target */}
      <Link
        to="/master/customers"
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Kembali ke daftar pelanggan
      </Link>

      {/* Header card — title + aggregates + actions. Stacks on mobile. */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
              <UserCircle2 className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {customer.name}
              </h1>
              <div className="mt-1 space-y-0.5 text-sm text-gray-600 dark:text-gray-400">
                {customer.phone && (
                  <p className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" />
                    <a
                      href={`https://wa.me/${customer.phone}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-brand-700 hover:underline dark:hover:text-brand-300"
                    >
                      +{customer.phone}
                    </a>
                  </p>
                )}
                {customer.email && (
                  <p className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" />
                    <span className="break-all">{customer.email}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-row gap-2 sm:flex-col">
            <Button
              variant="outline"
              onClick={() => setEditOpen(true)}
              className="flex-1 sm:flex-none"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(true)}
              className="flex-1 text-danger-600 hover:bg-danger-50 sm:flex-none dark:text-danger-400 dark:hover:bg-danger-900/20"
            >
              <Trash2 className="h-4 w-4" />
              Hapus
            </Button>
          </div>
        </div>

        {/* Aggregates row — 2 cols on mobile, 3 cols on tablet+ */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Total belanja" value={formatRupiah(customer.totalSpent)} />
          <Stat
            label="Jumlah kunjungan"
            value={`${customer.visitCount}× kunjungan`}
          />
          <Stat
            label="Terakhir transaksi"
            value={
              customer.lastVisitAt ? formatDate(customer.lastVisitAt, 'dd MMM yyyy') : 'Belum pernah'
            }
            className="col-span-2 sm:col-span-1"
          />
        </div>

        {customer.notes && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-accent-50 p-3 text-sm text-accent-900 dark:bg-accent-900/20 dark:text-accent-200">
            <StickyNote className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="whitespace-pre-line">{customer.notes}</p>
          </div>
        )}
      </div>

      {/* Loyalty (Komplit feature). Hidden when the tier doesn't
          include loyalty_points. Shows balance + lifetime totals at
          the top, then the most recent 50 ledger movements. */}
      {loyaltyAvailable && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-600" />
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Loyalty Poin
              </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAdjustPointsOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Sesuaikan
            </Button>
          </div>
          {loyaltySummary.isLoading ? (
            <p className="py-4 text-center text-xs text-gray-500">
              Memuat saldo poin…
            </p>
          ) : loyaltySummary.data ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat
                  label="Saldo aktif"
                  value={formatNumberID(loyaltySummary.data.pointsBalance)}
                />
                <Stat
                  label="Total earned"
                  value={formatNumberID(loyaltySummary.data.lifetimeEarned)}
                />
                <Stat
                  label="Total redeemed"
                  value={formatNumberID(loyaltySummary.data.lifetimeRedeemed)}
                />
              </div>
              <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Riwayat poin
              </h3>
              {loyaltySummary.data.movements.length === 0 ? (
                <p className="py-3 text-center text-xs text-gray-500">
                  Belum ada gerakan poin.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {loyaltySummary.data.movements.map((m) => {
                    const isInflow = m.type === 'earn'
                    const isAdjustReverse =
                      m.type === 'adjust' &&
                      typeof m.reason === 'string' &&
                      m.reason.startsWith('Reverse ')
                    return (
                      <li
                        key={m.id}
                        className="flex items-start gap-3 py-2.5"
                      >
                        <div
                          className={
                            isInflow
                              ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                              : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400'
                          }
                        >
                          {isInflow ? (
                            <Plus className="h-3.5 w-3.5" />
                          ) : (
                            <Minus className="h-3.5 w-3.5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {labelForLoyaltyType(m.type, isAdjustReverse)}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {m.reason ?? '—'} ·{' '}
                            {formatDate(m.createdAt, 'dd MMM yyyy, HH:mm')}
                          </p>
                        </div>
                        <p
                          className={
                            isInflow
                              ? 'text-sm font-semibold text-success-600 dark:text-success-400'
                              : 'text-sm font-semibold text-warning-700 dark:text-warning-400'
                          }
                        >
                          {isInflow ? '+' : '−'}
                          {formatNumberID(m.points)}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Stamp cards (JUR-195). One row per active program. Shows
          the customer's progress toward the next free reward. */}
      {loyaltyAvailable &&
        stampCards.data &&
        stampCards.data.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-3 flex items-center gap-2">
              <Stamp className="h-4 w-4 text-brand-600" />
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Kartu Stempel
              </h2>
            </div>
            <ul className="space-y-3">
              {stampCards.data.map((c) => (
                <li
                  key={c.programId}
                  className="rounded-lg border border-gray-100 p-3 dark:border-gray-700"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {c.programName}
                    </p>
                    <div className="flex items-center gap-2">
                      {c.canRedeem ? (
                        <span className="rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
                          Siap ditukar
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {c.currentStamps}/{c.stampsRequired}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setAdjustStampProgramId(c.programId)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                        aria-label={`Sesuaikan stempel ${c.programName}`}
                      >
                        <Settings2 className="h-3 w-3" />
                        Sesuaikan
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Array.from({ length: c.stampsRequired }).map((_, i) => (
                      <span
                        key={i}
                        className={
                          i < c.currentStamps
                            ? 'h-4 w-4 rounded-full bg-brand-500'
                            : 'h-4 w-4 rounded-full border border-dashed border-gray-300 dark:border-gray-600'
                        }
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Hadiah: gratis {c.rewardItemName ?? '—'} · sudah ditukar{' '}
                    {c.lifetimeRewards}×
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

      {/* Kasbon (JUR-191) — outstanding customer credit. Komplit only. */}
      {kasbonSummary.data?.kasbonEnabled && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-3 flex items-center gap-2">
            <HandCoins className="h-4 w-4 text-warning-700" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Kasbon
            </h2>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Belum dibayar
            </span>
            <span
              className={
                kasbonSummary.data.kasbon > 0
                  ? 'text-xl font-bold text-warning-700 dark:text-warning-400'
                  : 'text-xl font-bold text-gray-900 dark:text-gray-100'
              }
            >
              {formatRupiah(kasbonSummary.data.kasbon)}
            </span>
          </div>
          <Link
            to="/cashflow/bon"
            className="mt-3 inline-block text-xs text-brand-600 hover:underline dark:text-brand-400"
          >
            Kelola bon pelanggan →
          </Link>
        </div>
      )}

      {/* Recent sales timeline */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
          Riwayat Transaksi (20 terakhir)
        </h2>
        {customer.recentSales.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Belum ada transaksi terkait pelanggan ini.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {customer.recentSales.map((s) => (
              <li key={s.id}>
                <Link
                  to="/pos/sales/$saleId"
                  params={{ saleId: s.id }}
                  className="flex items-center gap-3 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
                >
                  <Calendar className="h-4 w-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {s.saleNumber}
                      {s.status === 'voided' && (
                        <span className="ml-2 rounded bg-danger-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
                          Void
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(s.createdAt, 'dd MMM yyyy, HH:mm')}{' '}
                      · {s.itemCount} item · {paymentLabel(s.paymentMethod)}
                    </p>
                  </div>
                  <p
                    className={
                      s.status === 'voided'
                        ? 'text-sm font-semibold text-gray-400 line-through'
                        : 'text-sm font-semibold text-gray-900 dark:text-gray-100'
                    }
                  >
                    {formatRupiah(s.total)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CustomerFormSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={(values) => editMut.mutate(values)}
        loading={editMut.isPending}
        initial={{
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          notes: customer.notes,
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMut.mutate()}
        title="Hapus Pelanggan?"
        description={`Pelanggan "${customer.name}" akan dihapus dari database. Riwayat transaksi tetap ada tapi tidak terkait pelanggan ini lagi.`}
        confirmText="Hapus"
        cancelText="Batal"
        variant="danger"
        loading={deleteMut.isPending}
      />

      {loyaltyAvailable && (
        <AdjustLoyaltyDialog
          open={adjustPointsOpen}
          onClose={() => setAdjustPointsOpen(false)}
          customerId={customer.id}
          customerName={customer.name}
          variant={{
            kind: 'points',
            currentBalance: Number(loyaltySummary.data?.pointsBalance ?? 0),
          }}
          onSaved={async () => {
            await queryClient.invalidateQueries({
              queryKey: ['pos', 'loyalty-summary', customer.id],
            })
          }}
        />
      )}

      {loyaltyAvailable &&
        adjustStampProgramId &&
        (() => {
          const card = stampCards.data?.find(
            (c) => c.programId === adjustStampProgramId,
          )
          if (!card) return null
          return (
            <AdjustLoyaltyDialog
              open={!!adjustStampProgramId}
              onClose={() => setAdjustStampProgramId(null)}
              customerId={customer.id}
              customerName={customer.name}
              variant={{
                kind: 'stamps',
                programId: card.programId,
                programName: card.programName,
                currentStamps: card.currentStamps,
                stampsRequired: card.stampsRequired,
              }}
              onSaved={async () => {
                await queryClient.invalidateQueries({
                  queryKey: ['pos', 'stamp-cards', customer.id],
                })
              }}
            />
          )
        })()}
    </div>
  )
}

function Stat({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div
      className={`rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40 ${className ?? ''}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </p>
    </div>
  )
}

function labelForLoyaltyType(
  type: string,
  isAdjustReverse: boolean,
): string {
  if (type === 'earn') return 'Dapat poin'
  if (type === 'redeem') return 'Tukar poin'
  if (type === 'adjust')
    return isAdjustReverse ? 'Pembatalan transaksi' : 'Penyesuaian admin'
  if (type === 'expire') return 'Poin kedaluwarsa'
  return type
}

function paymentLabel(method: string): string {
  const map: Record<string, string> = {
    cash: 'Tunai',
    qris: 'QRIS',
    transfer: 'Transfer',
    card: 'Kartu',
    ewallet: 'E-wallet',
  }
  return map[method] ?? method
}
