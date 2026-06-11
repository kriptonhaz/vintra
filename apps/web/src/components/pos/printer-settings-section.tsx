import * as React from 'react'
import { Bluetooth, BluetoothConnected, Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useThermalPrinter } from '@/hooks/use-thermal-printer'
import { renderTestPrint } from '@/lib/escpos/render-receipt'

/**
 * POS settings → "Printer Thermal" section. Renders the pair / status
 * / paper-width / Tes Cetak controls for the per-device Web Bluetooth
 * printer pairing (JUR-12).
 *
 * Parent must tier-gate this — render only when the tenant has the
 * `thermal_printer` POS feature flag. Free tier never sees the
 * section; iOS / Firefox / Brave-without-the-flag users see the
 * section with a "browser tidak mendukung" note instead of the pair
 * button.
 */
export function PrinterSettingsSection() {
  const { toast } = useToast()
  const {
    isSupported,
    printer,
    isPaired,
    pair,
    forget,
    setPaperWidth,
    print,
  } = useThermalPrinter()

  const [pairing, setPairing] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  async function handlePair() {
    setPairing(true)
    try {
      const saved = await pair(printer?.paperWidth ?? 58)
      toast({
        title: 'Printer tersambung',
        description: saved.deviceName,
        variant: 'success',
      })
    } catch (err) {
      // User-cancelled picker throws NotFoundError — silent is best.
      if (err instanceof Error && /cancel|not found/i.test(err.message)) {
        return
      }
      toast({
        title: 'Gagal menyambungkan printer',
        description: err instanceof Error ? err.message : 'Coba lagi',
        variant: 'error',
      })
    } finally {
      setPairing(false)
    }
  }

  async function handleTestPrint() {
    if (!printer) return
    setTesting(true)
    try {
      const bytes = renderTestPrint({
        paperWidth: printer.paperWidth,
        tenantName: 'Vintra POS',
      })
      await print(bytes)
      toast({
        title: 'Tes Cetak terkirim',
        description: 'Periksa keluaran printer',
        variant: 'success',
      })
    } catch (err) {
      toast({
        title: 'Gagal mengirim tes cetak',
        description: err instanceof Error ? err.message : 'Periksa daya printer',
        variant: 'error',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center gap-2">
        <Printer className="h-5 w-5 text-gray-600 dark:text-gray-300" />
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Printer Thermal
        </h3>
      </div>

      {!isSupported ? (
        <UnsupportedBrowserNote />
      ) : isPaired && printer ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-success-200 bg-success-50 p-3 dark:border-success-700 dark:bg-success-900/20">
            <BluetoothConnected className="mt-0.5 h-5 w-5 shrink-0 text-success-600" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-success-900 dark:text-success-200">
                {printer.deviceName}
              </p>
              <p className="text-xs text-success-800 dark:text-success-300">
                Lebar {printer.paperWidth}mm • disimpan untuk perangkat ini
              </p>
            </div>
            <button
              type="button"
              onClick={forget}
              className="rounded p-1 text-success-700 hover:bg-success-100 dark:text-success-300 dark:hover:bg-success-800/40"
              aria-label="Hapus printer"
              title="Hapus printer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Lebar kertas
            </label>
            <div className="flex gap-2">
              {([58, 80] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setPaperWidth(w)}
                  className={
                    printer.paperWidth === w
                      ? 'rounded-lg border border-brand-500 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 dark:bg-brand-900/20 dark:text-brand-200'
                      : 'rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40'
                  }
                >
                  {w}mm
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Pilih sesuai gulungan kertas printer. Umumnya 58mm untuk
              printer kasir kecil, 80mm untuk printer kasir besar.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleTestPrint}
              loading={testing}
            >
              <Printer className="h-4 w-4" />
              Tes Cetak
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handlePair}
              loading={pairing}
            >
              <Bluetooth className="h-4 w-4" />
              Sambungkan Ulang
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Sambungkan printer thermal Bluetooth untuk mencetak struk
            langsung dari halaman kasir. Tanpa printer, struk tetap
            bisa diunduh sebagai PDF.
          </p>
          <Button
            type="button"
            variant="brand"
            onClick={handlePair}
            loading={pairing}
          >
            <Bluetooth className="h-4 w-4" />
            Sambungkan Printer
          </Button>
          <p className="text-xs text-gray-500">
            Nyalakan printer + pastikan Bluetooth perangkat ini aktif.
            Pengaturan ini disimpan per perangkat — jika kamu berganti
            ponsel kasir, sambungkan ulang dari Pengaturan POS.
          </p>
        </div>
      )}
    </div>
  )
}

function UnsupportedBrowserNote() {
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        Browser ini belum mendukung Web Bluetooth, jadi tombol Cetak
        akan tetap menggunakan format PDF.
      </p>
      <ul className="list-inside list-disc space-y-0.5 text-xs text-gray-500">
        <li>Chrome (Android atau desktop) — bekerja langsung</li>
        <li>
          Brave — aktifkan dulu di Settings &rarr; Privacy &rarr; Web
          Bluetooth
        </li>
        <li>Safari (iPhone) &amp; Firefox — belum mendukung</li>
      </ul>
    </div>
  )
}
