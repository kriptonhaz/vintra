/**
 * Inventory locked state — subscription expired/downgraded. Wraps the
 * standard pattern (see-plans + contact-sales) used by other modules.
 */
import { Linking, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { Paragraph, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Lock, MessageCircle, Wallet } from '~/lib/icons'
import { SALES_WA_PERPANJANG } from './billing'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function InventoryLockedScreen() {
  const router = useRouter()
  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader title="Inventaris" back />
      <YStack flex={1} ai="center" jc="center" px="$5" gap="$4">
        <YStack
          w={88}
          h={88}
          br={28}
          bg={COLORS.warningTint}
          ai="center"
          jc="center"
          style={SHADOWS.card}
        >
          <Lock size={36} color="#92400e" />
        </YStack>
        <YStack ai="center" gap="$2" maxWidth={320}>
          <Paragraph
            fontFamily={FONTS.headingBold}
            fontSize={20}
            color={COLORS.onSurface}
            ta="center"
          >
            Langganan Inventaris tidak aktif
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={14}
            color={COLORS.onSurfaceVariant}
            ta="center"
          >
            Akses Inventory sedang dibekukan. Perpanjang paket atau hubungi
            sales kami untuk lanjut catat stok.
          </Paragraph>
        </YStack>
        <YStack gap="$2" width="100%" maxWidth={320}>
          <Pressable
            onPress={() => router.push('/inventory/billing' as never)}
            style={{
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Wallet size={16} color="#fff" />
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
              Lihat paket
            </Paragraph>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(SALES_WA_PERPANJANG)}
            style={{
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: COLORS.surfaceContainerLowest,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <MessageCircle size={16} color={COLORS.onSurface} />
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={14}
              color={COLORS.onSurface}
            >
              Hubungi sales
            </Paragraph>
          </Pressable>
        </YStack>
      </YStack>
    </YStack>
  )
}
