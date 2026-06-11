/**
 * Studio billing — Konten credits + tier hint. Upgrade via WA sales.
 */
import { ActivityIndicator, Linking, Pressable, ScrollView } from 'react-native'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  MessageCircle,
  Sparkles,
} from '~/lib/icons'
import { useKontenLedger, useKontenStatus } from '~/lib/creative'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const SALES_WA =
  'https://wa.me/6285881732869?text=' +
  encodeURIComponent(
    'Halo Vintra, saya ingin tambah kredit Konten / Studio.',
  )

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
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

export default function StudioBillingScreen() {
  const ledger = useKontenLedger()
  const status = useKontenStatus()

  if (ledger.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Kredit Studio" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (ledger.error) {
    const isForbidden =
      ledger.error instanceof ApiError && ledger.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Kredit Studio" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat billing studio.'
              : 'Gagal memuat data kredit.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const cap = ledger.data?.monthlyCap ?? null
  const used = ledger.data?.used ?? 0
  const remaining = ledger.data?.remaining ?? null
  const pct = cap && cap > 0 ? Math.min(100, (used / cap) * 100) : 0
  const tier = status.data?.tier ?? '-'

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader title="Kredit Studio" subtitle={`Paket ${tier}`} back />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
        <YStack
          bg={COLORS.primary}
          br={16}
          p="$4"
          gap="$2"
          style={SHADOWS.card}
        >
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={11}
            color="rgba(255,255,255,0.85)"
            letterSpacing={0.4}
          >
            SISA KREDIT
          </Paragraph>
          <XStack ai="baseline" gap="$2">
            <Paragraph fontFamily={FONTS.monoMedium} fontSize={32} color="#fff">
              {remaining ?? '∞'}
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color="rgba(255,255,255,0.85)"
            >
              / {cap ?? '∞'} bulan ini
            </Paragraph>
          </XStack>
          {cap !== null && (
            <YStack
              w="100%"
              h={6}
              br={3}
              bg="rgba(255,255,255,0.18)"
              overflow="hidden"
              mt="$1"
            >
              <YStack h={6} br={3} bg="#fff" width={`${pct}%`} />
            </YStack>
          )}
          <Stat fontSize={11} color="rgba(255,255,255,0.85)">
            Reset {fmtDate(ledger.data?.periodEnd ?? null)}
          </Stat>
        </YStack>

        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
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
                Cara kerja kredit
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
              >
                Setiap generate konten, logo, atau spanduk mengurangi 1
                kredit. Reset otomatis tiap awal bulan sesuai paket.
              </Paragraph>
            </YStack>
          </XStack>
        </YStack>

        <Pressable
          onPress={() => void Linking.openURL(SALES_WA)}
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
          <MessageCircle size={16} color="#fff" />
          <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
            Tambah kredit / Upgrade
          </Paragraph>
        </Pressable>

        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$3"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
          >
            FITUR YANG TERMASUK
          </Paragraph>
          <Bullet text="Konten produk untuk feed Instagram + TikTok" />
          <Bullet text="Logo brand otomatis dari brief singkat" />
          <Bullet text="Spanduk full-width untuk depan toko / banner web" />
          <Bullet text="Semua hasil bisa di-download HD tanpa watermark" />
        </YStack>
      </ScrollView>
    </YStack>
  )
}

function Bullet({ text }: { text: string }) {
  return (
    <XStack ai="flex-start" gap="$2">
      <Sparkles size={12} color={COLORS.primary} />
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={12}
        color={COLORS.onSurface}
        flex={1}
      >
        {text}
      </Paragraph>
    </XStack>
  )
}
