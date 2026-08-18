/**
 * Vintra AI (Sultan tier) — read-only business Q&A chat assistant.
 *
 * One server fn, no persistence: the client sends the full message
 * history each turn and gets one assistant reply back. The model is
 * grounded exclusively through TOOLS that wrap existing report server
 * functions — every tool call re-enters those functions in-process, so
 * tenant scoping, branch scoping, and RBAC are enforced by the exact
 * same code paths the report pages use. The AI has no other data access
 * and no write path.
 *
 * Provider = the platform default text capability (ai_provider_configs),
 * same resolution the Go WA auto-reply uses. Usage is metered into
 * ai_usage_logs (feature 'business_ai') and capped per tenant per day.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { tenants, branches, aiUsageLogs } from '@vintra/db/schema'
import { and, eq, gte, sql } from 'drizzle-orm'
import { requireBusinessAiAccess } from '../middleware/module-access'
import {
  getDefaultTextProvider,
  computeTextCostUsd,
} from '../lib/ai-text-provider'
import {
  chatComplete,
  type ChatMessage,
  type ToolDef,
} from '../lib/ai-chat'
import { getPOSReport } from './pos'
import { getPOSSalesByProduct } from './pos-reports'
import { getCashflowDashboard } from './cashflow-dashboard'
import { getCashflowTodaySummary } from './cashflow'
import { getInventoryOverview, listInventoryItems } from './inventory'
import { getAttendanceTodayOverview } from './attendance-checkin'
import { getHppReport } from './hpp'

const DAILY_CAP = 50
const MAX_TOOL_ITERATIONS = 4
const TOOL_RESULT_MAX_CHARS = 8_000
const TOOL_ARRAY_CAP = 20

// ─── Input ───────────────────────────────────────────────────────────

const askInput = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(30)
    .refine((msgs) => msgs[msgs.length - 1]!.role === 'user', {
      message: 'Pesan terakhir harus dari pengguna.',
    }),
})

// ─── Tool registry ───────────────────────────────────────────────────

const DATE_PARAM = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: 'Tanggal format YYYY-MM-DD (zona waktu Asia/Jakarta)',
}
const BRANCH_PARAM = {
  type: 'string',
  description:
    'UUID cabang (opsional). Ambil dari daftar cabang di konteks. Kosongkan untuk semua cabang.',
}

interface AiTool extends ToolDef {
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

/**
 * Every execute() calls an existing server fn IN-PROCESS with the same
 * request context, so requirePermission / branch scoping inside them
 * still applies to the chatting user. Failures surface back to the
 * model as tool errors, not 500s.
 */
