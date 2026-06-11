/**
 * Site locked — booking module (which gates microsite) inactive.
 */
import { Linking, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { Paragraph, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Lock, MessageCircle, Wallet } from '~/lib/icons'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const SALES_WA =
  'https://wa.me/6285881732869?text=' +
  encodeURIComponent(
    'Halo Vintra, langganan Booking saya tidak aktif (situs juga terkunci). Saya ingin perpanjang.',
  )

export default function SiteLockedScreen() {
  const router = useRouter()
  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader title="Situs" back />
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
            Situs publik tidak aktif
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={14}
            color={COLORS.onSurfaceVariant}
            ta="center"
          >
            Microsite tergantung pada modul Booking. Aktifkan / perpanjang
            paket Booking untuk publish situs lagi.
          </Paragraph>
        </YStack>
        <YStack gap="$2" width="100%" maxWidth={320}>
          <Pressable
            onPress={() => router.push('/booking' as never)}
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
              Atur Booking
            </Paragraph>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(SALES_WA)}
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
