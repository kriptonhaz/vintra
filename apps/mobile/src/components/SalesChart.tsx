/**
 * SalesChart — the home dashboard hero. A smooth area chart of the
 * sales series with a period dropdown (Harian/Mingguan/Bulanan/
 * Tahunan), the headline revenue number, and a delta badge.
 *
 * Hand-rolled with react-native-svg (no chart lib). The curve uses
 * Catmull-Rom → cubic-bezier smoothing so it reads like the reference
 * mockup's flowing line. A LinearGradient fills the area under the
 * curve in brand green; the last data point gets a highlighted dot.
 *
 * Brand palette only — the reference was orange; we're brand green.
 */
import { useMemo, useState } from 'react'
import { Pressable, useWindowDimensions } from 'react-native'
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
} from 'react-native-svg'
import {
  Adapt,
  Paragraph,
  Select,
  Sheet,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import { Check, ChevronDown, TrendingDown, TrendingUp } from '~/lib/icons'
import {
  useSalesSeries,
  type SalesPeriod,
  type SalesSeriesPoint,
} from '../lib/home'
import { useOutlet } from '../lib/outlet-context'
import { Money } from './Money'
import { COLORS, FONTS } from '../lib/theme'

const PERIOD_OPTIONS: Array<{ value: SalesPeriod; label: string }> = [
  { value: 'daily', label: 'Harian' },
  { value: 'weekly', label: 'Mingguan' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'yearly', label: 'Tahunan' },
]

const CHART_HEIGHT = 92

export function SalesChart() {
  const [period, setPeriod] = useState<SalesPeriod>('daily')
  const { selectedBranchId } = useOutlet()
  const query = useSalesSeries(period, { branchId: selectedBranchId })
  const { width: screenWidth } = useWindowDimensions()

  // Card is full-width minus the screen's 16px horizontal padding on
  // each side; chart is the card inner width minus the card's padding.
  const cardWidth = screenWidth - 32
  const chartWidth = cardWidth - 40 // 20px card padding each side

  const data = query.data
  const points = data?.points ?? []
  const deltaPct = data?.deltaPct ?? null
  const positive = (deltaPct ?? 0) >= 0

  return (
    <YStack
      bg={COLORS.primary}
      br="$6"
      p="$5"
      gap="$3"
      overflow="hidden"
      shadowColor="#0b3b1a"
      shadowOpacity={0.18}
      shadowRadius={20}
      shadowOffset={{ width: 0, height: 10 }}
      elevation={6}
    >
      {/* Top row: label + period dropdown */}
      <XStack ai="center" jc="space-between">
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={12}
          color="white"
          opacity={0.85}
          letterSpacing={0.55}
        >
          PENJUALAN
        </Paragraph>
        <PeriodSelect value={period} onChange={setPeriod} />
      </XStack>

      {/* Headline number */}
      <YStack gap="$1.5">
        <Money
          amount={data?.current ?? 0}
          emphasis
          fontSize={30}
          lineHeight={36}
          color="white"
        />
        {deltaPct !== null && (
          <XStack ai="center" gap="$1.5">
            <XStack
              ai="center"
              gap="$1"
              bg={positive ? 'rgba(140,249,165,0.25)' : 'rgba(255,180,180,0.25)'}
              br={9999}
              px="$2"
              py={2}
            >
              {positive ? (
                <TrendingUp size={12} color={COLORS.primaryFixed} />
              ) : (
                <TrendingDown size={12} color="#ffb3b3" />
              )}
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={11}
                color={positive ? COLORS.primaryFixed : '#ffb3b3'}
              >
                {positive ? '+' : ''}
                {deltaPct}%
              </Paragraph>
            </XStack>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color="white"
              opacity={0.75}
            >
              dari {periodPrevLabel(period)}
            </Paragraph>
          </XStack>
        )}
      </YStack>

      {/* Chart */}
      <YStack h={CHART_HEIGHT} jc="center">
        {query.isLoading && !data ? (
          <YStack ai="center" jc="center" flex={1}>
            <Spinner color="white" />
          </YStack>
        ) : points.length < 2 ? (
          <YStack ai="center" jc="center" flex={1}>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color="white"
              opacity={0.7}
            >
              Belum cukup data untuk grafik
            </Paragraph>
          </YStack>
        ) : (
          <AreaChart
            points={points}
            width={chartWidth}
            height={CHART_HEIGHT}
          />
        )}
      </YStack>

      {/* X-axis labels */}
      {points.length >= 2 && (
        <XStack jc="space-between">
          {axisLabels(points, period).map((lbl, i) => (
            <Paragraph
              key={i}
              fontFamily={FONTS.body}
              fontSize={9}
              color="white"
              opacity={0.6}
            >
              {lbl}
            </Paragraph>
          ))}
        </XStack>
      )}
    </YStack>
  )
}

// ─── The SVG area chart ─────────────────────────────────────────────

function AreaChart({
  points,
  width,
  height,
}: {
  points: SalesSeriesPoint[]
  width: number
  height: number
}) {
  const { linePath, areaPath, lastDot } = useMemo(() => {
    const values = points.map((p) => p.revenue)
    const max = Math.max(...values, 1)
    const min = Math.min(...values, 0)
    const range = max - min || 1

    const padV = 14 // vertical breathing room so the curve isn't clipped
    const usableH = height - padV * 2

    const coords = points.map((p, i) => {
      const x = (i / (points.length - 1)) * width
      const y = padV + (1 - (p.revenue - min) / range) * usableH
      return { x, y }
    })

    return {
      linePath: smoothLine(coords),
      areaPath: `${smoothLine(coords)} L ${width} ${height} L 0 ${height} Z`,
      lastDot: coords[coords.length - 1],
    }
  }, [points, width, height])

  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgLinearGradient id="salesArea" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0.35} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0.02} />
        </SvgLinearGradient>
      </Defs>

      {/* Area fill */}
      <Path d={areaPath} fill="url(#salesArea)" />

      {/* Line */}
      <Path
        d={linePath}
        stroke="#ffffff"
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Last point highlight */}
      <Circle cx={lastDot.x} cy={lastDot.y} r={6} fill="#ffffff" />
      <Circle cx={lastDot.x} cy={lastDot.y} r={3} fill={COLORS.primary} />
    </Svg>
  )
}

