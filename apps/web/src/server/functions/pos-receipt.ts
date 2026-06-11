import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { jsPDF } from 'jspdf'
import { db } from '@vintra/db'
import {
  posSales,
  posSaleItems,
  posSettings,
  branches,
  tenants,
  customerLoyaltyBalances,
} from '@vintra/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { requirePOSAccess } from '../middleware/module-access'
import { getPOSLogoSignedUrl } from '@/lib/s3-storage'
import { formatRupiah } from '@/lib/currency'
import type { PrinterSaleData } from '@/lib/escpos/render-receipt'

/**
 * Server-side PDF rendering. Two layouts:
 *   - thermal-80mm: narrow column, dot-matrix style. Default.
 *   - a4: full page, formal layout.
 *
 * Returns a base64 string (data URL prefix included) so the client can
 * drop it directly into an `<a href>` for download or open in a new tab
 * for print. Z-report uses the same library + helpers.
 */

function formatJakartaDateTime(d: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer Bank',
  card: 'Kartu',
  ewallet: 'E-Wallet',
}

interface SaleData {
  id: string
  saleNumber: string
  branchName: string
  tenantName: string
  customerName: string | null
  customerPhone: string | null
  subtotal: number
  discountType: string | null
  discountValue: number | null
  discountAmount: number
  /** JUR-9 sale-level promo snapshot. 0 = no promo. */
  promoAmount: number
  promoCodeSnapshot: string | null
  /** Sum of every tax line — back-compat for old receipts and totals. */
  taxAmount: number
  /** Legacy single label, used as fallback for pre-multi-tax sales. */
  taxLabel: string
  /**
   * Per-tax breakdown snapshot. Multi-tax (PPN + PB1 + service, etc).
   * Null/empty for sales rung before multi-tax shipped — receipt
   * falls back to a single line using `taxLabel` + `taxAmount`.
   */
  taxLines: Array<{ label: string; percent: number; amount: number }> | null
  total: number
  paymentMethod: string
  paidAmount: number
  changeAmount: number
  status: string
  createdAt: Date
  notes: string | null
  items: Array<{
    nameSnapshot: string
    qty: number
    unitPrice: number
    subtotal: number
    soldUnitLabel: string | null
    isBulkPrice: boolean
    /** JUR-7 per-line discount snapshot. 0 = no line discount. */
    lineDiscountAmount: number
    lineDiscountType: 'fixed' | 'percent' | null
    lineDiscountValue: number | null
    /** JUR-9 per-line auto-promo snapshot. 0 = no auto-promo. */
    autoPromoAmount: number
  }>
  receiptFooterText: string | null
  logoKey: string | null
  /** Loyalty snapshot per JUR-8. Null when the sale wasn't
   *  loyalty-eligible (no customer attached or feature off). */
  loyalty: {
    pointsEarned: number
    pointsRedeemed: number
    redeemAmount: number
    /** Current balance at receipt-render time. May differ from
     *  "balance immediately after this sale" if the customer has
     *  earned/redeemed on subsequent sales — receipts are usually
     *  printed at sale time so the gap is rare in practice. */
    currentBalance: number
  } | null
}

