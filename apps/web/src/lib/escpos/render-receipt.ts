/**
 * Render a sale into an ESC/POS byte stream sized for a 58mm or 80mm
 * thermal printer. Mirrors the visual order of the existing PDF
 * receipt in `server/functions/pos-receipt.ts:renderThermalReceipt`
 * — owner, branch, items, totals, payment, loyalty, footer — so the
 * customer sees the same content regardless of whether the cashier
 * printed via PDF or via a paired BT printer.
 *
 * The renderer is paper-agnostic: it just emits text + alignment + a
 * pre-built logo command. Caller is responsible for dithering the
 * logo (see `dither.ts`) before passing it in.
 */

import {
  align,
  concat,
  cut,
  feed,
  fontReset,
  fontSize,
  init,
  lf,
  text,
} from './commands'

/** Number of character columns at default font A for each paper size. */
const COLS_58MM = 32
const COLS_80MM = 48

export type PaperWidth = 58 | 80

/**
 * Sale payload consumed by the renderer. Mirrors `SaleData` from
 * `pos-receipt.ts` but with `createdAt` as an ISO string (after JSON
 * serialization through the server function) and the logo replaced
 * by a pre-rendered ESC/POS bitmap command (already includes the
 * `GS v 0` header). Pass `null` for `logoCommand` to skip the logo.
 */
export interface PrinterSaleData {
  id: string
  saleNumber: string
  tenantName: string
  branchName: string
  customerName: string | null
  customerPhone: string | null
  subtotal: number
  discountType: string | null
  discountValue: number | null
  discountAmount: number
  promoAmount: number
  promoCodeSnapshot: string | null
  taxAmount: number
  taxLabel: string
  taxLines:
    | Array<{ label: string; percent: number; amount: number }>
    | null
  total: number
  paymentMethod: string
  paidAmount: number
  changeAmount: number
  status: string
  createdAt: string
  notes: string | null
  items: Array<{
    nameSnapshot: string
    qty: number
    unitPrice: number
    subtotal: number
    soldUnitLabel: string | null
    isBulkPrice: boolean
    lineDiscountAmount: number
    lineDiscountType: 'fixed' | 'percent' | null
    lineDiscountValue: number | null
    autoPromoAmount: number
  }>
  receiptFooterText: string | null
  loyalty: {
    pointsEarned: number
    pointsRedeemed: number
    redeemAmount: number
    currentBalance: number
  } | null
  /**
   * Base64 PNG data URL for the tenant logo, fetched server-side via
   * the signed S3 URL. Client passes this to `ditherImageToCommand`
   * to produce the `logoCommand` argument for `renderReceipt`. Null
   * when the tenant has no logo configured.
   */
  logoDataUrl: string | null
}

export interface RenderOptions {
  paperWidth: PaperWidth
  /**
   * Pre-built ESC/POS raster command for the tenant logo, or null
   * to skip. Build via `ditherImageToCommand(logoDataUrl, dotsWide)`
   * on the client.
   */
  logoCommand?: Uint8Array | null
}

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

