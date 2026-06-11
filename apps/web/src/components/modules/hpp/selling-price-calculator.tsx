import { useState, useMemo } from 'react'
import { Calculator } from 'lucide-react'
import { suggestSellingPrice, calculateMarkup } from '@/lib/hpp-calculator'
import { formatRupiah } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

interface CalculatorProduct {
  id: string
  name: string
  hpp: number | null
}

interface SellingPriceCalculatorProps {
  products: CalculatorProduct[]
}

const PRESET_MARGINS = [20, 30, 40, 50, 60]

export function SellingPriceCalculator({
  products,
}: SellingPriceCalculatorProps) {
  const [selectedProductId, setSelectedProductId] = useState('')
  const [targetMargin, setTargetMargin] = useState('')

  // Only show products that have an HPP value
  const eligibleProducts = products.filter((p) => p.hpp !== null && p.hpp > 0)

  const selectedProduct = eligibleProducts.find(
    (p) => p.id === selectedProductId,
  )

  const marginValue = Number(targetMargin)
  const isValidMargin = targetMargin !== '' && marginValue > 0 && marginValue < 100

  const result = useMemo(() => {
    if (!selectedProduct?.hpp || !isValidMargin) return null

    const hpp = selectedProduct.hpp
    const suggested = suggestSellingPrice(hpp, marginValue)
    const markup = calculateMarkup(suggested, hpp)
    const profit = suggested - hpp

    return {
      hpp,
      suggestedPrice: Math.ceil(suggested),
      margin: marginValue,
      markup,
      profit: Math.ceil(profit),
    }
  }, [selectedProduct, marginValue, isValidMargin])

  if (eligibleProducts.length === 0) {
    return (
      <EmptyState
        icon={<Calculator className="h-6 w-6" />}
        title="Belum ada produk dengan HPP"
        description="Tambahkan resep/komposisi bahan ke produk terlebih dahulu agar HPP dapat dihitung."
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Product selector */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Pilih Produk
        </label>
        <select
          value={selectedProductId}
          onChange={(e) => setSelectedProductId(e.target.value)}
          className={cn(
            'flex h-10 w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm',
            'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25',
          )}
        >
          <option value="">Pilih produk</option>
          {eligibleProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} (HPP: {formatRupiah(p.hpp!)})
            </option>
          ))}
        </select>
      </div>

      {/* Target margin input */}
      {selectedProduct && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Target Margin (%)
          </label>
          <div className="space-y-3">
            <div className="relative">
              <input
                type="number"
                step="1"
                min="1"
                max="99"
                value={targetMargin}
                onChange={(e) => setTargetMargin(e.target.value)}
                placeholder="Masukkan target margin"
                className={cn(
                  'flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-8 text-sm',
                  'placeholder:text-gray-400',
                  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25',
                )}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                %
              </span>
            </div>

            {/* Preset margin buttons */}
            <div className="flex flex-wrap gap-2">
              {PRESET_MARGINS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant={
                    targetMargin === String(preset) ? 'default' : 'outline'
                  }
                  size="sm"
                  onClick={() => setTargetMargin(String(preset))}
                >
                  {preset}%
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Calculation result */}
      {result && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h4 className="text-sm font-semibold text-gray-900">
              Hasil Perhitungan
            </h4>
            <p className="text-xs text-gray-500">
              {selectedProduct?.name}
            </p>
          </div>

          <div className="space-y-3 px-5 py-4">
            {/* HPP */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">HPP (Harga Pokok)</span>
              <span className="text-sm font-medium text-gray-900">
                {formatRupiah(result.hpp)}
              </span>
            </div>

            {/* Target margin */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Target Margin</span>
              <span className="text-sm font-medium text-gray-900">
                {result.margin.toFixed(1)}%
              </span>
            </div>

            {/* Markup */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Markup</span>
              <span className="text-sm font-medium text-gray-900">
                {result.markup.toFixed(1)}%
              </span>
            </div>

            <hr className="border-gray-200" />

            {/* Suggested price */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                Harga Jual Disarankan
              </span>
              <span className="text-lg font-bold text-primary-600">
                {formatRupiah(result.suggestedPrice)}
              </span>
            </div>

            {/* Profit per unit */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Laba per Unit</span>
              <span className="text-sm font-semibold text-success-600">
                {formatRupiah(result.profit)}
              </span>
            </div>
          </div>

          {/* Formula explanation */}
          <div className="rounded-b-xl bg-gray-50 px-5 py-3">
            <p className="text-xs text-gray-500">
              Rumus: Harga Jual = HPP / (1 - Margin%) ={' '}
              {formatRupiah(result.hpp)} / (1 - {result.margin}%) ={' '}
              {formatRupiah(result.suggestedPrice)}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export { type SellingPriceCalculatorProps, type CalculatorProduct }
