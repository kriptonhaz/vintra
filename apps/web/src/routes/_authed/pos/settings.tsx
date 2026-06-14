import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import {
  getPOSSettings,
  updatePOSSettings,
  uploadReceiptLogo,
  updateBranchReceipt,
  updatePOSCashSettings,
  updateBranchCashStaleConfig,
} from '@/server/functions/pos'
import {
  listVoidCategories,
  createVoidCategory,
  updateVoidCategory,
} from '@/server/functions/pos-void-categories'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { PrinterSettingsSection } from '@/components/pos/printer-settings-section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { posTierLimits, type POSPaymentMethod } from '@vintra/shared'
import type { CashStaleConfig } from '@vintra/db/schema'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/pos/settings')({
  loader: () => getPOSSettings(),
  component: POSSettingsPage,
})

const PAYMENT_LABEL: Record<POSPaymentMethod, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer Bank',
  card: 'Kartu',
  ewallet: 'E-Wallet',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
  ovo: 'OVO',
}

function POSSettingsPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()
  const limits = posTierLimits(data.tier)
  const isUpgradeRequired = !limits.features.includes('custom_receipt')

  // Multi-tax stack. Each row = independent tax line (PPN, PB1,
  // service charge, etc). Migration 0029 seeded the array from the
  // legacy single-tax columns; brand-new tenants land here with an
  // empty list and add their first row by hand.
  type TaxRow = { label: string; percent: number; active: boolean }
  const [taxes, setTaxes] = React.useState<TaxRow[]>(() => {
    const raw = (data.settings as { taxes?: unknown } | null)?.taxes
    return Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>).map((r) => ({
          label: String(r.label ?? 'Pajak'),
          percent: Number(r.percent ?? 0),
          active: Boolean(r.active),
        }))
      : []
  })
  function addTaxRow() {
    setTaxes((prev) => [
      ...prev,
      { label: '', percent: 0, active: true },
    ])
  }
  function updateTaxRow(idx: number, patch: Partial<TaxRow>) {
    setTaxes((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function removeTaxRow(idx: number) {
    setTaxes((prev) => prev.filter((_, i) => i !== idx))
  }
  const [methods, setMethods] = React.useState<POSPaymentMethod[]>(
    (data.settings?.defaultPaymentMethods ?? ['cash', 'qris']) as POSPaymentMethod[],
  )

  // Bank accounts surfaced when paying via Transfer Bank. Whole array
  // is replaced on save, mirroring the tax stack above.
  type BankRow = {
    bankName: string
    accountNumber: string
    accountHolder: string
    active: boolean
  }
  const [banks, setBanks] = React.useState<BankRow[]>(
    () => (data.settings?.bankAccounts ?? []) as BankRow[],
  )
  function addBankRow() {
    setBanks((prev) => [
      ...prev,
      { bankName: '', accountNumber: '', accountHolder: '', active: true },
    ])
  }
  function updateBankRow(idx: number, patch: Partial<BankRow>) {
    setBanks((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function removeBankRow(idx: number) {
    setBanks((prev) => prev.filter((_, i) => i !== idx))
  }
  const save = useMutation({
    mutationFn: () =>
      updatePOSSettings({
        data: {
          // Strip out blank-label rows on save so the array stays clean.
          // Active rows still need a label even if the cashier left it
          // empty mid-edit; server zod also rejects min(1).
          taxes: taxes.filter((t) => t.label.trim().length > 0),
          // Footer + logo no longer ride on the main save — they have
          // per-branch overrides handled inside <ReceiptScopeSection>.
          defaultPaymentMethods: methods,
          // Drop rows the user left entirely blank so the array stays
          // clean; a row with any field filled is kept and validated
          // server-side (all three fields required).
          bankAccounts: banks.filter(
            (b) =>
              b.bankName.trim() ||
              b.accountNumber.trim() ||
              b.accountHolder.trim(),
          ),
        },
      }),
    onSuccess: () => {
      toast({ title: 'Pengaturan disimpan', variant: 'success' })
      router.invalidate()
    },
    onError: (err: Error) => {
      toast({
        title: 'Gagal menyimpan',
        description: err.message,
        variant: 'error',
      })
    },
  })

  function toggleMethod(m: POSPaymentMethod) {
    setMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    )
  }

  if (isUpgradeRequired) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-warning-200 bg-warning-50 p-6 text-sm text-warning-900">
          Pengaturan kustom (logo struk, footer, pajak, metode pembayaran)
          tersedia di paket Toko ke atas. Upgrade dari halaman billing untuk
          mengaktifkan.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Pengaturan Kasir
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Kustomisasi struk dan metode pembayaran yang aktif di kasir.
        </p>
      </div>

      <ReceiptScopeSection
        tenantDefault={{
          footer: data.settings?.receiptFooterText ?? null,
          logoKey: data.settings?.receiptLogoKey ?? null,
        }}
        branches={data.branches}
        onSaved={() => router.invalidate()}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Pajak">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Tambahkan jenis pajak yang berlaku — misal PPN 11%, PB1
            (pajak restoran) 10%, atau service charge 5%. Setiap baris
            yang aktif akan muncul di struk dan ditambahkan ke total.
            Kamu bisa nonaktifkan baris tanpa menghapusnya.
          </p>
          <div className="mt-3 space-y-2">
            {taxes.length === 0 && (
              <p className="rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
                Belum ada pajak. Klik "Tambah pajak" untuk mulai.
              </p>
            )}
            {taxes.map((row, idx) => (
              <div
                key={idx}
                className="flex items-end gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700"
              >
                <div className="flex shrink-0 items-center pt-6">
                  <input
                    type="checkbox"
                    checked={row.active}
                    onChange={(e) =>
                      updateTaxRow(idx, { active: e.target.checked })
                    }
                    aria-label="Aktifkan baris pajak"
                    className="rounded border-gray-300"
                  />
                </div>
                <div className="flex-1">
                  <Input
                    label="Label"
                    value={row.label}
                    onChange={(e) =>
                      updateTaxRow(idx, { label: e.target.value })
                    }
                    placeholder="cth. PPN, PB1, Service"
                    disabled={!row.active}
                  />
                </div>
                <div className="w-28 shrink-0">
                  <Input
                    label="Persen"
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={row.percent || ''}
                    onChange={(e) =>
                      updateTaxRow(idx, {
                        percent: parseFloat(e.target.value) || 0,
                      })
                    }
                    disabled={!row.active}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeTaxRow(idx)}
                  className="mb-1 shrink-0 rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                  aria-label="Hapus baris pajak"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={addTaxRow}
              className="w-full"
            >
              <Plus className="mr-1 h-4 w-4" /> Tambah pajak
            </Button>
          </div>
        </Section>

        {limits.features.includes('thermal_printer') && (
          <PrinterSettingsSection />
        )}

        <Section title="Metode Pembayaran Aktif">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Metode yang dipilih akan muncul di kasir. Minimal 1.
          </p>
          <div className="mt-3 space-y-2">
            {limits.paymentMethods.map((m) => (
              <label
                key={m}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg border p-2',
                  methods.includes(m)
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                    : 'border-gray-200 dark:border-gray-700',
                )}
              >
                <input
                  type="checkbox"
                  checked={methods.includes(m)}
                  onChange={() => toggleMethod(m)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm font-medium">{PAYMENT_LABEL[m]}</span>
              </label>
            ))}
          </div>
        </Section>
      </div>

      {methods.includes('transfer') && (
        <Section title="Rekening Bank">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Rekening yang ditampilkan saat pelanggan memilih Transfer Bank.
            Bisa lebih dari satu — nonaktifkan baris untuk menyembunyikannya
            tanpa menghapus.
          </p>
          <div className="mt-3 space-y-2">
            {banks.length === 0 && (
              <p className="rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
                Belum ada rekening. Klik "Tambah rekening" untuk mulai.
              </p>
            )}
            {banks.map((row, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700"
              >
                <div className="flex shrink-0 items-center pt-9">
                  <input
                    type="checkbox"
                    checked={row.active}
                    onChange={(e) =>
                      updateBankRow(idx, { active: e.target.checked })
                    }
                    aria-label="Aktifkan rekening"
                    className="rounded border-gray-300"
                  />
                </div>
                <div className="grid flex-1 gap-2 sm:grid-cols-3">
                  <Input
                    label="Bank"
                    value={row.bankName}
                    onChange={(e) =>
                      updateBankRow(idx, { bankName: e.target.value })
                    }
                    placeholder="cth. BCA"
                    disabled={!row.active}
                  />
                  <Input
                    label="No. Rekening"
                    value={row.accountNumber}
                    onChange={(e) =>
                      updateBankRow(idx, { accountNumber: e.target.value })
                    }
                    placeholder="cth. 1234567890"
                    className="tabular-nums"
                    disabled={!row.active}
                  />
                  <Input
                    label="Atas Nama"
                    value={row.accountHolder}
                    onChange={(e) =>
                      updateBankRow(idx, { accountHolder: e.target.value })
                    }
                    placeholder="cth. PT Toko Maju Jaya"
                    disabled={!row.active}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeBankRow(idx)}
                  className="mt-7 shrink-0 rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                  aria-label="Hapus rekening"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={addBankRow}
              className="w-full"
            >
              <Plus className="mr-1 h-4 w-4" /> Tambah rekening
            </Button>
          </div>
        </Section>
      )}

      {data.tier === 'komplit' && (
        <CashDrawerSection
          enabled={data.settings?.cashDrawerEnabled ?? true}
          threshold={Number(data.settings?.cashVarianceThreshold ?? 10000)}
          onSaved={() => router.invalidate()}
        />
      )}

      {data.tier === 'komplit' && (
        <CashStaleScopeSection
          tenantConfig={
            data.settings?.cashStaleConfig ?? { mode: 'daily_cutoff', cutoff: '01:00' }
          }
          branches={data.branches}
          onSaved={() => router.invalidate()}
        />
      )}

      <VoidCategoriesSection />

      <div className="flex justify-end">
        <Button
          variant="brand"
          onClick={() => save.mutate()}
          loading={save.isPending}
          disabled={methods.length === 0}
        >
          Simpan Pengaturan
        </Button>
      </div>
    </div>
  )
}

/**
 * JUR-204 — manage the list of void-reason categories the cashier
 * picks from when cancelling a sale. Owner-only (server enforces
 * pos.manage). System defaults are seeded lazily on first read; the
 * owner can archive any row, add custom labels, and rename custom
 * rows (system rows keep their label so reports semantics stay
 * stable across tenants).
 */
function VoidCategoriesSection() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [newLabel, setNewLabel] = React.useState('')

  // includeArchived: true so we can show archived rows at the bottom
  // with an unarchive button, instead of vanishing them entirely.
  const list = useQuery({
    queryKey: ['pos', 'void-categories', 'all'],
    queryFn: () => listVoidCategories({ data: { includeArchived: true } }),
    staleTime: 60 * 1000,
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['pos', 'void-categories'] })
  }

  const createMut = useMutation({
    mutationFn: (label: string) =>
      createVoidCategory({ data: { label } }),
    onSuccess: () => {
      setNewLabel('')
      toast({ title: 'Kategori ditambahkan', variant: 'success' })
      refresh()
    },
    onError: (err: Error) =>
      toast({ title: 'Gagal', description: err.message, variant: 'error' }),
  })

  const archiveMut = useMutation({
    mutationFn: (args: { id: string; isActive: boolean }) =>
      updateVoidCategory({ data: args }),
    onSuccess: () => refresh(),
    onError: (err: Error) =>
      toast({ title: 'Gagal', description: err.message, variant: 'error' }),
  })

  const rows = list.data ?? []
  const active = rows.filter((r) => r.isActive)
  const archived = rows.filter((r) => !r.isActive)

  return (
    <Section title="Kategori Pembatalan Transaksi">
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        Kasir memilih dari daftar ini saat membatalkan transaksi. Laporan
        membagi jumlah pembatalan per kategori sehingga kamu bisa lihat
        alasan paling sering.
      </p>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {active.length === 0 && list.isLoading && (
          <li className="py-3 text-sm text-gray-500">Memuat…</li>
        )}
        {active.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-3 py-2 text-sm"
          >
            <span className="flex-1 truncate text-gray-900 dark:text-gray-100">
              {c.label}
            </span>
            {c.isSystem && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                Bawaan
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                archiveMut.mutate({ id: c.id, isActive: false })
              }
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-danger-600 dark:hover:bg-gray-700"
              aria-label="Arsipkan"
              title="Arsipkan"
            >
              <Archive className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const t = newLabel.trim()
          if (!t) return
          createMut.mutate(t)
        }}
      >
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Tambah kategori, mis. Promo dobel"
          className="flex-1"
        />
        <Button
          type="submit"
          variant="brand"
          loading={createMut.isPending}
          disabled={!newLabel.trim()}
        >
          <Plus className="h-4 w-4" /> Tambah
        </Button>
      </form>

      {archived.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Diarsipkan
          </p>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {archived.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 py-2 text-sm text-gray-500 dark:text-gray-400"
              >
                <span className="flex-1 truncate">{c.label}</span>
                <button
                  type="button"
                  onClick={() =>
                    archiveMut.mutate({ id: c.id, isActive: true })
                  }
                  className="rounded-md p-1.5 hover:bg-gray-100 hover:text-brand-700 dark:hover:bg-gray-700"
                  aria-label="Aktifkan"
                  title="Aktifkan"
                >
                  <ArchiveRestore className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

/**
 * JUR-141 / JUR-145 PR 4 — owner kill-switch + variance threshold.
 * Has its own Save button so toggling Peti Kas doesn't get
 * accidentally batched with tax/payment-method edits below.
 */
function CashDrawerSection({
  enabled: initialEnabled,
  threshold: initialThreshold,
  onSaved,
}: {
  enabled: boolean
  threshold: number
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [enabled, setEnabled] = React.useState(initialEnabled)
  const [thresholdStr, setThresholdStr] = React.useState(String(initialThreshold))

  const mutation = useMutation({
    mutationFn: () =>
      updatePOSCashSettings({
        data: {
          cashDrawerEnabled: enabled,
          cashVarianceThreshold: parseInt(thresholdStr) || 0,
        },
      }),
    onSuccess: () => {
      toast({ title: 'Pengaturan Peti Kas disimpan', variant: 'success' })
      onSaved()
    },
    onError: (err: Error) => {
      toast({ title: 'Gagal menyimpan', description: err.message, variant: 'error' })
    },
  })

  return (
    <Section title="Peti Kas">
      <div className="space-y-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Aktifkan Peti Kas
            </p>
            <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
              Kasir wajib buka kas (catat modal awal) sebelum mencatat
              transaksi tunai. Memudahkan rekonsiliasi harian. Matikan
              jika tenant kamu tidak butuh kontrol selisih kas.
            </p>
          </div>
        </label>

        <div className="max-w-xs">
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Peringatkan jika selisih lebih dari
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
              Rp
            </span>
            <Input
              type="number"
              min={0}
              step={1000}
              value={thresholdStr}
              onChange={(e) => setThresholdStr(e.target.value)}
              className="pl-9 tabular-nums"
              disabled={!enabled}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Default Rp 10.000. Selisih ≥ batas ini akan ditandai merah +
            wajib diisi catatan.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            variant="brand"
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
          >
            Simpan Peti Kas
          </Button>
        </div>
      </div>
    </Section>
  )
}

interface BranchStaleScope {
  id: string
  name: string
  cashStaleConfig: CashStaleConfig | null
}

/** Short human label for an inherited rule, e.g. "Jam batas 01:00". */
function describeStaleConfig(cfg: CashStaleConfig): string {
  return cfg.mode === 'elapsed_hours'
    ? `${cfg.hours} jam buka`
    : `Jam batas ${cfg.cutoff}`
}

/**
 * "Sesi Kas Kedaluwarsa" editor with a per-branch scope picker, mirroring
 * <ReceiptScopeSection>.
 *
 *   Default = writes the tenant rule (pos_settings.cash_stale_config),
 *   inherited by every branch that hasn't overridden.
 *
 *   <Branch> = either "Ikuti default" (branches.cash_stale_config = NULL)
 *   or "Atur sendiri" (a per-branch override). New outlets start on
 *   inherit automatically. Single-branch tenants never see the picker.
 *
 * Each scope owns its own form state (re-mount via key={scope}) so
 * switching tabs doesn't carry edits across branches by mistake.
 */
function CashStaleScopeSection({
  tenantConfig,
  branches: branchList,
  onSaved,
}: {
  tenantConfig: CashStaleConfig
  branches: BranchStaleScope[]
  onSaved: () => void
}) {
  const [scope, setScope] = React.useState<'tenant' | string>('tenant')
  const isMultiBranch = branchList.length > 1
  const currentBranch =
    scope === 'tenant' ? null : branchList.find((b) => b.id === scope) ?? null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Sesi Kas Kedaluwarsa
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Kapan sesi kas yang lupa ditutup ditandai untuk tutup paksa.
            Default berlaku untuk semua cabang — atur per-cabang kalau ada
            outlet dengan jam operasional berbeda.
          </p>
        </div>
        {isMultiBranch && (
          <div className="sm:w-64">
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              Berlaku untuk
            </label>
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              options={[
                { value: 'tenant', label: 'Default (semua cabang)' },
                ...branchList.map((b) => ({
                  value: b.id,
                  label: `Cabang: ${b.name}`,
                })),
              ]}
            />
          </div>
        )}
      </div>

      <div className="mt-5">
        {scope === 'tenant' ? (
          <CashStaleScopeForm
            key="tenant"
            scopeKey="tenant"
            initialConfig={tenantConfig}
            tenantConfig={tenantConfig}
            onSaved={onSaved}
          />
        ) : (
          <CashStaleScopeForm
            key={currentBranch!.id}
            scopeKey={currentBranch!.id}
            initialConfig={currentBranch!.cashStaleConfig}
            tenantConfig={tenantConfig}
            onSaved={onSaved}
          />
        )}
      </div>
    </div>
  )
}

function CashStaleScopeForm({
  scopeKey,
  initialConfig,
  tenantConfig,
  onSaved,
}: {
  /** 'tenant' or a branch id — drives which server fn the save calls. */
  scopeKey: 'tenant' | string
  /** Branch override (null = inherits) or the tenant rule itself. */
  initialConfig: CashStaleConfig | null
  /** Tenant default, shown as the inherited value when a branch inherits. */
  tenantConfig: CashStaleConfig
  onSaved: () => void
}) {
  const { toast } = useToast()
  const isBranch = scopeKey !== 'tenant'
  // A branch with no override inherits the tenant default.
  const [inherit, setInherit] = React.useState(isBranch && initialConfig == null)
  // Seed editable fields from the override if present, else the tenant
  // default — so "Atur sendiri" starts from the values being inherited.
  const seed = initialConfig ?? tenantConfig
  const [mode, setMode] = React.useState<CashStaleConfig['mode']>(seed.mode)
  const [hoursStr, setHoursStr] = React.useState(
    String(seed.mode === 'elapsed_hours' ? seed.hours : 14),
  )
  const [cutoff, setCutoff] = React.useState(
    seed.mode === 'daily_cutoff' ? seed.cutoff : '01:00',
  )
  const [minHoursStr, setMinHoursStr] = React.useState(
    seed.mode === 'daily_cutoff' && seed.minHours != null
      ? String(seed.minHours)
      : '',
  )

  const buildConfig = (): CashStaleConfig =>
    mode === 'elapsed_hours'
      ? { mode: 'elapsed_hours', hours: parseInt(hoursStr) || 14 }
      : {
          mode: 'daily_cutoff',
          cutoff,
          ...(minHoursStr !== '' ? { minHours: parseInt(minHoursStr) || 0 } : {}),
        }

  const save = useMutation({
    mutationFn: () => {
      if (isBranch) {
        return updateBranchCashStaleConfig({
          data: { branchId: scopeKey, cashStaleConfig: inherit ? null : buildConfig() },
        })
      }
      return updatePOSCashSettings({ data: { cashStaleConfig: buildConfig() } })
    },
    onSuccess: () => {
      toast({ title: 'Pengaturan sesi kas disimpan', variant: 'success' })
      onSaved()
    },
    onError: (err: Error) =>
      toast({ title: 'Gagal menyimpan', description: err.message, variant: 'error' }),
  })

  const fieldsDisabled = isBranch && inherit

  return (
    <div className="space-y-4">
      {isBranch && (
        <div className="space-y-2">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={inherit}
              onChange={() => setInherit(true)}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-900 dark:text-gray-100">
              Ikuti pengaturan default
              <span className="ml-1 text-xs text-gray-500">
                ({describeStaleConfig(tenantConfig)})
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={!inherit}
              onChange={() => setInherit(false)}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-900 dark:text-gray-100">
              Atur sendiri untuk cabang ini
            </span>
          </label>
        </div>
      )}

      <div className="max-w-xs space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Metode
          </label>
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as CashStaleConfig['mode'])}
            disabled={fieldsDisabled}
            options={[
              { value: 'elapsed_hours', label: 'Berdasarkan lama jam buka' },
              { value: 'daily_cutoff', label: 'Berdasarkan jam batas hari' },
            ]}
          />
        </div>

        {mode === 'elapsed_hours' ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Tutup paksa setelah
            </label>
            <div className="relative">
              <Input
                type="number"
                min={1}
                max={72}
                step={1}
                value={hoursStr}
                onChange={(e) => setHoursStr(e.target.value)}
                className="pr-10 tabular-nums"
                disabled={fieldsDisabled}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                jam
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Default 14 jam. Sesi yang terbuka lebih lama dari ini akan
              diminta tutup paksa.
            </p>
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Jam batas hari
              </label>
              <Input
                type="time"
                value={cutoff}
                onChange={(e) => setCutoff(e.target.value)}
                className="tabular-nums"
                disabled={fieldsDisabled}
              />
              <p className="mt-1 text-xs text-gray-500">
                Mis. 01:00. Sesi yang dibuka sebelum jam ini akan diminta
                tutup paksa setelah jam tersebut terlewati (waktu WIB).
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Minimal jam buka (opsional)
              </label>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  value={minHoursStr}
                  onChange={(e) => setMinHoursStr(e.target.value)}
                  placeholder="cth. 4"
                  className="pr-10 tabular-nums"
                  disabled={fieldsDisabled}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                  jam
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Jangan tandai sesi yang baru buka kurang dari ini, walau jam
                batas sudah terlewati (mencegah sesi dini hari langsung
                ditandai). Kosongkan untuk menonaktifkan.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <Button variant="brand" onClick={() => save.mutate()} loading={save.isPending}>
          Simpan
        </Button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      {children}
    </div>
  )
}

interface BranchScope {
  id: string
  name: string
  receiptFooterText: string | null
  receiptLogoKey: string | null
}

/**
 * Logo + footer editor with a per-branch scope picker.
 *
 *   Default = writes to pos_settings.receipt_*. Single-branch tenants
 *   never see the picker — there's only one row to pick from.
 *
 *   <Branch> = writes to branches.receipt_* as an override. Empty
 *   field renders "Pakai default" placeholder so the cashier sees the
 *   inheritance chain at a glance; clearing the field saves null,
 *   which restores the tenant fallback on the next sale.
 *
 * Each scope owns its own form state (re-mount via key={scope}) so
 * switching tabs doesn't carry edits across branches by mistake.
 */
function ReceiptScopeSection({
  tenantDefault,
  branches: branchList,
  onSaved,
}: {
  tenantDefault: { footer: string | null; logoKey: string | null }
  branches: BranchScope[]
  onSaved: () => void
}) {
  // 'tenant' = default fallback row, otherwise the branch id.
  const [scope, setScope] = React.useState<'tenant' | string>('tenant')
  const isMultiBranch = branchList.length > 1
  const currentBranch =
    scope === 'tenant' ? null : branchList.find((b) => b.id === scope) ?? null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Logo + Footer Struk
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Default berlaku untuk semua cabang. Jika kamu punya outlet
            dengan alamat / logo berbeda, atur per-cabang di sini —
            kosongkan untuk mengikuti default.
          </p>
        </div>
        {isMultiBranch && (
          <div className="sm:w-64">
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              Berlaku untuk
            </label>
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              options={[
                { value: 'tenant', label: 'Default (semua cabang)' },
                ...branchList.map((b) => ({
                  value: b.id,
                  label: `Cabang: ${b.name}`,
                })),
              ]}
            />
          </div>
        )}
      </div>

      <div className="mt-5">
        {scope === 'tenant' ? (
          <ReceiptScopeForm
            key="tenant"
            scopeKey="tenant"
            initialFooter={tenantDefault.footer ?? ''}
            initialLogoKey={tenantDefault.logoKey}
            inheritedFooter={null}
            inheritedLogoKey={null}
            onSaved={onSaved}
          />
        ) : (
          <ReceiptScopeForm
            key={currentBranch!.id}
            scopeKey={currentBranch!.id}
            initialFooter={currentBranch!.receiptFooterText ?? ''}
            initialLogoKey={currentBranch!.receiptLogoKey}
            // Per-branch view shows the tenant default as the
            // "fallback" hint so the user can see what they're
            // overriding before they edit.
            inheritedFooter={tenantDefault.footer}
            inheritedLogoKey={tenantDefault.logoKey}
            onSaved={onSaved}
          />
        )}
      </div>
    </div>
  )
}

function ReceiptScopeForm({
  scopeKey,
  initialFooter,
  initialLogoKey,
  inheritedFooter,
  inheritedLogoKey,
  onSaved,
}: {
  /** 'tenant' or a branch id — drives which server fn the save calls. */
  scopeKey: 'tenant' | string
  initialFooter: string
  initialLogoKey: string | null
  /** Tenant default shown as a placeholder hint when scope is per-branch. */
  inheritedFooter: string | null
  inheritedLogoKey: string | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [footer, setFooter] = React.useState(initialFooter)
  const [logoKey, setLogoKey] = React.useState<string | null>(initialLogoKey)

  const isBranch = scopeKey !== 'tenant'

  const save = useMutation({
    mutationFn: async () => {
      if (isBranch) {
        return updateBranchReceipt({
          data: {
            branchId: scopeKey,
            // Empty string → null so the branch row reverts to the
            // tenant default fallback, matching the inheritance UX.
            receiptFooterText: footer.trim() ? footer : null,
          },
        })
      }
      return updatePOSSettings({
        data: { receiptFooterText: footer.trim() ? footer : null },
      })
    },
    onSuccess: () => {
      toast({ title: 'Footer struk disimpan', variant: 'success' })
      onSaved()
    },
    onError: (err: Error) =>
      toast({
        title: 'Gagal menyimpan',
        description: err.message,
        variant: 'error',
      }),
  })

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await readAsDataUrl(file)
      return uploadReceiptLogo({
        data: {
          dataUrl,
          ...(isBranch ? { branchId: scopeKey } : {}),
        },
      })
    },
    onSuccess: (res) => {
      setLogoKey(res.logoKey)
      toast({ title: 'Logo berhasil diunggah', variant: 'success' })
      onSaved()
    },
    onError: (err: Error) =>
      toast({
        title: 'Gagal upload logo',
        description: err.message,
        variant: 'error',
      }),
  })

  // Clear-to-default only applies in branch scope. Tenant logo is
  // edited by uploading a new file (no UI affordance to clear the
  // tenant default — that'd leave the receipt logo-less).
  const clearLogo = useMutation({
    mutationFn: () => {
      if (!isBranch) {
        throw new Error('Default logo tidak bisa dihapus dari sini')
      }
      return updateBranchReceipt({
        data: { branchId: scopeKey, receiptLogoKey: null },
      })
    },
    onSuccess: () => {
      setLogoKey(null)
      toast({ title: 'Logo dihapus', variant: 'success' })
      onSaved()
    },
    onError: (err: Error) =>
      toast({
        title: 'Gagal menghapus logo',
        description: err.message,
        variant: 'error',
      }),
  })

  return (
    <div className="space-y-5">
      {/* Logo */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Logo Struk
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Max 200 KB. PNG / JPEG / WebP.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) uploadLogo.mutate(f)
            }}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
          {uploadLogo.isPending && (
            <span className="text-xs text-gray-500">Mengunggah…</span>
          )}
        </div>
        {logoKey ? (
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className="text-success-600">
              Logo aktif: {logoKey.split('/').pop()}
            </span>
            {isBranch && (
              <button
                type="button"
                onClick={() => clearLogo.mutate()}
                disabled={clearLogo.isPending}
                className="text-gray-500 underline hover:text-danger-600"
              >
                Hapus, pakai default
              </button>
            )}
          </div>
        ) : isBranch && inheritedLogoKey ? (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Cabang ini mengikuti logo default ({inheritedLogoKey.split('/').pop()}).
          </p>
        ) : null}
      </div>

      {/* Footer */}
      <div>
        <Textarea
          label="Teks footer"
          rows={3}
          value={footer}
          onChange={(e) => setFooter(e.target.value)}
          placeholder={
            isBranch && inheritedFooter
              ? `Pakai default: ${inheritedFooter}`
              : 'cth. Toko Maju Jaya • Jl. Sudirman 1 • Terima kasih!'
          }
        />
        {isBranch && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {footer.trim().length === 0
              ? 'Kosong = pakai default tenant.'
              : 'Footer ini hanya untuk cabang yang dipilih.'}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          variant="brand"
          onClick={() => save.mutate()}
          loading={save.isPending}
        >
          Simpan {isBranch ? 'cabang' : 'default'}
        </Button>
      </div>
    </div>
  )
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