export function renderReceipt(
  sale: PrinterSaleData,
  opts: RenderOptions,
): Uint8Array {
  const cols = opts.paperWidth === 58 ? COLS_58MM : COLS_80MM
  const parts: Uint8Array[] = [init()]

  if (opts.logoCommand && opts.logoCommand.length > 0) {
    parts.push(align('center'), opts.logoCommand, lf())
  }

  // Tenant header — bold + double-height for prominence. Note: at
  // double-width, effective cols halves; we don't double-width the
  // header so it can fit longer business names on 58mm.
  parts.push(align('center'))
  parts.push(fontSize({ bold: true, doubleHeight: true }))
  parts.push(text(truncate(sale.tenantName, cols)))
  parts.push(lf())
  parts.push(fontReset())
  parts.push(text(truncate(sale.branchName, cols)))
  parts.push(lf())
  parts.push(text(divider(cols)))
  parts.push(lf())

  // Sale meta — left-aligned.
  parts.push(align('left'))
  parts.push(text(`No : ${sale.saleNumber}`))
  parts.push(lf())
  parts.push(text(`Tgl: ${formatJakartaDateTime(sale.createdAt)}`))
  parts.push(lf())
  if (sale.customerName) {
    parts.push(text(`Pelanggan: ${truncate(sale.customerName, cols - 11)}`))
    parts.push(lf())
  }
  parts.push(text(divider(cols)))
  parts.push(lf())

  // Items. Each item gets one line for the name (wrapped if needed),
  // one line for qty/unit/subtotal, and an optional discount note.
  for (const item of sale.items) {
    const nameLine = item.isBulkPrice
      ? `${item.nameSnapshot} (grosir)`
      : item.nameSnapshot
    for (const line of wrap(nameLine, cols)) {
      parts.push(text(line))
      parts.push(lf())
    }
    const unitSuffix = item.soldUnitLabel ? ` ${item.soldUnitLabel}` : ''
    const left = `  ${item.qty}${unitSuffix} x ${formatRupiah(item.unitPrice)}`
    const right = formatRupiah(item.subtotal)
    parts.push(text(padRight(left, right, cols)))
    parts.push(lf())
    if (item.lineDiscountAmount > 0) {
      const dLabel =
        item.lineDiscountType === 'percent' && item.lineDiscountValue != null
          ? `  Diskon item ${item.lineDiscountValue}%`
          : '  Diskon item'
      parts.push(
        text(padRight(dLabel, `-${formatRupiah(item.lineDiscountAmount)}`, cols)),
      )
      parts.push(lf())
    }
  }

  parts.push(text(divider(cols)))
  parts.push(lf())

  parts.push(text(padRight('Subtotal', formatRupiah(sale.subtotal), cols)))
  parts.push(lf())

  if (sale.discountAmount > 0) {
    const dLabel =
      sale.discountType === 'percent'
        ? `Diskon ${sale.discountValue}%`
        : 'Diskon'
    parts.push(text(padRight(dLabel, `-${formatRupiah(sale.discountAmount)}`, cols)))
    parts.push(lf())
  }
  if (sale.promoAmount > 0) {
    const lbl = sale.promoCodeSnapshot
      ? `Promo "${truncate(sale.promoCodeSnapshot, 14)}"`
      : 'Promo'
    parts.push(text(padRight(lbl, `-${formatRupiah(sale.promoAmount)}`, cols)))
    parts.push(lf())
  }

  const taxLines =
    sale.taxLines && sale.taxLines.length > 0
      ? sale.taxLines
      : sale.taxAmount > 0
        ? [{ label: sale.taxLabel, percent: 0, amount: sale.taxAmount }]
        : []
  for (const t of taxLines) {
    if (t.amount <= 0) continue
    const lbl = t.percent > 0 ? `${t.label} ${t.percent}%` : t.label
    parts.push(text(padRight(lbl, formatRupiah(t.amount), cols)))
    parts.push(lf())
  }

  parts.push(fontSize({ bold: true, doubleHeight: true }))
  // At double-height the line is twice as tall but column count is
  // unchanged — pad to `cols`. (Double-width would halve cols — we
  // avoid it so long totals still fit.)
  parts.push(text(padRight('TOTAL', formatRupiah(sale.total), cols)))
  parts.push(lf())
  parts.push(fontReset())

  const payLabel =
    PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod
  parts.push(text(padRight(`Bayar (${payLabel})`, formatRupiah(sale.paidAmount), cols)))
  parts.push(lf())
  if (sale.changeAmount > 0) {
    parts.push(text(padRight('Kembalian', formatRupiah(sale.changeAmount), cols)))
    parts.push(lf())
  }

  if (sale.status === 'voided') {
    parts.push(lf())
    parts.push(align('center'))
    parts.push(fontSize({ bold: true, doubleHeight: true }))
    parts.push(text('** DIBATALKAN **'))
    parts.push(fontReset())
    parts.push(lf())
    parts.push(align('left'))
  }

  parts.push(text(divider(cols)))
  parts.push(lf())

  if (sale.loyalty) {
    parts.push(align('center'))
    if (sale.loyalty.pointsRedeemed > 0) {
      parts.push(
        text(
          `Tukar poin: ${formatIndo(sale.loyalty.pointsRedeemed)} (${formatRupiah(sale.loyalty.redeemAmount)})`,
        ),
      )
      parts.push(lf())
    }
    if (sale.loyalty.pointsEarned > 0) {
      parts.push(text(`Dapat poin: +${formatIndo(sale.loyalty.pointsEarned)}`))
      parts.push(lf())
    }
    parts.push(text(`Saldo: ${formatIndo(sale.loyalty.currentBalance)} poin`))
    parts.push(lf())
    parts.push(text(divider(cols)))
    parts.push(lf())
    parts.push(align('left'))
  }

  // Footer
  parts.push(align('center'))
  parts.push(text('Terima kasih atas kunjungan Anda'))
  parts.push(lf())
  if (sale.receiptFooterText) {
    for (const line of wrap(sale.receiptFooterText, cols)) {
      parts.push(text(line))
      parts.push(lf())
    }
  } else {
    parts.push(text('Dibuat dengan Vintra'))
    parts.push(lf())
  }

  // Margin for manual tear, then attempt partial cut (no-op on
  // printers without an auto-cutter, including most RPP02N units).
  parts.push(feed(4))
  parts.push(cut())

  return concat(...parts)
}

