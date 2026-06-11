/**
 * Cashflow dashboard + P/L report + exports (JUR-159).
 *
 * Pure aggregation over the Phase 1–4 tables — no new schema. The
 * dashboard answers "is my business profitable this period"; the PDF
 * is a printable P/L statement; the CSV is the raw ledger for an
 * accountant's spreadsheet.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { jsPDF } from 'jspdf'
import { db } from '@vintra/db'
import {
  cashflowEntries,
  cashflowCategories,
  arReceivables,
  apPayables,
  apPayments,
  branches,
  tenants,
} from '@vintra/db/schema'
import { and, eq, gte, lte, sql, desc, inArray, type SQL } from 'drizzle-orm'
import { requireCashflowAccess } from '../middleware/module-access'
import { filterBranchesByAccess, branchScopeWhere } from '../lib/branch-scope'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const rangeInput = z.object({
  from: z.string().regex(DATE_RE),
  to: z.string().regex(DATE_RE),
  branchId: z.string().uuid().optional().nullable(),
})

function rupiah(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

/** The equal-length period immediately before [from, to]. */
function previousPeriod(from: string, to: string): { from: string; to: string } {
  const fromMs = new Date(`${from}T00:00:00Z`).getTime()
  const toMs = new Date(`${to}T00:00:00Z`).getTime()
  const lenDays = Math.round((toMs - fromMs) / 86_400_000) + 1
  const prevTo = new Date(fromMs - 86_400_000)
  const prevFrom = new Date(prevTo.getTime() - (lenDays - 1) * 86_400_000)
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  }
}

async function sumIncomeExpense(
  tenantId: string,
  from: string,
  to: string,
  branchCond: SQL | undefined,
): Promise<{ income: number; expense: number }> {
  const [row] = await db
    .select({
      income: sql<string>`COALESCE(SUM(CASE WHEN ${cashflowEntries.type} = 'income' THEN ${cashflowEntries.amount} ELSE 0 END), 0)`,
      expense: sql<string>`COALESCE(SUM(CASE WHEN ${cashflowEntries.type} = 'expense' THEN ${cashflowEntries.amount} ELSE 0 END), 0)`,
    })
    .from(cashflowEntries)
    .where(
      and(
        eq(cashflowEntries.tenantId, tenantId),
        gte(cashflowEntries.date, from),
        lte(cashflowEntries.date, to),
        branchCond,
      ),
    )
  return { income: Number(row?.income ?? 0), expense: Number(row?.expense ?? 0) }
}

// ─── Dashboard ───────────────────────────────────────────────────────

