/**
 * Microsite analytics — views / visitors / CTA clicks, with a simple
 * per-day bar chart.
 */
import { useState } from 'react'
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
  AlertTriangle,
  BarChart2,
  CheckCircle,
  Eye,
  Users,
} from '~/lib/icons'
import { useSiteAnalyticsSummary } from '~/lib/site'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const RANGES: { key: number; label: string }[] = [
  { key: 7, label: '7 hari' },
  { key: 30, label: '30 hari' },
  { key: 90, label: '90 hari' },
]

export default function SiteAnalyticsScreen() {
  const [days, setDays] = useState(7)
  const query = useSiteAnalyticsSummary(days)

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Statistik Situs" back />
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
        <ScreenHeader title="Statistik Situs" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat statistik situs.'
              : 'Statistik situs tersedia mulai paket Komplit.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const data = query.data
  const maxDay = Math.max(1, ...(data?.perDay ?? []).map((d) => d.views))

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Statistik Situs"
        subtitle={`${days} hari terakhir`}
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
        <XStack gap="$2">
          {RANGES.map((r) => {
            const on = r.key === days
            return (
              <Pressable
                key={r.key}
                onPress={() => setDays(r.key)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: on
                    ? COLORS.primary
                    : COLORS.surfaceContainerLowest,
                  borderWidth: 1,
                  borderColor: on ? COLORS.primary : COLORS.borderSubtle,
                  alignItems: 'center',
                }}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={12}
                  color={on ? '#fff' : COLORS.onSurface}
                >
                  {r.label}
                </Paragraph>
              </Pressable>
            )
          })}
        </XStack>

        <XStack gap="$3">
          <StatTile
            label="Total view"
            value={data?.totalViews ?? 0}
            icon={Eye}
            color={COLORS.primary}
            tint={COLORS.primaryFixed}
          />
          <StatTile
            label="Pengunjung"
            value={data?.uniqueVisitors ?? 0}
            icon={Users}
            color="#2563eb"
            tint="#dbeafe"
          />
        </XStack>
        <StatTile
          label="Klik CTA / WhatsApp"
          value={data?.ctaClicks ?? 0}
          icon={CheckCircle}
          color={COLORS.success}
          tint="#dcfce7"
          wide
        />

        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$3"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
          style={SHADOWS.card}
        >
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
          >
            TREN HARIAN
          </Paragraph>
          {(data?.perDay ?? []).length === 0 ? (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada data di rentang ini.
            </Paragraph>
          ) : (
            (data?.perDay ?? []).map((d) => {
              const pct = (d.views / maxDay) * 100
              return (
                <YStack key={d.date} gap={4}>
                  <XStack ai="center" jc="space-between">
                    <Paragraph
                      fontFamily={FONTS.bodyMedium}
                      fontSize={12}
                      color={COLORS.onSurface}
                    >
                      {d.date}
                    </Paragraph>
                    <Stat fontSize={12} color={COLORS.onSurfaceVariant}>
                      {d.views} view · {d.visitors} unik
                    </Stat>
                  </XStack>
                  <YStack
                    w="100%"
                    h={6}
                    br={3}
                    bg={COLORS.surfaceContainerLow}
                    overflow="hidden"
                  >
                    <YStack
                      h={6}
                      br={3}
                      bg={COLORS.primary}
                      width={`${pct}%`}
                    />
                  </YStack>
                </YStack>
              )
            })
          )}
        </YStack>
      </ScrollView>
    </YStack>
  )
}

function StatTile({
  label,
  value,
  icon: Icon,
  color,
  tint,
  wide,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ size?: number; color?: string }>
  color: string
  tint: string
  wide?: boolean
}) {
  return (
    <YStack
      flex={wide ? undefined : 1}
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
        <YStack w={26} h={26} br={8} bg={tint} ai="center" jc="center">
          <Icon size={14} color={color} />
        </YStack>
      </XStack>
      <Paragraph
        fontFamily={FONTS.monoMedium}
        fontSize={22}
        color={COLORS.onSurface}
      >
        {value.toLocaleString('id-ID')}
      </Paragraph>
    </YStack>
  )
}

// BarChart2 imported for future trend toggle.
const _BarChart2 = BarChart2
