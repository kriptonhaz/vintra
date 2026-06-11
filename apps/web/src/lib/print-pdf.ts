/**
 * Print + download helpers for server-rendered PDFs.
 *
 * Why blob URLs (and not data URLs):
 *   - `data:` URLs in an iframe are treated as a different opaque
 *     origin from the parent page → `iframe.contentWindow.print()`
 *     throws SecurityError (same-origin policy).
 *   - `data:` URLs opened via `window.open` are silently blocked by
 *     Chrome, Firefox, and Safari for cross-origin navigation rules.
 *   - `blob:` URLs inherit the parent page's origin → iframe access +
 *     print() work everywhere.
 *
 * Auto-cleanup: we revoke the blob URL after print/download finishes
 * so memory isn't leaked. The iframe sticks around for 5 seconds
 * after print() — Chrome aborts the print job if the iframe is
 * removed before the user confirms or cancels in the print dialog.
 */

function dataUrlToBlobUrl(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0) throw new Error('Invalid data URL')
  const header = dataUrl.slice(0, commaIdx)
  const body = dataUrl.slice(commaIdx + 1)
  const mimeMatch = header.match(/data:([^;]+)/)
  const mime = mimeMatch?.[1] ?? 'application/pdf'
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: mime })
  return URL.createObjectURL(blob)
}

export function printPdfDataUrl(dataUrl: string): void {
  let blobUrl: string
  try {
    blobUrl = dataUrlToBlobUrl(dataUrl)
  } catch {
    // Malformed PDF response — fail loudly rather than silently doing nothing.
    alert('Gagal memuat PDF untuk dicetak.')
    return
  }

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.left = '-9999px'
  iframe.style.top = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = 'none'
  iframe.src = blobUrl
  iframe.onload = () => {
    // Tiny delay lets the embedded PDF viewer initialise its layout
    // before we trigger print. Without this, Safari sometimes prints
    // a blank page.
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } catch {
        // Last-ditch fallback: open the blob URL in a new tab so the
        // user can hit print themselves.
        window.open(blobUrl, '_blank')
      }
      // Give the print dialog time to read the iframe; revoke the
      // blob + remove the iframe well after print is done.
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
        URL.revokeObjectURL(blobUrl)
      }, 30 * 1000)
    }, 250)
  }
  document.body.appendChild(iframe)
}

export function downloadPdfDataUrl(dataUrl: string, fileName: string): void {
  // Convert to blob URL so the download attribute reliably triggers
  // a file save (some browsers ignore `download` on long data: URLs).
  let blobUrl: string
  try {
    blobUrl = dataUrlToBlobUrl(dataUrl)
  } catch {
    alert('Gagal memuat PDF untuk diunduh.')
    return
  }
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  }, 1000)
}
