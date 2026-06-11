/**
 * Cashflow dashboard — KPIs (income / expense / net / cash position),
 * AR & AP snapshots, and category breakdown for the selected range.
 *
 * Date range = preset chips (Bulan ini / Bulan lalu / 30 hari /
 * 90 hari). Branch filter deferred — uses the tenant-wide view by
 * default.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from '~/lib/icons'
import { useCashflowDashboard } from '~/lib/cashflow'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

type RangePreset = 'thisMonth' | 'lastMonth' | '30d' | '90d'

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'thisMonth', label: 'Bulan ini' },
  { key: 'lastMonth', label: 'Bulan lalu' },
  { key: '30d', label: '30 hari' },
  { key: '90d', label: '90 hari' },
]

function ymd(d: Date): string {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  const jak = new Date(utcMs + 7 * 60 * 60_000)
  const y = jak.getUTCFullYear()
  const m = String(jak.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jak.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function computeRange(preset: RangePreset): { from: string; to: string } {
  const now = new Date()
  const to = ymd(now)
  switch (preset) {
    case 'thisMonth': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: ymd(start), to }
    }
    case 'lastMonth': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: ymd(start), to: ymd(end) }
    }
    case '30d':
      return { from: ymd(new Date(now.getTime() - 29 * 86_400_000)), to }
    case '90d':
      return { from: ymd(new Date(now.getTime() - 89 * 86_400_000)), to }
  }
}

function fmtPresetLabel(range: { from: string; to: string }): string {
  function fmt(s: string) {
    try {
      const [y, m, d] = s.split('-').map(Number)
      if (!y || !m || !d) return s
      return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
      })
    } catch {
      return s
    }
  }
  return `${fmt(range.from)} – ${fmt(range.to)}`
}

export default function CashflowDashboardScreen() {
  const router = useRouter()
  const [preset, setPreset] = useState<RangePreset>('thisMonth')
  const range = useMemo(() => computeRange(preset), [preset])
  const query = useCashflowDashboard(range)

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Dashboard Kas" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (query.error) {
    const isForbidden =
      query.error instanceof ApiError && query.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Dashboard Kas" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat dashboard kas.'
              : 'Gagal memuat dashboard.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const data = query.data ?? {
    income: 0,
    expense: 0,
    net: 0,
    cashPosition: 0,
    categoryBreakdown: [],
    dailyTrend: [],
    ar: { outstanding: 0, overdueCount: 0 },
    ap: { outstanding: 0, dueThisMonth: 0 },
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Dashboard Kas"
        subtitle={fmtPresetLabel(range)}
        back
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => query.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Range presets */}
        <XStack gap="$2">
          {PRESETS.map((p) => {
            const active = p.key === preset
            return (
              <Pressable
                key={p.key}
                onPress={() => setPreset(p.key)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: active
                    ? COLORS.primary
                    : COLORS.surfaceContainerLowest,
                  borderWidth: 1,
                  borderColor: active ? COLORS.primary : COLORS.borderSubtle,
                  alignItems: 'center',
                }}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={11}
                  color={active ? '#fff' : COLORS.onSurface}
                >
                  {p.label}
                </Paragraph>
              </Pressable>
            )
          })}
        </XStack>

        {/* KPIs */}
        <XStack gap="$3">
          <KpiTile
            label="Pemasukan"
            value={data.income}
            icon={TrendingUp}
            tint="#dcfce7"
            fg={COLORS.success}
          />
          <KpiTile
            label="Pengeluaran"
            value={data.expense}
            icon={TrendingDown}
            tint={COLORS.dangerTint}
            fg={COLORS.danger}
          />
        </XStack>
        <XStack gap="$3">
          <KpiTile
            label="Net"
            value={data.net}
            icon={ArrowDownToLine}
            tint={data.net >= 0 ? '#dcfce7' : COLORS.dangerTint}
            fg={data.net >= 0 ? COLORS.success : COLORS.danger}
            signed
          />
          <KpiTile
            label="Saldo Kas"
            value={data.cashPosition}
            icon={Wallet}
            tint={COLORS.primaryFixed}
            fg={COLORS.primary}
          />
        </XStack>

        {/* AR + AP */}
        <Pressable onPress={() => router.push('/cashflow/bon' as never)}>
          <ArApCard
            label="Piutang (Bon Pelanggan)"
            outstanding={data.ar.outstanding}
            hint={
              data.ar.overdueCount > 0
                ? `${data.ar.overdueCount} bon telat bayar`
                : 'Semua tepat waktu'
            }
            color={data.ar.overdueCount > 0 ? COLORS.danger : COLORS.success}
            icon={Users}
          />
        </Pressable>
        <Pressable onPress={() => router.push('/cashflow/cicilan' as never)}>
          <ArApCard
            label="Utang (Cicilan)"
            outstanding={data.ap.outstanding}
            hint={`Jatuh tempo bulan ini ${formatRupiahSafe(data.ap.dueThisMonth)}`}
            color={data.ap.dueThisMonth > 0 ? '#92400e' : COLORS.outline}
            icon={ArrowUpFromLine}
          />
        </Pressable>

        {/* Category breakdown */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$2"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <SectionLabel>BREAKDOWN KATEGORI</SectionLabel>
          {data.categoryBreakdown.length === 0 ? (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada transaksi di rentang ini.
            </Paragraph>
          ) : (
            <BreakdownList items={data.categoryBreakdown} />
          )}
        </YStack>
      </ScrollView>
    </YStack>
  )
}

