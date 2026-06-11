import { useState, useEffect, useMemo } from 'react'
import { createFileRoute, redirect, useRouter, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus,
  Navigation,
  Trash2,
  Star,
  Building2,
  ShoppingCart,
  Boxes,
  Users,
  AlertCircle,
  ArrowRight,
} from 'lucide-react'
import {
  getBranchManagementContext,
  getBranchWithSchedule,
  createBranch,
  updateBranch,
  deleteBranch,
  setBranchSchedule,
  setBranchScheduleMode,
  getBranchBusinessHours,
  setBranchBusinessHours,
} from '@/server/functions/attendance-branches'
import { branchCostBreakdown } from '@vintra/shared'
import { formatRupiah } from '@/lib/currency'
import { buildSalesWaUrl } from '@/lib/constants'
import { formatGeolocationError } from '@/lib/geolocation-error'

const SALES_WHATSAPP_URL = buildSalesWaUrl(
  'Halo Vintra, saya mau menambah cabang/outlet pada akun saya. Mohon bantu hitung biaya & atur pembayarannya.',
)
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export const Route = createFileRoute('/_authed/master/branches')({
  // Branches are tenant-wide master data (POS, Inventory, Attendance
  // all read them). With migration 0070 the page is gated on the new
  // generic `branches.manage` permission so POS-only and Komplit
  // tenants who don't have attendance can still manage outlets.
  // Owners + Admins get it by default; custom roles can be granted.
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('branches.manage')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  loader: () => getBranchManagementContext(),
  component: BranchesPage,
})

type Context = Awaited<ReturnType<typeof getBranchManagementContext>>
type Branch = Context['branches'][number]

const MODULE_META = {
  pos: {
    label: 'POS',
    longLabel: 'Kasir / POS',
    icon: ShoppingCart,
    color: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
  },
  inventory: {
    label: 'Stok',
    longLabel: 'Inventaris / Gudang',
    icon: Boxes,
    color: 'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300',
  },
  attendance: {
    label: 'HR',
    longLabel: 'Absensi / HR',
    icon: Users,
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  },
} as const

type ModuleKey = keyof typeof MODULE_META