async function loadSale(saleId: string, tenantId: string): Promise<SaleData> {
  const [row] = await db
    .select({
      id: posSales.id,
      saleNumber: posSales.saleNumber,
      branchName: branches.name,
      tenantName: tenants.businessName,
      customerName: posSales.customerName,
      customerPhone: posSales.customerPhone,
      customerId: posSales.customerId,
      subtotal: posSales.subtotal,
      discountType: posSales.discountType,
      discountValue: posSales.discountValue,
      discountAmount: posSales.discountAmount,
      taxAmount: posSales.taxAmount,
      taxLines: posSales.taxLines,
      total: posSales.total,
      paymentMethod: posSales.paymentMethod,
      paidAmount: posSales.paidAmount,
      changeAmount: posSales.changeAmount,
      status: posSales.status,
      createdAt: posSales.createdAt,
      notes: posSales.notes,
      taxLabel: posSettings.taxLabel,
      // Per-branch override wins; tenant default fills in when null.
      // Multi-outlet tenants set branch-specific addresses + logos
      // here without losing the tenant-wide fallback for the rest.
      receiptFooterText: sql<string | null>`COALESCE(${branches.receiptFooterText}, ${posSettings.receiptFooterText})`,
      logoKey: sql<string | null>`COALESCE(${branches.receiptLogoKey}, ${posSettings.receiptLogoKey})`,
      loyaltyPointsEarned: posSales.loyaltyPointsEarned,
      loyaltyPointsRedeemed: posSales.loyaltyPointsRedeemed,
      loyaltyRedeemAmount: posSales.loyaltyRedeemAmount,
      promoCodeSnapshot: posSales.promoCodeSnapshot,
      promoAmount: posSales.promoAmount,
    })
    .from(posSales)
    .innerJoin(branches, eq(branches.id, posSales.branchId))
    .innerJoin(tenants, eq(tenants.id, posSales.tenantId))
    .leftJoin(posSettings, eq(posSettings.tenantId, posSales.tenantId))
    .where(and(eq(posSales.id, saleId), eq(posSales.tenantId, tenantId)))
    .limit(1)
  if (!row) throw new Error('Transaksi tidak ditemukan')

  // Loyalty snapshot — only when this sale recorded earn/redeem AND
  // there's a customer to draw a current balance from. Reading the
  // balance at render-time is good-enough for receipts since they're
  // usually printed within seconds of the sale.
  const earned = Number(row.loyaltyPointsEarned ?? 0)
  const redeemed = Number(row.loyaltyPointsRedeemed ?? 0)
  let loyalty: SaleData['loyalty'] = null
  if (row.customerId && (earned > 0 || redeemed > 0)) {
    const [bal] = await db
      .select({ pointsBalance: customerLoyaltyBalances.pointsBalance })
      .from(customerLoyaltyBalances)
      .where(eq(customerLoyaltyBalances.customerId, row.customerId))
      .limit(1)
    loyalty = {
      pointsEarned: earned,
      pointsRedeemed: redeemed,
      redeemAmount: Number(row.loyaltyRedeemAmount ?? 0),
      currentBalance: Number(bal?.pointsBalance ?? 0),
    }
  }

  const items = await db
    .select({
      nameSnapshot: posSaleItems.nameSnapshot,
      qty: posSaleItems.qty,
      unitPrice: posSaleItems.unitPrice,
      subtotal: posSaleItems.subtotal,
      soldUnitLabel: posSaleItems.soldUnitLabel,
      isBulkPrice: posSaleItems.isBulkPrice,
      lineDiscountAmount: posSaleItems.lineDiscountAmount,
      lineDiscountType: posSaleItems.lineDiscountType,
      lineDiscountValue: posSaleItems.lineDiscountValue,
      autoPromoAmount: posSaleItems.autoPromoAmount,
    })
    .from(posSaleItems)
    .where(eq(posSaleItems.saleId, saleId))
    .orderBy(posSaleItems.createdAt)

  return {
    id: row.id,
    saleNumber: row.saleNumber,
    branchName: row.branchName,
    tenantName: row.tenantName,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    subtotal: Number(row.subtotal),
    discountType: row.discountType,
    discountValue: row.discountValue ? Number(row.discountValue) : null,
    discountAmount: Number(row.discountAmount),
    promoAmount: row.promoAmount != null ? Number(row.promoAmount) : 0,
    promoCodeSnapshot: row.promoCodeSnapshot,
    taxAmount: Number(row.taxAmount),
    taxLabel: row.taxLabel ?? 'PPN',
    taxLines: (row.taxLines as
      | Array<{ label: string; percent: number; amount: number }>
      | null) ?? null,
    total: Number(row.total),
    paymentMethod: row.paymentMethod,
    paidAmount: Number(row.paidAmount),
    changeAmount: Number(row.changeAmount),
    status: row.status,
    createdAt: row.createdAt,
    notes: row.notes,
    receiptFooterText: row.receiptFooterText,
    logoKey: row.logoKey,
    loyalty,
    items: items.map((i) => ({
      nameSnapshot: i.nameSnapshot,
      qty: Number(i.qty),
      unitPrice: Number(i.unitPrice),
      subtotal: Number(i.subtotal),
      soldUnitLabel: i.soldUnitLabel,
      isBulkPrice: i.isBulkPrice,
      lineDiscountAmount: Number(i.lineDiscountAmount ?? 0),
      lineDiscountType: (i.lineDiscountType ?? null) as
        | 'fixed'
        | 'percent'
        | null,
      lineDiscountValue:
        i.lineDiscountValue != null ? Number(i.lineDiscountValue) : null,
      autoPromoAmount: Number(i.autoPromoAmount ?? 0),
    })),
  }
}

