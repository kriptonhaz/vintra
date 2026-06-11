/**
 * Item detail screen — pushed from the inventory list. Shows the item
 * header, per-branch stock breakdown, and the last N stock movements
 * (history clamped server-side by tier).
 *
 * Action menu (top-right): Edit, Sesuaikan Stok, Nonaktifkan.
 *   - Edit          → opens ItemFormSheet pre-filled
 *   - Sesuaikan Stok → opens StockAdjustSheet for this item
 *   - Nonaktifkan   → soft-delete via deactivateInventoryItem
 *                     (the server refuses if there are open balances)
 */
import { useState } from 'react'
import { Alert, Pressable, RefreshControl } from 'react-native'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
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
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  Edit,
  MoreHorizontal,
  Package,
  RotateCcw,
  Store,
  Trash2,
} from '~/lib/icons'

const EditIcon = Edit
import {
  useDeactivateItem,
  useInventoryItem,
} from '../../lib/inventory'
import { ItemFormSheet } from '../../components/inventory/ItemFormSheet'
import { StockAdjustSheet } from '../../components/inventory/StockAdjustSheet'
import { Money, Stat } from '../../components/Money'
import { COLORS, FONTS } from '../../lib/theme'

export default function ItemDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const itemQuery = useInventoryItem(id ?? null)
  const deactivate = useDeactivateItem()

  const [editOpen, setEditOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  function handleDeactivate() {
    if (!id) return
    setMenuOpen(false)
    Alert.alert(
      'Nonaktifkan barang?',
      'Barang akan disembunyikan dari katalog. Bisa diaktifkan kembali dari web.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Nonaktifkan',
          style: 'destructive',
          onPress: async () => {
            try {
              await deactivate.mutateAsync(id)
              router.back()
            } catch (e) {
              Alert.alert(
                'Gagal',
                e instanceof Error ? e.message : 'Coba lagi.',
              )
            }
          },
        },
      ],
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <YStack flex={1} bg={COLORS.background}>
        {/* Header */}
        <YStack bg={COLORS.primary} pt={60} pb="$4" px="$5" gap="$2">
          <XStack ai="center" jc="space-between">
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <YStack
                w={36}
                h={36}
                br={18}
                bg={COLORS.primaryFixed}
                ai="center"
                jc="center"
              >
                <ChevronLeft size={22} color={COLORS.primary} />
              </YStack>
            </Pressable>

            <Pressable
              onPress={() => setMenuOpen(true)}
              hitSlop={10}
              disabled={!itemQuery.data}
            >
              <YStack
                w={36}
                h={36}
                br={18}
                bg={COLORS.primaryFixed}
                ai="center"
                jc="center"
                opacity={itemQuery.data ? 1 : 0.5}
              >
                <MoreHorizontal size={22} color={COLORS.primary} />
              </YStack>
            </Pressable>
          </XStack>
          <YStack gap="$0.5">
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color="white"
              opacity={0.85}
            >
              Detail Barang
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={22}
              color="white"
              numberOfLines={2}
            >
              {itemQuery.data?.name ?? 'Memuat...'}
            </Paragraph>
            {itemQuery.data?.sku && (
              <Paragraph
                fontFamily={FONTS.mono}
                fontSize={12}
                color="white"
                opacity={0.8}
              >
                SKU {itemQuery.data.sku}
              </Paragraph>
            )}
          </YStack>
        </YStack>

        {/* Body */}
        {itemQuery.isLoading ? (
          <YStack flex={1} ai="center" jc="center" gap="$3">
            <Spinner color={COLORS.primary} size="large" />
          </YStack>
        ) : itemQuery.error || !itemQuery.data ? (
          <YStack flex={1} ai="center" jc="center" gap="$3" px="$6">
            <AlertCircle size={48} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={16}
              color={COLORS.onSurface}
            >
              Gagal memuat barang
            </Paragraph>
            <Button
              bg={COLORS.primary}
              borderWidth={0}
              br={9999}
              h={44}
              onPress={() => itemQuery.refetch()}
            >
              <Paragraph fontFamily={FONTS.bodyBold} color="white">
                Coba lagi
              </Paragraph>
            </Button>
          </YStack>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 96 }}
            refreshControl={
              <RefreshControl
                refreshing={itemQuery.isFetching}
                onRefresh={() => itemQuery.refetch()}
                tintColor={COLORS.primary}
              />
            }
          >
            {/* Cost + min stock summary */}
            <XStack gap="$2">
              <SummaryCard
                label="Harga Modal"
                value={
                  <Money
                    emphasis
                    amount={Number(itemQuery.data.costPrice) || 0}
                    fontSize={18}
                    color={COLORS.onSurface}
                  />
                }
              />
              <SummaryCard
                label="Stok Minimum"
                value={
                  <Stat fontSize={18} emphasis color={COLORS.onSurface}>
                    {itemQuery.data.minStockLevel ?? '—'}
                  </Stat>
                }
              />
            </XStack>

            {/* Per-branch stock */}
            <SectionTitle label="STOK PER CABANG" />
            <YStack gap="$2">
              {(itemQuery.data.perBranch ?? []).length === 0 ? (
                <YStack
                  bg={COLORS.surfaceContainerLowest}
                  br="$4"
                  p="$4"
                  ai="center"
                  gap="$2"
                  borderWidth={1}
                  borderColor={COLORS.outlineVariant}
                >
                  <Package size={32} color={COLORS.outline} />
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={13}
                    color={COLORS.onSurfaceVariant}
                    ta="center"
                  >
                    Belum ada stok tercatat untuk barang ini.
                  </Paragraph>
                </YStack>
              ) : (
                (itemQuery.data.perBranch ?? []).map((b) => (
                  <BranchStockRow
                    key={b.branch_id}
                    branchName={b.branch_name}
                    quantity={Number(b.quantity)}
                    lastMovementAt={b.last_movement_at}
                  />
                ))
              )}
            </YStack>

            {/* Recent movements */}
            <SectionTitle label="PERGERAKAN TERAKHIR" />
            <YStack gap="$2">
              {(itemQuery.data.recentMovements ?? []).length === 0 ? (
                <YStack
                  bg={COLORS.surfaceContainerLowest}
                  br="$4"
                  p="$4"
                  ai="center"
                  gap="$2"
                  borderWidth={1}
                  borderColor={COLORS.outlineVariant}
                >
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={13}
                    color={COLORS.onSurfaceVariant}
                  >
                    Belum ada pergerakan.
                  </Paragraph>
                </YStack>
              ) : (
                (itemQuery.data.recentMovements ?? []).map((m) => (
                  <MovementRow
                    key={m.id}
                    type={m.movement_type}
                    qty={Number(m.quantity)}
                    branchName={m.branch_name}
                    reason={m.reason}
                    notes={m.notes}
                    at={m.created_at}
                  />
                ))
              )}
            </YStack>
          </ScrollView>
        )}

        {/* FAB — Sesuaikan Stok */}
        {itemQuery.data && (
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
            <Pressable onPress={() => setAdjustOpen(true)}>
              <XStack
                ai="center"
                gap="$2"
                bg={COLORS.primary}
                br={9999}
                px="$4"
                h={52}
              >
                <RotateCcw size={18} color="white" />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="white"
                >
                  Sesuaikan Stok
                </Paragraph>
              </XStack>
            </Pressable>
          </YStack>
        )}

        {/* Edit sheet */}
        {itemQuery.data && (
          <ItemFormSheet
            open={editOpen}
            onClose={() => setEditOpen(false)}
            item={itemQuery.data}
            onSuccess={() => itemQuery.refetch()}
          />
        )}

        {/* Stock adjust sheet */}
        {itemQuery.data && (
          <StockAdjustSheet
            open={adjustOpen}
            onClose={() => setAdjustOpen(false)}
            item={itemQuery.data}
            onSuccess={() => itemQuery.refetch()}
          />
        )}

        {/* Action menu sheet */}
        <Sheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          snapPoints={[35]}
          modal
          dismissOnSnapToBottom
        >
          <Sheet.Overlay />
          <Sheet.Handle />
          <Sheet.Frame
            padding="$4"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
          >
            <MenuOption
              icon={<EditIcon size={20} color={COLORS.primary} />}
              label="Edit Barang"
              onPress={() => {
                setMenuOpen(false)
                setEditOpen(true)
              }}
            />
            <MenuOption
              icon={<RotateCcw size={20} color={COLORS.primary} />}
              label="Sesuaikan Stok"
              onPress={() => {
                setMenuOpen(false)
                setAdjustOpen(true)
              }}
            />
            <MenuOption
              icon={<Trash2 size={20} color={COLORS.danger} />}
              label="Nonaktifkan"
              danger
              onPress={handleDeactivate}
            />
          </Sheet.Frame>
        </Sheet>
      </YStack>
    </>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <YStack
      flex={1}
      bg={COLORS.surfaceContainerLowest}
      br="$4"
      p="$3.5"
      gap="$1"
      borderWidth={1}
      borderColor={COLORS.outlineVariant}
    >
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={10}
        color={COLORS.onSurfaceVariant}
        letterSpacing={0.55}
      >
        {label}
      </Paragraph>
      {value}
    </YStack>
  )
}