// ─── Subcomponents ──────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  icon: Icon,
  tint,
  fg,
  signed,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ size?: number; color?: string }>
  tint: string
  fg: string
  signed?: boolean
}) {
  const display = signed && value < 0 ? `-${formatRupiahSafe(Math.abs(value))}` : formatRupiahSafe(value)
  return (
    <YStack
      flex={1}
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <XStack ai="center" jc="space-between">
        <Paragraph
          fontFamily={FONTS.bodySemi}
          fontSize={11}
          color={COLORS.onSurfaceVariant}
          textTransform="uppercase"
          letterSpacing={0.4}
        >
          {label}
        </Paragraph>
        <YStack
          w={26}
          h={26}
          br={8}
          bg={tint}
          ai="center"
          jc="center"
        >
          <Icon size={14} color={fg} />
        </YStack>
      </XStack>
      <Paragraph
        fontFamily={FONTS.monoMedium}
        fontSize={18}
        color={signed && value < 0 ? COLORS.danger : COLORS.onSurface}
        numberOfLines={1}
      >
        {display}
      </Paragraph>
    </YStack>
  )
}

function ArApCard({
  label,
  outstanding,
  hint,
  color,
  icon: Icon,
}: {
  label: string
  outstanding: number
  hint: string
  color: string
  icon: React.ComponentType<{ size?: number; color?: string }>
}) {
  return (
    <XStack
      ai="center"
      gap="$3"
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <YStack
        w={40}
        h={40}
        br={12}
        bg={`${color}22`}
        ai="center"
        jc="center"
      >
        <Icon size={18} color={color} />
      </YStack>
      <YStack flex={1}>
        <Paragraph
          fontFamily={FONTS.bodySemi}
          fontSize={13}
          color={COLORS.onSurface}
        >
          {label}
        </Paragraph>
        <XStack ai="baseline" gap="$2">
          <Money amount={outstanding} fontSize={16} emphasis />
          <Stat fontSize={10} color={color}>
            {hint}
          </Stat>
        </XStack>
      </YStack>
      <ChevronRight size={18} color={COLORS.outline} />
    </XStack>
  )
}

function BreakdownList({
  items,
}: {
  items: Array<{ categoryName: string; kind: 'income' | 'expense'; amount: number }>
}) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.amount)))
  return (
    <YStack gap="$2" mt="$1">
      {items.map((it, idx) => {
        const pct = (Math.abs(it.amount) / max) * 100
        const color = it.kind === 'income' ? COLORS.success : COLORS.danger
        return (
          <YStack key={`${it.categoryName}-${idx}`} gap={4}>
            <XStack ai="center" jc="space-between">
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={13}
                color={COLORS.onSurface}
                flex={1}
                numberOfLines={1}
              >
                {it.categoryName}
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.monoMedium}
                fontSize={12}
                color={color}
              >
                {it.kind === 'expense' ? '-' : ''}
                {formatRupiahSafe(Math.abs(it.amount))}
              </Paragraph>
            </XStack>
            <YStack
              w="100%"
              h={6}
              br={3}
              bg={COLORS.surfaceContainerLow}
              overflow="hidden"
            >
              <YStack h={6} br={3} bg={color} width={`${pct}%`} />
            </YStack>
          </YStack>
        )
      })}
    </YStack>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Paragraph
      fontFamily={FONTS.bodyBold}
      fontSize={11}
      color={COLORS.onSurfaceVariant}
      letterSpacing={0.55}
    >
      {children}
    </Paragraph>
  )
}

function formatRupiahSafe(amount: number): string {
  // Inline copy to avoid importing across screens. Identical to
  // lib/currency.ts.
  return `Rp ${new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount))}`
}
