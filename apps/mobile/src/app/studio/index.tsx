/**
 * Studio hub — combined gallery for konten + logo + spanduk +
 * generation CTAs.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image as RNImage,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertTriangle,
  CreditCard,
  Globe,
  Image as ImageIcon,
  Sparkles,
  Tag,
  Trash2,
} from '~/lib/icons'
import {
  useDeleteStudioGeneration,
  useKontenLedger,
  useStudioGenerations,
  type StudioGeneration,
} from '~/lib/creative'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

type Tab = 'all' | 'konten' | 'logo' | 'spanduk'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: 'Semua' },
  { key: 'konten', label: 'Konten' },
  { key: 'logo', label: 'Logo' },
  { key: 'spanduk', label: 'Spanduk' },
]

export default function StudioScreen() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('all')
  const query = useStudioGenerations(tab === 'all' ? undefined : tab)
  const ledger = useKontenLedger()
  const remove = useDeleteStudioGeneration()

  function confirmDelete(g: StudioGeneration) {
    Alert.alert('Hapus hasil?', 'Hasil akan dihapus permanen.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: () =>
          remove.mutate(
            { id: g.id, kind: g.kind },
            {
              onError: (err) =>
                Alert.alert(
                  'Gagal hapus',
                  err instanceof Error ? err.message : 'Coba lagi.',
                ),
            },
          ),
      },
    ])
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Studio Konten"
        subtitle="Hasil AI generation"
        back
        right={
          <Pressable
            onPress={() => router.push('/studio/billing' as never)}
            style={{
              padding: 8,
              borderRadius: 10,
              backgroundColor: COLORS.surfaceContainerLowest,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
            }}
          >
            <CreditCard size={16} color={COLORS.onSurface} />
          </Pressable>
        }
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
        {/* Credit hero */}
        {ledger.data && (
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
              KREDIT BULAN INI
            </Paragraph>
            <XStack ai="baseline" gap="$2">
              <Paragraph
                fontFamily={FONTS.monoMedium}
                fontSize={28}
                color="#fff"
              >
                {ledger.data.remaining ?? '∞'}
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color="rgba(255,255,255,0.85)"
              >
                /
                {ledger.data.monthlyCap ?? '∞'} kredit
              </Paragraph>
            </XStack>
            <Stat fontSize={11} color="rgba(255,255,255,0.85)">
              Terpakai {ledger.data.used} bulan ini
            </Stat>
          </YStack>
        )}

        {/* Generate CTAs */}
        <YStack gap="$2">
          <CtaRow
            icon={Sparkles}
            label="Generate Konten"
            desc="Foto produk, promo, ads"
            color="#9a4600"
            tint="#ffdbc9"
            onPress={() => router.push('/konten/generate' as never)}
          />
          <CtaRow
            icon={Tag}
            label="Buat Logo"
            desc="Logo brand otomatis"
            color="#7c3aed"
            tint="#ede9fe"
            onPress={() => router.push('/logo/generate' as never)}
          />
          <CtaRow
            icon={Globe}
            label="Buat Spanduk"
            desc="Banner besar untuk toko"
            color="#a0364d"
            tint="#ffd9dd"
            onPress={() => router.push('/spanduk/generate' as never)}
          />
        </YStack>

        {/* Tab */}
        <XStack
          ai="center"
          gap="$1"
          bg={COLORS.surfaceContainerLow}
          br={999}
          p={4}
        >
          {TABS.map((t) => {
            const on = t.key === tab
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: on ? '#fff' : 'transparent',
                  alignItems: 'center',
                }}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={11}
                  color={on ? COLORS.onSurface : COLORS.onSurfaceVariant}
                >
                  {t.label}
                </Paragraph>
              </Pressable>
            )
          })}
        </XStack>

        {/* Gallery */}
        {query.isLoading ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : query.error ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <AlertTriangle size={28} color={COLORS.danger} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={COLORS.onSurfaceVariant}
              ta="center"
              px="$4"
            >
              {query.error instanceof ApiError && query.error.status === 403
                ? 'Akun kamu tidak punya akses ke studio.'
                : 'Studio tersedia mulai paket Komplit.'}
            </Paragraph>
          </YStack>
        ) : (query.data ?? []).length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <ImageIcon size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              px="$4"
            >
              Belum ada hasil. Pakai salah satu generator di atas.
            </Paragraph>
          </YStack>
        ) : (
          <Gallery
            items={query.data ?? []}
            onDelete={confirmDelete}
          />
        )}
      </ScrollView>
    </YStack>
  )
}

function CtaRow({
  icon: Icon,
  label,
  desc,
  color,
  tint,
  onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>
  label: string
  desc: string
  color: string
  tint: string
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress}>
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
          br={14}
          bg={tint}
          ai="center"
          jc="center"
        >
          <Icon size={20} color={color} />
        </YStack>
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={14}
            color={COLORS.onSurface}
          >
            {label}
          </Paragraph>
          <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
            {desc}
          </Stat>
        </YStack>
        <Sparkles size={16} color={color} />
      </XStack>
    </Pressable>
  )
}

function Gallery({
  items,
  onDelete,
}: {
  items: StudioGeneration[]
  onDelete: (g: StudioGeneration) => void
}) {
  const { width } = useWindowDimensions()
  const itemW = (width - 16 * 2 - 8) / 2
  return (
    <XStack flexWrap="wrap" gap="$2">
      {items.map((g) => (
        <YStack
          key={g.id}
          width={itemW}
          bg={COLORS.surfaceContainerLowest}
          br={12}
          overflow="hidden"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
          style={SHADOWS.card}
        >
          <YStack
            w={itemW}
            h={itemW}
            bg={COLORS.surfaceContainerLow}
            ai="center"
            jc="center"
          >
            {g.thumbnailUrl ? (
              <RNImage
                source={{ uri: g.thumbnailUrl }}
                style={{ width: itemW, height: itemW }}
              />
            ) : (
              <ImageIcon size={28} color={COLORS.outline} />
            )}
          </YStack>
          <YStack p="$2" gap={2}>
            <XStack ai="center" jc="space-between">
              <YStack
                px={6}
                py={2}
                br={6}
                bg={
                  g.kind === 'konten'
                    ? '#ffdbc9'
                    : g.kind === 'logo'
                      ? '#ede9fe'
                      : '#ffd9dd'
                }
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={9}
                  color={
                    g.kind === 'konten'
                      ? '#9a4600'
                      : g.kind === 'logo'
                        ? '#7c3aed'
                        : '#a0364d'
                  }
                >
                  {g.kind.toUpperCase()}
                </Paragraph>
              </YStack>
              <Pressable onPress={() => onDelete(g)} hitSlop={6}>
                <Trash2 size={12} color={COLORS.outline} />
              </Pressable>
            </XStack>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
              numberOfLines={2}
            >
              {g.prompt}
            </Paragraph>
          </YStack>
        </YStack>
      ))}
    </XStack>
  )
}
