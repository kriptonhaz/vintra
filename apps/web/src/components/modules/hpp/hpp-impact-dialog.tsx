import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatRupiah } from '@/lib/currency'

/** Mirrors `DANGER_MARGIN` on the server. */
const DANGER_MARGIN = 20

export interface HppImpactProduct {
  productId: string
  name: string
  oldHpp: number | null
  newHpp: number
  newMargin: number
}

export interface HppImpact {
  affected: number
  unchanged: number
  unresolved: number
  averageMove: number
  products: HppImpactProduct[]
}

/**
 * Shows what a manual ingredient-price edit would do before it is applied.
 *
 * The owner typing a new price is the person who sets menu prices, so the
 * consequences are theirs to weigh: how many products move, by how much, and
 * — the part actually worth deciding about — which ones would end up selling
 * under a healthy margin. Those are listed first and by name, because
 * "3 products below 20%" is a statistic while "Es Teh Jumbo at 12%" is a
 * decision.
 *
 * Selling prices are never touched by the cascade; only the cost changes. The
 * copy says so, so nobody has to wonder whether their menu just moved.
 */
export function HppImpactDialog({
  open,
  impact,
  materialName,
  oldPrice,
  newPrice,
  onConfirm,
  onCancel,
  loading = false,
}: {
  open: boolean
  impact: HppImpact | null
  materialName: string
  oldPrice: number
  newPrice: number
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}) {
  if (!impact) return null

  const rising = newPrice >= oldPrice
  const danger = impact.products
    .filter((p) => p.newMargin < DANGER_MARGIN)
    .sort((a, b) => a.newMargin - b.newMargin)
  const rest = impact.products
    .filter((p) => p.newMargin >= DANGER_MARGIN)
    .sort((a, b) => b.newHpp - (b.oldHpp ?? 0) - (a.newHpp - (a.oldHpp ?? 0)))

  return (
    <Dialog open={open} onClose={onCancel}>
      <div className="max-h-[80vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Ubah harga {materialName}?
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {formatRupiah(oldPrice)} → {formatRupiah(newPrice)}. HPP produk yang
          memakai bahan ini akan ikut {rising ? 'naik' : 'turun'}.{' '}
          <span className="font-medium">Harga jual tidak diubah.</span>
        </p>

        {impact.affected === 0 ? (
          <p className="mt-4 rounded-md bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            Tidak ada produk yang terpengaruh.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat label="Produk terdampak" value={String(impact.affected)} />
              <Stat
                label={`Rata-rata ${rising ? 'naik' : 'turun'}`}
                value={formatRupiah(Math.abs(Math.round(impact.averageMove)))}
              />
            </div>

            {danger.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  {danger.length} produk marginnya jadi di bawah {DANGER_MARGIN}%
                </p>
                <ul className="mt-2 space-y-1">
                  {danger.map((p) => (
                    <ProductRow key={p.productId} p={p} danger />
                  ))}
                </ul>
              </div>
            )}

            {rest.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Produk lain yang ikut berubah
                </p>
                <ul className="mt-2 space-y-1">
                  {rest.slice(0, 8).map((p) => (
                    <ProductRow key={p.productId} p={p} />
                  ))}
                </ul>
                {rest.length > 8 && (
                  <p className="mt-1 text-xs text-gray-500">
                    dan {rest.length - 8} produk lainnya
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {impact.unresolved > 0 && (
          <p className="mt-4 rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {impact.unresolved} produk dilewati karena resepnya saling
            mereferensi (sub-resep melingkar). HPP-nya dibiarkan apa adanya —
            periksa komposisinya.
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
            Batal
          </Button>
          <Button type="button" variant="brand" onClick={onConfirm} disabled={loading}>
            {loading ? 'Menyimpan…' : 'Ya, ubah harga'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </p>
    </div>
  )
}

function ProductRow({ p, danger = false }: { p: HppImpactProduct; danger?: boolean }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-sm">
      <span className="truncate text-gray-700 dark:text-gray-300">{p.name}</span>
      <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-400">
        {p.oldHpp != null && `${formatRupiah(p.oldHpp)} → `}
        {formatRupiah(p.newHpp)}
        <span
          className={
            danger
              ? 'ml-2 font-medium text-red-600 dark:text-red-400'
              : 'ml-2 text-gray-500'
          }
        >
          {p.newMargin.toFixed(0)}%
        </span>
      </span>
    </li>
  )
}
