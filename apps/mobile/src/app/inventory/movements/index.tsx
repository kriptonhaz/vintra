/**
 * Tenant-wide stock movements ledger. Filters: branch (from outlet
 * context), search by item name. Tap a row to see detail + delete.
 *
 * For Free tier the server clamps history to 30 days and returns the
 * cap as `historyClampedToDays` — we surface that as a hint banner so
 * users know why older rows are missing.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
} from 'react-native'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  RotateCcw,
  Search,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useDeleteMovement,
  useInventoryMovements,
  type MovementRow,
  type MovementType,
} from '~/lib/inventory'
import { ApiError } from '~/lib/api'
import { formatRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const TYPE_LABEL: Record<string, { label: string; color: string; sign: '+' | '-' | '=' }> = {
  in: { label: 'Stock In', color: COLORS.success, sign: '+' },
  out: { label: 'Stock Out', color: COLORS.danger, sign: '-' },
  transfer_in: { label: 'Transfer Masuk', color: COLORS.primary, sign: '+' },
  transfer_out: { label: 'Transfer Keluar', color: '#92400e', sign: '-' },
  adjustment: { label: 'Penyesuaian', color: COLORS.info, sign: '=' },
  sale: { label: 'Penjualan', color: COLORS.danger, sign: '-' },
  po_receive: { label: 'Terima PO', color: COLORS.success, sign: '+' },
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function MovementsScreen() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<MovementRow | null>(null)
  const query = useInventoryMovements({ pageSize: 100 })

  const items = query.data?.items ?? []
  const clamped = query.data?.historyClampedToDays ?? null

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return items
    return items.filter((m) => m.itemName.toLowerCase().includes(needle))
  }, [items, search])

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pergerakan Stok" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (query.error) {
    const isForbidden =
      query.error instanceof ApiError && query.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pergerakan Stok" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke pergerakan stok.'
              : 'Gagal memuat pergerakan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Pergerakan Stok"
        subtitle={`${query.data?.total ?? 0} pergerakan`}
        back
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => query.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {clamped !== null && (
          <XStack
            ai="flex-start"
            gap="$2"
            bg={COLORS.warningTint}
            br={10}
            p="$3"
          >
            <AlertCircle size={14} color="#92400e" />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color="#92400e"
              flex={1}
            >
              Riwayat paket Gratis dibatasi {clamped} hari terakhir.
              Upgrade untuk akses riwayat lengkap.
            </Paragraph>
          </XStack>
        )}

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
            placeholder="Cari nama item…"
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

        {filtered.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              {search
                ? `Tidak ada pergerakan cocok dengan "${search}".`
                : 'Belum ada pergerakan stok.'}
            </Paragraph>
          </YStack>
        ) : (
          filtered.map((m) => (
            <MovementCard key={m.id} m={m} onPress={() => setSelected(m)} />
          ))
        )}
      </ScrollView>

      <DetailModal
        movement={selected}
        onClose={() => setSelected(null)}
      />
    </YStack>
  )
}

function MovementCard({
  m,
  onPress,
}: {
  m: MovementRow
  onPress: () => void
}) {
  const meta = TYPE_LABEL[m.movementType] ?? {
    label: m.movementType,
    color: COLORS.onSurfaceVariant,
    sign: '=' as const,
  }
  const Icon = meta.sign === '+' ? ArrowDownToLine : meta.sign === '-' ? ArrowUpFromLine : RotateCcw
  return (
    <Pressable onPress={onPress}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={12}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        style={SHADOWS.card}
      >
        <XStack ai="center" gap="$3">
          <YStack
            w={36}
            h={36}
            br={10}
            bg={`${meta.color}22`}
            ai="center"
            jc="center"
          >
            <Icon size={16} color={meta.color} />
          </YStack>
          <YStack flex={1}>
            <Paragraph
              fontFamily={FONTS.bodySemi}
              fontSize={14}
              color={COLORS.onSurface}
              numberOfLines={1}
            >
              {m.itemName}
            </Paragraph>
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              {meta.label} · {m.branchName}
            </Stat>
            <Stat fontSize={10} color={COLORS.outline}>
              {fmtDateTime(m.createdAt)}
            </Stat>
          </YStack>
          <YStack ai="flex-end">
            <Paragraph
              fontFamily={FONTS.monoMedium}
              fontSize={14}
              color={meta.color}
            >
              {meta.sign === '=' ? '' : meta.sign}
              {Math.abs(m.quantity).toLocaleString('id-ID')}
            </Paragraph>
            {m.unitCost !== null && (
              <Stat fontSize={10} color={COLORS.onSurfaceVariant}>
                {formatRupiah(m.unitCost)}/unit
              </Stat>
            )}
          </YStack>
          <ChevronRight size={16} color={COLORS.outline} />
        </XStack>
      </YStack>
    </Pressable>
  )
}

function DetailModal({
  movement,
  onClose,
}: {
  movement: MovementRow | null
  onClose: () => void
}) {
  const remove = useDeleteMovement()
  if (!movement) return null
  const m = movement
  const meta = TYPE_LABEL[m.movementType] ?? {
    label: m.movementType,
    color: COLORS.onSurfaceVariant,
    sign: '=' as const,
  }
  const totalCost =
    m.unitCost !== null ? Math.abs(m.quantity) * m.unitCost : null

  function handleDelete() {
    Alert.alert(
      'Hapus pergerakan?',
      'Stok akan dikembalikan ke kondisi sebelum pergerakan ini dicatat.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () => {
            remove.mutate(m.id, {
              onSuccess: () => onClose(),
              onError: (err) =>
                Alert.alert(
                  'Gagal hapus',
                  err instanceof Error ? err.message : 'Coba lagi.',
                ),
            })
          },
        },
      ],
    )
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <YStack flex={1} bg={COLORS.background}>
        <XStack
          ai="center"
          jc="space-between"
          px="$4"
          pt="$5"
          pb="$3"
          borderBottomWidth={1}
          borderBottomColor={COLORS.borderSubtle}
        >
          <H2 fontSize={18} color={COLORS.onSurface}>
            Detail pergerakan
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <YStack
            bg={COLORS.surfaceContainerLowest}
            br={14}
            p="$3"
            gap="$2"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={16}
              color={COLORS.onSurface}
            >
              {m.itemName}
            </Paragraph>
            <Stat fontSize={12} color={COLORS.onSurfaceVariant}>
              {meta.label} · {m.branchName}
            </Stat>
            <Stat fontSize={12} color={COLORS.onSurfaceVariant}>
              {fmtDateTime(m.createdAt)}
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
            <Row label="Jumlah" value={`${meta.sign === '=' ? '' : meta.sign}${Math.abs(m.quantity).toLocaleString('id-ID')}`} />
            {m.unitCost !== null && (
              <Row label="Harga per Unit" value={formatRupiah(m.unitCost)} />
            )}
            {totalCost !== null && (
              <Row label="Total Biaya" value={formatRupiah(totalCost)} bold />
            )}
            {m.reason && <Row label="Alasan" value={m.reason} />}
            {m.notes && <Row label="Catatan" value={m.notes} />}
          </YStack>

          <Pressable
            onPress={handleDelete}
            disabled={remove.isPending}
            style={{
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: remove.isPending ? COLORS.outline : COLORS.danger,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {remove.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Trash2 size={14} color="#fff" />
                <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
                  Hapus pergerakan
                </Paragraph>
              </>
            )}
          </Pressable>
        </ScrollView>
      </YStack>
    </Modal>
  )
}

function Row({
  label,
  value,
  bold,
}: {
  label: string
  value: string
  bold?: boolean
}) {
  return (
    <XStack ai="center" jc="space-between" gap="$2">
      <Paragraph
        fontFamily={bold ? FONTS.bodyBold : FONTS.body}
        fontSize={13}
        color={bold ? COLORS.onSurface : COLORS.onSurfaceVariant}
        flex={1}
      >
        {label}
      </Paragraph>
      <Paragraph
        fontFamily={bold ? FONTS.monoMedium : FONTS.body}
        fontSize={bold ? 14 : 13}
        color={COLORS.onSurface}
        ta="right"
        flex={1}
      >
        {value}
      </Paragraph>
    </XStack>
  )
}

// Keep MovementType import alive — pre-existing tooling treats unused
// imports as errors on stricter configs.
export type _ = MovementType