/**
 * Catmull-Rom → cubic-bezier smoothing. Produces a flowing curve
 * through every data point (unlike a naive quadratic that drifts).
 */
function smoothLine(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`

  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2

    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

// ─── Period dropdown (Tamagui Select → touch sheet) ─────────────────

function PeriodSelect({
  value,
  onChange,
}: {
  value: SalesPeriod
  onChange: (v: SalesPeriod) => void
}) {
  const label =
    PERIOD_OPTIONS.find((o) => o.value === value)?.label ?? 'Harian'

  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as SalesPeriod)}
      disablePreventBodyScroll
    >
      <Select.Trigger
        h={32}
        br={9999}
        px="$3"
        bg="rgba(255,255,255,0.18)"
        borderWidth={0}
        width="auto"
      >
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={12}
          color="white"
        >
          {label}
        </Paragraph>
        <Select.Icon>
          <ChevronDown size={14} color="white" />
        </Select.Icon>
      </Select.Trigger>

      <Adapt platform="touch">
        <Sheet modal dismissOnSnapToBottom animation="medium" snapPoints={[40]}>
          <Sheet.Frame>
            <Sheet.ScrollView>
              <Adapt.Contents />
            </Sheet.ScrollView>
          </Sheet.Frame>
          <Sheet.Overlay />
        </Sheet>
      </Adapt>

      <Select.Content>
        <Select.Viewport>
          {PERIOD_OPTIONS.map((opt, idx) => (
            <Select.Item key={opt.value} index={idx} value={opt.value}>
              <Select.ItemText>{opt.label}</Select.ItemText>
              <Select.ItemIndicator marginLeft="auto">
                <Check size={16} color={COLORS.primary} />
              </Select.ItemIndicator>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select>
  )
}

// ─── Label helpers ───────────────────────────────────────────────────

function periodPrevLabel(period: SalesPeriod): string {
  switch (period) {
    case 'daily':
      return 'kemarin'
    case 'weekly':
      return 'minggu lalu'
    case 'monthly':
      return 'bulan lalu'
    case 'yearly':
      return 'tahun lalu'
  }
}

/**
 * Pick ~4 evenly-spaced x-axis labels (first, ~⅓, ~⅔, last) so they
 * don't overlap on a narrow screen. Each formatted per period.
 */
function axisLabels(points: SalesSeriesPoint[], period: SalesPeriod): string[] {
  const n = points.length
  if (n === 0) return []
  const idxs = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  )
  return idxs.map((i) => formatBucketLabel(points[i].bucketStart, period))
}

function formatBucketLabel(iso: string, period: SalesPeriod): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', ...opts }).format(d)
  switch (period) {
    case 'daily':
      return fmt({ weekday: 'short' }) // Sen, Sel...
    case 'weekly':
      return fmt({ day: 'numeric', month: 'short' }) // 12 Mei
    case 'monthly':
      return fmt({ month: 'short' }) // Jan, Feb...
    case 'yearly':
      return fmt({ year: 'numeric' }) // 2024
  }
}
