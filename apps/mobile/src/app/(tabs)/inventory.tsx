/**
 * Inventory tab (Phase B) — read-only list of items with stock per
 * branch + a low-stock filter chip. CRUD (add/edit/stock-adjust/
 * inter-branch transfer) is Phase C.
 *
 * Layout zones:
 *   1. Header   — brand-green strip with eyebrow + title.
 *   2. Toolbar  — branch picker (sheet) + search input + low-stock chip.
 *   3. List     — virtualized rows of items. Each row: photo placeholder,
 *                 name + SKU, total quantity in base unit, low-stock badge
 *                 if applicable.
 *   4. Empty    — friendly empty/error/loading states.
 *
 * Access: if the user doesn't have inventory access (no Inventory
 * subscription, missing inventory.read permission), the server fns
 * 403 and we show a soft "access required" message instead of an error.
 */
import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, TextInput, Linking } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import {
  Button,
  Paragraph,
  ScrollView,
  Sheet,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronRight,
  ExternalLink,
  Package,
  Plus,
  Search,
  Store,
  TrendingUp,
  X,
} from '~/lib/icons'
import {
  useInventoryItems,
  useInventoryBranches,
  type InventoryItemRow,
} from '../../lib/inventory'
import { useTenant } from '../../lib/tenant-context'
import { useOutlet } from '../../lib/outlet-context'
import { Stat } from '../../components/Money'
import { ItemFormSheet } from '../../components/inventory/ItemFormSheet'
import { COLORS, FONTS } from '../../lib/theme'

