import { useCallback, useEffect, useState } from 'react'
import {
  connectPaired,
  forgetPrinter,
  getSavedPrinter,
  isWebBluetoothSupported,
  pairPrinter,
  setSavedPaperWidth,
  writeBytes,
  type SavedPrinter,
} from '@/lib/printer/bluetooth'
import { getSaleDataForPrinter } from '@/server/functions/pos-receipt'
import { renderReceipt } from '@/lib/escpos/render-receipt'
import { ditherImageToCommand } from '@/lib/escpos/dither'

/**
 * React glue over the Web Bluetooth printer driver. Exposes the
 * paired printer state (synced from localStorage) plus pair / forget
 * / write actions. Settings page + sale-success modal both consume
 * this hook.
 *
 * Pure client. SSR returns `isSupported: false` and a null `printer`
 * so the markup is stable across the hydration boundary.
 */
export function useThermalPrinter() {
  const [printer, setPrinter] = useState<SavedPrinter | null>(null)
  const [isSupported, setIsSupported] = useState(false)

  useEffect(() => {
    setIsSupported(isWebBluetoothSupported())
    setPrinter(getSavedPrinter())
  }, [])

  const pair = useCallback(async (paperWidth: 58 | 80 = 58) => {
    const saved = await pairPrinter(paperWidth)
    setPrinter(saved)
    return saved
  }, [])

  const forget = useCallback(() => {
    forgetPrinter()
    setPrinter(null)
  }, [])

  const setPaperWidth = useCallback((width: 58 | 80) => {
    const updated = setSavedPaperWidth(width)
    if (updated) setPrinter(updated)
  }, [])

  const print = useCallback(async (bytes: Uint8Array) => {
    await writeBytes(bytes)
  }, [])

  /**
   * Full receipt print: fetch the sale's print payload, dither the
   * tenant logo, render the ESC/POS byte stream, and write it to the
   * paired printer. The single thermal-print path shared by the
   * post-sale success modal and the transaction-history detail page.
   * Throws when no printer is paired.
   */
  const printReceipt = useCallback(
    async (saleId: string) => {
      if (!printer) throw new Error('Printer tidak terhubung')
      const sale = await getSaleDataForPrinter({ data: { id: saleId } })
      const dotsWide = printer.paperWidth === 58 ? 384 : 576
      const logoCommand = sale.logoDataUrl
        ? await ditherImageToCommand(sale.logoDataUrl, dotsWide)
        : null
      const bytes = renderReceipt(sale, {
        paperWidth: printer.paperWidth,
        logoCommand,
      })
      await writeBytes(bytes)
    },
    [printer],
  )

  /** Force a reconnect attempt — useful for the "Tes Cetak" button. */
  const reconnect = useCallback(async () => {
    return connectPaired()
  }, [])

  return {
    /** Web Bluetooth API is exposed by the current browser. */
    isSupported,
    /** Saved printer record, or null when not paired. */
    printer,
    /** Convenience boolean for `printer != null`. */
    isPaired: printer != null,
    pair,
    forget,
    setPaperWidth,
    print,
    printReceipt,
    reconnect,
  }
}
