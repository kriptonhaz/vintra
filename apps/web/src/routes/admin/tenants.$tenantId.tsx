import { useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatRupiah } from '@/lib/currency'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Package, Calculator, Users, ShieldAlert, Clock, Power, Trash2, Pencil, Plus, Sparkles, Store, Gift } from 'lucide-react'
import { getTenantDetail, deleteTenant, setTenantActiveModules } from '@/server/functions/admin'
import {
  recordWaPayment,
  deactivateWa,
} from '@/server/functions/admin-finance'
import { adminGetTenantReferralAttribution } from '@/server/functions/referral-admin'
import { backfillPosCashflowEntries } from '@/server/functions/cashflow'
import {
  getCompContext,
  listCompGrants,
  createCompGrant,
  reviewCompGrant,
} from '@/server/functions/comp-grants'
import { Textarea } from '@/components/ui/textarea'
import {
  WaPaymentSheet,
  type WaPaymentSheetSubmit,
} from '@/components/admin/finance/wa-payment-sheet'
import {
  getAttendanceSubscription,
  updateAttendanceSubscription,
  deactivateAttendance,
} from '@/server/functions/attendance-subscription'
import {
  getTenantTransactions,
  recordPaymentAndActivate,
  recordInventoryPaymentAndActivate,
  recordPOSPaymentAndActivate,
  startPOSTrial,
  endPOSTrial,
  recordRefund,
  startTrial,
  updateTrial,
  endTrial,
  getTenantBranchBillingDrift,
  recordAdditionalOutletPayment,
} from '@/server/functions/admin-finance'
import {
  AdditionalOutletSheet,
  type AdditionalOutletSubmit,
} from '@/components/admin/finance/additional-outlet-sheet'
import {
  getInventorySubscription,
  deactivateInventory,
} from '@/server/functions/inventory-subscription'
import {
  getPOSSubscription,
  deactivatePOS,
} from '@/server/functions/pos-subscription'
import {
  PaymentSheet,
  type PaymentSheetSubmit,
} from '@/components/admin/finance/payment-sheet'
import {
  InventoryPaymentSheet,
  type InventoryPaymentSheetSubmit,
} from '@/components/admin/finance/inventory-payment-sheet'
import {
  POSPaymentSheet,
  type POSPaymentSheetSubmit,
} from '@/components/admin/finance/pos-payment-sheet'
import {
  TrialSheet,
  type TrialSheetSubmit,
} from '@/components/admin/finance/trial-sheet'
import { KomplitBundleBanner } from '@/components/admin/finance/komplit-bundle-banner'
import { TenantReferralAccessCard } from '@/components/admin/tenant-referral-access-card'
import { ATTENDANCE_TRIAL_DEFAULTS } from '@vintra/shared'
import {
  RefundSheet,
  type RefundSheetSubmit,
} from '@/components/admin/finance/refund-sheet'
import {
  TransactionsTable,
  type TransactionRow,
} from '@/components/admin/finance/transactions-table'
import { TransactionDetailDrawer } from '@/components/admin/finance/transaction-detail-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { cn, formatDate, formatNumberID } from '@/lib/utils' // JUR-137
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { useStartImpersonation } from '@/hooks/use-impersonation'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export const Route = createFileRoute('/admin/tenants/$tenantId')({
  loader: async ({ params }) => {
    const [detail, referralAttribution] = await Promise.all([
      getTenantDetail({ data: { tenantId: params.tenantId } }),
      adminGetTenantReferralAttribution({ data: { tenantId: params.tenantId } }).catch(() => null),
    ])
    return { ...detail, referralAttribution }
  },
  component: TenantDetailPage,
})