export default function InventoryTab() {
  const router = useRouter()
  const { state } = useTenant()
  const tenantSlug = state.status === 'ready' ? state.tenant.slug : null

  const branchesQuery = useInventoryBranches()
  const branches = branchesQuery.data?.branches ?? []

  // Branch scope is the global outlet (see use-outlet). The on-screen
  // picker stays as a shortcut to switching without going back to Home,
  // but it writes to the global state — so toggling here also flips
  // POS, sales chart, etc. We intentionally drop the legacy "Semua
  // cabang" aggregate since the global model is always pinned to one
  // outlet (matches the web's BranchSwitcher behavior).
  const { selectedBranchId, setSelectedBranchId } = useOutlet()
  const branchId = selectedBranchId
  // Honor ?lowStock=1 on the initial render — this is how the low-stock
  // notification deep-links into the tab with the filter chip toggled on.
  const { lowStock: lowStockParam } = useLocalSearchParams<{
    lowStock?: string
  }>()
  const [search, setSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(lowStockParam === '1')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const activeBranch = branches.find((b) => b.id === branchId) ?? null

  const itemsQuery = useInventoryItems({
    branchId: branchId ?? undefined,
    search: search.trim() || undefined,
    lowStockOnly,
  })

  const items = itemsQuery.data?.items ?? []
  const totalCount = itemsQuery.data?.total ?? 0

  // Server returns ALL items even when lowStockOnly=true? No — we trust
  // the server filter; this is just for the header copy.
  const lowStockCount = useMemo(
    () => items.filter((i) => i.isLowStock).length,
    [items],
  )

  return (
    <YStack flex={1} bg={COLORS.background}>
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <YStack bg={COLORS.primary} pt={60} pb="$4" px="$5" gap="$1.5">
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={12}
          color="white"
          opacity={0.85}
        >
          Stok Bahan & Produk
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={24}
          color="white"
        >
          Inventory
        </Paragraph>
      </YStack>

      {/* ── TOOLBAR ────────────────────────────────────────────── */}
      <YStack px="$4" py="$3" gap="$2.5" bg={COLORS.surfaceContainerLowest}>
        {/* Branch picker */}
        <Pressable onPress={() => setPickerOpen(true)}>
          <XStack
            ai="center"
            gap="$2"
            bg={COLORS.surfaceContainerLow}
            br={9999}
            px="$3.5"
            h={44}
            borderWidth={1}
            borderColor={COLORS.outlineVariant}
          >
            <Store size={16} color={COLORS.primary} />
            <YStack flex={1}>
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={13}
                color={COLORS.onSurface}
                numberOfLines={1}
              >
                {activeBranch?.name ?? 'Memuat outlet...'}
              </Paragraph>
            </YStack>
            <ChevronRight size={16} color={COLORS.outline} />
          </XStack>
        </Pressable>

        {/* Search */}
        <XStack
          ai="center"
          gap="$2"
          bg={COLORS.surfaceContainerLow}
          br={9999}
          px="$3.5"
          h={44}
          borderWidth={1}
          borderColor={COLORS.outlineVariant}
        >
          <Search size={16} color={COLORS.outline} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Cari nama atau SKU..."
            placeholderTextColor={COLORS.outline}
            style={{
              flex: 1,
              fontSize: 14,
              fontFamily: FONTS.body,
              color: COLORS.onSurface,
              paddingVertical: 0,
            }}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <X size={16} color={COLORS.outline} />
            </Pressable>
          )}
        </XStack>

        {/* Low-stock filter chip */}
        <XStack ai="center" gap="$2">
          <Pressable onPress={() => setLowStockOnly((v) => !v)}>
            <XStack
              ai="center"
              gap="$1.5"
              bg={lowStockOnly ? COLORS.warning : COLORS.surfaceContainerLow}
              br={9999}
              px="$3"
              py="$1.5"
              borderWidth={1}
              borderColor={lowStockOnly ? COLORS.warning : COLORS.outlineVariant}
            >
              <AlertTriangle
                size={12}
                color={lowStockOnly ? 'white' : COLORS.warning}
              />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={lowStockOnly ? 'white' : COLORS.onSurface}
              >
                Stok menipis
              </Paragraph>
              {lowStockOnly && <Check size={12} color="white" />}
            </XStack>
          </Pressable>
          <YStack flex={1} />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            {itemsQuery.isLoading
              ? '...'
              : `${totalCount} item${lowStockOnly && lowStockCount > 0 ? ` (${lowStockCount} menipis)` : ''}`}
          </Paragraph>
        </XStack>
      </YStack>

      {/* ── Quick link to requisitions (JUR-190) ───────────────── */}
      <Pressable
        onPress={() => router.push('/inventory/requisitions')}
      >
        <XStack
          mx="$4"
          mb="$2"
          ai="center"
          gap="$2.5"
          p="$3"
          br="$3"
          bg={COLORS.primaryFixed}
          borderWidth={1}
          borderColor={COLORS.primary}
        >
          <TrendingUp size={18} color={COLORS.primary} />
          <YStack flex={1}>
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={13}
              color={COLORS.primary}
            >
              Mutasi Stok antar Cabang
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
            >
              Permintaan & pemenuhan barang antar outlet
            </Paragraph>
          </YStack>
          <ChevronRight size={16} color={COLORS.primary} />
        </XStack>
      </Pressable>

      {/* ── LIST ───────────────────────────────────────────────── */}
      <ListBody
        query={itemsQuery}
        items={items}
        tenantSlug={tenantSlug}
        lowStockOnly={lowStockOnly}
      />

      {/* ── FAB — Tambah Barang ────────────────────────────────── */}
      <YStack
        position="absolute"
        bottom={24}
        right={20}
        shadowColor="#000"
        shadowOpacity={0.18}
        shadowRadius={12}
        shadowOffset={{ width: 0, height: 6 }}
        elevation={8}
      >
        <Pressable onPress={() => setCreateOpen(true)}>
          <XStack
            ai="center"
            gap="$2"
            bg={COLORS.primary}
            br={9999}
            px="$4"
            h={52}
          >
            <Plus size={20} color="white" />
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={14}
              color="white"
            >
              Tambah Barang
            </Paragraph>
          </XStack>
        </Pressable>
      </YStack>

      <ItemFormSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => itemsQuery.refetch()}
      />

      {/* ── BRANCH PICKER SHEET ────────────────────────────────── */}
      <Sheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        snapPoints={[60]}
        modal
        dismissOnSnapToBottom
      >
        <Sheet.Overlay />
        <Sheet.Handle />
        <Sheet.Frame padding="$4" gap="$3" bg={COLORS.surfaceContainerLowest}>
          <Paragraph
            fontFamily={FONTS.headingBold}
            fontSize={18}
            color={COLORS.onSurface}
          >
            Pilih Outlet
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
          >
            Pilihan ini berlaku di semua modul.
          </Paragraph>
          <ScrollView>
            <YStack gap="$1.5">
              {branches.map((b) => (
                <BranchOption
                  key={b.id}
                  label={b.name}
                  helper={b.address ?? undefined}
                  active={branchId === b.id}
                  onPress={() => {
                    setSelectedBranchId(b.id)
                    setPickerOpen(false)
                  }}
                />
              ))}
            </YStack>
          </ScrollView>
        </Sheet.Frame>
      </Sheet>
    </YStack>
  )
}

