/**
 * WhatsApp dashboard — quota tiles for instance count and monthly AI
 * replies. Plus a "media retention" notice (S3 lifecycle = 24h).
 */
import { ActivityIndicator, RefreshControl, ScrollView } from 'react-native'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  MessageCircle,
  Sparkles,
} from '~/lib/icons'
import {
  useAiMonthlyUsage,
  useWaInstances,
  useWaSubscription,
} from '~/lib/whatsapp'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function WaDashboardScreen() {
  const sub = useWaSubscription()
  const instances = useWaInstances()
  const ai = useAiMonthlyUsage()

  if (sub.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="WhatsApp Dashboard" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (sub.error) {
    const isForbidden =
      sub.error instanceof ApiError && sub.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="WhatsApp Dashboard" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat dashboard WA.'
              : 'Gagal memuat dashboard.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const instanceCount = (instances.data ?? []).length
  const instanceCap = sub.data?.instanceCap ?? 0
  const replyCap = sub.data?.monthlyReplyCap ?? null
  const replyUsed = ai.data?.used ?? 0

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="WhatsApp Dashboard"
        subtitle={sub.data?.tier ? `Paket ${sub.data.tier.toUpperCase()}` : '-'}
        back
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={sub.isFetching || ai.isFetching || instances.isFetching}
            onRefresh={() => {
              void sub.refetch()
              void ai.refetch()
              void instances.refetch()
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        <QuotaCard
          label="Akun WhatsApp"
          icon={MessageCircle}
          iconColor="#25D366"
          tint="#dcfce7"
          used={instanceCount}
          cap={instanceCap}
          unit="akun"
        />

        <QuotaCard
          label="AI Reply Bulan Ini"
          icon={Sparkles}
          iconColor="#7c3aed"
          tint="#ede9fe"
          used={replyUsed}
          cap={replyCap}
          unit="reply"
          subtitle={
            sub.data?.aiEnabled
              ? undefined
              : 'AI butuh paket Komplit untuk aktif.'
          }
        />

        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$4"
          gap="$2"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <XStack ai="flex-start" gap="$2">
            <AlertCircle size={16} color={COLORS.primary} />
            <YStack flex={1}>
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Media disimpan 24 jam
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
              >
                Foto, stiker, dan dokumen di percakapan hanya disimpan
                selama 24 jam (S3 lifecycle policy). Setelah itu hanya
                teks dan metadata yang tersisa.
              </Paragraph>
            </YStack>
          </XStack>
        </YStack>

        {sub.data?.validUntil && (
          <YStack
            bg={COLORS.surfaceContainerLowest}
            br={14}
            p="$3"
            gap="$2"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <XStack ai="center" gap="$2">
              <CheckCircle size={16} color={COLORS.success} />
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={13}
                color={COLORS.onSurface}
                flex={1}
              >
                Aktif hingga{' '}
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={13}
                  color={COLORS.onSurface}
                >
                  {fmtDate(sub.data.validUntil)}
                </Paragraph>
              </Paragraph>
            </XStack>
          </YStack>
        )}
      </ScrollView>
    </YStack>
  )
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function QuotaCard({
  label,
  icon: Icon,
  iconColor,
  tint,
  used,
  cap,
  unit,
  subtitle,
}: {
  label: string
  icon: React.ComponentType<{ size?: number; color?: string }>
  iconColor: string
  tint: string
  used: number
  cap: number | null
  unit: string
  subtitle?: string
}) {
  const pct = cap && cap > 0 ? Math.min(100, (used / cap) * 100) : 0
  const isWarn = cap && cap > 0 && used / cap >= 0.8
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <XStack ai="center" gap="$3">
        <YStack
          w={44}
          h={44}
          br={14}
          bg={tint}
          ai="center"
          jc="center"
        >
          <Icon size={20} color={iconColor} />
        </YStack>
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
            textTransform="uppercase"
            letterSpacing={0.4}
          >
            {label}
          </Paragraph>
          <XStack ai="baseline" gap="$2">
            <Paragraph
              fontFamily={FONTS.monoMedium}
              fontSize={22}
              color={isWarn ? COLORS.danger : COLORS.onSurface}
            >
              {used.toLocaleString('id-ID')}
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={COLORS.onSurfaceVariant}
            >
              {cap !== null ? `dari ${cap.toLocaleString('id-ID')}` : 'unlimited'} {unit}
            </Paragraph>
          </XStack>
        </YStack>
      </XStack>
      {cap !== null && (
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
            bg={isWarn ? COLORS.danger : iconColor}
            width={`${pct}%`}
          />
        </YStack>
      )}
      {subtitle && (
        <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
          {subtitle}
        </Stat>
      )}
    </YStack>
  )
}