/**
 * Thermal 80mm receipt. jsPDF unit = mm. Width = 80mm; height auto-grows
 * to fit content. Font kept small + monospaced-ish for receipt feel.
 */
function renderThermalReceipt(
  doc: jsPDF,
  sale: SaleData,
  logoBase64: string | null,
): void {
  const W = 80
  let y = 6

  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', (W - 30) / 2, y, 30, 15, undefined, 'FAST')
      y += 17
    } catch {
      // Skip logo on render error.
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(sale.tenantName, W / 2, y, { align: 'center' })
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(sale.branchName, W / 2, y, { align: 'center' })
  y += 4
  doc.text('-'.repeat(40), W / 2, y, { align: 'center' })
  y += 4

  doc.text(`No : ${sale.saleNumber}`, 4, y)
  y += 3.5
  doc.text(`Tgl: ${formatJakartaDateTime(sale.createdAt)}`, 4, y)
  y += 3.5
  if (sale.customerName) {
    doc.text(`Pelanggan: ${sale.customerName}`, 4, y)
    y += 3.5
  }
  doc.text('-'.repeat(40), W / 2, y, { align: 'center' })
  y += 4

  // Items — "@ Rp X / unit", with grosir badge on bulk-priced lines.
  // Line-discount (JUR-7) gets a small "(diskon -Rp X)" hint under
  // the qty row when applied; subtotal column already reflects the
  // post-discount value.
  doc.setFontSize(8)
  for (const item of sale.items) {
    const nameLine = item.isBulkPrice
      ? `${item.nameSnapshot} (grosir)`
      : item.nameSnapshot
    doc.text(nameLine, 4, y, { maxWidth: W - 8 })
    y += 3.5
    const unitSuffix = item.soldUnitLabel ? ` ${item.soldUnitLabel}` : ''
    const qtyStr = `${item.qty}${unitSuffix} x ${formatRupiah(item.unitPrice)}`
    doc.text(qtyStr, 4, y)
    doc.text(formatRupiah(item.subtotal), W - 4, y, { align: 'right' })
    y += 3.5
    if (item.lineDiscountAmount > 0) {
      const dLabel =
        item.lineDiscountType === 'percent' && item.lineDiscountValue != null
          ? `Diskon item ${item.lineDiscountValue}%`
          : 'Diskon item'
      doc.text(
        `  ${dLabel}: -${formatRupiah(item.lineDiscountAmount)}`,
        4,
        y,
      )
      y += 3.5
    } else {
      // Maintain spacing between lines whether or not the discount
      // hint rendered.
      y += 0.5
    }
  }

  doc.text('-'.repeat(40), W / 2, y, { align: 'center' })
  y += 4

  doc.text('Subtotal', 4, y)
  doc.text(formatRupiah(sale.subtotal), W - 4, y, { align: 'right' })
  y += 3.5

  if (sale.discountAmount > 0) {
    const dLabel =
      sale.discountType === 'percent'
        ? `Diskon ${sale.discountValue}%`
        : 'Diskon'
    doc.text(dLabel, 4, y)
    doc.text(`-${formatRupiah(sale.discountAmount)}`, W - 4, y, {
      align: 'right',
    })
    y += 3.5
  }
  if (sale.promoAmount > 0) {
    const label = sale.promoCodeSnapshot
      ? `Promo "${sale.promoCodeSnapshot}"`
      : 'Promo'
    doc.text(label, 4, y, { maxWidth: W - 30 })
    doc.text(`-${formatRupiah(sale.promoAmount)}`, W - 4, y, { align: 'right' })
    y += 3.5
  }
  // Multi-tax breakdown — one line per active tax row. Pre-multi-tax
  // sales fall back to the single legacy label.
  const thermalTaxLines =
    sale.taxLines && sale.taxLines.length > 0
      ? sale.taxLines
      : sale.taxAmount > 0
        ? [{ label: sale.taxLabel, percent: 0, amount: sale.taxAmount }]
        : []
  for (const t of thermalTaxLines) {
    if (t.amount <= 0) continue
    const lbl = t.percent > 0 ? `${t.label} ${t.percent}%` : t.label
    doc.text(lbl, 4, y)
    doc.text(formatRupiah(t.amount), W - 4, y, { align: 'right' })
    y += 3.5
  }

  doc.setFont('helvetica', 'bold')
  doc.text('TOTAL', 4, y)
  doc.text(formatRupiah(sale.total), W - 4, y, { align: 'right' })
  y += 4
  doc.setFont('helvetica', 'normal')

  doc.text(
    `Bayar (${PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod})`,
    4,
    y,
  )
  doc.text(formatRupiah(sale.paidAmount), W - 4, y, { align: 'right' })
  y += 3.5
  if (sale.changeAmount > 0) {
    doc.text('Kembalian', 4, y)
    doc.text(formatRupiah(sale.changeAmount), W - 4, y, { align: 'right' })
    y += 3.5
  }

  if (sale.status === 'voided') {
    y += 3
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('** DIBATALKAN **', W / 2, y, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    y += 4
  }

  y += 4
  doc.text('-'.repeat(40), W / 2, y, { align: 'center' })
  y += 4

  // Loyalty footer (JUR-8). Compact two-line block when the sale had
  // earn/redeem activity. We deliberately don't show "Poin sebelumnya"
  // because reconstructing pre-sale balance requires reading the
  // ledger; receipts at sale-time make "Saldo sekarang" close enough.
  if (sale.loyalty) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    if (sale.loyalty.pointsRedeemed > 0) {
      doc.text(
        `Tukar poin: ${sale.loyalty.pointsRedeemed.toLocaleString('id-ID')} (${formatRupiah(sale.loyalty.redeemAmount)})`,
        W / 2,
        y,
        { align: 'center' },
      )
      y += 3.5
    }
    if (sale.loyalty.pointsEarned > 0) {
      doc.text(
        `Dapat poin: +${sale.loyalty.pointsEarned.toLocaleString('id-ID')}`,
        W / 2,
        y,
        { align: 'center' },
      )
      y += 3.5
    }
    doc.text(
      `Saldo: ${sale.loyalty.currentBalance.toLocaleString('id-ID')} poin`,
      W / 2,
      y,
      { align: 'center' },
    )
    y += 3.5
    doc.text('-'.repeat(40), W / 2, y, { align: 'center' })
    y += 4
  }

  doc.text('Terima kasih atas kunjungan Anda', W / 2, y, { align: 'center' })
  y += 3.5
  if (sale.receiptFooterText) {
    const wrapped = doc.splitTextToSize(sale.receiptFooterText, W - 8)
    doc.text(wrapped, W / 2, y, { align: 'center' })
    y += (wrapped as string[]).length * 3.5
  } else {
    doc.setFontSize(7)
    doc.text('Dibuat dengan Vintra — vintra.my.id', W / 2, y, {
      align: 'center',
    })
    y += 3
  }
}