// ─── Body (list / loading / empty / error) ──────────────────────────

function ListBody({
  query,
  items,
  tenantSlug,
  lowStockOnly,
}: {
  query: ReturnType<typeof useInventoryItems>
  items: InventoryItemRow[]
  tenantSlug: string | null
  lowStockOnly: boolean
}) {
  if (query.isLoading) {
    return (
      <YStack flex={1} ai="center" jc="center" gap="$3">
        <Spinner color={COLORS.primary} size="large" />
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={13}
          color={COLORS.onSurfaceVariant}
        >
          Memuat stok...
        </Paragraph>
      </YStack>
    )
  }

  if (query.error) {
    return <ErrorState error={query.error} tenantSlug={tenantSlug} />
  }

  if (items.length === 0) {
    return <EmptyState lowStockOnly={lowStockOnly} />
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 96 }}
      refreshControl={
        <RefreshControl
          refreshing={query.isFetching}
          onRefresh={() => query.refetch()}
          tintColor={COLORS.primary}
        />
      }
    >
      {items.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
    </ScrollView>
  )
}

function ItemRow({ item }: { item: InventoryItemRow }) {
  const router = useRouter()
  // Decide the quantity tint:
  //   - red if minStockLevel set AND below it
  //   - amber if within 1.25× of min
  //   - default text otherwise
  const qtyTint = item.isLowStock
    ? COLORS.danger
    : item.minStockLevel != null && item.totalQuantity < item.minStockLevel * 1.25
      ? COLORS.warning
      : COLORS.onSurface

  return (
    <Pressable onPress={() => router.push(`/inventory/${item.id}` as never)}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br="$4"
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={item.isLowStock ? COLORS.warning : COLORS.outlineVariant}
      >
        <XStack ai="center" gap="$3">
        {/* Photo placeholder — Phase C wires the signed S3 URL */}
        <YStack
          w={48}
          h={48}
          br={12}
          bg={COLORS.surfaceContainerLow}
          ai="center"
          jc="center"
        >
          <Package size={22} color={COLORS.outline} />
        </YStack>

        <YStack flex={1} gap={2}>
          <Paragraph
            fontFamily={FONTS.headingSemi}
            fontSize={14}
            color={COLORS.onSurface}
            numberOfLines={1}
          >
            {item.name}
          </Paragraph>
          <XStack gap="$2" ai="center">
            {item.sku && (
              <Paragraph
                fontFamily={FONTS.mono}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
                numberOfLines={1}
              >
                {item.sku}
              </Paragraph>
            )}
            {item.categoryName && (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
                numberOfLines={1}
              >
                · {item.categoryName}
              </Paragraph>
            )}
          </XStack>
        </YStack>

        <YStack ai="flex-end" gap={2}>
          <Stat fontSize={14} color={qtyTint} emphasis>
            {formatQty(item.totalQuantity)} {item.baseUnit.label}
          </Stat>
          {item.minStockLevel != null && (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={10}
              color={COLORS.onSurfaceVariant}
            >
              min {formatQty(item.minStockLevel)}
            </Paragraph>
          )}
        </YStack>
      </XStack>

        {item.isLowStock && (
          <XStack
            ai="center"
            gap="$1.5"
            bg={COLORS.warningTint}
            br={9999}
            px="$2.5"
            py="$1"
            alignSelf="flex-start"
          >
            <AlertCircle size={11} color={COLORS.warning} />
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={10}
              color={COLORS.warning}
            >
              Stok di bawah minimum
            </Paragraph>
          </XStack>
        )}
      </YStack>
    </Pressable>
  )
}

