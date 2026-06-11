/**
 * HPP dashboard — product list with HPP, margin, selling price.
 *
 * Mirrors apps/web/src/routes/_authed/hpp/index.tsx but adapted for
 * mobile: stat strip + search + scrollable product cards (instead of a
 * table). Tap a card → opens the wizard in edit mode. Long-press → row
 * actions (delete / duplicate).
 *
 * Photo thumbnails are batched via getHppPhotoUrls for the visible
 * page, matching the web's approach (one server roundtrip per page,
 * not N).
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertTriangle,
  ChevronRight,
  Package,
  Plus,
  Search,
  Star,
  TrendingUp,
} from '~/lib/icons'
import {
  useDeleteProduct,
  useDuplicateProduct,
  useHppPhotoUrls,
  useHppReport,
  type HppProductRow,
} from '~/lib/hpp'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'
import { ApiError } from '~/lib/api'

// `lucide-react`-style fallback for `Star` — the mobile icon barrel does
// have it; pull from the same import above so it stays consistent.

export default function HppDashboard() {
  const router = useRouter()
  const [search, setSearch] = useState('')

  const reportQuery = useHppReport()
  const report = reportQuery.data ?? { products: [], materialCount: 0 }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return report.products
    return report.products.filter((p) => p.name.toLowerCase().includes(q))
  }, [report.products, search])

  // ── Stats ─────────────────────────────────────────────────────────
  const totalProducts = report.products.length
  const productsWithMargin = report.products.filter((p) => p.margin !== null)
  const avgMargin =
    productsWithMargin.length > 0
      ? productsWithMargin.reduce((sum, p) => sum + Number(p.margin ?? 0), 0) /
        productsWithMargin.length
      : null
  const bestProduct = productsWithMargin.reduce<HppProductRow | null>(
    (best, p) =>
      best && Number(best.margin ?? 0) >= Number(p.margin ?? 0) ? best : p,
    null,
  )
  const needsUpdateCount = report.products.filter((p) => p.hpp === null).length

  // ── Photo URLs (paged to the filtered set) ─────────────────────────
  const visibleKeys = useMemo(
    () =>
      filtered
        .map((p) => p.effectivePhotoKey)
        .filter((k): k is string => !!k),
    [filtered],
  )
  const photoUrlsQuery = useHppPhotoUrls(visibleKeys)
  const photoUrls = photoUrlsQuery.data ?? {}

  // ── Mutations ─────────────────────────────────────────────────────
  const deleteProduct = useDeleteProduct()
  const duplicateProduct = useDuplicateProduct()

  function onCardPress(product: HppProductRow) {
    router.push({
      pathname: '/hpp/calculate' as never,
      params: { editProductId: product.id },
    } as never)
  }

  function onCardLongPress(product: HppProductRow) {
    Alert.alert(product.name, undefined, [
      {
        text: 'Duplikat',
        onPress: () => {
          duplicateProduct.mutate(product.id, {
            onError: (err) =>
              Alert.alert('Gagal menduplikasi', errorMessage(err)),
          })
        },
      },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: () => confirmDelete(product),
      },
      { text: 'Batal', style: 'cancel' },
    ])
  }

  function confirmDelete(product: HppProductRow) {
    Alert.alert(
      'Hapus produk?',
      `"${product.name}" akan dihapus permanen. Resep + foto tidak bisa dikembalikan.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () => {
            deleteProduct.mutate(product.id, {
              onError: (err) =>
                Alert.alert('Gagal menghapus', errorMessage(err)),
            })
          },
        },
      ],
    )
  }

  // ── Loading / error ───────────────────────────────────────────────
  if (reportQuery.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="HPP" subtitle="Memuat produk…" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }

  if (reportQuery.error) {
    const err = reportQuery.error
    const isForbidden = err instanceof ApiError && err.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="HPP" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu belum punya akses ke modul HPP.'
              : 'Gagal memuat data HPP. Cek koneksi & coba lagi.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="HPP"
        subtitle={`${totalProducts} produk · ${report.materialCount} bahan`}
        back
        right={
          <Pressable
            onPress={() => router.push('/hpp/calculate' as never)}
            style={{
              backgroundColor: COLORS.primary,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Plus size={16} color="#fff" />
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={13} color="#fff">
              Hitung
            </Paragraph>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={reportQuery.isFetching}
            onRefresh={() => reportQuery.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Stat strip */}
        <XStack gap="$3" flexWrap="wrap">
          <StatTile
            label="Produk"
            value={String(totalProducts)}
            icon={Package}
            tint={COLORS.primaryFixed}
            iconColor={COLORS.primary}
          />
          <StatTile
            label="Avg Margin"
            value={avgMargin !== null ? `${avgMargin.toFixed(1)}%` : '-'}
            icon={TrendingUp}
            tint="#dbeafe"
            iconColor="#2563eb"
          />
          <StatTile
            label="Margin Tertinggi"
            value={
              bestProduct?.margin
                ? `${Number(bestProduct.margin).toFixed(1)}%`
                : '-'
            }
            sub={bestProduct?.name ?? undefined}
            icon={Star}
            tint="#fef3c7"
            iconColor="#d97706"
          />
          <StatTile
            label="Perlu Update"
            value={String(needsUpdateCount)}
            icon={AlertTriangle}
            tint={needsUpdateCount > 0 ? COLORS.dangerTint : COLORS.successTint}
            iconColor={needsUpdateCount > 0 ? COLORS.danger : COLORS.success}
          />
        </XStack>

        {/* Search */}
        <XStack
          ai="center"
          gap="$2"
          bg={COLORS.surfaceContainerLowest}
          br={12}
          px="$3"
          h={44}
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <Search size={16} color={COLORS.outline} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Cari produk…"
            placeholderTextColor={COLORS.outline}
            style={{
              flex: 1,
              fontFamily: FONTS.body,
              fontSize: 14,
              color: COLORS.onSurface,
              paddingVertical: 0,
            }}
          />
        </XStack>

        {/* Product list */}
        {totalProducts === 0 ? (
          <EmptyState
            title="Belum ada produk"
            body="Mulai hitung HPP produkmu untuk tahu margin keuntungan tiap item."
            ctaLabel="Hitung HPP baru"
            onCta={() => router.push('/hpp/calculate' as never)}
          />
        ) : filtered.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            bg={COLORS.surfaceContainerLowest}
            br={16}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={14}
              color={COLORS.onSurfaceVariant}
            >
              Tidak ada produk cocok dengan "{search}".
            </Paragraph>
          </YStack>
        ) : (
          <YStack gap="$2">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                photoUrl={
                  product.effectivePhotoKey
                    ? (photoUrls[product.effectivePhotoKey] ?? null)
                    : null
                }
                onPress={() => onCardPress(product)}
                onLongPress={() => onCardLongPress(product)}
              />
            ))}
          </YStack>
        )}
      </ScrollView>
    </YStack>
  )
}