function SectionTitle({ label }: { label: string }) {
  return (
    <Paragraph
      fontFamily={FONTS.bodyBold}
      fontSize={11}
      color={COLORS.onSurfaceVariant}
      letterSpacing={0.55}
      mt="$2"
    >
      {label}
    </Paragraph>
  )
}

function BranchStockRow({
  branchName,
  quantity,
  lastMovementAt,
}: {
  branchName: string
  quantity: number
  lastMovementAt: string | null
}) {
  return (
    <XStack
      ai="center"
      gap="$3"
      bg={COLORS.surfaceContainerLowest}
      br="$4"
      p="$3"
      borderWidth={1}
      borderColor={COLORS.outlineVariant}
    >
      <YStack
        w={36}
        h={36}
        br={18}
        bg={COLORS.primaryFixed}
        ai="center"
        jc="center"
      >
        <Store size={18} color={COLORS.primary} />
      </YStack>
      <YStack flex={1}>
        <Paragraph
          fontFamily={FONTS.headingSemi}
          fontSize={14}
          color={COLORS.onSurface}
          numberOfLines={1}
        >
          {branchName}
        </Paragraph>
        {lastMovementAt && (
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            Terakhir: {formatRelative(lastMovementAt)}
          </Paragraph>
        )}
      </YStack>
      <Stat fontSize={16} emphasis color={COLORS.onSurface}>
        {formatQty(quantity)}
      </Stat>
    </XStack>
  )
}

