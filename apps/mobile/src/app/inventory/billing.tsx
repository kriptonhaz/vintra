/**
 * Inventory billing — Free/Toko/Bisnis tier cards. Tier comparison
 * data is local (mirrors INVENTORY_PLANS shared constant); current
 * tier comes from getInventoryOverview.
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
import { useInventoryOverview, type InventoryTier } from '~/lib/inventory'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

interface TierSpec {
  tier: InventoryTier
  name: string
  monthlyPrice: number
  annualPrice: number | null
  extraLocation: number
  features: string[]
  isPopular?: boolean
}

const TIERS: TierSpec[] = [
  {
    tier: 'free',
    name: 'Gratis',
    monthlyPrice: 0,
    annualPrice: null,
    extraLocation: 0,
    features: [
      'Unlimited SKU',
      '1 lokasi',
      'Riwayat 30 hari',
      'Stock-in / out manual',
    ],
  },
  {
    tier: 'toko',
    name: 'Toko',
    monthlyPrice: 49000,
    annualPrice: 35000,
    extraLocation: 25000,
    isPopular: true,
    features: [
      'Multi lokasi',
      'Riwayat tanpa batas',
      'Low-stock alert',
      'Purchase Order + supplier',
      'Auto-sync biaya HPP',
      'Import dari HPP',
    ],
  },
  {
    tier: 'bisnis',
    name: 'Bisnis',
    monthlyPrice: 99000,
    annualPrice: 75000,
    extraLocation: 35000,
    features: [
      'Semua fitur Toko',
      'Multi-unit pricing',
      'Inter-branch requisitions',
      'Stock opname',
      'Audit log',
    ],
  },
]

const SALES_WA =
  'https://wa.me/6285881732869?text=' +
  encodeURIComponent('Halo Vintra, saya ingin upgrade modul Inventory.')

export const SALES_WA_PERPANJANG =
  'https://wa.me/6285881732869?text=' +
  encodeURIComponent(
    'Halo Vintra, langganan Inventory saya tidak aktif. Saya ingin perpanjang.',
  )

export default function InventoryBillingScreen() {
  const overview = useInventoryOverview()

  if (overview.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Paket Inventaris" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (overview.error) {
    const isForbidden =
      overview.error instanceof ApiError && overview.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Paket Inventaris" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke billing inventory.'
              : 'Gagal memuat status langganan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const currentTier = overview.data?.tier ?? 'free'

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Paket Inventaris"
        subtitle={`Saat ini: ${TIERS.find((t) => t.tier === currentTier)?.name ?? currentTier}`}
        back
      />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
        {TIERS.map((tier) => (
          <TierCard
            key={tier.tier}
            tier={tier}
            isCurrent={tier.tier === currentTier}
          />
        ))}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$4"
          gap="$2"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
          mt="$2"
        >
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={13}
            color={COLORS.onSurface}
          >
            Cara upgrade?
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
          >
            Tap "Upgrade" di paket pilihan, sales kami akan bantu via
            WhatsApp. Pembayaran transfer / QRIS, aktif paling lambat
            1×24 jam.
          </Paragraph>
        </YStack>
      </ScrollView>
    </YStack>
  )
}

function TierCard({
  tier,
  isCurrent,
}: {
  tier: TierSpec
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
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={18}
          color={COLORS.onSurface}
        >
          {tier.name}
        </Paragraph>
        <XStack gap="$2">
          {isCurrent && (
            <YStack px={8} py={3} br={999} bg={COLORS.primary}>
              <Paragraph fontFamily={FONTS.bodyBold} fontSize={10} color="#fff">
                AKTIF
              </Paragraph>
            </YStack>
          )}
          {tier.isPopular && !isCurrent && (
            <YStack px={8} py={3} br={999} bg={COLORS.success}>
              <Paragraph fontFamily={FONTS.bodyBold} fontSize={10} color="#fff">
                POPULER
              </Paragraph>
            </YStack>
          )}
        </XStack>
      </XStack>

      <YStack gap={2}>
        {tier.tier === 'free' ? (
          <Money amount={0} fontSize={22} emphasis />
        ) : (
          <>
            <XStack ai="baseline" gap="$2">
              <Money amount={tier.monthlyPrice} fontSize={20} emphasis />
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
              >
                /bulan lokasi pertama
              </Paragraph>
            </XStack>
            {tier.annualPrice && (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
              >
                Tahunan: Rp {tier.annualPrice.toLocaleString('id-ID')}/bulan
              </Paragraph>
            )}
            {tier.extraLocation > 0 && (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
              >
                + Rp {tier.extraLocation.toLocaleString('id-ID')}/lokasi tambahan
              </Paragraph>
            )}
          </>
        )}
      </YStack>

      <YStack gap="$2">
        {tier.features.map((f) => (
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