// ─── Subcomponents ───────────────────────────────────────────────────

interface StatTileProps {
  label: string
  value: string
  sub?: string
  icon: React.ComponentType<{ size?: number; color?: string }>
  tint: string
  iconColor: string
}

function StatTile({ label, value, sub, icon: Icon, tint, iconColor }: StatTileProps) {
  return (
    <YStack
      flexBasis="48%"
      flexGrow={1}
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
        <YStack
          w={28}
          h={28}
          br={9}
          bg={tint}
          ai="center"
          jc="center"
        >
          <Icon size={14} color={iconColor} />
        </YStack>
      </XStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        color={COLORS.onSurface}
        numberOfLines={1}
      >
        {value}
      </Paragraph>
      {sub ? (
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={11}
          color={COLORS.onSurfaceVariant}
          numberOfLines={1}
        >
          {sub}
        </Paragraph>
      ) : null}
    </YStack>
  )
}

interface ProductCardProps {
  product: HppProductRow
  photoUrl: string | null
  onPress: () => void
  onLongPress: () => void
}

function ProductCard({ product, photoUrl, onPress, onLongPress }: ProductCardProps) {
  const sellingPrice = Number(product.sellingPrice) || 0
  const hpp = product.hpp !== null ? Number(product.hpp) : null
  const margin = product.margin !== null ? Number(product.margin) : null

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress}>
      <XStack
        ai="center"
        gap="$3"
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
      >
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            style={{ width: 52, height: 52, borderRadius: 12 }}
          />
        ) : (
          <YStack
            w={52}
            h={52}
            br={12}
            bg={COLORS.surfaceContainerLow}
            ai="center"
            jc="center"
          >
            <Package size={22} color={COLORS.outline} />
          </YStack>
        )}

        <YStack flex={1} gap={2}>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={14}
            color={COLORS.onSurface}
            numberOfLines={1}
          >
            {product.name}
          </Paragraph>
          <XStack gap="$2" ai="center" flexWrap="wrap">
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
            >
              {product.category ?? 'Tanpa kategori'}
            </Paragraph>
            {margin !== null && (
              <MarginPill margin={margin} />
            )}
          </XStack>
          <XStack gap="$3" ai="baseline" mt={2}>
            <Money amount={sellingPrice} fontSize={13} emphasis />
            {hpp !== null && (
              <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                HPP {hpp.toLocaleString('id-ID')}
              </Stat>
            )}
          </XStack>
        </YStack>

        <ChevronRight size={18} color={COLORS.outline} />
      </XStack>
    </Pressable>
  )
}

function MarginPill({ margin }: { margin: number }) {
  const tone =
    margin >= 40
      ? { bg: COLORS.successTint, fg: COLORS.success }
      : margin >= 20
        ? { bg: COLORS.warningTint, fg: '#92400e' }
        : { bg: COLORS.dangerTint, fg: COLORS.danger }
  return (
    <YStack px={6} py={2} br={6} bg={tone.bg}>
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={10}
        color={tone.fg}
      >
        {margin.toFixed(1)}%
      </Paragraph>
    </YStack>
  )
}

interface EmptyStateProps {
  title: string
  body: string
  ctaLabel: string
  onCta: () => void
}

function EmptyState({ title, body, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <YStack
      ai="center"
      gap="$3"
      py="$10"
      bg={COLORS.surfaceContainerLowest}
      br={16}
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      px="$5"
    >
      <YStack
        w={72}
        h={72}
        br={20}
        bg={COLORS.primaryFixed}
        ai="center"
        jc="center"
      >
        <Package size={32} color={COLORS.primary} />
      </YStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={16}
        color={COLORS.onSurface}
      >
        {title}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        color={COLORS.onSurfaceVariant}
        ta="center"
      >
        {body}
      </Paragraph>
      <Pressable
        onPress={onCta}
        style={{
          marginTop: 8,
          backgroundColor: COLORS.primary,
          paddingVertical: 12,
          paddingHorizontal: 20,
          borderRadius: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Plus size={16} color="#fff" />
        <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
          {ctaLabel}
        </Paragraph>
      </Pressable>
    </YStack>
  )
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const body = JSON.parse(err.body) as { error?: string }
      if (body.error) return body.error
    } catch {
      // body wasn't JSON, fall through
    }
    return err.message
  }
  if (err instanceof Error) return err.message
  return 'Terjadi kesalahan tidak dikenal.'
}
