/**
 * POS billing — tier comparison cards (Free/Toko/Komplit/Bisnis).
 * Tapping "Upgrade" opens WhatsApp sales chat. Tier comparison data
 * is local; current tier comes from getPOSOverview.
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
import { usePosOverview, type PosTier } from '~/lib/pos'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

interface TierSpec {
  tier: PosTier
  name: string
  monthlyPrice: number
  annualPrice: number | null
  additionalOutlet: number
  features: string[]
  isPopular?: boolean
  comingSoon?: boolean
}

const TIERS: TierSpec[] = [
  {
    tier: 'free',
    name: 'Gratis',
    monthlyPrice: 0,
    annualPrice: null,
    additionalOutlet: 0,
    features: [
      'Transaksi tanpa batas',
      'Riwayat tanpa batas',
      '1 kasir, 1 outlet',
      'Tunai + QRIS',
      'Struk default',
    ],
  },
  {
    tier: 'toko',
    name: 'POS Toko',
    monthlyPrice: 79000,
    annualPrice: 49000,
    additionalOutlet: 50000,
    features: [
      'POS-only (tanpa Inventory + Absensi)',
      'Transaksi tanpa batas',
      '3 kasir per outlet',
      'Semua metode bayar',
      'Logo + footer kustom',
      'Diskon penjualan',
      'Z-Report harian',
      'Customer database',
    ],
  },
  {
    tier: 'komplit',
    name: 'Komplit',
    monthlyPrice: 75000,
    annualPrice: 55000,
    additionalOutlet: 60000,
    isPopular: true,
    features: [
      'Semua modul: POS + Inventory + Absensi + HPP',
      'Unlimited kasir, unlimited karyawan',
      'Unlimited SKU, unlimited transaksi',
      'Customer database + loyalty',
      'Promo codes',
      'Diskon per item',
      'Auto-deduct bahan dari resep',
      'Cetak struk thermal',
    ],
  },
  {
    tier: 'bisnis',
    name: 'Bisnis',
    monthlyPrice: 0,
    annualPrice: null,
    additionalOutlet: 0,
    comingSoon: true,
    features: [
      'Semua fitur Komplit',
      'Konsolidasi cross-outlet',
      'Kitchen display + shift mgmt',
      'API integrasi',
    ],
  },
]

const SALES_WA =
  'https://wa.me/6285881732869?text=' +
  encodeURIComponent('Halo Vintra, saya ingin upgrade modul Kasir.')

const SALES_WA_PERPANJANG =
  'https://wa.me/6285881732869?text=' +
  encodeURIComponent(
    'Halo Vintra, langganan Kasir saya tidak aktif. Saya ingin perpanjang.',
  )

export default function PosBillingScreen() {
  const overview = usePosOverview()

  if (overview.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Paket Kasir" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (overview.error) {
    const err = overview.error
    const isForbidden = err instanceof ApiError && err.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Paket Kasir" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke billing POS.'
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
        title="Paket Kasir"
        subtitle={`Saat ini: ${TIERS.find((t) => t.tier === currentTier)?.name ?? currentTier}`}
        back
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
      >
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
            Tap tombol "Upgrade" pada paket yang kamu pilih, lalu chat
            sales kami via WhatsApp. Pembayaran via transfer / QRIS dan
            paket aktif paling lambat 1×24 jam.
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
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={10}
                color="#fff"
              >
                AKTIF
              </Paragraph>
            </YStack>
          )}
          {tier.isPopular && !isCurrent && (
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
          {tier.comingSoon && (
            <YStack px={8} py={3} br={999} bg={COLORS.warningTint}>
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={10}
                color="#92400e"
              >
                COMING SOON
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
                /bulan/outlet pertama
              </Paragraph>
            </XStack>
            {tier.annualPrice !== null && (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
              >
                Tahunan: Rp {tier.annualPrice.toLocaleString('id-ID')}/bulan
              </Paragraph>
            )}
            {tier.additionalOutlet > 0 && (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
              >
                + Rp {tier.additionalOutlet.toLocaleString('id-ID')}/outlet
                tambahan
              </Paragraph>
            )}
          </>
        )}
      </YStack>

      <YStack gap="$2" mt="$1">
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
            backgroundColor: tier.comingSoon ? '#fff' : COLORS.primary,
            borderWidth: tier.comingSoon ? 1 : 0,
            borderColor: COLORS.borderSubtle,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {tier.comingSoon ? (
            <>
              <MessageCircle size={14} color={COLORS.onSurface} />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Hubungi Sales
              </Paragraph>
            </>
          ) : (
            <>
              <Wallet size={14} color="#fff" />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color="#fff"
              >
                Upgrade
              </Paragraph>
            </>
          )}
        </Pressable>
      )}
    </YStack>
  )
}

export { SALES_WA, SALES_WA_PERPANJANG }
