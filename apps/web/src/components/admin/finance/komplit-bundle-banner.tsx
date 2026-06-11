/**
 * Komplit one-click activation / renewal banner (admin tenant detail page).
 *
 * Sits above the 3 per-module sections (POS / Inventory / Absensi).
 * Single CTA opens the POS payment sheet pre-selected to Komplit
 * Annual — the server-side `recordPOSPaymentAndActivate` already
 * detects komplit plans and atomically activates POS + Inventory +
 * Attendance + adds all 3 modules to `tenants.activeModules`. For
 * tenants already on Komplit, the same fn extends the period from
 * the current expiry instead of starting at "now", so renewal is a
 * straight click.
 *
 * Renders in two modes:
 *   - "Aktifkan" (free / non-Komplit): pitch headline + activate CTA
 *   - "Perpanjang" (already Komplit): renewal headline + current
 *     expiry highlighted + extend CTA
 * Banner stays visible after purchase precisely because admin needs
 * a one-click renewal path for Komplit — the per-module Perpanjang
 * buttons would each only extend their own module, not the bundle.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
  Sparkles,
  Package,
  ShoppingCart,
  Clock,
  Check,
  CalendarClock,
} from 'lucide-react'
import { recordPOSPaymentAndActivate } from '@/server/functions/admin-finance'
import { formatDate } from '@/lib/utils' // JUR-137
import { getPOSSubscription } from '@/server/functions/pos-subscription'
import { getInventorySubscription } from '@/server/functions/inventory-subscription'
import { getAttendanceSubscription } from '@/server/functions/attendance-subscription'
import {
  POSPaymentSheet,
  type POSPaymentSheetSubmit,
} from './pos-payment-sheet'
import type { ReferralAttributionForSheet } from './referral-discount-banner'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

export function KomplitBundleBanner({
  tenantId,
  tenantName,
  referralAttribution,
}: {
  tenantId: string
  tenantName: string
  /** JUR-96: forwarded into the POSPaymentSheet so the discount UX
   *  shows when admin clicks "Aktifkan Komplit". */
  referralAttribution?: ReferralAttributionForSheet | null
}) {
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  // Read all 3 module subscriptions so we can:
  //  1. Hide banner when already on Komplit (no upsell point)
  //  2. Show "extend dari X" warning when any module has unexpired
  //     subscription — Komplit period will start at the LATEST expiry
  //     so the tenant doesn't lose paid time. Mirrors the server-side
  //     period-rollover logic in recordPOSPaymentAndActivate.
  const { data: posSub } = useQuery({
    queryKey: ['admin', 'pos-subscription', tenantId],
    queryFn: () => getPOSSubscription({ data: { tenantId } }),
  })
  const { data: invSub } = useQuery({
    queryKey: ['admin', 'inventory-subscription', tenantId],
    queryFn: () => getInventorySubscription({ data: { tenantId } }),
  })
  const { data: attSub } = useQuery({
    queryKey: ['admin', 'attendance-subscription', tenantId],
    queryFn: () => getAttendanceSubscription({ data: { tenantId } }),
  })

  // posSub shape: { tenant, settings, currentPlan }. The settings row
  // holds the persisted tier + subscription state.
  const isAlreadyKomplit =
    posSub?.settings?.tier === 'komplit' &&
    posSub?.settings?.subscriptionActive === true

  // Compute the latest unexpired expiry across all 3 modules.
  // Server uses the same logic as the period start for Komplit.
  const now = Date.now()
  const moduleExpiries: Array<{ label: string; expiry: Date }> = []
  function consider(
    label: string,
    active: boolean | null | undefined,
    expiry: string | Date | null | undefined,
  ) {
    if (!active || !expiry) return
    const ts = new Date(expiry).getTime()
    if (ts > now) moduleExpiries.push({ label, expiry: new Date(expiry) })
  }
  consider(
    'POS',
    posSub?.settings?.subscriptionActive,
    posSub?.settings?.subscriptionExpiresAt,
  )
  consider(
    'Inventory',
    invSub?.settings?.subscriptionActive,
    invSub?.settings?.subscriptionExpiresAt,
  )
  consider(
    'Absensi',
    attSub?.settings?.subscriptionActive,
    attSub?.settings?.subscriptionExpiresAt,
  )
  const latestExpiry =
    moduleExpiries.length > 0
      ? moduleExpiries.reduce((a, b) =>
          a.expiry.getTime() > b.expiry.getTime() ? a : b,
        )
      : null

  const paymentMut = useMutation({
    mutationFn: (input: POSPaymentSheetSubmit) =>
      recordPOSPaymentAndActivate({
        data: {
          tenantId,
          planKey: input.planKey,
          outletCount: input.outletCount,
          transferDate: input.transferDate,
          bankReference: input.bankReference,
          proofDataUrl: input.proofDataUrl,
          notes: input.notes,
        },
      }),
    onSuccess: async () => {
      setPaymentOpen(false)
      toast({
        title: isAlreadyKomplit ? 'Komplit Diperpanjang' : 'Komplit Aktif',
        description: isAlreadyKomplit
          ? `Masa aktif Komplit untuk ${tenantName} diperpanjang.`
          : `Paket Komplit untuk ${tenantName} aktif. POS + Inventory + Absensi sekaligus.`,
        variant: 'success',
      })
      // Invalidate ALL three module subscription queries — the server
      // tx flipped all 3 on at once, the UI needs to reflect that.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['admin', 'pos-subscription', tenantId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['admin', 'inventory-subscription', tenantId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['admin', 'attendance-subscription', tenantId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['admin', 'finance', 'tenant-transactions', tenantId],
        }),
      ])
      await router.invalidate()
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : 'Gagal menyimpan pembayaran'
      setMutationError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    },
  })

  // Render either pitch (non-Komplit) or renewal (already Komplit)
  // variant. Renewal stays visible so admin has a one-click bundle
  // extension path — per-module Perpanjang buttons would only renew
  // their own module, not the bundled three.

  return (
    <>
      <div className="rounded-2xl border-2 border-brand-500 bg-gradient-to-br from-brand-50 to-white p-5 shadow-sm dark:from-brand-900/20 dark:to-gray-800 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1 min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
              <Sparkles className="h-3 w-3" />
              {isAlreadyKomplit ? 'Renewal Komplit' : 'Aksi Cepat'}
            </span>
            <h2 className="mt-2 text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
              {isAlreadyKomplit
                ? 'Perpanjang Paket Komplit'
                : 'Aktifkan Paket Komplit Sekaligus'}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {isAlreadyKomplit
                ? 'Satu klik perpanjang masa aktif POS + Inventory + Absensi sekaligus. Periode disambung dari tanggal kadaluarsa saat ini, jadi sisa waktu tidak hangus.'
                : 'Satu pembayaran aktifkan POS + Inventory + Absensi sekaligus — hemat dibanding aktif per modul.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <ModuleChip icon={ShoppingCart} label="POS Toko" />
              <ModuleChip icon={Package} label="Inventory" />
              <ModuleChip icon={Clock} label="Absensi (unlimited staf)" />
              <ModuleChip icon={Check} label="HPP gratis" />
            </div>

            {/* Show the rollover / current-expiry context:
                - Non-Komplit + has any module unexpired → Komplit will
                  start from that latest expiry
                - Already-Komplit → highlight the current Komplit expiry
                  so admin sees how much runway is left before renewal */}
            {latestExpiry && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-accent-900 dark:border-accent-700 dark:bg-accent-900/20 dark:text-accent-200">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">
                    {isAlreadyKomplit ? (
                      <>
                        Komplit aktif sampai{' '}
                        <span className="font-bold">
                          {formatDate(latestExpiry.expiry, 'dd MMM yyyy')}
                        </span>
                        .
                      </>
                    ) : (
                      <>
                        Tenant ini punya langganan{' '}
                        <span className="font-bold">{latestExpiry.label}</span>{' '}
                        aktif sampai{' '}
                        <span className="font-bold">
                          {formatDate(latestExpiry.expiry, 'dd MMM yyyy')}
                        </span>
                        .
                      </>
                    )}
                  </p>
                  <p className="mt-0.5">
                    Periode {isAlreadyKomplit ? 'baru' : 'Komplit'} otomatis
                    dimulai dari tanggal tersebut — sisa waktu yang sudah
                    dibayar tidak hangus.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1 sm:items-end">
            <Button
              variant="brand"
              size="lg"
              onClick={() => {
                setMutationError(null)
                setPaymentOpen(true)
              }}
              className="w-full sm:w-auto"
            >
              <Sparkles className="h-4 w-4" />
              {isAlreadyKomplit ? 'Perpanjang Komplit' : 'Aktifkan Komplit'}
            </Button>
            <p className="text-center text-[11px] text-gray-500 sm:text-right">
              {isAlreadyKomplit
                ? 'Tahunan Rp 660.000/outlet (~ Rp 55k/bln)'
                : 'Mulai Rp 55.000/bulan/outlet'}
            </p>
          </div>
        </div>
      </div>

      {paymentOpen && (
        <POSPaymentSheet
          mode={isAlreadyKomplit ? 'renew' : 'activate'}
          tenantName={tenantName}
          currentExpiresAt={posSub?.settings?.subscriptionExpiresAt ?? null}
          // Pre-fill with Komplit Annual so admin can submit without
          // re-picking from the dropdown. They can still switch to
          // Monthly / Toko via the dropdown if they want.
          initialPlanKey="pos_komplit_annual"
          referralAttribution={referralAttribution}
          onClose={() => setPaymentOpen(false)}
          onSubmit={(values) => paymentMut.mutate(values)}
          loading={paymentMut.isPending}
          error={mutationError}
        />
      )}
    </>
  )
}

function ModuleChip({
  icon: Icon,
  label,
}: {
  icon: typeof Package
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-gray-700 ring-1 ring-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}