export const getCashflowDashboard = createServerFn({ method: 'POST' })
  .inputValidator(rangeInput)
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    // Combine the branchId filter with the hard franchisee scope so a
    // branch-restricted caller can never read beyond their branches.
    const branchCond = and(
      data.branchId
        ? eq(cashflowEntries.branchId, data.branchId)
        : undefined,
      branchScopeWhere(auth, cashflowEntries.branchId),
    )
    const where = and(
      eq(cashflowEntries.tenantId, auth.tenantId),
      gte(cashflowEntries.date, data.from),
      lte(cashflowEntries.date, data.to),
      branchCond,
    )

    const prev = previousPeriod(data.from, data.to)

    const [
      current,
      previous,
      byCategory,
      daily,
      arRow,
      apRow,
      branchRows,
      branchAgg,
    ] = await Promise.all([
        sumIncomeExpense(auth.tenantId, data.from, data.to, branchCond),
        sumIncomeExpense(auth.tenantId, prev.from, prev.to, branchCond),
        db
          .select({
            type: cashflowEntries.type,
            categoryName: cashflowCategories.name,
            total: sql<string>`COALESCE(SUM(${cashflowEntries.amount}), 0)`,
          })
          .from(cashflowEntries)
          .innerJoin(
            cashflowCategories,
            eq(cashflowCategories.id, cashflowEntries.categoryId),
          )
          .where(where)
          .groupBy(cashflowEntries.type, cashflowCategories.name)
          .orderBy(desc(sql`SUM(${cashflowEntries.amount})`)),
        db
          .select({
            date: cashflowEntries.date,
            income: sql<string>`COALESCE(SUM(CASE WHEN ${cashflowEntries.type} = 'income' THEN ${cashflowEntries.amount} ELSE 0 END), 0)`,
            expense: sql<string>`COALESCE(SUM(CASE WHEN ${cashflowEntries.type} = 'expense' THEN ${cashflowEntries.amount} ELSE 0 END), 0)`,
          })
          .from(cashflowEntries)
          .where(where)
          .groupBy(cashflowEntries.date)
          .orderBy(cashflowEntries.date),
        // Outstanding AR — point-in-time, tenant-wide (not period/branch).
        db
          .select({
            total: sql<string>`COALESCE(SUM(${arReceivables.amount} - ${arReceivables.paidAmount}), 0)`,
          })
          .from(arReceivables)
          .where(
            and(
              eq(arReceivables.tenantId, auth.tenantId),
              inArray(arReceivables.status, ['outstanding', 'partial']),
            ),
          ),
        // Outstanding AP — unpaid installments, tenant-wide.
        db
          .select({
            total: sql<string>`COALESCE(SUM(${apPayments.amount}), 0)`,
          })
          .from(apPayments)
          .innerJoin(apPayables, eq(apPayables.id, apPayments.payableId))
          .where(
            and(
              eq(apPayables.tenantId, auth.tenantId),
              sql`${apPayments.paidAt} IS NULL`,
            ),
          ),
        db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(
            and(
              eq(branches.tenantId, auth.tenantId),
              eq(branches.isActive, true),
            ),
          )
          .orderBy(branches.name),
        // Income/expense grouped per branch — feeds the multi-outlet
        // comparison chart shown when "Semua cabang" is selected.
        db
          .select({
            branchId: cashflowEntries.branchId,
            income: sql<string>`COALESCE(SUM(CASE WHEN ${cashflowEntries.type} = 'income' THEN ${cashflowEntries.amount} ELSE 0 END), 0)`,
            expense: sql<string>`COALESCE(SUM(CASE WHEN ${cashflowEntries.type} = 'expense' THEN ${cashflowEntries.amount} ELSE 0 END), 0)`,
          })
          .from(cashflowEntries)
          .where(where)
          .groupBy(cashflowEntries.branchId),
      ])

    const net = current.income - current.expense
    const prevNet = previous.income - previous.expense
    const outstandingAR = Number(arRow[0]?.total ?? 0)
    const outstandingAP = Number(apRow[0]?.total ?? 0)

    const incomeByCategory = byCategory
      .filter((r) => r.type === 'income')
      .map((r) => ({ name: r.categoryName, total: Number(r.total) }))
    const expenseByCategory = byCategory
      .filter((r) => r.type === 'expense')
      .map((r) => ({ name: r.categoryName, total: Number(r.total) }))

    // Resolve branch names for the per-branch comparison. Entries with a
    // null branchId (never assigned to an outlet) bucket into "Tanpa cabang".
    const branchNameById = new Map(branchRows.map((b) => [b.id, b.name]))
    const byBranch = branchAgg
      .map((r) => {
        const income = Number(r.income)
        const expense = Number(r.expense)
        return {
          branchId: r.branchId,
          name: r.branchId
            ? (branchNameById.get(r.branchId) ?? 'Cabang lain')
            : 'Tanpa cabang',
          income,
          expense,
          net: income - expense,
        }
      })
      .sort((a, b) => b.net - a.net)

    return {
      kpis: {
        income: current.income,
        expense: current.expense,
        net,
        prevIncome: previous.income,
        prevExpense: previous.expense,
        prevNet,
      },
      posisiKas: net + outstandingAR - outstandingAP,
      outstandingAR,
      outstandingAP,
      incomeByCategory,
      expenseByCategory,
      topExpenses: expenseByCategory.slice(0, 5),
      dailyTrend: daily.map((d) => ({
        date: d.date,
        income: Number(d.income),
        expense: Number(d.expense),
      })),
      branches: filterBranchesByAccess(auth, branchRows),
      byBranch,
    }
  })

// ─── CSV export ──────────────────────────────────────────────────────

function csvCell(value: string | number | null): string {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const getCashflowEntriesCsv = createServerFn({ method: 'POST' })
  .inputValidator(rangeInput)
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const rows = await db
      .select({
        date: cashflowEntries.date,
        type: cashflowEntries.type,
        categoryName: cashflowCategories.name,
        branchName: branches.name,
        amount: cashflowEntries.amount,
        source: cashflowEntries.source,
        note: cashflowEntries.note,
      })
      .from(cashflowEntries)
      .innerJoin(
        cashflowCategories,
        eq(cashflowCategories.id, cashflowEntries.categoryId),
      )
      .leftJoin(branches, eq(branches.id, cashflowEntries.branchId))
      .where(
        and(
          eq(cashflowEntries.tenantId, auth.tenantId),
          gte(cashflowEntries.date, data.from),
          lte(cashflowEntries.date, data.to),
          data.branchId
            ? eq(cashflowEntries.branchId, data.branchId)
            : undefined,
          branchScopeWhere(auth, cashflowEntries.branchId),
        ),
      )
      .orderBy(cashflowEntries.date)

    const header = [
      'Tanggal',
      'Tipe',
      'Kategori',
      'Cabang',
      'Jumlah',
      'Sumber',
      'Catatan',
    ]
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push(
        [
          csvCell(r.date),
          csvCell(r.type === 'income' ? 'Pemasukan' : 'Pengeluaran'),
          csvCell(r.categoryName),
          csvCell(r.branchName ?? ''),
          csvCell(Number(r.amount)),
          csvCell(r.source),
          csvCell(r.note ?? ''),
        ].join(','),
      )
    }
    return {
      csv: lines.join('\n'),
      fileName: `cashflow-${data.from}-${data.to}.csv`,
    }
  })

