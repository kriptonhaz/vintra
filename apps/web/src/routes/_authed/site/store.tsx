/**
 * Toko Online — storefront settings (Phase 1).
 *
 * Komplit-only, same gate as the Situs editor. Lets the owner enable
 * the online store, pick the fulfillment branch, choose which POS
 * payment methods to surface, configure manual shipping (per-zone +
 * flat fallback + pickup), the WhatsApp confirmation number / notify
 * instance, tax, and a checkout note.
 */
import * as React from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import {
  getStorefrontSettings,
  updateStorefrontSettings,
  saveShippingZones,
} from '@/server/functions/storefront-settings'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/site/store')({
  beforeLoad: ({ context }) => {
    const user = (
      context as {
        user?: {
          permissions?: string[]
          moduleSubscriptions?: { pos?: { features?: ReadonlyArray<string> } }
        }
      }
    ).user
    if (!user?.permissions?.includes('booking.write')) {
      throw redirect({ to: '/dashboard' })
    }
    if (!user.moduleSubscriptions?.pos?.features?.includes('tenant_site')) {
      throw redirect({ to: '/site/locked' })
    }
  },
  loader: () => getStorefrontSettings(),
  component: StoreSettingsPage,
})

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer Bank',
  card: 'Kartu',
  ewallet: 'E-Wallet',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
  ovo: 'OVO',
}

type ZoneRow = { name: string; fee: number; isActive: boolean }

function StoreSettingsPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()
  const s = data.settings

  const [isEnabled, setIsEnabled] = React.useState(s?.isEnabled ?? false)
  const [fulfillmentBranchId, setFulfillmentBranchId] = React.useState(
    s?.fulfillmentBranchId ?? '',
  )
  const [methods, setMethods] = React.useState<string[]>(
    (s?.paymentMethods ?? []) as string[],
  )
  const [deliveryEnabled, setDeliveryEnabled] = React.useState(
    s?.deliveryEnabled ?? true,
  )
  const [pickupEnabled, setPickupEnabled] = React.useState(
    s?.pickupEnabled ?? true,
  )
  const [flatFee, setFlatFee] = React.useState(
    String(s?.flatShippingFee ?? '0'),
  )
  const [waPhone, setWaPhone] = React.useState(s?.waConfirmPhone ?? '')
  const [notifyInstance, setNotifyInstance] = React.useState(
    s?.adminNotifyInstanceId ?? '',
  )
  const [applyTax, setApplyTax] = React.useState(s?.applyTax ?? true)
  const [checkoutNote, setCheckoutNote] = React.useState(s?.checkoutNote ?? '')

  const [zones, setZones] = React.useState<ZoneRow[]>(() =>
    (data.zones ?? []).map((z) => ({
      name: z.name,
      fee: Number(z.fee),
      isActive: z.isActive,
    })),
  )

  function toggleMethod(m: string) {
    setMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    )
  }

  const save = useMutation({
    mutationFn: async () => {
      await updateStorefrontSettings({
        data: {
          isEnabled,
          fulfillmentBranchId: fulfillmentBranchId || null,
          paymentMethods: methods as never,
          deliveryEnabled,
          pickupEnabled,
          flatShippingFee: Number(flatFee) || 0,
          waConfirmPhone: waPhone.trim() ? waPhone : null,
          adminNotifyInstanceId: notifyInstance || null,
          applyTax,
          checkoutNote: checkoutNote.trim() ? checkoutNote : null,
        },
      })
      await saveShippingZones({
        data: {
          zones: zones
            .filter((z) => z.name.trim().length > 0)
            .map((z) => ({ name: z.name, fee: z.fee || 0, isActive: z.isActive })),
        },
      })
    },
    onSuccess: () => {
      toast({ title: 'Pengaturan toko disimpan', variant: 'success' })
      router.invalidate()
    },
    onError: (err: Error) =>
      toast({
        title: 'Gagal menyimpan',
        description: err.message,
        variant: 'error',
      }),
  })

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Toko Online
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Aktifkan keranjang &amp; checkout di situs kamu. Pembayaran masih
          konfirmasi manual lewat WhatsApp (tanpa payment gateway).
        </p>
      </div>

      <Section title="Status Toko">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <span className="text-sm">
            <span className="block font-medium text-gray-900 dark:text-gray-100">
              Aktifkan Toko Online
            </span>
            <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
              Saat aktif, pengunjung situs bisa menambah produk ke keranjang
              dan checkout. Pilih produk yang dijual online dari halaman
              Inventaris (toggle "Jual online").
            </span>
          </span>
        </label>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Cabang Pemenuhan">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Stok cabang ini yang dipotong saat pesanan dikonfirmasi.
          </p>
          <div className="mt-3 max-w-sm">
            <Select
              value={fulfillmentBranchId}
              onChange={(e) => setFulfillmentBranchId(e.target.value)}
              options={[
                { value: '', label: 'Otomatis (cabang utama)' },
                ...data.branches.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          </div>
        </Section>

        <Section title="Metode Pembayaran di Toko">
          {data.posPaymentMethods.length === 0 ? (
            <p className="rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
              Belum ada metode pembayaran aktif. Atur dulu di Pengaturan Kasir.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Pilih metode yang muncul saat checkout. Detail rekening / QRIS
                tetap diatur di Pengaturan Kasir.
              </p>
              <div className="mt-3 space-y-2">
                {data.posPaymentMethods.map((m) => (
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
                    <span className="text-sm font-medium">
                      {PAYMENT_LABEL[m] ?? m}
                    </span>
                  </label>
                ))}
              </div>
              {methods.includes('transfer') && !data.hasBankAccounts && (
                <p className="mt-2 text-xs text-warning-700">
                  Belum ada rekening bank di Pengaturan Kasir — tambahkan agar
                  instruksi transfer muncul ke pelanggan.
                </p>
              )}
            </>
          )}
        </Section>
      </div>

      <Section title="Pengiriman">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deliveryEnabled}
                onChange={(e) => setDeliveryEnabled(e.target.checked)}
                className="rounded border-gray-300"
              />
              Kirim ke alamat (ongkir)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pickupEnabled}
                onChange={(e) => setPickupEnabled(e.target.checked)}
                className="rounded border-gray-300"
              />
              Ambil di tempat (pickup)
            </label>
          </div>

          {deliveryEnabled && (
            <>
              <div className="max-w-xs">
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Ongkir flat (default)
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                    Rp
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step={1000}
                    value={flatFee}
                    onChange={(e) => setFlatFee(e.target.value)}
                    className="pl-9 tabular-nums"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Dipakai kalau pelanggan tidak memilih zona di bawah.
                </p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Zona ongkir
                </p>
                <div className="space-y-2">
                  {zones.length === 0 && (
                    <p className="rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
                      Belum ada zona. Tambahkan mis. "Dalam kota", "Luar kota".
                    </p>
                  )}
                  {zones.map((row, idx) => (
                    <div
                      key={idx}
                      className="flex items-end gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700"
                    >
                      <div className="flex shrink-0 items-center pt-6">
                        <input
                          type="checkbox"
                          checked={row.isActive}
                          onChange={(e) =>
                            setZones((prev) =>
                              prev.map((z, i) =>
                                i === idx
                                  ? { ...z, isActive: e.target.checked }
                                  : z,
                              ),
                            )
                          }
                          aria-label="Aktifkan zona"
                          className="rounded border-gray-300"
                        />
                      </div>
                      <div className="flex-1">
                        <Input
                          label="Nama zona"
                          value={row.name}
                          onChange={(e) =>
                            setZones((prev) =>
                              prev.map((z, i) =>
                                i === idx ? { ...z, name: e.target.value } : z,
                              ),
                            )
                          }
                          placeholder="cth. Dalam kota"
                          disabled={!row.isActive}
                        />
                      </div>
                      <div className="w-36 shrink-0">
                        <Input
                          label="Ongkir"
                          type="number"
                          min={0}
                          step={1000}
                          value={row.fee || ''}
                          onChange={(e) =>
                            setZones((prev) =>
                              prev.map((z, i) =>
                                i === idx
                                  ? { ...z, fee: parseFloat(e.target.value) || 0 }
                                  : z,
                              ),
                            )
                          }
                          className="tabular-nums"
                          disabled={!row.isActive}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setZones((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="mb-1 shrink-0 rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                        aria-label="Hapus zona"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setZones((prev) => [
                        ...prev,
                        { name: '', fee: 0, isActive: true },
                      ])
                    }
                    className="w-full"
                  >
                    <Plus className="mr-1 h-4 w-4" /> Tambah zona
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Konfirmasi WhatsApp">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Nomor WhatsApp toko
              </label>
              <Input
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                placeholder="cth. 0812xxxxxxx"
                className="tabular-nums"
              />
              <p className="mt-1 text-xs text-gray-500">
                Tujuan tombol "Konfirmasi via WhatsApp" pelanggan. Kosong =
                pakai nomor cabang.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Auto-notifikasi admin (opsional)
              </label>
              <Select
                value={notifyInstance}
                onChange={(e) => setNotifyInstance(e.target.value)}
                options={[
                  { value: '', label: 'Tidak (hanya tombol konfirmasi)' },
                  ...data.waInstances.map((w) => ({
                    value: w.id,
                    label: `${w.label}${w.adminPhone ? '' : ' (admin belum diset)'}`,
                  })),
                ]}
              />
              <p className="mt-1 text-xs text-gray-500">
                Kirim notifikasi pesanan baru otomatis ke admin lewat WhatsApp
                yang sudah terhubung.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Lainnya">
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={applyTax}
                onChange={(e) => setApplyTax(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm">
                <span className="block font-medium text-gray-900 dark:text-gray-100">
                  Terapkan pajak
                </span>
                <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
                  Ikuti pengaturan pajak di Pengaturan Kasir untuk pesanan
                  online.
                </span>
              </span>
            </label>
            <Textarea
              label="Catatan checkout"
              rows={3}
              value={checkoutNote}
              onChange={(e) => setCheckoutNote(e.target.value)}
              placeholder="cth. Pesanan diproses setelah pembayaran dikonfirmasi."
            />
          </div>
        </Section>
      </div>

      <div className="flex justify-end">
        <Button
          variant="brand"
          onClick={() => save.mutate()}
          loading={save.isPending}
        >
          Simpan Pengaturan
        </Button>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      {children}
    </div>
  )
}