/** A4 layout — formal, branded receipt. */
function renderA4Receipt(
  doc: jsPDF,
  sale: SaleData,
  logoBase64: string | null,
): void {
  let y = 20

  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', 160, 10, 35, 18, undefined, 'FAST')
    } catch {
      /* skip */
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(sale.tenantName, 20, y)
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(sale.branchName, 20, y)
  y += 5
  doc.text(`No: ${sale.saleNumber}`, 20, y)
  y += 5
  doc.text(`Tgl: ${formatJakartaDateTime(sale.createdAt)}`, 20, y)
  y += 5
  if (sale.customerName) {
    doc.text(`Pelanggan: ${sale.customerName}`, 20, y)
    y += 5
  }

  y += 5
  doc.setFont('helvetica', 'bold')
  doc.text('Item', 20, y)
  doc.text('Qty', 110, y)
  doc.text('Harga', 130, y, { align: 'right' })
  doc.text('Subtotal', 190, y, { align: 'right' })
  y += 2
  doc.line(20, y, 190, y)
  y += 5
  doc.setFont('helvetica', 'normal')

  for (const item of sale.items) {
    const nameLine = item.isBulkPrice
      ? `${item.nameSnapshot} · grosir`
      : item.nameSnapshot
    doc.text(nameLine, 20, y, { maxWidth: 85 })
    const qtyStr = item.soldUnitLabel
      ? `${item.qty} ${item.soldUnitLabel}`
      : String(item.qty)
    doc.text(qtyStr, 110, y)
    doc.text(formatRupiah(item.unitPrice), 130, y, { align: 'right' })
    doc.text(formatRupiah(item.subtotal), 190, y, { align: 'right' })
    y += 6
  }

  y += 2
  doc.line(20, y, 190, y)
  y += 6

  doc.text('Subtotal', 130, y, { align: 'right' })
  doc.text(formatRupiah(sale.subtotal), 190, y, { align: 'right' })
  y += 5

  if (sale.discountAmount > 0) {
    const dLabel =
      sale.discountType === 'percent'
        ? `Diskon ${sale.discountValue}%`
        : 'Diskon'
    doc.text(dLabel, 130, y, { align: 'right' })
    doc.text(`-${formatRupiah(sale.discountAmount)}`, 190, y, { align: 'right' })
    y += 5
  }
  if (sale.promoAmount > 0) {
    const label = sale.promoCodeSnapshot
      ? `Promo "${sale.promoCodeSnapshot}"`
      : 'Promo'
    doc.text(label, 130, y, { align: 'right' })
    doc.text(`-${formatRupiah(sale.promoAmount)}`, 190, y, { align: 'right' })
    y += 5
  }
  // Multi-tax breakdown — same fallback as the thermal layout.
  const a4TaxLines =
    sale.taxLines && sale.taxLines.length > 0
      ? sale.taxLines
      : sale.taxAmount > 0
        ? [{ label: sale.taxLabel, percent: 0, amount: sale.taxAmount }]
        : []
  for (const t of a4TaxLines) {
    if (t.amount <= 0) continue
    const lbl = t.percent > 0 ? `${t.label} ${t.percent}%` : t.label
    doc.text(lbl, 130, y, { align: 'right' })
    doc.text(formatRupiah(t.amount), 190, y, { align: 'right' })
    y += 5
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('TOTAL', 130, y, { align: 'right' })
  doc.text(formatRupiah(sale.total), 190, y, { align: 'right' })
  y += 8
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)

  doc.text(
    `Bayar (${PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod})`,
    130,
    y,
    { align: 'right' },
  )
  doc.text(formatRupiah(sale.paidAmount), 190, y, { align: 'right' })
  y += 5
  if (sale.changeAmount > 0) {
    doc.text('Kembalian', 130, y, { align: 'right' })
    doc.text(formatRupiah(sale.changeAmount), 190, y, { align: 'right' })
    y += 5
  }

  if (sale.status === 'voided') {
    y += 6
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('** DIBATALKAN **', 105, y, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
  }

  // Loyalty footer (A4) — same shape as the thermal layout, just
  // formatted for the wider page.
  if (sale.loyalty) {
    y += 8
    doc.setFontSize(10)
    if (sale.loyalty.pointsRedeemed > 0) {
      doc.text(
        `Tukar poin: ${sale.loyalty.pointsRedeemed.toLocaleString('id-ID')} (${formatRupiah(sale.loyalty.redeemAmount)})`,
        20,
        y,
      )
      y += 5
    }
    if (sale.loyalty.pointsEarned > 0) {
      doc.text(
        `Diperoleh: +${sale.loyalty.pointsEarned.toLocaleString('id-ID')} poin`,
        20,
        y,
      )
      y += 5
    }
    doc.text(
      `Saldo poin: ${sale.loyalty.currentBalance.toLocaleString('id-ID')}`,
      20,
      y,
    )
  }

  y = 270
  doc.line(20, y, 190, y)
  y += 6
  if (sale.receiptFooterText) {
    doc.text(sale.receiptFooterText, 105, y, { align: 'center' })
  } else {
    doc.setFontSize(8)
    doc.text('Dibuat dengan Vintra — vintra.my.id', 105, y, {
      align: 'center',
    })
  }
}

async function fetchLogoBase64(logoKey: string | null): Promise<string | null> {
  if (!logoKey) return null
  try {
    const url = await getPOSLogoSignedUrl(logoKey, 60)
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const mimeType = res.headers.get('content-type') ?? 'image/png'
    return `data:${mimeType};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Render + return base64 PDF for a sale receipt. Default = thermal 80mm;
 * caller can request 'a4' for a wider format.
 */
export const getSaleReceiptPDF = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      layout: z.enum(['thermal-80mm', 'a4']).optional().default('thermal-80mm'),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    const sale = await loadSale(data.id, auth.tenantId)
    const logo = await fetchLogoBase64(sale.logoKey)

    let doc: jsPDF
    if (data.layout === 'a4') {
      doc = new jsPDF({ unit: 'mm', format: 'a4' })
      renderA4Receipt(doc, sale, logo)
    } else {
      // 80mm thermal: width 80mm, length grows. jsPDF needs an explicit
      // page size — use 80x300 and trust auto-page-add for very long
      // receipts (rare in MVP).
      doc = new jsPDF({ unit: 'mm', format: [80, 300] })
      renderThermalReceipt(doc, sale, logo)
    }

    const base64 = doc.output('datauristring')
    return { dataUrl: base64, fileName: `Struk-${sale.saleNumber}.pdf` }
  })

// `getSaleReceiptShareUrl` (S3-uploaded PDF for WhatsApp linking) was
// removed by request: most customers don't open the link, and the
// uploads bloat S3 with files nobody reads. WhatsApp share now sends a
// text-only summary; users can manually attach the downloaded PDF if
// they really need to ship it.

/**
 * JSON sale payload for the client-side ESC/POS thermal renderer
 * (JUR-12). Same data the PDF renderer consumes, but as JSON so the
 * browser can build the byte stream and push it over Web Bluetooth
 * to a paired thermal printer. Logo arrives as a base64 data URL —
 * the client dithers it to 1-bit before emitting `GS v 0` raster.
 *
 * `logoKey` (the raw S3 object key) is intentionally NOT returned;
 * the tenant's storage layout stays server-side.
 */
export const getSaleDataForPrinter = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<PrinterSaleData> => {
    const auth = await requirePOSAccess()
    const sale = await loadSale(data.id, auth.tenantId)
    const logoDataUrl = await fetchLogoBase64(sale.logoKey)
    // Drop logoKey from the shape and add the data URL; convert the
    // Date to ISO so it survives JSON serialization across the
    // server-function boundary.
    const { logoKey: _logoKey, createdAt, ...rest } = sale
    return {
      ...rest,
      createdAt: createdAt.toISOString(),
      logoDataUrl,
    }
  })

/**
 * Z-report PDF — daily summary by payment method + top items. Toko+.
 * Reuses the A4 renderer style but simpler content.
 */
export const getDailyZReportPDF = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      branchId: z.string().uuid().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    // Re-query using the public function so the tier check stays in one
    // place. Avoids drift between PDF + JSON variants.
    // Inline impl for simplicity — duplicate the few SQL calls here.
    const startUtc = `${data.date}T00:00:00+07:00`
    const endUtc = `${data.date}T23:59:59+07:00`

    const [tenant] = await db
      .select({ businessName: tenants.businessName })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    let branchName = 'Semua Cabang'
    if (data.branchId) {
      const [b] = await db
        .select({ name: branches.name })
        .from(branches)
        .where(eq(branches.id, data.branchId))
        .limit(1)
      if (b) branchName = b.name
    }

    // Re-fetch by calling the JSON version (would be cleaner) — but for
    // simplicity inline. Mirror the cron query.
    const totalsRow = await db.execute<{
      sales_count: number
      voided_count: number
      total_revenue: number | null
    }>(
      // sql template literal via drizzle's `sql`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import('drizzle-orm')).sql`
      SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int AS sales_count,
        SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END)::int AS voided_count,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total::numeric ELSE 0 END), 0) AS total_revenue
      FROM pos_sales
      WHERE tenant_id = ${auth.tenantId}
        AND created_at >= ${startUtc}::timestamptz
        AND created_at <= ${endUtc}::timestamptz
        ${data.branchId ? (await import('drizzle-orm')).sql`AND branch_id = ${data.branchId}` : (await import('drizzle-orm')).sql``}
    `,
    )
    const totals = totalsRow[0]

    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    let y = 20
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(`Z-Report ${data.date}`, 105, y, { align: 'center' })
    y += 7
    doc.setFontSize(11)
    doc.text(tenant.businessName, 105, y, { align: 'center' })
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(branchName, 105, y, { align: 'center' })
    y += 10

    doc.setFont('helvetica', 'bold')
    doc.text('Ringkasan', 20, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.text(`Transaksi selesai: ${Number(totals?.sales_count ?? 0)}`, 20, y)
    y += 5
    doc.text(`Transaksi dibatalkan: ${Number(totals?.voided_count ?? 0)}`, 20, y)
    y += 5
    doc.text(`Total pendapatan: ${formatRupiah(Number(totals?.total_revenue ?? 0))}`, 20, y)
    y += 12

    doc.setFontSize(8)
    doc.text(
      `Dicetak ${formatJakartaDateTime(new Date())} • Vintra`,
      105,
      287,
      { align: 'center' },
    )

    const dataUrl = doc.output('datauristring')
    return { dataUrl, fileName: `Z-Report-${data.date}.pdf` }
  })
