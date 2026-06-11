/**
 * Web Bluetooth driver for ESC/POS thermal printers (JUR-12).
 *
 * Browser-only (Chrome / Edge / Brave-with-flag, Android + desktop).
 * iOS Safari and Firefox don't ship Web Bluetooth — callers must
 * gate the UI with `isWebBluetoothSupported()` so those browsers
 * keep the PDF fallback path.
 *
 * Bluetooth Classic SPP printers (no GATT) are out of reach for
 * Web Bluetooth and will not appear in the device picker. The
 * verified test printer (RPP02N) exposes a custom 128-bit service
 * `e7810a71-...` with a fully-writable characteristic `bef8d6c9-...`
 * — that's the primary path. Three fallback services cover the
 * other common Chinese ESC/POS BLE printers.
 */

/**
 * Candidate (service, write char) pairs tried in priority order
 * when discovering the right characteristic on a freshly-paired
 * printer. The first hit is cached in localStorage so subsequent
 * connects skip the loop.
 */
const CANDIDATE_PAIRS: ReadonlyArray<{ service: string; writeChar: string }> = [
  // RPP02N (Rongta / GoojPrt) — verified on the test unit.
  {
    service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    writeChar: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  },
  // ISSC / Microchip BM77/BM78 transparent UART — common on
  // mid-tier 58mm/80mm Bluetooth printers.
  {
    service: '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    writeChar: '49535343-1e4d-4bd9-ba61-23c647249616',
  },
  // Legacy GoojPrt 16-bit service — most older RPP-family units.
  {
    service: '0000ff00-0000-1000-8000-00805f9b34fb',
    writeChar: '0000ff02-0000-1000-8000-00805f9b34fb',
  },
  // Generic ESC/POS BLE module (sometimes labelled "BT-Print").
  {
    service: '000018f0-0000-1000-8000-00805f9b34fb',
    writeChar: '00002af1-0000-1000-8000-00805f9b34fb',
  },
]

/**
 * Every candidate service must be listed in `optionalServices` of
 * `requestDevice()` — Chrome forbids GATT access to services not
 * granted at pair time.
 */
const ALL_CANDIDATE_SERVICES: BluetoothServiceUUID[] = CANDIDATE_PAIRS.map(
  (p) => p.service,
)

/**
 * BLE GATT default MTU is 23 bytes (20-byte payload). Chunk every
 * write at this size so the stack never has to fragment, which has
 * historically caused dropped bytes on cheap printer firmware.
 */
const CHUNK_SIZE = 20

/**
 * Pause inserted between chunk writes. `writeValueWithoutResponse`
 * doesn't ACK, and bursts faster than the printer's UART can drain
 * its buffer cause truncated receipts on some units. 6ms is enough
 * for the test printer; faster printers don't suffer from it.
 */
const CHUNK_DELAY_MS = 6

export interface SavedPrinter {
  /** Stable identifier — `BluetoothDevice.id` (browser-scoped opaque string). */
  deviceId: string
  /** Human-readable name from the BT advertising packet. */
  deviceName: string
  /** Resolved GATT service UUID. */
  serviceUUID: string
  /** Resolved write characteristic UUID. */
  writeCharUUID: string
  /** 58 or 80, set by the user in Settings. */
  paperWidth: 58 | 80
  /** ISO timestamp — for "last connected" display. */
  savedAt: string
}

const STORAGE_KEY = 'jq_pos_thermal_printer'

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export function getSavedPrinter(): SavedPrinter | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SavedPrinter
  } catch {
    return null
  }
}

export function savePrinter(p: SavedPrinter): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

export function forgetPrinter(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Update just the paper width on the saved printer without changing
 * the connection identity. Returns the updated record, or null when
 * nothing was saved.
 */
export function setSavedPaperWidth(width: 58 | 80): SavedPrinter | null {
  const cur = getSavedPrinter()
  if (!cur) return null
  const next: SavedPrinter = { ...cur, paperWidth: width }
  savePrinter(next)
  return next
}

interface ActiveConnection {
  device: BluetoothDevice
  characteristic: BluetoothRemoteGATTCharacteristic
}

let active: ActiveConnection | null = null

/**
 * Show the OS Bluetooth picker, let the user select a printer,
 * connect via GATT, and discover the write characteristic. Persists
 * the result to localStorage and returns the saved record.
 *
 * Throws on user cancellation, no Web Bluetooth, GATT failure, or
 * no writable characteristic discovered.
 */
export async function pairPrinter(paperWidth: 58 | 80 = 58): Promise<SavedPrinter> {
  if (!isWebBluetoothSupported()) {
    throw new Error(
      'Browser tidak mendukung Web Bluetooth. Gunakan Chrome di Android atau desktop.',
    )
  }
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: ALL_CANDIDATE_SERVICES,
  })
  if (!device.gatt) {
    throw new Error('Perangkat tidak mendukung GATT')
  }
  const server = await device.gatt.connect()
  const found = await discoverWriteCharacteristic(server)
  if (!found) {
    server.disconnect()
    throw new Error(
      'Printer tidak memiliki karakteristik tulis yang dikenal. Coba printer lain atau hubungi support.',
    )
  }

  const saved: SavedPrinter = {
    deviceId: device.id,
    deviceName: device.name ?? 'Printer Thermal',
    serviceUUID: found.service.uuid,
    writeCharUUID: found.characteristic.uuid,
    paperWidth,
    savedAt: new Date().toISOString(),
  }
  savePrinter(saved)
  attachDisconnectHandler(device)
  active = { device, characteristic: found.characteristic }
  return saved
}