function TenantDetailPage() {
  const { tenant, members, counts, waSubscription, referralAttribution } = Route.useLoaderData()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const startMut = useStartImpersonation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [impError, setImpError] = useState<string | null>(null)
  const [addOutletOpen, setAddOutletOpen] = useState(false)
  const [outletError, setOutletError] = useState<string | null>(null)

  // Unified "Tambah Outlet" — replaces the old per-module buttons.
  // The sheet asks which package the new outlet uses (Komplit bundle /
  // POS only / Inventory only) and the server fn writes the right
  // transaction(s). Komplit selection writes a paired Rp 0 Inventory
  // row to keep both modules' billed counts in sync.
  const addOutletMut = useMutation({
    mutationFn: (input: AdditionalOutletSubmit) =>
      recordAdditionalOutletPayment({
        data: {
          tenantId: tenant.id,
          packageKey: input.packageKey,
          additionalOutletCount: input.additionalOutletCount,
          transferDate: input.transferDate,
          bankReference: input.bankReference,
          proofDataUrl: input.proofDataUrl,
          notes: input.notes,
        },
      }),
    onSuccess: async (result) => {
      setAddOutletOpen(false)
      toast({
        title: 'Pembayaran tercatat',
        description: `${result.invoiceNumber} · Kapasitas outlet jadi ${result.newBilledOutletCount}.`,
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin-tenant-drift', tenant.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin-additional-outlet-context', tenant.id],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal mencatat pembayaran'
      setOutletError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    },
  })

  async function handleImpersonate() {
    setImpError(null)
    try {
      await startMut.mutateAsync(tenant.id)
      setConfirmOpen(false)
      navigate({ to: '/dashboard' })
    } catch (err) {
      setImpError(
        err instanceof Error ? err.message : t('admin.tenantDetail.impersonateError'),
      )
    }
  }

  return (
    <div className="space-y-6">
      <Link
        to="/admin/tenants"
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('admin.tenantDetail.back')}
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {tenant.businessName}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('admin.tenantDetail.registeredOn', {
              slug: tenant.slug,
              date: formatDate(tenant.createdAt, 'dd MMMM yyyy'),
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="brand"
            onClick={() => {
              setOutletError(null)
              setAddOutletOpen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            Tambah Outlet
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            loading={startMut.isPending}
          >
            <ShieldAlert className="h-4 w-4" />
            {t('admin.tenantDetail.impersonateButton')}
          </Button>
        </div>
      </div>

      {addOutletOpen && (
        <AdditionalOutletSheet
          tenantId={tenant.id}
          tenantName={tenant.businessName}
          onClose={() => setAddOutletOpen(false)}
          onSubmit={(v) => addOutletMut.mutate(v)}
          loading={addOutletMut.isPending}
          error={outletError}
        />
      )}

      <BranchBillingDriftCard tenantId={tenant.id} />

      {/* Referral attribution banner — present whenever the tenant
          signed up via someone else's referral code AND the 12-month
          window is still open. Shown at the top so the admin sees the
          discount before clicking any module activation button. */}
      {referralAttribution && (
        <div className="flex items-start gap-3 rounded-lg border border-success-200 bg-success-50 p-4 dark:border-success-900/40 dark:bg-success-900/20">
          <div className="text-2xl leading-none">🎁</div>
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-700 dark:text-success-300">
              Pendaftar referral — diskon {referralAttribution.discountPct}%
            </p>
            <p className="mt-1 text-success-700/80 dark:text-success-300/80">
              Via kode <strong className="font-mono">{referralAttribution.code}</strong> dari{' '}
              <strong>{referralAttribution.referrerName}</strong>. Diskon berlaku sampai{' '}
              <strong>
                {formatDate(referralAttribution.windowEndsAt, 'dd MMMM yyyy')}
              </strong>{' '}
              untuk setiap aktivasi paket inti (POS, Inventory, Absensi) dalam
              periode tersebut — tidak berlaku untuk modul WhatsApp. Komisi {referralAttribution.commissionPct}% otomatis
              dicatat ke akun {referralAttribution.referrerName}.
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onConfirm={handleImpersonate}
        onCancel={() => {
          setConfirmOpen(false)
          setImpError(null)
        }}
        title={t('admin.tenantDetail.impersonateConfirmTitle', {
          tenantName: tenant.businessName,
        })}
        description={impError ?? t('admin.tenantDetail.impersonateConfirmDesc')}
        confirmText={t('admin.tenantDetail.impersonateConfirmCta')}
        cancelText={t('common.cancel')}
        loading={startMut.isPending}
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('admin.tenantDetail.statOutlets')}
          value={counts.branches.toString()}
          icon={<Store className="h-5 w-5 text-brand-600 dark:text-brand-400" />}
        />
        <StatCard
          label={t('admin.tenantDetail.statMembers')}
          value={members.length.toString()}
          icon={<Users className="h-5 w-5 text-brand-600 dark:text-brand-400" />}
        />
        <StatCard
          label={t('admin.tenantDetail.statProducts')}
          value={counts.products.toString()}
          icon={<Package className="h-5 w-5 text-accent-600 dark:text-accent-400" />}
        />
        <StatCard
          label={t('admin.tenantDetail.statMaterials')}
          value={counts.materials.toString()}
          icon={<Calculator className="h-5 w-5 text-success-600 dark:text-success-400" />}
        />
      </div>

      {/* Komplit one-click activation banner — renders above the
          per-module sections. Hides itself when the tenant is already
          on a Komplit subscription. The CTA opens the POS payment
          sheet pre-filled with Komplit Annual; the server-side flow
          activates POS + Inventory + Attendance in one transaction. */}
      <KomplitBundleBanner
        tenantId={tenant.id}
        tenantName={tenant.businessName}
        referralAttribution={referralAttribution}
      />

      {/* Per-module management — still useful for adjusting expiry,
          deactivating, refunds, and trial flows even when the tenant
          is on Komplit (each module's settings row exists either way). */}
      <AttendanceModuleSection tenantId={tenant.id} tenantName={tenant.businessName} referralAttribution={referralAttribution} />
      <InventoryModuleSection tenantId={tenant.id} tenantName={tenant.businessName} referralAttribution={referralAttribution} />
      <POSModuleSection tenantId={tenant.id} tenantName={tenant.businessName} referralAttribution={referralAttribution} />
      <WAModuleSection tenantId={tenant.id} tenantName={tenant.businessName} activeModules={tenant.activeModules} waSubscription={waSubscription} />

      {/* Referral allowlist — toggle the tenant's access to running a
          referral program + set their per-tenant discount/commission cap. */}
      <TenantReferralAccessCard tenantId={tenant.id} />

      {/* JUR-156: backfill the cashflow ledger from historical POS sales
          — used after a tenant upgrades to Komplit. Idempotent. */}
      <CashflowBackfillSection tenantId={tenant.id} />

      {/* JUR-194: comp / free-access grants — activate a module at Rp 0
          with a reason, never recorded as income. */}
      <CompGrantSection tenantId={tenant.id} tenantName={tenant.businessName} />

      {/* Payment history — all manual transactions for this tenant */}
      <PaymentsHistorySection tenantId={tenant.id} tenantName={tenant.businessName} />

      {/* Danger zone — tenant deletion */}
      <DangerZoneSection tenantId={tenant.id} tenantName={tenant.businessName} />

      {/* Tenant info */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('admin.tenantDetail.infoTitle')}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <InfoRow label={t('admin.tenantDetail.infoOwner')} value={tenant.ownerEmail ?? t('admin.tenantDetail.noEmail')} />
          <InfoRow
            label={t('admin.tenantDetail.infoPhone')}
            value={
              tenant.ownerPhone ? (
                /* Tap-to-WhatsApp — admin's primary reason to need
                   the owner's number is to follow up about payments
                   or onboarding. wa.me wants digits only with a
                   country prefix; Indonesian numbers stored as
                   "08xxx" get normalised to "628xxx". */
                <a
                  href={`https://wa.me/${tenant.ownerPhone
                    .replace(/[^\d]/g, '')
                    .replace(/^0/, '62')}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-brand-600 hover:underline dark:text-brand-400"
                >
                  {tenant.ownerPhone}
                </a>
              ) : (
                t('admin.tenantDetail.noEmail')
              )
            }
          />
          <InfoRow label={t('admin.tenantDetail.infoCategory')} value={tenant.businessCategory ?? t('admin.tenantDetail.noEmail')} />
          <InfoRow label={t('admin.tenantDetail.infoEmployeeRange')} value={tenant.employeeRange ?? t('admin.tenantDetail.noEmail')} />
          <InfoRow
            label={t('admin.tenantDetail.infoOnboarding')}
            value={
              tenant.onboardingCompleted
                ? t('admin.tenantDetail.infoOnboardingDone')
                : t('admin.tenantDetail.infoOnboardingPending')
            }
          />
          <InfoRow
            label={t('admin.tenantDetail.infoActiveModules')}
            value={tenant.activeModules.join(', ') || t('admin.tenantDetail.noEmail')}
          />
        </dl>
      </div>

      {/* Members */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('admin.tenantDetail.membersTitle')}
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.tenantDetail.memberColEmail')}</TableHead>
              <TableHead>{t('admin.tenantDetail.memberColRole')}</TableHead>
              <TableHead>{t('admin.tenantDetail.memberColJoined')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="py-8 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {t('admin.tenantDetail.membersEmpty')}
                </TableCell>
              </TableRow>
            ) : (
              members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    {m.email ?? (
                      <span className="italic text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                      {m.role}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(m.createdAt, 'dd MMM yyyy')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/**
 * Soft-enforcement signal: when the owner adds more branches than the
 * latest billing period covers, this card surfaces the unbilled
 * outlets so the admin doesn't forget to bump `outletCount` on the
 * next renewal payment. Hidden when there's no drift (delta=0).
 */
function BranchBillingDriftCard({ tenantId }: { tenantId: string }) {
  const { data } = useQuery({
    queryKey: ['admin-tenant-drift', tenantId],
    queryFn: () => getTenantBranchBillingDrift({ data: { tenantId } }),
    staleTime: 60_000,
  })
  if (!data) return null
  const items = [
    data.pos ? { label: 'POS', ...data.pos } : null,
    data.inventory ? { label: 'Stok', ...data.inventory } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null && x.delta > 0)
  if (items.length === 0) return null
  const total = items.reduce((acc, x) => acc + x.extraPerMonth, 0)
  return (
    <div className="rounded-xl border border-warning-300 bg-warning-50 p-4 dark:border-warning-900/50 dark:bg-warning-900/20">
      <p className="text-sm font-semibold text-warning-900 dark:text-warning-200">
        Cabang baru ditambahkan setelah pembayaran terakhir
      </p>
      <p className="mt-1 text-xs text-warning-800/80 dark:text-warning-200/80">
        Pastikan jumlah outlet pada renewal berikutnya sudah disesuaikan.
        Tagihan tambahan estimasi:{' '}
        <span className="font-bold">{formatRupiah(total)}/bulan</span>.
      </p>
      <ul className="mt-3 space-y-1 text-xs text-warning-900 dark:text-warning-100">
        {items.map((x) => (
          <li key={x.label}>
            · <strong>{x.label}</strong> — dibayar {x.billed} lokasi,
            sekarang ada {x.active} ({x.delta > 0 ? '+' : ''}
            {x.delta}) · +{formatRupiah(x.extraPerMonth)}/bln
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * JUR-156: one-shot backfill of cashflow income rows from a tenant's
 * historical completed POS sales. Safe to re-run — already-linked sales
 * are skipped server-side.
 */
function CashflowBackfillSection({ tenantId }: { tenantId: string }) {
  const { toast } = useToast()
  const mut = useMutation({
    mutationFn: () => backfillPosCashflowEntries({ data: { tenantId } }),
    onSuccess: (res) => {
      toast({
        title: 'Backfill selesai',
        description: `${res.inserted} catatan kas dibuat dari penjualan POS.`,
        variant: 'success',
      })
    },
    onError: (err) => {
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Backfill gagal',
        variant: 'error',
      })
    },
  })
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Backfill Cashflow dari POS
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Impor semua penjualan POS lama tenant ini ke buku arus kas.
            Aman dijalankan berulang — penjualan yang sudah terhubung dilewati.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => mut.mutate()}
          loading={mut.isPending}
        >
          Jalankan Backfill
        </Button>
      </div>
    </div>
  )
}

// ─── JUR-194: comp / free-access grants ──────────────────────────────

const COMP_MODULE_LABEL: Record<string, string> = {
  pos: 'POS Kasir',
  inventory: 'Inventory',
  attendance: 'Absensi',
  whatsapp: 'WhatsApp AI',
}

const COMP_PLAN_OPTIONS: Record<
  'pos' | 'inventory' | 'attendance' | 'whatsapp',
  { value: string; label: string }[]
> = {
  pos: [
    { value: 'komplit', label: 'Komplit (POS + Inventory + Absensi)' },
    { value: 'toko', label: 'POS Toko' },
    { value: 'bisnis', label: 'POS Bisnis' },
  ],
  inventory: [
    { value: 'toko', label: 'Inventory Toko' },
    { value: 'bisnis', label: 'Inventory Bisnis' },
  ],
  attendance: [{ value: 'standard', label: 'Absensi' }],
  whatsapp: [
    { value: 'basic', label: 'WhatsApp Basic' },
    { value: 'komplit', label: 'WhatsApp Komplit' },
  ],
}

function compStatusBadge(status: string): string {
  return (
    {
      pending: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
      applied: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
      rejected: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    }[status] ?? 'bg-gray-100 text-gray-600'
  )
}
const COMP_STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  applied: 'Aktif',
  rejected: 'Ditolak',
}

function CompGrantSection({
  tenantId,
  tenantName,
}: {
  tenantId: string
  tenantName: string
}) {
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)

  const ctx = useQuery({
    queryKey: ['admin', 'comp-context'],
    queryFn: () => getCompContext(),
    staleTime: 5 * 60 * 1000,
  })
  const isFounder = ctx.data?.isFounder ?? false

  const grantsQuery = useQuery({
    queryKey: ['admin', 'comp-grants', tenantId],
    queryFn: () => listCompGrants({ data: { tenantId } }),
  })
  const grants = grantsQuery.data ?? []

  const reviewMut = useMutation({
    mutationFn: (input: { id: string; action: 'approve' | 'reject' }) =>
      reviewCompGrant({ data: input }),
    onSuccess: async (res) => {
      toast({
        title:
          res.status === 'applied'
            ? 'Comp disetujui & modul diaktifkan'
            : 'Permintaan comp ditolak',
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'comp-grants', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) =>
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Coba lagi.',
        variant: 'error',
      }),
  })

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Akses Gratis (Comp)
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Aktifkan modul tanpa biaya — wajib pakai alasan, tidak tercatat
            sebagai pendapatan.
            {!isFounder && ' Permintaan Anda menunggu persetujuan founder.'}
          </p>
        </div>
        <Button variant="outline" onClick={() => setFormOpen(true)}>
          <Gift className="h-4 w-4" /> Beri Akses Gratis
        </Button>
      </div>

      {grants.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-700">
          {grants.map((g) => (
            <li key={g.id} className="flex items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {COMP_MODULE_LABEL[g.moduleKey] ?? g.moduleKey} · {g.planKey}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {g.reason} · {g.durationMonths} bln ·{' '}
                  {formatDate(g.createdAt, 'dd MMM yyyy')}
                </p>
              </div>
              <span
                className={cn(
                  'inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                  compStatusBadge(g.status),
                )}
              >
                {COMP_STATUS_LABEL[g.status] ?? g.status}
              </span>
              {g.status === 'pending' && isFounder && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="brand"
                    size="sm"
                    loading={reviewMut.isPending}
                    onClick={() =>
                      reviewMut.mutate({ id: g.id, action: 'approve' })
                    }
                  >
                    Setujui
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      reviewMut.mutate({ id: g.id, action: 'reject' })
                    }
                  >
                    Tolak
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        <CompGrantForm
          tenantId={tenantId}
          tenantName={tenantName}
          isFounder={isFounder}
          onClose={() => setFormOpen(false)}
          onDone={async () => {
            setFormOpen(false)
            await queryClient.invalidateQueries({
              queryKey: ['admin', 'comp-grants', tenantId],
            })
            await router.invalidate()
          }}
        />
      )}
    </div>
  )
}

function CompGrantForm({
  tenantId,
  tenantName,
  isFounder,
  onClose,
  onDone,
}: {
  tenantId: string
  tenantName: string
  isFounder: boolean
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { toast } = useToast()
  // moduleKey -> chosen planKey. A module is selected iff it's a key here.
  const [picks, setPicks] = useState<Record<string, string>>({
    pos: 'komplit',
  })
  const [durationMonths, setDurationMonths] = useState('12')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const COMP_MODULES = [
    { key: 'pos', label: 'POS Kasir' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'attendance', label: 'Absensi' },
    { key: 'whatsapp', label: 'WhatsApp AI' },
  ] as const
  type CompModuleKey = (typeof COMP_MODULES)[number]['key']

  // POS at the Komplit tier already bundles Inventory + Absensi, so
  // picking those separately would create overlapping grants.
  const komplitBundled = picks.pos === 'komplit'

  function toggleModule(m: CompModuleKey) {
    setPicks((prev) => {
      const next = { ...prev }
      if (m in next) delete next[m]
      else next[m] = COMP_PLAN_OPTIONS[m][0]!.value
      return next
    })
  }

  function setPlan(m: CompModuleKey, plan: string) {
    setPicks((prev) => {
      const next = { ...prev, [m]: plan }
      // Switching POS to Komplit drops the now-redundant inventory/absensi.
      if (m === 'pos' && plan === 'komplit') {
        delete next.inventory
        delete next.attendance
      }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const modules = Object.entries(picks).map(([moduleKey, planKey]) => ({
      moduleKey: moduleKey as CompModuleKey,
      planKey,
    }))
    if (modules.length === 0) {
      setError('Pilih minimal 1 modul.')
      return
    }
    if (!reason.trim()) {
      setError('Alasan wajib diisi.')
      return
    }
    setSubmitting(true)
    try {
      const res = await createCompGrant({
        data: {
          tenantId,
          durationMonths: Number(durationMonths) || 12,
          reason: reason.trim(),
          modules,
        },
      })
      toast({
        title:
          res.status === 'applied'
            ? `${res.count} modul diaktifkan gratis`
            : `Permintaan ${res.count} modul dikirim ke founder`,
        description:
          res.status === 'pending'
            ? 'Menunggu persetujuan founder sebelum aktif.'
            : undefined,
        variant: 'success',
      })
      await onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan.'
      setError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>Beri Akses Gratis</SheetTitle>
        <SheetDescription>
          Aktifkan modul untuk {tenantName} tanpa biaya. Pilih satu atau
          beberapa modul sekaligus.
        </SheetDescription>
      </SheetHeader>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
              Modul
            </p>
            <div className="space-y-2">
              {COMP_MODULES.map((m) => {
                const checked = m.key in picks
                const disabled =
                  komplitBundled &&
                  (m.key === 'inventory' || m.key === 'attendance')
                const tierOptions = COMP_PLAN_OPTIONS[m.key]
                return (
                  <div
                    key={m.key}
                    className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                  >
                    <label
                      className={cn(
                        'flex items-center gap-2 text-sm',
                        disabled
                          ? 'cursor-not-allowed opacity-60'
                          : 'cursor-pointer',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked && !disabled}
                        disabled={disabled}
                        onChange={() => toggleModule(m.key)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600"
                      />
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {m.label}
                      </span>
                    </label>
                    {disabled && (
                      <p className="mt-1 pl-6 text-xs text-gray-500">
                        Sudah termasuk paket Komplit.
                      </p>
                    )}
                    {checked && !disabled && tierOptions.length > 1 && (
                      <div className="mt-2 pl-6">
                        <Select
                          value={picks[m.key]}
                          onChange={(e) => setPlan(m.key, e.target.value)}
                          options={tierOptions}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <Select
            label="Durasi"
            value={durationMonths}
            onChange={(e) => setDurationMonths(e.target.value)}
            options={[
              { label: '1 bulan', value: '1' },
              { label: '3 bulan', value: '3' },
              { label: '6 bulan', value: '6' },
              { label: '12 bulan', value: '12' },
            ]}
          />
          <Textarea
            label="Alasan (wajib)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="mis. beta tester, partner, kompensasi gangguan"
          />
          {!isFounder && (
            <p className="rounded-lg bg-warning-50 p-2.5 text-xs text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
              Anda bukan founder — permintaan ini akan dikirim untuk
              persetujuan founder sebelum modul aktif.
            </p>
          )}
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="brand" loading={submitting}>
            {isFounder ? 'Aktifkan Gratis' : 'Kirim Permintaan'}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {label}
        </span>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {value}
      </p>
    </div>
  )
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">
        {value}
      </dd>
    </div>
  )
}

// ─── Attendance module subscription section ──────────

const activateSchema = z.object({
  expiresAt: z.string().min(1, 'Tanggal berakhir wajib diisi'),
  billedStaffCount: z.coerce.number().int().min(0, 'Minimal 0'),
})
type ActivateForm = z.infer<typeof activateSchema>

function AttendanceModuleSection({
  tenantId,
  tenantName,
  referralAttribution,
}: {
  tenantId: string
  tenantName: string
  referralAttribution: {
    code: string
    referrerName: string
    discountPct: number
    commissionPct: number
    windowEndsAt: string
  } | null
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'attendance-subscription', tenantId],
    queryFn: () => getAttendanceSubscription({ data: { tenantId } }),
  })

  // 'payment' = integrated pay+activate sheet (also used for renew)
  // 'adjust'  = correct expiry / staff count without creating a tx
  // 'trial-edit'  = modify the running trial
  // (Trial *start* no longer uses a sheet — defaults from
  // ATTENDANCE_TRIAL_DEFAULTS are applied directly via a confirm
  // dialog. Admins still need a sheet to extend mid-trial because
  // those values vary per request.)
  const [sheetMode, setSheetMode] = useState<
    'payment' | 'adjust' | 'trial-edit' | null
  >(null)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [startTrialOpen, setStartTrialOpen] = useState(false)
  const [endTrialOpen, setEndTrialOpen] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const paymentMut = useMutation({
    mutationFn: (input: PaymentSheetSubmit) =>
      recordPaymentAndActivate({
        data: {
          tenantId,
          moduleKey: 'attendance',
          planKey: input.planKey,
          billedStaffCount: input.billedStaffCount,
          transferDate: input.transferDate,
          bankReference: input.bankReference,
          proofDataUrl: input.proofDataUrl,
          notes: input.notes,
        },
      }),
    onSuccess: async () => {
      setSheetMode(null)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('admin.tenantDetail.toastAttendanceActivated'),
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'attendance-subscription', tenantId],
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'finance', 'tenant-transactions', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan pembayaran'
      setMutationError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    },
  })

  const updateMut = useMutation({
    mutationFn: (input: { expiresAt: string; billedStaffCount: number }) =>
      updateAttendanceSubscription({ data: { tenantId, ...input } }),
    onSuccess: async () => {
      setSheetMode(null)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('admin.tenantDetail.toastAttendanceUpdated'),
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'attendance-subscription', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal memperbarui'
      setMutationError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    },
  })

  const deactivateMut = useMutation({
    mutationFn: () => deactivateAttendance({ data: { tenantId } }),
    onSuccess: async () => {
      setDeactivateOpen(false)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('admin.tenantDetail.toastAttendanceDeactivated'),
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'attendance-subscription', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal menonaktifkan'
      setMutationError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    },
  })

  // Trial start always uses the platform defaults — admins no longer
  // override per-tenant on the create path. Keeps every trial uniform
  // (and reduces support questions like "why did this tenant get 30
  // days but mine only 3?"). If a specific tenant truly needs more,
  // start the trial first then use "Ubah Trial" to extend.
  const startTrialMut = useMutation({
    mutationFn: () =>
      startTrial({
        data: {
          tenantId,
          durationDays: ATTENDANCE_TRIAL_DEFAULTS.durationDays,
          staffCap: ATTENDANCE_TRIAL_DEFAULTS.staffCap,
        },
      }),
    onSuccess: async () => {
      setStartTrialOpen(false)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('admin.tenantDetail.toastTrialStarted'),
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'attendance-subscription', tenantId],
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'finance', 'tenant-transactions', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal memulai trial'
      setMutationError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    },
  })

  const updateTrialMut = useMutation({
    mutationFn: (input: TrialSheetSubmit) => {
      // Edit mode sends new end date + cap. We re-derive end from
      // `durationDays` starting "now" — matches what TrialSheet shows
      // in its preview.
      const endsAt = new Date(
        Date.now() + input.durationDays * 24 * 60 * 60 * 1000,
      )
      return updateTrial({
        data: {
          tenantId,
          endsAt: endsAt.toISOString(),
          staffCap: input.staffCap,
        },
      })
    },
    onSuccess: async () => {
      setSheetMode(null)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('admin.tenantDetail.toastTrialUpdated'),
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'attendance-subscription', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah trial'
      setMutationError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    },
  })

  const endTrialMut = useMutation({
    mutationFn: () => endTrial({ data: { tenantId } }),
    onSuccess: async () => {
      setEndTrialOpen(false)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('admin.tenantDetail.toastTrialEnded'),
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'attendance-subscription', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal mengakhiri trial'
      setMutationError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    },
  })

  const now = Date.now()
  const paidExpiresAt = data?.settings?.subscriptionExpiresAt
    ? new Date(data.settings.subscriptionExpiresAt)
    : null
  const paidActive =
    (data?.settings?.subscriptionActive ?? false) &&
    !!paidExpiresAt &&
    paidExpiresAt.getTime() > now

  const trialEndsAt = data?.settings?.trialEndsAt
    ? new Date(data.settings.trialEndsAt)
    : null
  const trialActive = !!trialEndsAt && trialEndsAt.getTime() > now
  const trialUsed = data?.settings?.trialUsed ?? false
  // null = unlimited (no per-tenant cap during trial). UI checks
  // `trialStaffCap === null` to render "Tanpa batas" instead of a number.
  const trialStaffCap: number | null =
    data?.settings?.trialStaffCap ?? (data?.settings?.trialEndsAt ? null : 0)
  const trialDaysLeft = trialEndsAt
    ? Math.max(
        0,
        Math.ceil((trialEndsAt.getTime() - now) / (24 * 60 * 60 * 1000)),
      )
    : 0

  // "Module active" is paid OR trial for display purposes. The module
  // button bar diverges based on which state is current.
  const isActive = paidActive || trialActive
  const expiresAt = paidExpiresAt
  const billedStaff = data?.settings?.billedStaffCount ?? 0

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('admin.tenantDetail.moduleAttendanceTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('admin.tenantDetail.moduleAttendanceDesc')}
          </p>
        </div>
        {isLoading ? null : paidActive ? (
          // Paid subscription — normal renew/adjust/deactivate controls.
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="brand" onClick={() => setSheetMode('payment')}>
              <Plus className="h-4 w-4" />
              {t('admin.tenantDetail.moduleRenewBtn')}
            </Button>
            <Button variant="outline" onClick={() => setSheetMode('adjust')}>
              <Pencil className="h-4 w-4" />
              {t('admin.tenantDetail.moduleAdjustBtn')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDeactivateOpen(true)}
              loading={deactivateMut.isPending}
            >
              <Power className="h-4 w-4" />
              {t('admin.tenantDetail.moduleDeactivateBtn')}
            </Button>
          </div>
        ) : trialActive ? (
          // Trial running — admin can convert (Aktifkan), modify, or end.
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="brand" onClick={() => setSheetMode('payment')}>
              <Power className="h-4 w-4" />
              {t('admin.tenantDetail.moduleActivateBtn')}
            </Button>
            <Button variant="outline" onClick={() => setSheetMode('trial-edit')}>
              <Pencil className="h-4 w-4" />
              {t('admin.tenantDetail.moduleEditTrialBtn')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setEndTrialOpen(true)}
              loading={endTrialMut.isPending}
              className="text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/30"
            >
              <Power className="h-4 w-4" />
              {t('admin.tenantDetail.moduleEndTrialBtn')}
            </Button>
          </div>
        ) : (
          // No subscription, no trial. Offer Aktifkan + (Mulai Trial if
          // the tenant hasn't used their one shot yet).
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="brand" onClick={() => setSheetMode('payment')}>
              <Power className="h-4 w-4" />
              {t('admin.tenantDetail.moduleActivateBtn')}
            </Button>
            {!trialUsed && (
              <Button
                variant="outline"
                onClick={() => {
                  setMutationError(null)
                  setStartTrialOpen(true)
                }}
              >
                <Sparkles className="h-4 w-4" />
                {t('admin.tenantDetail.moduleStartTrialBtn')}
              </Button>
            )}
          </div>
        )}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('admin.tenantDetail.moduleStatus')}
          </dt>
          <dd className="mt-0.5">
            {paidActive ? (
              <span className="inline-flex rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
                {t('admin.tenantDetail.moduleActive')}
              </span>
            ) : trialActive ? (
              <span className="inline-flex rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
                {t('admin.tenantDetail.moduleTrialActive')}
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                {t('admin.tenantDetail.moduleInactive')}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('admin.tenantDetail.modulePlan')}
          </dt>
          <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">
            {data?.currentPlan ? (
              <>
                <span className="font-medium">{t(data.currentPlan.labelKey)}</span>
                <p className="text-xs text-gray-500">
                  {data.currentPlan.isTrial
                    ? t('admin.tenantDetail.modulePlanTrialFree')
                    : `Rp ${formatNumberID(data.currentPlan.pricePerStaffPerMonth)}/staf/bln`}
                </p>
              </>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {trialActive && !paidActive
              ? t('admin.tenantDetail.moduleTrialEndsAt')
              : t('admin.tenantDetail.moduleExpiresAt')}
          </dt>
          <dd className="mt-0.5 flex items-center gap-1 text-sm text-gray-900 dark:text-gray-100">
            {trialActive && !paidActive && trialEndsAt ? (
              <>
                <Clock className="h-3 w-3 text-gray-400" />
                {formatDate(trialEndsAt, 'dd MMMM yyyy')}
                <span className="ml-1 text-xs text-gray-500">
                  ({t('admin.tenantDetail.moduleTrialDaysLeft', { days: trialDaysLeft })})
                </span>
              </>
            ) : expiresAt ? (
              <>
                <Clock className="h-3 w-3 text-gray-400" />
                {formatDate(expiresAt, 'dd MMMM yyyy')}
              </>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {trialActive && !paidActive
              ? t('admin.tenantDetail.moduleTrialCap')
              : t('admin.tenantDetail.moduleBilledStaff')}
          </dt>
          <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">
            {trialActive && !paidActive ? (
              trialStaffCap === null ? (
                'Tanpa batas'
              ) : trialStaffCap > 0 ? (
                `${trialStaffCap} staf`
              ) : (
                <span className="text-gray-400">—</span>
              )
            ) : billedStaff > 0 ? (
              `${billedStaff} staf`
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
        </div>
      </dl>

      {sheetMode === 'payment' && (
        <PaymentSheet
          // Only treat as "renew" when there's a real paid subscription.
          // Trial → paid transitions start a fresh paid window.
          mode={paidActive ? 'renew' : 'activate'}
          tenantName={tenantName}
          currentExpiresAt={paidActive ? expiresAt : null}
          defaultBilledStaffCount={paidActive ? billedStaff : undefined}
          referralAttribution={referralAttribution}
          onClose={() => {
            setSheetMode(null)
            setMutationError(null)
          }}
          onSubmit={(values) => paymentMut.mutate(values)}
          loading={paymentMut.isPending}
          error={mutationError}
        />
      )}

      {sheetMode === 'adjust' && (
        <AdjustWithoutPaymentSheet
          tenantName={tenantName}
          defaultExpiresAt={
            data?.settings?.subscriptionExpiresAt
              ? new Date(data.settings.subscriptionExpiresAt)
                  .toISOString()
                  .slice(0, 10)
              : new Date().toISOString().slice(0, 10)
          }
          defaultBilledStaffCount={data?.settings?.billedStaffCount ?? 1}
          onClose={() => {
            setSheetMode(null)
            setMutationError(null)
          }}
          onSubmit={(values) => updateMut.mutate(values)}
          loading={updateMut.isPending}
          error={mutationError}
        />
      )}

      <ConfirmDialog
        open={deactivateOpen}
        onConfirm={() => {
          setMutationError(null)
          deactivateMut.mutate()
        }}
        onCancel={() => {
          setDeactivateOpen(false)
          setMutationError(null)
        }}
        title={t('admin.tenantDetail.moduleDeactivateTitle')}
        description={mutationError ?? t('admin.tenantDetail.moduleDeactivateDesc')}
        confirmText={t('admin.tenantDetail.moduleDeactivateBtn')}
        cancelText={t('common.cancel')}
        loading={deactivateMut.isPending}
        variant="danger"
      />

      <ConfirmDialog
        open={startTrialOpen}
        onConfirm={() => {
          setMutationError(null)
          startTrialMut.mutate()
        }}
        onCancel={() => {
          setStartTrialOpen(false)
          setMutationError(null)
        }}
        title={t('admin.tenantDetail.moduleStartTrialTitle')}
        description={
          mutationError ??
          t('admin.tenantDetail.moduleStartTrialDesc', {
            tenantName,
            days: ATTENDANCE_TRIAL_DEFAULTS.durationDays,
            staff: ATTENDANCE_TRIAL_DEFAULTS.staffCap,
          })
        }
        confirmText={t('admin.tenantDetail.moduleStartTrialBtn')}
        cancelText={t('common.cancel')}
        loading={startTrialMut.isPending}
      />

      {sheetMode === 'trial-edit' && (
        <TrialSheet
          mode="edit"
          tenantName={tenantName}
          currentEndsAt={trialEndsAt}
          currentStaffCap={trialStaffCap}
          onClose={() => {
            setSheetMode(null)
            setMutationError(null)
          }}
          onSubmit={(values) => updateTrialMut.mutate(values)}
          loading={updateTrialMut.isPending}
          error={mutationError}
        />
      )}

      <ConfirmDialog
        open={endTrialOpen}
        onConfirm={() => {
          setMutationError(null)
          endTrialMut.mutate()
        }}
        onCancel={() => {
          setEndTrialOpen(false)
          setMutationError(null)
        }}
        title={t('admin.tenantDetail.moduleEndTrialTitle')}
        description={mutationError ?? t('admin.tenantDetail.moduleEndTrialDesc', { tenantName })}
        confirmText={t('admin.tenantDetail.moduleEndTrialBtn')}
        cancelText={t('common.cancel')}
        loading={endTrialMut.isPending}
        variant="danger"
      />
    </div>
  )
}

/**
 * Corrective sheet — lets admin fix the expiry/staff count without
 * recording a new payment. Used for typo repairs, goodwill extensions,
 * etc. Every "real" change should go through the PaymentSheet instead.
 */
function AdjustWithoutPaymentSheet({
  tenantName,
  defaultExpiresAt,
  defaultBilledStaffCount,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  tenantName: string
  defaultExpiresAt: string
  defaultBilledStaffCount: number
  onClose: () => void
  onSubmit: (values: { expiresAt: string; billedStaffCount: number }) => void
  loading: boolean
  error: string | null
}) {
  const { t } = useTranslation()

  const form = useForm<ActivateForm>({
    resolver: zodResolver(activateSchema),
    defaultValues: {
      expiresAt: defaultExpiresAt,
      billedStaffCount: defaultBilledStaffCount,
    },
  })

  function handleSubmit(values: ActivateForm) {
    // Convert YYYY-MM-DD to ISO datetime at end of day Jakarta time
    const expiresIso = new Date(`${values.expiresAt}T23:59:59+07:00`).toISOString()
    onSubmit({ expiresAt: expiresIso, billedStaffCount: values.billedStaffCount })
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('admin.tenantDetail.moduleAdjustTitle')}</SheetTitle>
        <SheetDescription>
          {t('admin.tenantDetail.moduleAdjustDesc', { tenantName })}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.tenantDetail.moduleFieldExpiry')}
            </label>
            <Controller
              name="expiresAt"
              control={form.control}
              render={({ field }) => (
                <DateInput
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                />
              )}
            />
            {form.formState.errors.expiresAt && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.expiresAt.message}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.tenantDetail.moduleFieldBilledStaff')}
            </label>
            <Input type="number" min={0} {...form.register('billedStaffCount')} />
            {form.formState.errors.billedStaffCount && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.billedStaffCount.message}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              {t('admin.tenantDetail.moduleFieldBilledStaffHint')}
            </p>
          </div>
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={loading}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

// ─── Payments history (per-tenant ledger) ────────────

function PaymentsHistorySection({
  tenantId,
  tenantName,
}: {
  tenantId: string
  tenantName: string
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'finance', 'tenant-transactions', tenantId],
    queryFn: () => getTenantTransactions({ data: { tenantId } }),
  })

  const [detailId, setDetailId] = useState<string | null>(null)
  const [refundTarget, setRefundTarget] = useState<{
    id: string
    invoiceNumber: string
    amountIdr: number
  } | null>(null)
  const [refundError, setRefundError] = useState<string | null>(null)

  const refundMut = useMutation({
    mutationFn: (input: RefundSheetSubmit & { originalTransactionId: string }) =>
      recordRefund({
        data: {
          originalTransactionId: input.originalTransactionId,
          refundReason: input.refundReason,
          transferDate: input.transferDate,
          endSubscriptionNow: input.endSubscriptionNow,
          proofDataUrl: input.proofDataUrl,
        },
      }),
    onSuccess: async () => {
      setRefundTarget(null)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('admin.finance.toastRefundRecorded'),
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'finance', 'tenant-transactions', tenantId],
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'attendance-subscription', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan refund'
      setRefundError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    },
  })

  const rows: TransactionRow[] = data.map((d) => ({
    id: d.id,
    invoiceNumber: d.invoiceNumber,
    tenantId: d.tenantId,
    moduleKey: d.moduleKey,
    planKey: d.planKey,
    amountIdr: d.amountIdr,
    transferDate: d.transferDate,
    status: d.status,
    billedStaffCount: d.billedStaffCount ?? null,
    billedOutletCount: d.billedOutletCount ?? null,
    refundOfTransactionId: d.refundOfTransactionId ?? null,
    createdAt: d.createdAt,
    hasRefund: d.hasRefund,
  }))

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('admin.tenantDetail.paymentsTitle')}
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('admin.tenantDetail.paymentsSubtitle')}
        </p>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-500">
          {t('common.loading')}
        </div>
      ) : (
        <TransactionsTable
          rows={rows}
          onRowClick={(r) => setDetailId(r.id)}
          onRefund={(r) =>
            setRefundTarget({
              id: r.id,
              invoiceNumber: r.invoiceNumber,
              amountIdr: r.amountIdr,
            })
          }
        />
      )}

      {detailId && (
        <TransactionDetailDrawer
          transactionId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      {refundTarget && (
        <RefundSheet
          originalInvoiceNumber={refundTarget.invoiceNumber}
          originalAmountIdr={refundTarget.amountIdr}
          tenantName={tenantName}
          onClose={() => {
            setRefundTarget(null)
            setRefundError(null)
          }}
          onSubmit={(values) =>
            refundMut.mutate({
              originalTransactionId: refundTarget.id,
              ...values,
            })
          }
          loading={refundMut.isPending}
          error={refundError}
        />
      )}
    </div>
  )
}

// ─── Danger zone — tenant deletion ───────────────────

function DangerZoneSection({
  tenantId,
  tenantName,
}: {
  tenantId: string
  tenantName: string
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [confirmText, setConfirmText] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mut = useMutation({
    mutationFn: () =>
      deleteTenant({
        data: { tenantId, confirmBusinessName: confirmText },
      }),
    onSuccess: async () => {
      setDialogOpen(false)
      toast({
        title: t('common.toastSavedTitle'),
        description: t('admin.tenantDetail.deleteSuccess', { tenantName }),
        variant: 'success',
      })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] })
      navigate({ to: '/admin/tenants' })
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal menghapus tenant'
      setError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: t('admin.tenantDetail.deleteError', { message: msg }),
        variant: 'error',
      })
    },
  })

  const canDelete = confirmText.trim() === tenantName.trim()

  return (
    <div className="rounded-xl border border-danger-200 bg-danger-50 p-5 dark:border-danger-900/50 dark:bg-danger-950/20">
      <h2 className="text-lg font-semibold text-danger-700 dark:text-danger-400">
        {t('admin.tenantDetail.dangerZoneTitle')}
      </h2>
      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
        {t('admin.tenantDetail.dangerZoneDesc')}
      </p>
      <div className="mt-4 space-y-2">
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          {t('admin.tenantDetail.deleteConfirmLabel')}
        </label>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={t('admin.tenantDetail.deleteConfirmPlaceholder', {
            tenantName,
          })}
          className="max-w-md"
        />
      </div>
      <div className="mt-4">
        <Button
          variant="danger"
          disabled={!canDelete}
          onClick={() => {
            setError(null)
            setDialogOpen(true)
          }}
        >
          <Trash2 className="h-4 w-4" />
          {t('admin.tenantDetail.deleteButton')}
        </Button>
      </div>

      <ConfirmDialog
        open={dialogOpen}
        onConfirm={() => mut.mutate()}
        onCancel={() => {
          setDialogOpen(false)
          setError(null)
        }}
        title={t('admin.tenantDetail.deleteDialogTitle', { tenantName })}
        description={error ?? t('admin.tenantDetail.deleteDialogDesc')}
        confirmText={t('admin.tenantDetail.deleteDialogCta')}
        cancelText={t('common.cancel')}
        loading={mut.isPending}
        variant="danger"
      />
    </div>
  )
}

// ─── Inventory module section ────────────────────────────────────────
//
// Compact admin controls for the inventory module. Phase 1 ships only
// the trial start/end flow — paid activation is deferred to follow-up
// work since the per-staff payment sheet doesn't fit a flat-priced
// plan and the user can manually run SQL OR contact sales for the
// first paid customers.
function InventoryModuleSection({
  tenantId,
  tenantName,
  referralAttribution,
}: {
  tenantId: string
  tenantName: string
  referralAttribution: {
    code: string
    referrerName: string
    discountPct: number
    commissionPct: number
    windowEndsAt: string
  } | null
}) {
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'inventory-subscription', tenantId],
    queryFn: () => getInventorySubscription({ data: { tenantId } }),
  })

  const [paymentOpen, setPaymentOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const paymentMut = useMutation({
    mutationFn: (input: InventoryPaymentSheetSubmit) =>
      recordInventoryPaymentAndActivate({
        data: {
          tenantId,
          planKey: input.planKey,
          locationCount: input.locationCount,
          transferDate: input.transferDate,
          bankReference: input.bankReference,
          proofDataUrl: input.proofDataUrl,
          notes: input.notes,
        },
      }),
    onSuccess: async () => {
      setPaymentOpen(false)
      toast({
        title: 'Inventory Aktif',
        description: `Modul Inventory untuk ${tenantName} berhasil diaktifkan.`,
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'inventory-subscription', tenantId],
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'finance', 'tenant-transactions', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : 'Gagal menyimpan pembayaran'
      setMutationError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    },
  })

  const deactivateMut = useMutation({
    mutationFn: () => deactivateInventory({ data: { tenantId } }),
    onSuccess: async () => {
      setDeactivateOpen(false)
      toast({
        title: 'Inventory Dinonaktifkan',
        description: `Akses modul Inventory ${tenantName} dimatikan.`,
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'inventory-subscription', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal menonaktifkan'
      setMutationError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    },
  })

  const now = Date.now()
  const expiresAt = data?.settings?.subscriptionExpiresAt
    ? new Date(data.settings.subscriptionExpiresAt)
    : null
  const paidActive =
    (data?.settings?.subscriptionActive ?? false) &&
    !!expiresAt &&
    expiresAt.getTime() > now

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Modul Inventory
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Catat pembayaran tenant untuk mengaktifkan paket Toko (atau lebih
            tinggi) modul Inventory. Transaksi akan muncul di riwayat
            pembayaran.
          </p>
        </div>
        {isLoading ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {paidActive ? (
              <>
                <Button
                  variant="brand"
                  onClick={() => {
                    setMutationError(null)
                    setPaymentOpen(true)
                  }}
                >
                  <Plus className="h-4 w-4" /> Perpanjang
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMutationError(null)
                    setDeactivateOpen(true)
                  }}
                  loading={deactivateMut.isPending}
                >
                  <Power className="h-4 w-4" /> Nonaktifkan
                </Button>
              </>
            ) : (
              <Button
                variant="brand"
                onClick={() => {
                  setMutationError(null)
                  setPaymentOpen(true)
                }}
              >
                <Power className="h-4 w-4" /> Aktifkan
              </Button>
            )}
          </div>
        )}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Status
          </dt>
          <dd className="mt-0.5">
            {paidActive ? (
              <span className="inline-flex rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
                Aktif
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                Tidak Aktif (Free)
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Paket
          </dt>
          <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">
            {data?.currentPlan ? (
              <>
                <span className="font-medium capitalize">
                  {data.currentPlan.tier}
                </span>{' '}
                <span className="text-xs text-gray-500">
                  ({data.currentPlan.durationMonths} bln)
                </span>
              </>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Berakhir
          </dt>
          <dd className="mt-0.5 flex items-center gap-1 text-sm text-gray-900 dark:text-gray-100">
            {expiresAt ? (
              <>
                <Clock className="h-3 w-3 text-gray-400" />
                {formatDate(expiresAt, 'dd MMMM yyyy')}
              </>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
        </div>
      </dl>

      {paymentOpen && (
        <InventoryPaymentSheet
          mode={paidActive ? 'renew' : 'activate'}
          tenantName={tenantName}
          currentExpiresAt={paidActive ? expiresAt : null}
          referralAttribution={referralAttribution}
          onClose={() => {
            setPaymentOpen(false)
            setMutationError(null)
          }}
          onSubmit={(values) => paymentMut.mutate(values)}
          loading={paymentMut.isPending}
          error={mutationError}
        />
      )}

      <ConfirmDialog
        open={deactivateOpen}
        onConfirm={() => {
          setMutationError(null)
          deactivateMut.mutate()
        }}
        onCancel={() => {
          setDeactivateOpen(false)
          setMutationError(null)
        }}
        title="Nonaktifkan modul Inventory?"
        description={
          mutationError ??
          `Akses Inventory ${tenantName} akan kembali ke paket Free. Data tetap tersimpan dan bisa diaktifkan kembali.`
        }
        confirmText="Nonaktifkan"
        cancelText="Batal"
        loading={deactivateMut.isPending}
        variant="danger"
      />
    </div>
  )
}

function POSModuleSection({
  tenantId,
  tenantName,
  referralAttribution,
}: {
  tenantId: string
  tenantName: string
  referralAttribution: {
    code: string
    referrerName: string
    discountPct: number
    commissionPct: number
    windowEndsAt: string
  } | null
}) {
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'pos-subscription', tenantId],
    queryFn: () => getPOSSubscription({ data: { tenantId } }),
  })

  const [paymentOpen, setPaymentOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [trialConfirmOpen, setTrialConfirmOpen] = useState(false)
  const [endTrialOpen, setEndTrialOpen] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

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
        title: 'Kasir Aktif',
        description: `Modul Kasir untuk ${tenantName} berhasil diaktifkan.`,
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'pos-subscription', tenantId],
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'finance', 'tenant-transactions', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : 'Gagal menyimpan pembayaran'
      setMutationError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    },
  })

  const deactivateMut = useMutation({
    mutationFn: () => deactivatePOS({ data: { tenantId } }),
    onSuccess: async () => {
      setDeactivateOpen(false)
      toast({
        title: 'Kasir Dinonaktifkan',
        description: `Akses modul Kasir ${tenantName} dimatikan.`,
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'pos-subscription', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal menonaktifkan'
      setMutationError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    },
  })

  const startTrialMut = useMutation({
    mutationFn: () => startPOSTrial({ data: { tenantId } }),
    onSuccess: async () => {
      setTrialConfirmOpen(false)
      toast({
        title: 'Trial Kasir Dimulai',
        description: `Trial 7 hari (Toko) untuk ${tenantName}.`,
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'pos-subscription', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal memulai trial'
      setMutationError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    },
  })

  const endTrialMut = useMutation({
    mutationFn: () => endPOSTrial({ data: { tenantId } }),
    onSuccess: async () => {
      setEndTrialOpen(false)
      toast({
        title: 'Trial Diakhiri',
        description: `Trial Kasir ${tenantName} dihentikan.`,
        variant: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'pos-subscription', tenantId],
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal mengakhiri trial'
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    },
  })

  const now = Date.now()
  const expiresAt = data?.settings?.subscriptionExpiresAt
    ? new Date(data.settings.subscriptionExpiresAt)
    : null
  const trialEndsAt = data?.settings?.trialEndsAt
    ? new Date(data.settings.trialEndsAt)
    : null
  const paidActive =
    (data?.settings?.subscriptionActive ?? false) &&
    !!expiresAt &&
    expiresAt.getTime() > now
  const trialActive = !!trialEndsAt && trialEndsAt.getTime() > now
  const trialUsed = data?.settings?.trialUsed ?? false

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Modul Kasir (POS)
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Catat pembayaran tenant untuk mengaktifkan paket Toko (atau lebih
            tinggi) modul Kasir, atau mulai trial 7 hari.
          </p>
        </div>
        {isLoading ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {paidActive ? (
              <>
                <Button
                  variant="brand"
                  onClick={() => {
                    setMutationError(null)
                    setPaymentOpen(true)
                  }}
                >
                  <Plus className="h-4 w-4" /> Perpanjang
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMutationError(null)
                    setDeactivateOpen(true)
                  }}
                  loading={deactivateMut.isPending}
                >
                  <Power className="h-4 w-4" /> Nonaktifkan
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="brand"
                  onClick={() => {
                    setMutationError(null)
                    setPaymentOpen(true)
                  }}
                >
                  <Power className="h-4 w-4" /> Aktifkan
                </Button>
                {!trialUsed && !trialActive && (
                  <Button
                    variant="outline"
                    onClick={() => setTrialConfirmOpen(true)}
                    loading={startTrialMut.isPending}
                  >
                    <Sparkles className="h-4 w-4" /> Mulai Trial
                  </Button>
                )}
                {trialActive && (
                  <Button
                    variant="outline"
                    onClick={() => setEndTrialOpen(true)}
                    loading={endTrialMut.isPending}
                  >
                    Akhiri Trial
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Status</dt>
          <dd className="mt-0.5">
            {paidActive ? (
              <span className="inline-flex rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
                Aktif
              </span>
            ) : trialActive ? (
              <span className="inline-flex rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
                Trial
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                Tidak Aktif (Free)
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Paket</dt>
          <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">
            {data?.currentPlan ? (
              <>
                <span className="font-medium capitalize">{data.currentPlan.tier}</span>{' '}
                <span className="text-xs text-gray-500">
                  ({data.currentPlan.durationMonths} bln)
                </span>
              </>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Berakhir</dt>
          <dd className="mt-0.5 flex items-center gap-1 text-sm text-gray-900 dark:text-gray-100">
            {expiresAt || trialEndsAt ? (
              <>
                <Clock className="h-3 w-3 text-gray-400" />
                {(() => {
                  const d = paidActive ? expiresAt : trialEndsAt
                  return d ? formatDate(d, 'dd MMMM yyyy') : null
                })()}
              </>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
        </div>
      </dl>

      {paymentOpen && (
        <POSPaymentSheet
          mode={paidActive ? 'renew' : 'activate'}
          tenantName={tenantName}
          currentExpiresAt={paidActive ? expiresAt : null}
          referralAttribution={referralAttribution}
          onClose={() => {
            setPaymentOpen(false)
            setMutationError(null)
          }}
          onSubmit={(values) => paymentMut.mutate(values)}
          loading={paymentMut.isPending}
          error={mutationError}
        />
      )}

      <ConfirmDialog
        open={deactivateOpen}
        onConfirm={() => {
          setMutationError(null)
          deactivateMut.mutate()
        }}
        onCancel={() => {
          setDeactivateOpen(false)
          setMutationError(null)
        }}
        title="Nonaktifkan modul Kasir?"
        description={
          mutationError ??
          `Akses Kasir ${tenantName} akan kembali ke paket Free. Data tetap tersimpan dan bisa diaktifkan kembali.`
        }
        confirmText="Nonaktifkan"
        cancelText="Batal"
        loading={deactivateMut.isPending}
        variant="danger"
      />

      <ConfirmDialog
        open={trialConfirmOpen}
        onConfirm={() => startTrialMut.mutate()}
        onCancel={() => setTrialConfirmOpen(false)}
        title="Mulai Trial Kasir?"
        description={`Trial 7 hari dengan fitur Toko untuk ${tenantName}. Hanya bisa dilakukan sekali per tenant.`}
        confirmText="Ya, Mulai Trial"
        cancelText="Batal"
        loading={startTrialMut.isPending}
      />

      <ConfirmDialog
        open={endTrialOpen}
        onConfirm={() => endTrialMut.mutate()}
        onCancel={() => setEndTrialOpen(false)}
        title="Akhiri Trial Kasir?"
        description={`Trial untuk ${tenantName} akan berakhir sekarang. Tenant kembali ke paket Free.`}
        confirmText="Ya, Akhiri"
        cancelText="Batal"
        loading={endTrialMut.isPending}
        variant="danger"
      />
    </div>
  )
}

// ─── WhatsApp Module Section ──────────────────────────────────────────────────

function WAModuleSection({ tenantId, tenantName, activeModules, waSubscription }: {
  tenantId: string
  tenantName: string
  activeModules: string[]
  waSubscription: { tier: string; active: boolean; expiresAt: string | null }
}) {
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [mutError, setMutError] = useState<string | null>(null)

  const paymentMut = useMutation({
    mutationFn: (input: WaPaymentSheetSubmit) =>
      recordWaPayment({
        data: {
          tenantId,
          planKey: input.planKey,
          amountIdr: input.amountIdr,
          durationMonths: input.durationMonths === 12 ? 12 : 1,
          transferDate: input.transferDate,
          bankReference: input.bankReference,
          proofDataUrl: input.proofDataUrl,
          notes: input.notes,
        },
      }),
    onSuccess: async () => {
      setSheetOpen(false)
      toast({ title: 'WhatsApp AI diaktifkan', variant: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'finance', 'tenant-transactions', tenantId] })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan'
      setMutError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    },
  })

  const deactivateMut = useMutation({
    mutationFn: () => deactivateWa({ data: { tenantId } }),
    onSuccess: async () => {
      setDeactivateOpen(false)
      toast({
        title: 'WhatsApp AI Dinonaktifkan',
        description: `Akses modul WhatsApp AI ${tenantName} dimatikan.`,
        variant: 'success',
      })
      await router.invalidate()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal menonaktifkan'
      setMutError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    },
  })

  const TIER_LABEL: Record<string, string> = { basic: 'Basic', komplit: 'Komplit', enterprise: 'Enterprise' }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">WhatsApp AI</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Aktifkan modul WhatsApp AI untuk tenant ini. Transaksi akan muncul di riwayat pembayaran.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {waSubscription.active ? (
            <>
              <Button
                variant="brand"
                onClick={() => {
                  setMutError(null)
                  setSheetOpen(true)
                }}
              >
                <Plus className="h-4 w-4" /> Perpanjang
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setMutError(null)
                  setDeactivateOpen(true)
                }}
                loading={deactivateMut.isPending}
              >
                <Power className="h-4 w-4" /> Nonaktifkan
              </Button>
            </>
          ) : (
            <Button
              variant="brand"
              onClick={() => {
                setMutError(null)
                setSheetOpen(true)
              }}
            >
              <Power className="h-4 w-4" /> Aktifkan
            </Button>
          )}
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Status</dt>
          <dd className="mt-0.5">
            {waSubscription.active ? (
              <span className="inline-flex rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
                Aktif
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                Tidak Aktif
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Paket</dt>
          <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">
            {waSubscription.active ? (
              <span className="font-medium">{TIER_LABEL[waSubscription.tier] ?? waSubscription.tier}</span>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Berakhir</dt>
          <dd className="mt-0.5 flex items-center gap-1 text-sm text-gray-900 dark:text-gray-100">
            {waSubscription.active && waSubscription.expiresAt ? (
              <>
                <Clock className="h-3 w-3 text-gray-400" />
                {formatDate(waSubscription.expiresAt, 'dd MMMM yyyy')}
              </>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
        </div>
      </dl>

      {sheetOpen && (
        <WaPaymentSheet
          mode={waSubscription.active ? 'renew' : 'activate'}
          tenantName={tenantName}
          currentExpiresAt={waSubscription.expiresAt ? new Date(waSubscription.expiresAt) : null}
          onClose={() => setSheetOpen(false)}
          onSubmit={(values) => { setMutError(null); paymentMut.mutate(values) }}
          loading={paymentMut.isPending}
          error={mutError}
        />
      )}

      <ConfirmDialog
        open={deactivateOpen}
        onConfirm={() => {
          setMutError(null)
          deactivateMut.mutate()
        }}
        onCancel={() => {
          setDeactivateOpen(false)
          setMutError(null)
        }}
        title="Nonaktifkan modul WhatsApp AI?"
        description={
          mutError ??
          `Akses WhatsApp AI ${tenantName} akan dimatikan. Data tetap tersimpan dan bisa diaktifkan kembali.`
        }
        confirmText="Nonaktifkan"
        cancelText="Batal"
        loading={deactivateMut.isPending}
        variant="danger"
      />
    </div>
  )
}
