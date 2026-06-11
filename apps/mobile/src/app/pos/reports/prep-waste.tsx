/**
 * Prep & Waste report — daily breakdown of items prepared vs consumed
 * vs leftover. Highlight rows where waste % > 20% so owners can dial
 * morning batch sizes down.
 *
 * Date range preset chips (today/7d/30d/this month). Branch filter
 * deferred to v2 (owners typically scan all-branches first).
 *
 * Server gate: requires `pos.report.view` + Toko tier minimum.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
} from 'react-native'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  Package,
  TrendingDown,
  TrendingUp,
} from '~/lib/icons'
import { usePrepWasteReport, type PrepWasteRow } from '~/lib/pos'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

type RangePreset = 'today' | '7d' | '30d' | 'month'

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'today', label: 'Hari ini' },
  { key: '7d', label: '7 hari' },
  { key: '30d', label: '30 hari' },
  { key: 'month', label: 'Bulan ini' },
]

function jakartaYmd(d: Date): string {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  const jak = new Date(utcMs + 7 * 60 * 60_000)
  const y = jak.getUTCFullYear()
  const m = String(jak.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jak.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function computeRange(preset: RangePreset): { from: string; to: string } {
  const today = new Date()
  const to = jakartaYmd(today)
  switch (preset) {
    case 'today':
      return { from: to, to }
    case '7d': {
      const start = new Date(today.getTime() - 6 * 86_400_000)
      return { from: jakartaYmd(start), to }
    }
    case '30d': {
      const start = new Date(today.getTime() - 29 * 86_400_000)
      return { from: jakartaYmd(start), to }
    }
    case 'month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: jakartaYmd(start), to }
    }
  }
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtDay(ymd: string): string {
  try {
    const [y, m, d] = ymd.split('-').map(Number)
    if (!y || !m || !d) return ymd
    return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
    })
  } catch {
    return ymd
  }
}

export default function PrepWasteScreen() {
  const [preset, setPreset] = useState<RangePreset>('7d')
  const range = useMemo(() => computeRange(preset), [preset])
  const query = usePrepWasteReport({ dateFrom: range.from, dateTo: range.to })

  const rows = query.data ?? []
  const summary = useMemo(() => {
    const totalPrepared = rows.reduce((s, r) => s + r.qtyPrepared, 0)
    const totalConsumed = rows.reduce((s, r) => s + r.qtyConsumed, 0)
    const totalLeftover = rows.reduce((s, r) => s + r.qtyLeftover, 0)
    const wastePct =
      totalPrepared > 0 ? (totalLeftover / totalPrepared) * 100 : 0
    return { totalPrepared, totalConsumed, totalLeftover, wastePct }
  }, [rows])

  // Group by day for nicer rendering
  const byDay = useMemo(() => {
    const map = new Map<string, PrepWasteRow[]>()
    for (const r of rows) {
      const arr = map.get(r.day) ?? []
      arr.push(r)
      map.set(r.day, arr)
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [rows])

  // ── Loading / error ───────────────────────────────────────────────
  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Prep & Waste" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }

  if (query.error) {
    const err = query.error
    const isForbidden = err instanceof ApiError && err.status === 403
    const msg = err instanceof Error ? err.message : ''
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Prep & Waste" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke laporan POS.'
              : msg.includes('Toko')
                ? 'Laporan ini tersedia mulai paket Toko. Upgrade dulu yuk.'
                : 'Gagal memuat laporan. Cek koneksi & coba lagi.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Prep & Waste"
        subtitle={`${fmtDay(range.from)} - ${fmtDay(range.to)}`}
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
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  backgroundColor: active
                    ? COLORS.primary
                    : COLORS.surfaceContainerLowest,
                  borderWidth: 1,
                  borderColor: active ? COLORS.primary : COLORS.borderSubtle,
                }}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={12}
                  color={active ? '#fff' : COLORS.onSurface}
                >
                  {p.label}
                </Paragraph>
              </Pressable>
            )
          })}
        </XStack>

        {/* Summary tiles */}
        <XStack gap="$3">
          <SummaryTile
            label="Prepared"
            value={fmtNum(summary.totalPrepared)}
            icon={Package}
            tint={COLORS.primaryFixed}
            fg={COLORS.primary}
          />
          <SummaryTile
            label="Consumed"
            value={fmtNum(summary.totalConsumed)}
            icon={TrendingUp}
            tint="#dbeafe"
            fg="#2563eb"
          />
        </XStack>
        <XStack gap="$3">
          <SummaryTile
            label="Leftover"
            value={fmtNum(summary.totalLeftover)}
            icon={TrendingDown}
            tint={
              summary.wastePct > 20 ? COLORS.dangerTint : COLORS.successTint
            }
            fg={summary.wastePct > 20 ? COLORS.danger : COLORS.success}
          />
          <SummaryTile
            label="Waste %"
            value={`${summary.wastePct.toFixed(1)}%`}
            icon={summary.wastePct > 20 ? AlertCircle : TrendingDown}
            tint={
              summary.wastePct > 20 ? COLORS.dangerTint : COLORS.successTint
            }
            fg={summary.wastePct > 20 ? COLORS.danger : COLORS.success}
          />
        </XStack>

        {/* Detail */}
        {rows.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Package size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              mt="$2"
            >
              Belum ada prep batch di rentang ini.
            </Paragraph>
          </YStack>
        ) : (
          byDay.map(([day, dayRows]) => (
            <YStack key={day} gap="$2">
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
                letterSpacing={0.55}
                px="$1"
              >
                {fmtDay(day).toUpperCase()}
              </Paragraph>
              {dayRows.map((r) => (
                <PrepRow key={`${r.day}-${r.itemId}-${r.branchId}`} row={r} />
              ))}
            </YStack>
          ))
        )}
      </ScrollView>
    </YStack>
  )
}