function BranchesPage() {
  const ctx = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)

  // Per-module current extras already accrued by existing branches.
  // Read by the summary card so the owner sees today's cost picture
  // before they touch "Tambah Cabang".
  const currentBreakdown = useMemo(
    () =>
      branchCostBreakdown({
        posTier: ctx.posTier,
        inventoryTier: ctx.inventoryTier,
        posPlanKey: ctx.posPlanKey,
        inventoryPlanKey: ctx.inventoryPlanKey,
        branches: ctx.branches.map((b) => ({
          enabledModules: b.enabledModules,
        })),
      }),
    [ctx.posTier, ctx.inventoryTier, ctx.posPlanKey, ctx.inventoryPlanKey, ctx.branches],
  )

  // Paid-tier tenants must pay upfront for additional outlets (we run
  // prepaid, not postpaid). Block client-side creation when every paid
  // module already has as many active branches as it's billed for.
  //
  // The condition fires when ALL of these are true:
  //   - Tenant is on at least one paid module
  //   - For each paid module: actual branch count with that module
  //     enabled >= billedOutletCount on the latest paid transaction
  // When admin records an outlet-tambahan payment via the new admin
  // sheet, billedOutletCount goes up → block lifts → tenant can
  // create the branch themselves.
  const onPaidTier = ctx.posTier !== 'free' || ctx.inventoryTier !== 'free'
  // Default billed = 1 (the first outlet is included in the base
  // subscription price) when there's no recorded transaction yet.
  const posBilled = Math.max(1, ctx.posBilledOutletCount)
  const invBilled = Math.max(1, ctx.inventoryBilledOutletCount)
  const posAtCap = ctx.posTier !== 'free' && ctx.counts.pos >= posBilled
  const invAtCap =
    ctx.inventoryTier !== 'free' && ctx.counts.inventory >= invBilled
  const needsPrepayForNext = onPaidTier && (posAtCap || invAtCap)

  // Unused billed capacity — when admin recorded an outlet-tambahan
  // payment AND the tenant hasn't created the branch yet. The sheet
  // uses this to (a) skip module-toggle / cost-preview / WA-admin
  // noise (admin's already settled the money), and (b) pre-fill the
  // new branch's enabledModules based on which modules have unused
  // slots so the tenant only fills in name + GPS.
  const posSlot = Math.max(0, posBilled - ctx.counts.pos)
  const invSlot = Math.max(0, invBilled - ctx.counts.inventory)
  const paidCapacityModules: ModuleKey[] = []
  if (posSlot > 0) paidCapacityModules.push('pos')
  if (invSlot > 0) paidCapacityModules.push('inventory')
  // Komplit bundles attendance — when both POS and Inv have slots
  // (paired Komplit purchase), include attendance too. Attendance is
  // per-staff billed (no per-branch cost), so a "POS-only kiosk" with
  // only POS slot doesn't get auto-attendance.
  if (posSlot > 0 && invSlot > 0 && ctx.posTier === 'komplit') {
    paidCapacityModules.push('attendance')
  }
  const hasPaidCapacity = paidCapacityModules.length > 0

  // Block "Tambah Cabang" when EVERY active paid module is on Free
  // tier AND already at the 1-branch cap — the only way the user can
  // legitimately add another branch is to upgrade. We surface a CTA
  // pointing at the relevant billing page (POS for now; richer plan
  // matrix can come later).
  const atFreeCap =
    ctx.posTier === 'free' &&
    ctx.inventoryTier === 'free' &&
    ctx.branches.length >= 1

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('branches.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Kelola cabang fisik (toko/outlet) atau gudang Anda. Setiap
            cabang bisa diaktifkan untuk modul yang berbeda — gudang
            hanya pakai Stok, outlet penuh pakai semua.
          </p>
        </div>
        {atFreeCap ? (
          <Link
            to="/pos/billing"
            className="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-700"
          >
            Upgrade untuk tambah cabang
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : needsPrepayForNext ? (
          <a
            href={SALES_WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            Tambah Cabang via Admin
          </a>
        ) : (
          <Button
            variant="brand"
            onClick={() => setCreating(true)}
            className="shrink-0 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Tambah Cabang
          </Button>
        )}
      </div>

      <SummaryCard ctx={ctx} currentExtra={currentBreakdown.currentExtraPerMonth} />

      {atFreeCap && (
        <div className="flex items-start gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-900/40 dark:bg-warning-900/20">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning-700 dark:text-warning-400" />
          <div className="text-sm">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              Paket gratis cuma boleh 1 cabang
            </p>
            <p className="mt-0.5 text-gray-600 dark:text-gray-400">
              Upgrade ke paket berbayar (POS Toko / Komplit / Stok Toko)
              untuk menambah cabang atau gudang baru. Setiap modul
              menagih biaya tambahan per lokasi sesuai paketnya.
            </p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama Cabang</TableHead>
              <TableHead>Modul Aktif</TableHead>
              <TableHead>Alamat</TableHead>
              <TableHead>Koordinat</TableHead>
              <TableHead>Radius</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ctx.branches.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  Belum ada cabang. Klik "Tambah Cabang" untuk membuat
                  yang pertama.
                </TableCell>
              </TableRow>
            ) : (
              ctx.branches.map((b) => (
                <TableRow
                  key={b.id}
                  onClick={() => setEditing(b)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {b.name}
                      {b.isMain && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-800 dark:bg-accent-900/40 dark:text-accent-300">
                          <Star className="h-3 w-3" />
                          Utama
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ModuleBadgeGroup modules={b.enabledModules} />
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                    {b.address ?? <span className="text-gray-400">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-gray-600 dark:text-gray-400">
                    {Number(b.latitude).toFixed(5)}, {Number(b.longitude).toFixed(5)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.radiusMeters} m
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {creating && (
        <CreateBranchSheet
          ctx={ctx}
          paidCapacityModules={paidCapacityModules}
          hasPaidCapacity={hasPaidCapacity}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false)
            await router.invalidate()
          }}
        />
      )}

      {editing && (
        <EditBranchSheet
          branch={editing}
          ctx={ctx}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await router.invalidate()
          }}
          onDeleted={async () => {
            setEditing(null)
            await router.invalidate()
          }}
        />
      )}
    </div>
  )
}

// ─── Header summary (plan + per-module counts + current extras) ─────

function SummaryCard({
  ctx,
  currentExtra,
}: {
  ctx: Context
  currentExtra: number
}) {
  // Attendance intentionally omitted — it's billed per-staff, not
  // per-branch, so a "Paket" line under HR was misleading. Branches
  // still toggle attendance for GPS/schedule purposes (separate setting).
  const stat = [
    {
      key: 'pos' as ModuleKey,
      tier: ctx.posTier,
      count: ctx.counts.pos,
      active: ctx.posActive,
    },
    {
      key: 'inventory' as ModuleKey,
      tier: ctx.inventoryTier,
      count: ctx.counts.inventory,
      active: ctx.inventoryActive,
    },
  ]

  return (
    <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800 sm:grid-cols-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Total Cabang
        </p>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {ctx.branches.length}
          </span>
          <span className="text-sm text-gray-500">lokasi</span>
        </p>
      </div>
      {stat.map((s) => {
        const meta = MODULE_META[s.key]
        const Icon = meta.icon
        return (
          <div key={s.key}>
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <Icon className="h-3.5 w-3.5" />
              {meta.longLabel}
            </p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {s.count}
              </span>
              <span className="text-sm text-gray-500">lokasi</span>
            </p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Paket: <span className="font-medium capitalize">{s.tier}</span>
              {!s.active && s.tier !== 'free' && (
                <span className="ml-1 text-warning-700">(belum aktif)</span>
              )}
            </p>
          </div>
        )
      })}
      {currentExtra > 0 && (
        <div className="-mt-1 flex items-start gap-2 border-t border-gray-200 pt-4 text-xs text-gray-600 sm:col-span-3 dark:border-gray-700 dark:text-gray-400">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
          <p>
            Biaya cabang tambahan saat ini:{' '}
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {formatRupiah(currentExtra)}/bulan
            </span>{' '}
            (sudah termasuk dalam paket aktif).
          </p>
        </div>
      )}
    </div>
  )
}

function ModuleBadgeGroup({ modules }: { modules: string[] }) {
  const known = (['pos', 'inventory', 'attendance'] as ModuleKey[]).filter((k) =>
    modules.includes(k),
  )
  if (known.length === 0) {
    return <span className="text-xs text-gray-400">—</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {known.map((k) => {
        const meta = MODULE_META[k]
        const Icon = meta.icon
        return (
          <span
            key={k}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.color}`}
          >
            <Icon className="h-3 w-3" />
            {meta.label}
          </span>
        )
      })}
    </div>
  )
}

// ─── Cost preview (used in create + edit sheets) ────

function CostPreview({
  ctx,
  enabledModules,
  excludeBranchId,
}: {
  ctx: Context
  enabledModules: string[]
  excludeBranchId?: string
}) {
  // For "create" excludeBranchId is undefined and we compute the delta
  // as "adding a new branch with these modules". For "edit" we exclude
  // the branch being edited from the current state, then re-add it
  // with the proposed module set — net delta surfaces honestly.
  const baseline = useMemo(
    () =>
      ctx.branches
        .filter((b) => b.id !== excludeBranchId)
        .map((b) => ({ enabledModules: b.enabledModules })),
    [ctx.branches, excludeBranchId],
  )

  const result = useMemo(
    () =>
      branchCostBreakdown(
        {
          posTier: ctx.posTier,
          inventoryTier: ctx.inventoryTier,
          posPlanKey: ctx.posPlanKey,
          inventoryPlanKey: ctx.inventoryPlanKey,
          branches: baseline,
        },
        { enabledModules },
      ),
    [
      ctx.posTier,
      ctx.inventoryTier,
      ctx.posPlanKey,
      ctx.inventoryPlanKey,
      baseline,
      enabledModules,
    ],
  )

  // The TS overload picks the proposed shape when we pass `proposed`.
  // Defensive narrowing keeps the JSX simple.
  const delta =
    'proposedDeltaPerMonth' in result ? result.proposedDeltaPerMonth : 0
  const proposedBreakdown =
    'proposedBreakdown' in result ? result.proposedBreakdown : null

  if (enabledModules.length === 0) {
    return (
      <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs text-warning-800 dark:border-warning-900/40 dark:bg-warning-900/20 dark:text-warning-300">
        Pilih minimal 1 modul yang dipakai di cabang ini.
      </div>
    )
  }

  if (delta === 0) {
    return (
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs text-brand-800 dark:border-brand-900/40 dark:bg-brand-900/20 dark:text-brand-300">
        Tidak ada biaya tambahan untuk cabang ini di paket aktif.
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-900/40 dark:bg-brand-900/20">
      <p className="text-xs font-medium text-brand-900 dark:text-brand-200">
        Biaya tambahan cabang ini
      </p>
      <p className="text-base font-bold text-brand-700 dark:text-brand-300">
        + {formatRupiah(delta)}/bulan
      </p>
      {proposedBreakdown && (
        <div className="space-y-0.5 text-[11px] text-gray-600 dark:text-gray-400">
          {proposedBreakdown.komplit > 0 && (
            <p>
              · Komplit (bundle penuh):{' '}
              {formatRupiah(proposedBreakdown.komplit)}/bln
            </p>
          )}
          {proposedBreakdown.pos > 0 && (
            <p>· POS à la carte: {formatRupiah(proposedBreakdown.pos)}/bln</p>
          )}
          {proposedBreakdown.inventory > 0 && (
            <p>
              · Stok à la carte:{' '}
              {formatRupiah(proposedBreakdown.inventory)}/bln
            </p>
          )}
        </div>
      )}
      <div className="rounded-md border border-warning-200 bg-warning-50 p-2 text-[11px] text-warning-900 dark:border-warning-900/40 dark:bg-warning-900/20 dark:text-warning-200">
        <p className="font-medium">Pembayaran upfront</p>
        <p className="mt-0.5">
          Vintra prepaid: cabang baru aktif setelah pembayaran masuk.
          Admin akan hitung biaya pro-rata sesuai sisa masa aktif paket.
        </p>
        <a
          href={SALES_WHATSAPP_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-block font-semibold text-warning-700 underline hover:text-warning-800 dark:text-warning-300 dark:hover:text-warning-200"
        >
          Hubungi admin via WhatsApp →
        </a>
      </div>
    </div>
  )
}

// ─── Create sheet ────────────────────────────────────

const branchFormSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi'),
  address: z.string().optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(10).max(5000),
  isMain: z.boolean(),
  branchModel: z.enum(['independent', 'franchise']),
  enabledModules: z.array(z.enum(['pos', 'inventory', 'attendance'])).min(1),
})
type BranchForm = z.infer<typeof branchFormSchema>

function CreateBranchSheet({
  ctx,
  paidCapacityModules,
  hasPaidCapacity,
  onClose,
  onSaved,
}: {
  ctx: Context
  /** Modules with unused billed slots — pre-checked when present. */
  paidCapacityModules: ModuleKey[]
  /** When true, admin already settled payment for this outlet's slot —
   *  skip module toggles + cost preview + WhatsApp prepaid notice. */
  hasPaidCapacity: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)

  const form = useForm<BranchForm>({
    resolver: zodResolver(branchFormSchema),
    defaultValues: {
      name: '',
      address: '',
      latitude: 0,
      longitude: 0,
      radiusMeters: 100,
      isMain: false,
      branchModel: 'independent',
      // When admin recorded an outlet-tambahan payment, use the modules
      // they paid for; otherwise default to a full outlet so existing
      // first-branch creation (free tier) still defaults nicely.
      enabledModules: hasPaidCapacity
        ? paidCapacityModules
        : ['pos', 'inventory', 'attendance'],
    },
  })
  const enabledModules = form.watch('enabledModules')

  async function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setServerError(t('branches.gpsUnsupported'))
      return
    }
    setGpsLoading(true)
    setServerError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.setValue('latitude', Number(pos.coords.latitude.toFixed(7)))
        form.setValue('longitude', Number(pos.coords.longitude.toFixed(7)))
        setGpsLoading(false)
      },
      (err) => {
        // JUR-208: friendlier, platform-aware help instead of the raw
        // spec phrase. Same helper is used on /attendance check-in.
        setServerError(formatGeolocationError(err, t))
        setGpsLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function handleSubmit(values: BranchForm) {
    setServerError(null)
    try {
      await createBranch({
        data: {
          name: values.name,
          address: values.address ?? null,
          latitude: values.latitude,
          longitude: values.longitude,
          radiusMeters: values.radiusMeters,
          isMain: values.isMain,
          branchModel: values.branchModel,
          enabledModules: values.enabledModules,
        },
      })
      toast({
        title: t('common.toastSavedTitle'),
        description: `Cabang "${values.name}" berhasil ditambahkan.`,
        variant: 'success',
      })
      await onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan'
      setServerError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>Tambah Cabang</SheetTitle>
        <SheetDescription>
          {hasPaidCapacity
            ? 'Pembayaran outlet ini sudah dicatat oleh admin. Tinggal isi nama dan lokasi cabang baru.'
            : 'Tentukan modul yang aktif di cabang ini — biaya tambahan ditampilkan secara live di bawah.'}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {hasPaidCapacity ? (
            <PaidCapacityNotice modules={paidCapacityModules} />
          ) : (
            <>
              <ModuleTogglesField form={form} />
              <CostPreview ctx={ctx} enabledModules={enabledModules} />
            </>
          )}
          <DetailFields
            form={form}
            gpsLoading={gpsLoading}
            onUseCurrentLocation={handleUseCurrentLocation}
          />
          {serverError && (
          <p className="whitespace-pre-line text-sm text-danger-600">
            {serverError}
          </p>
        )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            loading={form.formState.isSubmitting}
            disabled={enabledModules.length === 0}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

/**
 * Replaces the module-toggle + cost-preview + WhatsApp-prepaid stack
 * when the admin has already recorded the outlet-tambahan payment.
 * Tenant just sees "you've got a paid slot, here's what it covers"
 * and fills in branch details below.
 */
function PaidCapacityNotice({ modules }: { modules: ModuleKey[] }) {
  const knownModules = modules.filter(
    (m): m is ModuleKey => m in MODULE_META,
  )
  return (
    <div className="rounded-lg border border-success-200 bg-success-50 p-4 dark:border-success-900/40 dark:bg-success-900/20">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          Sudah Dibayar
        </span>
        <span className="text-sm font-semibold text-success-900 dark:text-success-100">
          Outlet siap dibuat
        </span>
      </div>
      <p className="text-xs text-success-800 dark:text-success-200">
        Admin sudah mencatat pembayaran outlet ini. Cabang baru akan
        aktif untuk modul berikut:
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {knownModules.map((k) => {
          const meta = MODULE_META[k]
          const Icon = meta.icon
          return (
            <span
              key={k}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.color}`}
            >
              <Icon className="h-3 w-3" />
              {meta.longLabel}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ─── Edit sheet with tabs ────────────────────────────

const scheduleFormSchema = z.object({
  days: z
    .array(
      z.object({
        dayOfWeek: z.number(),
        isWorkDay: z.boolean(),
        clockInTime: z.string(),
        clockOutTime: z.string(),
        lateGraceMinutes: z.coerce.number().int().min(0).max(120),
        earlyLeaveGraceMinutes: z.coerce.number().int().min(0).max(120),
      }),
    )
    .length(7),
})
type ScheduleForm = z.infer<typeof scheduleFormSchema>

const businessHoursFormSchema = z.object({
  days: z
    .array(
      z.object({
        day: z.number(),
        open: z.boolean(),
        openTime: z.string(),
        closeTime: z.string(),
      }),
    )
    .length(7),
})
type BusinessHoursForm = z.infer<typeof businessHoursFormSchema>

const DAY_LABEL_KEYS = [
  'branches.daySun',
  'branches.dayMon',
  'branches.dayTue',
  'branches.dayWed',
  'branches.dayThu',
  'branches.dayFri',
  'branches.daySat',
]

function EditBranchSheet({
  branch,
  ctx,
  onClose,
  onSaved,
  onDeleted,
}: {
  branch: Branch
  ctx: Context
  onClose: () => void
  onSaved: () => void | Promise<void>
  onDeleted: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [tab, setTab] = useState<'detail' | 'schedule' | 'businessHours'>('detail')
  const [serverError, setServerError] = useState<string | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Attendance "simple mode" — when false the branch has a fixed
  // schedule; when true staff clock in/out freely with no scoring.
  const [requiresSchedule, setRequiresSchedule] = useState(
    branch.requiresSchedule,
  )
  const [scheduleModeLoading, setScheduleModeLoading] = useState(false)
  const [confirmSimpleMode, setConfirmSimpleMode] = useState(false)

  const detailForm = useForm<BranchForm>({
    resolver: zodResolver(branchFormSchema),
    defaultValues: {
      name: branch.name,
      address: branch.address ?? '',
      latitude: Number(branch.latitude),
      longitude: Number(branch.longitude),
      radiusMeters: branch.radiusMeters,
      isMain: branch.isMain,
      branchModel:
        branch.branchModel === 'franchise' ? 'franchise' : 'independent',
      enabledModules: branch.enabledModules.filter((m): m is ModuleKey =>
        (['pos', 'inventory', 'attendance'] as string[]).includes(m),
      ),
    },
  })
  const enabledModules = detailForm.watch('enabledModules')

  const scheduleForm = useForm<ScheduleForm>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        isWorkDay: d >= 1 && d <= 5,
        clockInTime: '08:00',
        clockOutTime: '17:00',
        lateGraceMinutes: 10,
        earlyLeaveGraceMinutes: 0,
      })),
    },
  })

  const { fields } = useFieldArray({
    control: scheduleForm.control,
    name: 'days',
  })

  const businessHoursForm = useForm<BusinessHoursForm>({
    resolver: zodResolver(businessHoursFormSchema),
    defaultValues: {
      days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        day: d,
        open: d >= 1 && d <= 5,
        openTime: '09:00',
        closeTime: '21:00',
      })),
    },
  })

  const { fields: bhFields } = useFieldArray({
    control: businessHoursForm.control,
    name: 'days',
  })

  useEffect(() => {
    getBranchBusinessHours({ data: { branchId: branch.id } })
      .then(({ hours }) => {
        if (!hours || hours.length === 0) return
        const byDay = new Map(hours.map((h) => [h.day, h]))
        businessHoursForm.reset({
          days: [0, 1, 2, 3, 4, 5, 6].map((d) => {
            const h = byDay.get(d)
            return h
              ? { day: d, open: true, openTime: h.open, closeTime: h.close }
              : { day: d, open: false, openTime: '09:00', closeTime: '21:00' }
          }),
        })
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.id])

  useEffect(() => {
    getBranchWithSchedule({ data: { branchId: branch.id } })
      .then(({ schedules }) => {
        if (schedules.length === 7) {
          scheduleForm.reset({
            days: schedules.map((s) => ({
              dayOfWeek: s.dayOfWeek,
              isWorkDay: s.isWorkDay,
              clockInTime: s.clockInTime.slice(0, 5),
              clockOutTime: s.clockOutTime.slice(0, 5),
              lateGraceMinutes: s.lateGraceMinutes,
              earlyLeaveGraceMinutes: s.earlyLeaveGraceMinutes,
            })),
          })
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.id])

  async function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setServerError(t('branches.gpsUnsupported'))
      return
    }
    setGpsLoading(true)
    setServerError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        detailForm.setValue('latitude', Number(pos.coords.latitude.toFixed(7)))
        detailForm.setValue('longitude', Number(pos.coords.longitude.toFixed(7)))
        setGpsLoading(false)
      },
      (err) => {
        // JUR-208: friendlier, platform-aware help instead of the raw
        // spec phrase. Same helper is used on /attendance check-in.
        setServerError(formatGeolocationError(err, t))
        setGpsLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  // Flip attendance schedule mode. The change persists immediately
  // (it seeds or deletes schedule rows server-side) rather than waiting
  // for the Save button. Turning it OFF is confirmed first.
  async function applyScheduleMode(next: boolean) {
    setServerError(null)
    setScheduleModeLoading(true)
    try {
      await setBranchScheduleMode({
        data: { branchId: branch.id, requiresSchedule: next },
      })
      setRequiresSchedule(next)
      if (next) {
        const { schedules } = await getBranchWithSchedule({
          data: { branchId: branch.id },
        })
        if (schedules.length === 7) {
          scheduleForm.reset({
            days: schedules.map((s) => ({
              dayOfWeek: s.dayOfWeek,
              isWorkDay: s.isWorkDay,
              clockInTime: s.clockInTime.slice(0, 5),
              clockOutTime: s.clockOutTime.slice(0, 5),
              lateGraceMinutes: s.lateGraceMinutes,
              earlyLeaveGraceMinutes: s.earlyLeaveGraceMinutes,
            })),
          })
        }
      }
      toast({
        title: t('common.toastSavedTitle'),
        description: next
          ? t('branches.toastScheduleModeOn', { name: branch.name })
          : t('branches.toastScheduleModeOff', { name: branch.name }),
        variant: 'success',
      })
      await onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan'
      setServerError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    } finally {
      setScheduleModeLoading(false)
    }
  }

  function handleScheduleModeToggle(next: boolean) {
    if (next) void applyScheduleMode(true)
    else setConfirmSimpleMode(true)
  }

  async function handleSave() {
    setServerError(null)
    try {
      if (tab === 'businessHours') {
        const valid = await businessHoursForm.trigger()
        if (!valid) return
        const v = businessHoursForm.getValues()
        const hours = v.days
          .filter((d) => d.open)
          .map((d) => ({ day: d.day, open: d.openTime, close: d.closeTime }))
        await setBranchBusinessHours({
          data: { branchId: branch.id, hours },
        })
        toast({
          title: t('common.toastSavedTitle'),
          description: t('branches.toastBusinessHoursSaved', { name: branch.name }),
          variant: 'success',
        })
        await onSaved()
        return
      }
      if (tab === 'detail') {
        const valid = await detailForm.trigger()
        if (!valid) return
        const v = detailForm.getValues()
        await updateBranch({
          data: {
            id: branch.id,
            name: v.name,
            address: v.address ?? null,
            latitude: Number(v.latitude),
            longitude: Number(v.longitude),
            radiusMeters: Number(v.radiusMeters),
            isMain: v.isMain,
            branchModel: v.branchModel,
            enabledModules: v.enabledModules,
          },
        })
        toast({
          title: t('common.toastSavedTitle'),
          description: t('attendance.toastBranchUpdated', { name: v.name }),
          variant: 'success',
        })
      } else {
        // Simple-mode branch — no schedule to save; the mode toggle
        // already persisted itself.
        if (!requiresSchedule) {
          await onSaved()
          return
        }
        const valid = await scheduleForm.trigger()
        if (!valid) return
        const v = scheduleForm.getValues()
        await setBranchSchedule({
          data: {
            branchId: branch.id,
            days: v.days.map((d) => ({
              dayOfWeek: d.dayOfWeek,
              isWorkDay: d.isWorkDay,
              clockInTime:
                d.clockInTime.length === 5
                  ? `${d.clockInTime}:00`
                  : d.clockInTime,
              clockOutTime:
                d.clockOutTime.length === 5
                  ? `${d.clockOutTime}:00`
                  : d.clockOutTime,
              lateGraceMinutes: Number(d.lateGraceMinutes) || 0,
              earlyLeaveGraceMinutes: Number(d.earlyLeaveGraceMinutes) || 0,
            })),
          },
        })
        toast({
          title: t('common.toastSavedTitle'),
          description: t('attendance.toastScheduleSaved', { name: branch.name }),
          variant: 'success',
        })
      }
      await onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan'
      setServerError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    }
  }

  async function handleDelete() {
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      await deleteBranch({ data: { id: branch.id } })
      toast({
        title: t('common.toastDeletedTitle'),
        description: t('attendance.toastBranchDeleted', { name: branch.name }),
        variant: 'success',
      })
      await onDeleted()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghapus'
      setDeleteError(msg)
      toast({ title: t('common.toastFailedTitle'), description: msg, variant: 'error' })
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{branch.name}</SheetTitle>
        <SheetDescription>{t('branches.sheetDesc')}</SheetDescription>
      </SheetHeader>

      <div className="flex border-b border-gray-200 px-6 dark:border-gray-700">
        <TabButton
          label={t('branches.tabDetail')}
          active={tab === 'detail'}
          onClick={() => setTab('detail')}
        />
        <TabButton
          label={t('branches.tabSchedule')}
          active={tab === 'schedule'}
          onClick={() => setTab('schedule')}
        />
        <TabButton
          label={t('branches.tabBusinessHours')}
          active={tab === 'businessHours'}
          onClick={() => setTab('businessHours')}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {tab === 'detail' && (
            <>
              <ModuleTogglesField form={detailForm} />
              <CostPreview
                ctx={ctx}
                enabledModules={enabledModules}
                excludeBranchId={branch.id}
              />
              <DetailFields
                form={detailForm}
                gpsLoading={gpsLoading}
                onUseCurrentLocation={handleUseCurrentLocation}
              />
            </>
          )}
          {tab === 'schedule' && (
            <div>
              {/* Schedule mode toggle — advanced (fixed schedule) vs
                  simple (free clock-in, no lateness scoring). */}
              <div className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {t('branches.scheduleModeTitle')}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {requiresSchedule
                      ? t('branches.scheduleModeOnDesc')
                      : t('branches.scheduleModeOffDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={requiresSchedule}
                  disabled={scheduleModeLoading}
                  onClick={() => handleScheduleModeToggle(!requiresSchedule)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    requiresSchedule ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      requiresSchedule ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {requiresSchedule ? (
              <>
              <p className="mb-3 text-xs text-gray-500">
                {t('branches.scheduleHint')}
              </p>
              <div className="space-y-3">
                {fields.map((field, idx) => {
                  const isWorkDay = scheduleForm.watch(`days.${idx}.isWorkDay`)
                  return (
                    <div
                      key={field.id}
                      className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {t(DAY_LABEL_KEYS[field.dayOfWeek] ?? '')}
                        </p>
                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            {...scheduleForm.register(`days.${idx}.isWorkDay`)}
                            className="h-4 w-4"
                          />
                          {t('branches.colWorkDay')}
                        </label>
                      </div>
                      <div
                        className={`space-y-3 ${isWorkDay ? '' : 'pointer-events-none opacity-50'}`}
                      >
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('branches.colClockIn')}
                          </label>
                          <Input
                            type="time"
                            {...scheduleForm.register(`days.${idx}.clockInTime`)}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('branches.colClockOut')}
                          </label>
                          <Input
                            type="time"
                            {...scheduleForm.register(`days.${idx}.clockOutTime`)}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('branches.colGrace')}
                          </label>
                          <Input
                            type="number"
                            min={0}
                            max={120}
                            {...scheduleForm.register(
                              `days.${idx}.lateGraceMinutes`,
                              { valueAsNumber: true },
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              </>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
                  {t('branches.scheduleSimpleNote')}
                </div>
              )}
            </div>
          )}
          {tab === 'businessHours' && (
            <div>
              <p className="mb-3 text-xs text-gray-500">
                {t('branches.businessHoursHint')}
              </p>
              <div className="space-y-3">
                {bhFields.map((field, idx) => {
                  const open = businessHoursForm.watch(`days.${idx}.open`)
                  return (
                    <div
                      key={field.id}
                      className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {t(DAY_LABEL_KEYS[field.day] ?? '')}
                        </p>
                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            {...businessHoursForm.register(`days.${idx}.open`)}
                            className="h-4 w-4"
                          />
                          {t('branches.colOpen')}
                        </label>
                      </div>
                      <div
                        className={`grid grid-cols-2 gap-3 ${open ? '' : 'pointer-events-none opacity-50'}`}
                      >
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('branches.colOpenTime')}
                          </label>
                          <Input
                            type="time"
                            {...businessHoursForm.register(`days.${idx}.openTime`)}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('branches.colCloseTime')}
                          </label>
                          <Input
                            type="time"
                            {...businessHoursForm.register(`days.${idx}.closeTime`)}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {serverError && (
            <p className="whitespace-pre-line text-sm text-danger-600">
              {serverError}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeleting(true)}
            className="text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/30"
          >
            <Trash2 className="h-4 w-4" />
            {t('common.delete')}
          </Button>
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="brand" onClick={handleSave}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleting(false)
          setDeleteError(null)
        }}
        title={t('branches.deleteTitle')}
        description={
          deleteError ?? t('branches.deleteDesc', { name: branch.name })
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        loading={deleteLoading}
        variant="danger"
      />

      <ConfirmDialog
        open={confirmSimpleMode}
        onConfirm={async () => {
          setConfirmSimpleMode(false)
          await applyScheduleMode(false)
        }}
        onCancel={() => setConfirmSimpleMode(false)}
        title={t('branches.scheduleSimpleConfirmTitle')}
        description={t('branches.scheduleSimpleConfirmDesc', {
          name: branch.name,
        })}
        confirmText={t('branches.scheduleSimpleConfirmCta')}
        cancelText={t('common.cancel')}
        loading={scheduleModeLoading}
        variant="danger"
      />
    </Sheet>
  )
}

// ─── Shared sub-components ─────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? 'border-brand-500 text-brand-700 dark:text-brand-400'
          : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
      }`}
    >
      {label}
    </button>
  )
}

function ModuleTogglesField({ form }: { form: ReturnType<typeof useForm<BranchForm>> }) {
  const enabledModules = form.watch('enabledModules')
  function toggle(mod: ModuleKey) {
    const current = new Set(enabledModules)
    if (current.has(mod)) current.delete(mod)
    else current.add(mod)
    form.setValue('enabledModules', Array.from(current) as ModuleKey[], {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
        Modul yang aktif di cabang ini
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(MODULE_META) as ModuleKey[]).map((k) => {
          const meta = MODULE_META[k]
          const Icon = meta.icon
          const on = enabledModules.includes(k)
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                on
                  ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-900/30 dark:text-brand-200'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
              }`}
            >
              <Icon className="h-4 w-4" />
              {meta.longLabel}
            </button>
          )
        })}
      </div>
      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
        Gudang? Centang Stok saja. Outlet penuh? Centang ketiganya.
      </p>
    </div>
  )
}

function DetailFields({
  form,
  gpsLoading,
  onUseCurrentLocation,
}: {
  form: ReturnType<typeof useForm<BranchForm>>
  gpsLoading: boolean
  onUseCurrentLocation: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('branches.fieldName')}
        </label>
        <Input
          {...form.register('name')}
          placeholder={t('branches.fieldNamePlaceholder')}
        />
        {form.formState.errors.name && (
          <p className="mt-1 text-xs text-danger-600">
            {form.formState.errors.name.message}
          </p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('branches.fieldAddress')}
        </label>
        <Textarea
          {...form.register('address')}
          rows={2}
          placeholder={t('branches.fieldAddressPlaceholder')}
        />
      </div>

      {/* Branch model — hidden for the main branch (always HQ). */}
      {!form.watch('isMain') && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('branches.fieldModel')}
          </label>
          <select
            {...form.register('branchModel')}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="independent">
              {t('branches.modelIndependent')}
            </option>
            <option value="franchise">{t('branches.modelFranchise')}</option>
          </select>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('branches.modelHint')}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('branches.fieldLatitude')}
          </label>
          <Input
            type="number"
            step="any"
            {...form.register('latitude')}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('branches.fieldLongitude')}
          </label>
          <Input
            type="number"
            step="any"
            {...form.register('longitude')}
          />
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={onUseCurrentLocation}
        loading={gpsLoading}
      >
        <Navigation className="h-4 w-4" />
        {t('branches.useCurrentLocation')}
      </Button>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('branches.fieldRadius')}
        </label>
        <Input
          type="number"
          min={10}
          max={5000}
          {...form.register('radiusMeters')}
        />
        <p className="mt-1 text-xs text-gray-500">
          {t('branches.fieldRadiusHint')}
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900/40">
        <input
          type="checkbox"
          {...form.register('isMain')}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-accent-600 focus:ring-accent-500"
        />
        <span className="flex-1">
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {t('branches.fieldIsMain')}
          </span>
          <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
            {t('branches.fieldIsMainHint')}
          </span>
        </span>
      </label>
    </>
  )
}
