/**
 * WhatsApp billing — Basic / Komplit tier comparison. Pro tier is
 * hidden on the web (deferred to a future release); we follow suit.
 */
import { ActivityIndicator, Linking, Pressable, ScrollView } from 'react-native'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money } from '~/components/Money'
import {
  AlertTriangle,
  Check,
  MessageCircle,
  Wallet,
} from '~/lib/icons'
import { useWaSubscription } from '~/lib/whatsapp'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

interface WaPlan {
  tier: 'basic' | 'komplit'
  name: string
  monthlyPrice: number
  instanceCap: number
  monthlyReplyCap: number | null
  features: string[]
  isPopular?: boolean
}

const PLANS: WaPlan[] = [
  {
    tier: 'basic',
    name: 'Basic',
    monthlyPrice: 99000,
    instanceCap: 1,
    monthlyReplyCap: null,
    features: [
      'Inbox terpusat untuk 1 nomor',
      'Kirim teks + foto + dokumen',
      'Riwayat chat di Vintra',
      'Handoff ke admin manual',
    ],
  },
  {
    tier: 'komplit',
    name: 'Komplit',
    monthlyPrice: 199000,
    instanceCap: 3,
    monthlyReplyCap: 2000,
    isPopular: true,
    features: [
      'Sampai 3 nomor WhatsApp',
      'AI auto-reply (2.000 reply / bulan)',
      'RAG tools — bot tahu stok + harga',
      'Auto-handoff saat AI tidak yakin',
      'Notifikasi pesan baru via push',
    ],
  },
]

const SALES_WA =
  'https://wa.me/6285881732869?text=' +
  encodeURIComponent('Halo Vintra, saya ingin upgrade modul WhatsApp.')

export default function WaBillingScreen() {
  const sub = useWaSubscription()

  if (sub.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Paket WhatsApp" back />
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
        <ScreenHeader title="Paket WhatsApp" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke billing WA.'
              : 'Gagal memuat status paket.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const currentTier = sub.data?.tier ?? 'basic'

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Paket WhatsApp"
        subtitle={`Saat ini: ${PLANS.find((p) => p.tier === currentTier)?.name ?? currentTier}`}
        back
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
      >
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.tier}
            plan={plan}
            isCurrent={plan.tier === currentTier}
          />
        ))}
      </ScrollView>
    </YStack>
  )
}

function PlanCard({
  plan,
  isCurrent,
}: {
  plan: WaPlan
  isCurrent: boolean
}) {
  return (
    <YStack
      bg={isCurrent ? COLORS.primaryFixed : COLORS.surfaceContainerLowest}
      br={16}
      p="$4"
      gap="$3"
      borderWidth={2}
      borderColor={isCurrent ? COLORS.primary : COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <XStack ai="center" jc="space-between">
        <XStack ai="center" gap="$2">
          <MessageCircle size={18} color="#25D366" />
          <Paragraph
            fontFamily={FONTS.headingBold}
            fontSize={18}
            color={COLORS.onSurface}
          >
            {plan.name}
          </Paragraph>
        </XStack>
        <XStack gap="$2">
          {isCurrent && (
            <YStack px={8} py={3} br={999} bg={COLORS.primary}>
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={10}
                color="#fff"
              >
                AKTIF
              </Paragraph>
            </YStack>
          )}
          {plan.isPopular && !isCurrent && (
            <YStack px={8} py={3} br={999} bg={COLORS.success}>
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={10}
                color="#fff"
              >
                POPULER
              </Paragraph>
            </YStack>
          )}
        </XStack>
      </XStack>

      <XStack ai="baseline" gap="$2">
        <Money amount={plan.monthlyPrice} fontSize={22} emphasis />
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={11}
          color={COLORS.onSurfaceVariant}
        >
          /bulan
        </Paragraph>
      </XStack>

      <YStack gap="$2">
        {plan.features.map((f) => (
          <XStack key={f} ai="flex-start" gap="$2">
            <YStack mt={2}>
              <Check size={14} color={COLORS.primary} />
            </YStack>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurface}
              flex={1}
            >
              {f}
            </Paragraph>
          </XStack>
        ))}
      </YStack>

      {!isCurrent && (
        <Pressable
          onPress={() => void Linking.openURL(SALES_WA)}
          style={{
            marginTop: 4,
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: COLORS.primary,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Wallet size={14} color="#fff" />
          <Paragraph fontFamily={FONTS.bodyBold} fontSize={13} color="#fff">
            Upgrade
          </Paragraph>
        </Pressable>
      )}
    </YStack>
  )
}