function MovementRow({
  type,
  qty,
  branchName,
  reason,
  notes,
  at,
}: {
  type: string
  qty: number
  branchName: string
  reason: string | null
  notes: string | null
  at: string
}) {
  const isIn = type === 'in' || type === 'transfer_in'
  const isOut = type === 'out' || type === 'transfer_out'
  const tint = isIn ? COLORS.success : isOut ? COLORS.danger : COLORS.primary
  const Icon = isIn ? ArrowDownToLine : isOut ? ArrowUpFromLine : RotateCcw
  const sign = isIn ? '+' : isOut ? '−' : '±'

  return (
    <XStack
      ai="center"
      gap="$3"
      bg={COLORS.surfaceContainerLowest}
      br="$4"
      p="$3"
      borderWidth={1}
      borderColor={COLORS.outlineVariant}
    >
      <YStack
        w={36}
        h={36}
        br={18}
        bg={tint + '20'}
        ai="center"
        jc="center"
      >
        <Icon size={16} color={tint} />
      </YStack>
      <YStack flex={1} gap={1}>
        <XStack ai="center" gap="$2">
          <Stat fontSize={14} color={tint} emphasis>
            {sign}
            {formatQty(qty)}
          </Stat>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
            numberOfLines={1}
            flex={1}
          >
            · {branchName}
          </Paragraph>
        </XStack>
        {(reason || notes) && (
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            numberOfLines={2}
          >
            {[reason, notes].filter(Boolean).join(' — ')}
          </Paragraph>
        )}
      </YStack>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={10}
        color={COLORS.onSurfaceVariant}
      >
        {formatRelative(at)}
      </Paragraph>
    </XStack>
  )
}

function MenuOption({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  danger?: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress}>
      <XStack
        ai="center"
        gap="$3"
        p="$3"
        br="$3"
        pressStyle={{ bg: COLORS.surfaceContainerLow }}
      >
        {icon}
        <Paragraph
          fontFamily={FONTS.bodyMedium}
          fontSize={15}
          color={danger ? COLORS.danger : COLORS.onSurface}
        >
          {label}
        </Paragraph>
      </XStack>
    </Pressable>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

const qtyFormatter = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function formatQty(n: number): string {
  return qtyFormatter.format(n)
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime()
    const now = Date.now()
    const diffMin = Math.round((now - then) / 60000)
    if (diffMin < 1) return 'baru saja'
    if (diffMin < 60) return `${diffMin}m lalu`
    const h = Math.round(diffMin / 60)
    if (h < 24) return `${h}j lalu`
    const d = Math.round(h / 24)
    if (d < 7) return `${d}h lalu`
    const dt = new Date(iso)
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`
  } catch {
    return ''
  }
}
