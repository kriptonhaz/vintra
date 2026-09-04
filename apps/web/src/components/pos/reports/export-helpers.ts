import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import { formatDate } from '@/lib/utils'

/**
 * Shared PDF chrome for every /pos/reports/* export. Draws title +
 * date range + tenant name at the top and a "Dicetak …" footer at
 * the bottom of the page. Returns the y-cursor the caller should
 * continue drawing from. Mirrors the pattern inlined in
 * reports.index.tsx so the four new report PDFs feel consistent.
 */
export function pdfHeader(
  doc: jsPDF,
  title: string,
  from: string,
  to: string,
  tenantName?: string,
): number {
  let y = 20
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(title, 20, y)
  y += 7
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`${from} → ${to}`, 20, y)
  y += 5
  if (tenantName) {
    doc.text(tenantName, 20, y)
    y += 5
  }
  return y + 4
}

/**
 * Stamp the "Dicetak …" footer and a page counter on EVERY page.
 *
 * Callers draw rows top-to-bottom and `addPage()` when they run past
 * the margin, then call this once at the end — which used to footer
 * only whichever page the cursor happened to be sitting on. That was
 * invisible while these reports fitted on one page; now that an export
 * carries the whole result set instead of the 25 rows on screen, a
 * Produk PDF can run to dozens, and a reader needs to know both where a
 * loose page came from and whether any are missing.
 */
export function pdfFooter(doc: jsPDF) {
  const printedAt = formatDate(new Date(), 'dd MMM yyyy, HH:mm')
  const pageCount = doc.getNumberOfPages()
  const current = doc.getCurrentPageInfo().pageNumber
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`Dicetak ${printedAt} • Vintra`, 105, 287, { align: 'center' })
    if (pageCount > 1) {
      doc.text(`Hal ${page} / ${pageCount}`, 190, 287, { align: 'right' })
    }
  }
  // Leave the cursor where the caller left it — this helper is not the
  // last thing every caller does.
  doc.setPage(current)
}

/** Trigger a browser download of a CSV blob. Quoting + escaping is
 *  the caller's responsibility — every report has its own column
 *  shape so a one-size-fits-all serializer would just add noise. */
export function downloadCsvBlob(rows: string[], filename: string) {
  const blob = new Blob([rows.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Save a jsPDF instance via a synthetic download link (matches the
 *  existing P&L report's mechanism — no jsPDF.save() since that
 *  prompts a native dialog on some browsers). */
export function downloadPdf(doc: jsPDF, filename: string) {
  const dataUrl = doc.output('datauristring')
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

/** CSV cell that may contain quotes/commas — wraps in double quotes
 *  and doubles any embedded quote. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Client-side XLSX builder. Each entry in `sheets` becomes one sheet
 * in the workbook — pass a 2D array of cell values, the first row
 * being headers. Column widths are auto-fitted to the longest value
 * (capped at 40 chars so a long URL doesn't blow the layout).
 *
 * Triggers a browser download directly. Matches the attendance
 * records download UX so callers don't have to author two paths.
 */
export function downloadXlsx(
  sheets: { name: string; rows: (string | number | null)[][] }[],
  filename: string,
) {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows)
    // Auto column widths — scan each column for its longest cell value.
    const widths = sheet.rows.reduce<number[]>((acc, row) => {
      row.forEach((cell, i) => {
        const len = cell == null ? 0 : String(cell).length
        acc[i] = Math.max(acc[i] ?? 0, Math.min(len, 40))
      })
      return acc
    }, [])
    ws['!cols'] = widths.map((wch) => ({ wch: Math.max(wch, 8) }))
    // Sheet names: 31-char max, no [ ] : / ? \ * — strip & truncate.
    const safe = sheet.name.replace(/[\[\]:/?\\*]/g, '').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safe)
  }
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