/**
 * Tiny test-print payload — connects to the printer and produces a
 * short sanity-check receipt. Used by the "Tes Cetak" button in
 * Settings.
 */
export function renderTestPrint(opts: {
  paperWidth: PaperWidth
  tenantName: string
  logoCommand?: Uint8Array | null
}): Uint8Array {
  const cols = opts.paperWidth === 58 ? COLS_58MM : COLS_80MM
  const parts: Uint8Array[] = [init()]
  if (opts.logoCommand && opts.logoCommand.length > 0) {
    parts.push(align('center'), opts.logoCommand, lf())
  }
  parts.push(align('center'))
  parts.push(fontSize({ bold: true, doubleHeight: true }))
  parts.push(text(truncate(opts.tenantName, cols)))
  parts.push(lf())
  parts.push(fontReset())
  parts.push(text('Tes Cetak'))
  parts.push(lf())
  parts.push(text(divider(cols)))
  parts.push(lf())
  parts.push(text(formatJakartaDateTime(new Date().toISOString())))
  parts.push(lf())
  parts.push(text(`Lebar kertas: ${opts.paperWidth}mm (${cols} kolom)`))
  parts.push(lf())
  parts.push(text(divider(cols)))
  parts.push(lf())
  parts.push(text('Printer terhubung - siap dipakai'))
  parts.push(lf())
  parts.push(feed(4))
  parts.push(cut())
  return concat(...parts)
}

// ─── helpers ──────────────────────────────────────────────────────

function formatRupiah(n: number): string {
  // Plain ASCII so no code-page switch needed. Matches the visual
  // format of `formatRupiah` in pos-receipt.ts but without the U+00A0
  // non-breaking space that Intl emits.
  const rounded = Math.round(n)
  const sign = rounded < 0 ? '-' : ''
  const abs = Math.abs(rounded).toString()
  const withSep = abs.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}Rp ${withSep}`
}

function formatIndo(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function formatJakartaDateTime(iso: string): string {
  // Use Intl with Asia/Jakarta TZ so a sale rung at 17:55 WIB prints
  // "17:55" not the cashier's UTC equivalent. The final .replace
  // strips the U+00A0 NBSP Intl emits between time components on
  // Android Chrome — our ASCII-only encoder would otherwise turn it
  // into a literal '?'.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(d)
    .replace(/ /g, ' ')
}

function divider(cols: number): string {
  return '-'.repeat(cols)
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max)
}

/**
 * Right-justify `right` against `cols`, with `left` on the left.
 * If they'd overlap, truncate `left` to fit.
 */
function padRight(left: string, right: string, cols: number): string {
  const gap = cols - left.length - right.length
  if (gap >= 1) return left + ' '.repeat(gap) + right
  // Truncate left to make room — keep right intact since it's the
  // money figure.
  const leftRoom = Math.max(0, cols - right.length - 1)
  return left.slice(0, leftRoom) + ' ' + right
}

/** Simple greedy word wrap at `cols` columns. */
function wrap(s: string, cols: number): string[] {
  const words = s.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (!cur) {
      cur = w.length > cols ? w.slice(0, cols) : w
      continue
    }
    if (cur.length + 1 + w.length <= cols) {
      cur += ' ' + w
    } else {
      lines.push(cur)
      cur = w.length > cols ? w.slice(0, cols) : w
    }
  }
  if (cur) lines.push(cur)
  return lines.length > 0 ? lines : ['']
}