// ─── PDF P/L statement ───────────────────────────────────────────────

export const getCashflowPLReportPdf = createServerFn({ method: 'POST' })
  .inputValidator(rangeInput)
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const branchCond = and(
      data.branchId
        ? eq(cashflowEntries.branchId, data.branchId)
        : undefined,
      branchScopeWhere(auth, cashflowEntries.branchId),
    )
    const where = and(
      eq(cashflowEntries.tenantId, auth.tenantId),
      gte(cashflowEntries.date, data.from),
      lte(cashflowEntries.date, data.to),
      branchCond,
    )

    const [[tenant], byCategory] = await Promise.all([
      db
        .select({ name: tenants.businessName })
        .from(tenants)
        .where(eq(tenants.id, auth.tenantId))
        .limit(1),
      db
        .select({
          type: cashflowEntries.type,
          categoryName: cashflowCategories.name,
          total: sql<string>`COALESCE(SUM(${cashflowEntries.amount}), 0)`,
        })
        .from(cashflowEntries)
        .innerJoin(
          cashflowCategories,
          eq(cashflowCategories.id, cashflowEntries.categoryId),
        )
        .where(where)
        .groupBy(cashflowEntries.type, cashflowCategories.name)
        .orderBy(desc(sql`SUM(${cashflowEntries.amount})`)),
    ])

    let branchName = 'Semua cabang'
    if (data.branchId) {
      const [b] = await db
        .select({ name: branches.name })
        .from(branches)
        .where(eq(branches.id, data.branchId))
        .limit(1)
      branchName = b?.name ?? branchName
    }

    const income = byCategory.filter((r) => r.type === 'income')
    const expense = byCategory.filter((r) => r.type === 'expense')
    const incomeTotal = income.reduce((s, r) => s + Number(r.total), 0)
    const expenseTotal = expense.reduce((s, r) => s + Number(r.total), 0)

    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const left = 18
    let y = 22

    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text('Laporan Laba Rugi', left, y)
    y += 8
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(tenant?.name ?? 'Vintra', left, y)
    y += 5
    doc.text(`Periode: ${data.from} s/d ${data.to}`, left, y)
    y += 5
    doc.text(`Cabang: ${branchName}`, left, y)
    y += 10

    const right = 192
    function sectionRow(label: string, amount: number, bold = false) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.text(label, left, y)
      doc.text(rupiah(amount), right, y, { align: 'right' })
      y += 6
    }
    function heading(text: string) {
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text(text, left, y)
      y += 6
      doc.setFontSize(10)
    }

    heading('Pemasukan')
    if (income.length === 0) {
      doc.setFont('helvetica', 'italic')
      doc.text('Tidak ada pemasukan pada periode ini.', left, y)
      y += 6
    } else {
      for (const r of income) sectionRow(r.categoryName, Number(r.total))
    }
    sectionRow('Total Pemasukan', incomeTotal, true)
    y += 4

    heading('Pengeluaran')
    if (expense.length === 0) {
      doc.setFont('helvetica', 'italic')
      doc.text('Tidak ada pengeluaran pada periode ini.', left, y)
      y += 6
    } else {
      for (const r of expense) sectionRow(r.categoryName, Number(r.total))
    }
    sectionRow('Total Pengeluaran', expenseTotal, true)
    y += 4

    doc.setDrawColor(180)
    doc.line(left, y, right, y)
    y += 7
    doc.setFontSize(12)
    sectionRow('Laba Bersih', incomeTotal - expenseTotal, true)

    y += 12
    doc.setFontSize(8)
    doc.setFont('helvetica', 'italic')
    doc.text(
      `Dibuat oleh Vintra — ${new Date().toISOString().slice(0, 10)}`,
      left,
      y,
    )

    return {
      dataUrl: doc.output('datauristring'),
      fileName: `laba-rugi-${data.from}-${data.to}.pdf`,
    }
  })