const TOOLS: AiTool[] = [
  {
    name: 'get_sales_report',
    description:
      'Laporan penjualan POS untuk rentang tanggal: total omset (revenue), jumlah transaksi, HPP, margin, produk terlaris (topByQty/topByRevenue), breakdown per metode pembayaran dan per kasir. Gunakan untuk pertanyaan omset, penjualan, dan barang paling laku.',
    parameters: {
      type: 'object',
      properties: { from: DATE_PARAM, to: DATE_PARAM, branchId: BRANCH_PARAM },
      required: ['from', 'to'],
    },
    execute: (args) =>
      getPOSReport({
        data: {
          from: String(args.from ?? ''),
          to: String(args.to ?? ''),
          ...(args.branchId ? { branchId: String(args.branchId) } : {}),
        },
      }),
  },
  {
    name: 'get_sales_by_product',
    description:
      'Breakdown penjualan per produk (qty terjual, omset, margin per item) untuk rentang tanggal, bisa diurutkan. Gunakan saat butuh daftar produk terlaris yang lebih detail dari get_sales_report.',
    parameters: {
      type: 'object',
      properties: {
        from: DATE_PARAM,
        to: DATE_PARAM,
        branchId: BRANCH_PARAM,
        sortBy: {
          type: 'string',
          enum: ['revenue', 'qty', 'salesCount', 'margin', 'name'],
          description: 'Urutkan berdasarkan (default revenue)',
        },
      },
      required: ['from', 'to'],
    },
    execute: (args) =>
      getPOSSalesByProduct({
        data: {
          from: String(args.from ?? ''),
          to: String(args.to ?? ''),
          ...(args.branchId ? { branchId: String(args.branchId) } : {}),
          sortBy: (args.sortBy as never) ?? 'revenue',
          sortDir: 'desc',
          page: 1,
          pageSize: TOOL_ARRAY_CAP,
        },
      }),
  },
  {
    name: 'get_cashflow_dashboard',
    description:
      'Ringkasan arus kas untuk rentang tanggal: pemasukan, pengeluaran, laba bersih (net), posisi kas, piutang/hutang, pengeluaran terbesar, dan perbandingan antar cabang (byBranch). Gunakan untuk pertanyaan untung/rugi, pengeluaran, dan cabang mana paling untung.',
    parameters: {
      type: 'object',
      properties: { from: DATE_PARAM, to: DATE_PARAM, branchId: BRANCH_PARAM },
      required: ['from', 'to'],
    },
    execute: (args) =>
      getCashflowDashboard({
        data: {
          from: String(args.from ?? ''),
          to: String(args.to ?? ''),
          ...(args.branchId ? { branchId: String(args.branchId) } : {}),
        },
      }),
  },
  {
    name: 'get_cashflow_today',
    description:
      'Ringkasan kas hari ini saja: total pemasukan, pengeluaran, dan selisihnya. Cara tercepat menjawab "kas hari ini".',
    parameters: { type: 'object', properties: {} },
    execute: () => getCashflowTodaySummary(),
  },
  {
    name: 'get_inventory_overview',
    description:
      'Ringkasan stok/inventory: jumlah item aktif, jumlah item stok menipis (low stock), nilai stok dalam Rupiah. Set lowStockOnly=true untuk mendapat DAFTAR NAMA item yang stoknya menipis.',
    parameters: {
      type: 'object',
      properties: {
        branchId: BRANCH_PARAM,
        lowStockOnly: {
          type: 'boolean',
          description: 'true = kembalikan daftar item yang stoknya menipis',
        },
      },
    },
    execute: async (args) => {
      const overview = await getInventoryOverview({
        data: args.branchId ? { branchId: String(args.branchId) } : {},
      })
      if (!args.lowStockOnly) return overview
      const items = await listInventoryItems({
        data: {
          ...(args.branchId ? { branchId: String(args.branchId) } : {}),
          lowStockOnly: true,
          page: 1,
          pageSize: TOOL_ARRAY_CAP,
        },
      })
      return { overview: overview.usage, lowStockItems: items }
    },
  },
  {
    name: 'get_attendance_today',
    description:
      'Kehadiran karyawan hari ini: berapa yang sudah hadir dari total staf aktif. Gunakan untuk pertanyaan absensi/kehadiran.',
    parameters: { type: 'object', properties: {} },
    execute: () => getAttendanceTodayOverview(),
  },
  {
    name: 'get_hpp_margins',
    description:
      'Daftar produk dengan HPP, harga jual, dan margin masing-masing. Gunakan untuk pertanyaan margin produk, produk paling/kurang menguntungkan per unit, dan biaya bahan.',
    parameters: { type: 'object', properties: {} },
    execute: () => getHppReport(),
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────

/** Recursively cap arrays so big report payloads don't blow the context. */
function capArrays(value: unknown, depth = 0): unknown {
  if (depth > 6) return value
  if (Array.isArray(value)) {
    return value.slice(0, TOOL_ARRAY_CAP).map((v) => capArrays(v, depth + 1))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = capArrays(v, depth + 1)
    }
    return out
  }
  return value
}

function serializeToolResult(result: unknown): string {
  const json = JSON.stringify(capArrays(result))
  return json.length > TOOL_RESULT_MAX_CHARS
    ? json.slice(0, TOOL_RESULT_MAX_CHARS) + '…(dipotong)'
    : json
}

function toolErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'Forbidden' || /permission|akses/i.test(msg)) {
    return 'Pengguna ini tidak punya akses ke data tersebut.'
  }
  // Zod/validation and gate messages are already user-safe Indonesian;
  // anything else gets trimmed so provider/DB internals never leak.
  return msg.slice(0, 200)
}

/** YYYY-MM-DD for "now" in Asia/Jakarta. */
function todayJakarta(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
  }).format(new Date())
}

function buildSystemPrompt(input: {
  businessName: string
  businessCategory: string | null
  branchList: Array<{ id: string; name: string }>
}): string {
  const today = todayJakarta()
  const longToday = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'full',
  }).format(new Date())
  const branchLines = input.branchList
    .map((b) => `- ${b.name}: ${b.id}`)
    .join('\n')

  return [
    `Kamu adalah Vintra AI, asisten bisnis untuk "${input.businessName}"${input.businessCategory ? ` (kategori: ${input.businessCategory})` : ''} di platform Vintra.`,
    ``,
    `Hari ini: ${longToday} (${today}, zona waktu Asia/Jakarta).`,
    ``,
    `Daftar cabang (nama: id):`,
    branchLines || '- (hanya satu lokasi utama)',
    ``,
    `Aturan:`,
    `1. Jawab SELALU dalam Bahasa Indonesia yang santai tapi profesional.`,
    `2. Kamu HANYA menjawab pertanyaan tentang data bisnis ini (penjualan, stok, kas, absensi, HPP). Tolak pertanyaan di luar itu dengan sopan.`,
    `3. JANGAN PERNAH mengarang angka. Selalu panggil tool untuk mengambil data sebelum menjawab pertanyaan tentang angka.`,
    `4. Tanggal untuk tool: format YYYY-MM-DD, parameter "to" bersifat inklusif. "Hari ini" = ${today}. "Bulan ini" = tanggal 1 bulan berjalan sampai ${today}.`,
    `5. Jika pengguna menyebut nama cabang, cocokkan dengan daftar cabang di atas dan pakai id-nya. Jika nama tidak cocok, tanyakan balik.`,
    `6. Format uang: Rp 1.234.567 (titik sebagai pemisah ribuan, tanpa desimal).`,
    `7. Jika tool mengembalikan error akses, sampaikan bahwa pengguna tidak punya akses ke data itu — jangan mencoba tool lain untuk menyiasatinya.`,
    `8. Jawab ringkas: angka utama dulu, lalu 1-2 kalimat konteks. Gunakan bullet hanya jika membandingkan beberapa item.`,
  ].join('\n')
}

