/**
 * Arus Kas hub — lands the user on a launcher with quick-stats + tiles
 * into the 5 sub-screens (dashboard, catatan, akun, kategori, bon,
 * cicilan).
 *
 * We deliberately make this the cashflow root (mobileHref '/cashflow')
 * so the lainnya tile opens a fast-loading menu rather than blocking
 * on the heavier dashboard query.
 */
import { Linking, Pressable, RefreshControl, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { ActivityIndicator } from 'react-native'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money } from '~/components/Money'
import {
  AlertTriangle,
  BarChart2,
  ChevronRight,
  CreditCard,
  FileText,
  Tag,
  Truck,
  Users,
  Wallet,
} from '~/lib/icons'
import { useCashflowOverview, useHomeCashflow } from '~/lib/cashflow'
import { useTenant } from '~/lib/tenant-context'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

interface Tile {
  key: string
  label: string
  desc: string
  icon: React.ComponentType<{ size?: number; color?: string }>
  iconColor: string
  tint: string
  href: string
}

const TILES: Tile[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    desc: 'Ringkasan + breakdown kategori',
    icon: BarChart2,
    iconColor: '#2563eb',
    tint: '#dbeafe',
    href: '/cashflow/dashboard',
  },
  {
    key: 'entries',
    label: 'Catatan Kas',
    desc: 'Tambah pemasukan & pengeluaran',
    icon: FileText,
    iconColor: COLORS.primary,
    tint: COLORS.primaryFixed,
    href: '/cashflow/entries',
  },
  {
    key: 'akun',
    label: 'Akun & Bank',
    desc: 'Saldo + transfer antar akun',
    icon: Wallet,
    iconColor: '#7c3aed',
    tint: '#ede9fe',
    href: '/cashflow/akun',
  },
  {
    key: 'kategori',
    label: 'Kategori',
    desc: 'Atur kategori income & expense',
    icon: Tag,
    iconColor: '#0891b2',
    tint: '#cffafe',
    href: '/cashflow/kategori',
  },
  {
    key: 'bon',
    label: 'Bon Pelanggan',
    desc: 'Piutang & pelunasan',
    icon: Users,
    iconColor: '#9a4600',
    tint: '#ffdbc9',
    href: '/cashflow/bon',
  },
  {
    key: 'cicilan',
    label: 'Cicilan',
    desc: 'Utang & jadwal pembayaran',
    icon: Truck,
    iconColor: '#a0364d',
    tint: '#ffd9dd',
    href: '/cashflow/cicilan',
  },
]

export default function CashflowHub() {
  const router = useRouter()
  const access = useCashflowOverview()
  const today = useHomeCashflow()

  if (access.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Arus Kas" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }

  if (access.error || (access.data && !access.data.hasAccess)) {
    const err = access.error
    const isForbidden = err instanceof ApiError && err.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Arus Kas" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke Arus Kas.'
              : 'Arus Kas tersedia mulai paket Toko. Upgrade dulu yuk.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader title="Arus Kas" subtitle="Catatan keuangan harian" back />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={today.isFetching}
            onRefresh={() => today.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Today snapshot */}
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
            HARI INI
          </Paragraph>
          <XStack ai="baseline" jc="space-between">
            <YStack>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color="rgba(255,255,255,0.85)"
              >
                Pemasukan
              </Paragraph>
              <Money
                amount={today.data?.income ?? 0}
                color="#fff"
                fontSize={18}
                emphasis
              />
            </YStack>
            <YStack ai="flex-end">
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color="rgba(255,255,255,0.85)"
              >
                Pengeluaran
              </Paragraph>
              <Money
                amount={today.data?.expense ?? 0}
                color="#fff"
                fontSize={18}
                emphasis
              />
            </YStack>
          </XStack>
          <YStack h={1} bg="rgba(255,255,255,0.18)" my={4} />
          <XStack ai="baseline" jc="space-between">
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={13}
              color="#fff"
            >
              Net hari ini
            </Paragraph>
            <Money
              amount={(today.data?.income ?? 0) - (today.data?.expense ?? 0)}
              color="#fff"
              fontSize={20}
              emphasis
            />
          </XStack>
        </YStack>

        {/* Tile launcher */}
        {TILES.map((t) => {
          const Icon = t.icon
          return (
            <Pressable
              key={t.key}
              onPress={() => router.push(t.href as never)}
            >
              <XStack
                ai="center"
                gap="$3"
                bg={COLORS.surfaceContainerLowest}
                br={14}
                p="$3"
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
                style={SHADOWS.card}
              >
                <YStack
                  w={44}
                  h={44}
                  br={12}
                  bg={t.tint}
                  ai="center"
                  jc="center"
                >
                  <Icon size={20} color={t.iconColor} />
                </YStack>
                <YStack flex={1}>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {t.label}
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    {t.desc}
                  </Paragraph>
                </YStack>
                <ChevronRight size={18} color={COLORS.outline} />
              </XStack>
            </Pressable>
          )
        })}
      </ScrollView>
    </YStack>
  )
}

// Keep CreditCard imported so we can extend the tiles later w/ a Plans
// link without re-importing.
const _CreditCard = CreditCard
const _Linking = Linking
const _useTenant = useTenant