/**
 * Reconnect to a previously-paired printer without showing the
 * picker. Returns null when nothing is saved or the OS no longer
 * recognises the device (Chrome's per-origin permission can be
 * revoked by the user). Caller should fall back to `pairPrinter()`
 * on null.
 */
export async function connectPaired(): Promise<ActiveConnection | null> {
  if (active && active.device.gatt?.connected) return active

  const saved = getSavedPrinter()
  if (!saved) return null
  if (!isWebBluetoothSupported()) return null

  // `getDevices()` returns devices the origin has been granted
  // permission to access. Available in Chrome 96+; older browsers
  // throw, which we treat as "no saved connection available".
  let devices: BluetoothDevice[]
  try {
    devices = await navigator.bluetooth.getDevices()
  } catch {
    return null
  }
  const device = devices.find((d) => d.id === saved.deviceId)
  if (!device || !device.gatt) return null

  const server = device.gatt.connected
    ? device.gatt
    : await device.gatt.connect()

  let characteristic: BluetoothRemoteGATTCharacteristic
  try {
    const service = await server.getPrimaryService(saved.serviceUUID)
    characteristic = await service.getCharacteristic(saved.writeCharUUID)
  } catch {
    // Cached UUIDs no longer resolve (firmware update / wrong unit
    // selected from `getDevices`) — fall back to discovery so a
    // single dropped pairing doesn't force a full re-pair flow.
    const found = await discoverWriteCharacteristic(server)
    if (!found) {
      server.disconnect()
      return null
    }
    characteristic = found.characteristic
    savePrinter({
      ...saved,
      serviceUUID: found.service.uuid,
      writeCharUUID: found.characteristic.uuid,
    })
  }

  attachDisconnectHandler(device)
  active = { device, characteristic }
  return active
}

/**
 * Push an ESC/POS byte stream to the currently-connected printer.
 * Auto-reconnects via `connectPaired()` if the session was dropped.
 * Throws if there's no paired printer to connect to.
 */
export async function writeBytes(bytes: Uint8Array): Promise<void> {
  let conn = active
  if (!conn || !conn.device.gatt?.connected) {
    conn = await connectPaired()
  }
  if (!conn) {
    throw new Error('Tidak ada printer terpasang. Sambungkan di Pengaturan POS.')
  }

  // `writeValueWithoutResponse` is the fast path: no ACK round-trip
  // per chunk. We pace manually with `CHUNK_DELAY_MS` instead.
  // Copy each slice into a fresh ArrayBuffer-backed Uint8Array so the
  // TS lib type (which forbids SharedArrayBuffer-backed views) is
  // satisfied; the extra allocation is irrelevant for receipt-sized
  // payloads (KB scale).
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const end = Math.min(i + CHUNK_SIZE, bytes.length)
    const chunk = new Uint8Array(bytes.subarray(i, end))
    await conn.characteristic.writeValueWithoutResponse(chunk)
    if (CHUNK_DELAY_MS > 0 && end < bytes.length) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS))
    }
  }
}

/**
 * Drop the GATT connection but keep the saved pairing — next call
 * to `writeBytes` or `connectPaired` will reconnect silently.
 */
export function disconnect(): void {
  if (active?.device.gatt?.connected) {
    active.device.gatt.disconnect()
  }
  active = null
}

// ─── internals ────────────────────────────────────────────────────

async function discoverWriteCharacteristic(
  server: BluetoothRemoteGATTServer,
): Promise<{
  service: BluetoothRemoteGATTService
  characteristic: BluetoothRemoteGATTCharacteristic
} | null> {
  for (const pair of CANDIDATE_PAIRS) {
    try {
      const service = await server.getPrimaryService(pair.service)
      const characteristic = await service.getCharacteristic(pair.writeChar)
      const props = characteristic.properties
      if (props.write || props.writeWithoutResponse) {
        return { service, characteristic }
      }
    } catch {
      // Service or characteristic not on this device — try next.
    }
  }
  return null
}

function attachDisconnectHandler(device: BluetoothDevice): void {
  device.addEventListener('gattserverdisconnected', () => {
    if (active?.device.id === device.id) {
      active = null
    }
  })
}