// ─── States ──────────────────────────────────────────────────────────

function EmptyState({ lowStockOnly }: { lowStockOnly: boolean }) {
  return (
    <YStack flex={1} ai="center" jc="center" gap="$3" px="$6">
      <YStack
        w={88}
        h={88}
        br={44}
        bg={COLORS.primaryFixed}
        ai="center"
        jc="center"
      >
        <Package size={40} color={COLORS.primary} />
      </YStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        color={COLORS.onSurface}
        ta="center"
      >
        {lowStockOnly ? 'Stok aman' : 'Belum ada barang'}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        lineHeight={20}
        color={COLORS.onSurfaceVariant}
        ta="center"
        maxWidth={280}
      >
        {lowStockOnly
          ? 'Tidak ada barang yang stoknya di bawah batas minimum.'
          : 'Tambah barang dari dashboard web untuk mulai tracking stok.'}
      </Paragraph>
    </YStack>
  )
}

function ErrorState({
  error,
  tenantSlug,
}: {
  error: unknown
  tenantSlug: string | null
}) {
  const message = error instanceof Error ? error.message : 'Gagal memuat'
  const isAccessError =
    message.toLowerCase().includes('forbidden') ||
    message.toLowerCase().includes('tidak diizinkan') ||
    message.toLowerCase().includes('belum aktif')

  const webUrl = tenantSlug
    ? `https://${tenantSlug}.vintra.my.id/inventory`
    : 'https://vintra.my.id/inventory'

  return (
    <YStack flex={1} ai="center" jc="center" gap="$3" px="$6">
      <YStack
        w={88}
        h={88}
        br={44}
        bg={COLORS.surfaceContainerLow}
        ai="center"
        jc="center"
      >
        <AlertCircle size={40} color={COLORS.outline} />
      </YStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        color={COLORS.onSurface}
        ta="center"
      >
        {isAccessError ? 'Akses Inventory belum aktif' : 'Gagal memuat stok'}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        lineHeight={20}
        color={COLORS.onSurfaceVariant}
        ta="center"
        maxWidth={300}
      >
        {isAccessError
          ? 'Aktifkan modul Inventory di dashboard atau minta owner untuk memberi akses.'
          : message}
      </Paragraph>
      <Pressable onPress={() => Linking.openURL(webUrl)}>
        <XStack
          ai="center"
          gap="$2"
          bg={COLORS.primaryFixed}
          br={9999}
          px="$4"
          py="$2.5"
          mt="$2"
        >
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={14}
            color={COLORS.primary}
          >
            Buka di Web
          </Paragraph>
          <ExternalLink size={14} color={COLORS.primary} />
        </XStack>
      </Pressable>
    </YStack>
  )
}

// ─── Branch picker option ────────────────────────────────────────────

function BranchOption({
  label,
  helper,
  active,
  onPress,
}: {
  label: string
  helper?: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress}>
      <XStack
        ai="center"
        gap="$3"
        p="$3"
        br="$3"
        bg={active ? COLORS.primaryFixed : 'transparent'}
        borderWidth={1}
        borderColor={active ? COLORS.primary : COLORS.outlineVariant}
      >
        <Store
          size={18}
          color={active ? COLORS.primary : COLORS.onSurfaceVariant}
        />
        <YStack flex={1}>
          <Paragraph
            fontFamily={active ? FONTS.headingSemi : FONTS.bodyMedium}
            fontSize={14}
            color={active ? COLORS.primary : COLORS.onSurface}
          >
            {label}
          </Paragraph>
          {helper && (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
              numberOfLines={1}
            >
              {helper}
            </Paragraph>
          )}
        </YStack>
        {active && <Check size={18} color={COLORS.primary} />}
      </XStack>
    </Pressable>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

const qtyFormatter = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

/** Format a base-unit quantity with id-ID thousand separators (dot). */
function formatQty(n: number): string {
  return qtyFormatter.format(n)
}