// ─── The server fn ───────────────────────────────────────────────────

export const askBusinessAi = createServerFn({ method: 'POST' })
  .inputValidator(askInput)
  .handler(async ({ data }) => {
    const auth = await requireBusinessAiAccess()
    const startedAt = Date.now()

    // Daily cost cap — count ALL log rows (success + error) for today
    // WIB so retries and failures still bound spend.
    const dayStartUtc = new Date(`${todayJakarta()}T00:00:00+07:00`)
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiUsageLogs)
      .where(
        and(
          eq(aiUsageLogs.tenantId, auth.tenantId),
          eq(aiUsageLogs.feature, 'business_ai'),
          gte(aiUsageLogs.createdAt, dayStartUtc),
        ),
      )
    const count = countRow?.count ?? 0
    if (count >= DAILY_CAP) {
      throw new Error(
        `Batas ${DAILY_CAP} pertanyaan per hari tercapai. Coba lagi besok.`,
      )
    }

    const provider = await getDefaultTextProvider()
    if (!provider) {
      throw new Error('Provider AI belum dikonfigurasi. Hubungi admin Vintra.')
    }

    // Prompt grounding: business identity + branch name→id map.
    const [tenant] = await db
      .select({
        businessName: tenants.businessName,
        businessCategory: tenants.businessCategory,
      })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1)
    const branchRows = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(
        and(eq(branches.tenantId, auth.tenantId), eq(branches.isActive, true)),
      )
    // Members restricted to specific branches only see those in the
    // prompt — keeps the model from offering data it can't fetch.
    const visibleBranches =
      auth.allowedBranchIds === null
        ? branchRows
        : branchRows.filter((b) => auth.allowedBranchIds!.includes(b.id))

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt({
          businessName: tenant?.businessName ?? 'bisnis ini',
          businessCategory: tenant?.businessCategory ?? null,
          branchList: visibleBranches,
        }),
      },
      ...data.messages.map((m) => ({ role: m.role, content: m.content })),
    ]

    const toolDefs: ToolDef[] = TOOLS.map(
      ({ name, description, parameters }) => ({ name, description, parameters }),
    )

    let totalIn = 0
    let totalOut = 0
    let reply: string | null = null
    let status: 'success' | 'error' = 'success'
    let errorMessage: string | null = null

    try {
      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        // Last iteration runs without tools to force a final answer.
        const isLast = i === MAX_TOOL_ITERATIONS - 1
        const completion = await chatComplete(
          provider,
          messages,
          isLast ? [] : toolDefs,
        )
        totalIn += completion.usage.inputTokens
        totalOut += completion.usage.outputTokens

        if (!completion.toolCalls.length) {
          reply = completion.text ?? ''
          break
        }

        messages.push({
          role: 'assistant',
          content: completion.text,
          toolCalls: completion.toolCalls,
        })

        const results = await Promise.allSettled(
          completion.toolCalls.map((call) => {
            const tool = TOOLS.find((t) => t.name === call.name)
            if (!tool) {
              return Promise.reject(new Error(`Tool tidak dikenal: ${call.name}`))
            }
            return tool.execute(call.arguments)
          }),
        )
        for (const [j, result] of results.entries()) {
          const call = completion.toolCalls[j]!
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content:
              result.status === 'fulfilled'
                ? serializeToolResult(result.value)
                : JSON.stringify({ error: toolErrorMessage(result.reason) }),
          })
        }
      }

      if (reply === null) {
        // Should be unreachable (last iteration has no tools), but
        // never leave the user hanging.
        reply = 'Maaf, aku belum bisa menjawab pertanyaan itu. Coba tanyakan dengan cara lain.'
      }
    } catch (err) {
      status = 'error'
      errorMessage = err instanceof Error ? err.message : String(err)
      throw new Error(
        'Vintra AI sedang tidak bisa menjawab. Coba lagi sebentar.',
      )
    } finally {
      // Best-effort metering — same pattern as konten.ts. Failures here
      // must never break the chat response.
      try {
        await db.insert(aiUsageLogs).values({
          tenantId: auth.tenantId,
          feature: 'business_ai',
          provider: provider.providerType,
          model: provider.model,
          inputTokens: totalIn,
          outputTokens: totalOut,
          costUsd: computeTextCostUsd(totalIn, totalOut, provider),
          latencyMs: Date.now() - startedAt,
          status,
          errorMessage,
        })
      } catch {
        // ignore
      }
    }

    return { reply }
  })