// ─── Subcomponents ──────────────────────────────────────────────────

interface SummaryTileProps {
  label: string
  value: string
  icon: React.ComponentType<{ size?: number; color?: string }>
  tint: string
  fg: string
}

function SummaryTile({ label, value, icon: Icon, tint, fg }: SummaryTileProps) {
  return (
    <YStack
      flex={1}
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$1"
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
        <YStack w={26} h={26} br={8} bg={tint} ai="center" jc="center">
          <Icon size={14} color={fg} />
        </YStack>
      </XStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        color={COLORS.onSurface}
      >
        {value}
      </Paragraph>
    </YStack>
  )
}

function PrepRow({ row }: { row: PrepWasteRow }) {
  const wastePct =
    row.qtyPrepared > 0 ? (row.qtyLeftover / row.qtyPrepared) * 100 : 0
  const high = wastePct > 20
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={12}
      p="$3"
      gap="$1"
      borderWidth={1}
      borderColor={high ? COLORS.danger : COLORS.borderSubtle}
    >
      <XStack ai="center" jc="space-between">
        <Paragraph
          fontFamily={FONTS.bodySemi}
          fontSize={14}
          color={COLORS.onSurface}
          flex={1}
          numberOfLines={1}
        >
          {row.itemName}
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={12}
          color={high ? COLORS.danger : COLORS.onSurfaceVariant}
        >
          {wastePct.toFixed(0)}% waste
        </Paragraph>
      </XStack>
      <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
        {row.branchName} ·{' '}
        <Paragraph fontFamily={FONTS.monoMedium} fontSize={11} color={COLORS.onSurface}>
          Prep {fmtNum(row.qtyPrepared)}
        </Paragraph>{' '}
        ·{' '}
        <Paragraph fontFamily={FONTS.monoMedium} fontSize={11} color={COLORS.onSurface}>
          Cons {fmtNum(row.qtyConsumed)}
        </Paragraph>{' '}
        ·{' '}
        <Paragraph
          fontFamily={FONTS.monoMedium}
          fontSize={11}
          color={high ? COLORS.danger : COLORS.onSurface}
        >
          Sisa {fmtNum(row.qtyLeftover)} {row.baseUnitLabel}
        </Paragraph>
      </Stat>
    </YStack>
  )
}
