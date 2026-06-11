/**
 * Purchase Orders list — filterable by status. Tap a row to push detail.
 * "Buat PO" CTA opens a modal stub that links to the web for now
 * (mobile create-PO wizard with line picker is heavier than this
 * batch's scope — full editor lands in a follow-up).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Plus,
  Search,
  Trash2,
  Truck,
  X,
} from '~/lib/icons'
import {
  useCreatePO,
  useInventoryBranches,
  usePOItems,
  usePurchaseOrders,
  type POItemOption,
  type POItemUnit,
  type POStatus,
  type PurchaseOrderRow,
} from '~/lib/inventory'
import { useHppSuppliers } from '~/lib/hpp'
import { ApiError } from '~/lib/api'
import { formatRupiah, parseRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const STATUS_FILTERS: Array<{ key: POStatus | undefined; label: string }> = [
  { key: undefined, label: 'Semua' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Dikirim' },
  { key: 'partial', label: 'Sebagian' },
  { key: 'received', label: 'Selesai' },
  { key: 'cancelled', label: 'Dibatalkan' },
]

const STATUS_COLOR: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: COLORS.surfaceContainerLow, fg: COLORS.onSurfaceVariant, label: 'Draft' },
  sent: { bg: '#dbeafe', fg: '#2563eb', label: 'Dikirim' },
  partial: { bg: COLORS.warningTint, fg: '#92400e', label: 'Sebagian' },
  received: { bg: COLORS.successTint, fg: COLORS.success, label: 'Selesai' },
  cancelled: { bg: COLORS.dangerTint, fg: COLORS.danger, label: 'Batal' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function POListScreen() {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<POStatus | undefined>(undefined)
  const [createOpen, setCreateOpen] = useState(false)
  const query = usePurchaseOrders({ status: statusFilter })

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Purchase Order" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (query.error) {
    const err = query.error
    const isForbidden = err instanceof ApiError && err.status === 403
    const msg = err instanceof Error ? err.message : ''
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Purchase Order" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke Purchase Order.'
              : msg.includes('Toko') || msg.includes('paket')
                ? 'Purchase Order tersedia mulai paket Toko. Upgrade dulu yuk.'
                : 'Gagal memuat PO.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const rows = query.data?.items ?? []

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Purchase Order"
        subtitle={`${query.data?.total ?? 0} PO`}
        back
        right={
          <Pressable
            onPress={() => setCreateOpen(true)}
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
            <Plus size={14} color="#fff" />
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={12} color="#fff">
              Baru
            </Paragraph>
          </Pressable>
        }
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {STATUS_FILTERS.map((f) => {
            const active = f.key === statusFilter
            return (
              <Pressable key={f.label} onPress={() => setStatusFilter(f.key)}>
                <YStack
                  px={14}
                  py={8}
                  br={999}
                  bg={active ? COLORS.primary : COLORS.surfaceContainerLowest}
                  borderWidth={1}
                  borderColor={active ? COLORS.primary : COLORS.borderSubtle}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={12}
                    color={active ? '#fff' : COLORS.onSurface}
                  >
                    {f.label}
                  </Paragraph>
                </YStack>
              </Pressable>
            )
          })}
        </ScrollView>

        {rows.length === 0 ? (
          <YStack
            ai="center"
            gap="$3"
            py="$8"
            bg={COLORS.surfaceContainerLowest}
            br={16}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
            px="$5"
          >
            <YStack
              w={64}
              h={64}
              br={20}
              bg={COLORS.primaryFixed}
              ai="center"
              jc="center"
            >
              <Truck size={26} color={COLORS.primary} />
            </YStack>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={16}
              color={COLORS.onSurface}
            >
              Belum ada Purchase Order
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
            >
              Buat PO untuk catat pesanan ke supplier sebelum stok masuk.
            </Paragraph>
            <Pressable
              onPress={() => setCreateOpen(true)}
              style={{
                marginTop: 4,
                paddingHorizontal: 16,
                paddingVertical: 10,
                backgroundColor: COLORS.primary,
                borderRadius: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Plus size={14} color="#fff" />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color="#fff"
              >
                Buat PO baru
              </Paragraph>
            </Pressable>
          </YStack>
        ) : (
          rows.map((po) => (
            <POCard
              key={po.id}
              po={po}
              onPress={() =>
                router.push({
                  pathname: '/inventory/po/[poId]' as never,
                  params: { poId: po.id },
                } as never)
              }
            />
          ))
        )}
      </ScrollView>

      <CreatePOModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(po) => {
          setCreateOpen(false)
          router.push({
            pathname: '/inventory/po/[poId]' as never,
            params: { poId: po.id },
          } as never)
        }}
      />
    </YStack>
  )
}

function POCard({
  po,
  onPress,
}: {
  po: PurchaseOrderRow
  onPress: () => void
}) {
  const status = STATUS_COLOR[po.status] ?? {
    bg: COLORS.surfaceContainerLow,
    fg: COLORS.onSurfaceVariant,
    label: po.status,
  }
  return (
    <Pressable onPress={onPress}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        style={SHADOWS.card}
      >
        <XStack ai="center" jc="space-between">
          <YStack px={8} py={2} br={6} bg={status.bg}>
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={10}
              color={status.fg}
            >
              {status.label.toUpperCase()}
            </Paragraph>
          </YStack>
          <ChevronRight size={16} color={COLORS.outline} />
        </XStack>

        <XStack ai="center" jc="space-between">
          <YStack flex={1}>
            <Paragraph
              fontFamily={FONTS.bodySemi}
              fontSize={14}
              color={COLORS.onSurface}
            >
              {po.poNumber}
            </Paragraph>
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              {po.supplierName} · {po.branchName}
            </Stat>
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              Dibuat {fmtDate(po.createdAt)}
              {po.expectedAt ? ` · Diharap ${fmtDate(po.expectedAt)}` : ''}
            </Stat>
          </YStack>
          <YStack ai="flex-end">
            <Money amount={po.subtotal} fontSize={14} emphasis />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={10}
              color={COLORS.outline}
            >
              Subtotal
            </Paragraph>
          </YStack>
        </XStack>
      </YStack>
    </Pressable>
  )
}

// ─── Create-PO modal (native) ───────────────────────────────────────

interface DraftLine {
  key: string
  itemId: string
  itemName: string
  unitId: string | null
  unitLabel: string
  orderedQty: string
  unitCost: string
}

function CreatePOModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean
  onClose: () => void
  onCreated: (po: PurchaseOrderRow) => void
}) {
  const branchesQuery = useInventoryBranches()
  const suppliersQuery = useHppSuppliers()
  const itemsQuery = usePOItems()
  const createPo = useCreatePO()

  const branches = branchesQuery.data?.branches ?? []
  const suppliers = suppliersQuery.data ?? []
  const items = itemsQuery.data ?? []

  const [branchId, setBranchId] = useState<string | null>(null)
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [expectedAt, setExpectedAt] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [picker, setPicker] = useState<
    null | { kind: 'branch' | 'supplier' | 'item' }
  >(null)

  useEffect(() => {
    if (!visible) {
      setBranchId(null)
      setSupplierId(null)
      setExpectedAt('')
      setNotes('')
      setLines([])
    }
  }, [visible])

  useEffect(() => {
    if (visible && !branchId && branches.length > 0) {
      setBranchId(branches[0]!.id)
    }
  }, [visible, branchId, branches])

  const branchName = branches.find((b) => b.id === branchId)?.name
  const supplierName = suppliers.find((s) => s.id === supplierId)?.name

  const subtotal = useMemo(
    () =>
      lines.reduce((acc, l) => {
        const qty = parseFloat(l.orderedQty) || 0
        const cost = parseFloat(l.unitCost) || 0
        return acc + qty * cost
      }, 0),
    [lines],
  )

  function addLine(item: POItemOption, unit: POItemUnit) {
    setLines((prev) => [
      ...prev,
      {
        key: `l-${Date.now()}-${item.id}-${unit.unitId}`,
        itemId: item.id,
        itemName: item.name,
        unitId: unit.unitId,
        unitLabel: unit.unitLabel,
        orderedQty: '',
        unitCost: String(item.costPrice ?? 0),
      },
    ])
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    )
  }
  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }

  async function handleSave() {
    if (!branchId) {
      Alert.alert('Pilih cabang', 'Cabang penerima wajib dipilih.')
      return
    }
    if (!supplierId) {
      Alert.alert('Pilih supplier', 'Supplier wajib dipilih.')
      return
    }
    if (lines.length === 0) {
      Alert.alert('Tambah baris', 'Minimal 1 baris item.')
      return
    }
    for (const l of lines) {
      const q = parseFloat(l.orderedQty) || 0
      if (q <= 0) {
        Alert.alert('Jumlah tidak valid', `Cek qty untuk ${l.itemName}.`)
        return
      }
    }
    try {
      const result = await createPo.mutateAsync({
        branchId,
        supplierId,
        expectedAt: expectedAt.trim() || null,
        notes: notes.trim() || null,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          unitId: l.unitId,
          orderedQty: parseFloat(l.orderedQty) || 0,
          unitCost: parseRupiah(l.unitCost),
        })),
      })
      onCreated(result)
    } catch (err) {
      Alert.alert(
        'Gagal buat PO',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  return (
    <Modal
      visible={visible}
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
            Buat PO Baru
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}>
            <FieldGroup label="Cabang penerima *">
              <Pressable
                onPress={() => setPicker({ kind: 'branch' })}
                style={pickerStyle}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={13}
                  color={branchName ? COLORS.onSurface : COLORS.outline}
                >
                  {branchName ?? 'Pilih cabang'}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </Pressable>
            </FieldGroup>

            <FieldGroup label="Supplier *">
              <Pressable
                onPress={() => setPicker({ kind: 'supplier' })}
                style={pickerStyle}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={13}
                  color={supplierName ? COLORS.onSurface : COLORS.outline}
                >
                  {supplierName ?? 'Pilih supplier'}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </Pressable>
            </FieldGroup>

            <FieldGroup label="Tanggal diharap (opsional)">
              <TextInput
                value={expectedAt}
                onChangeText={setExpectedAt}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.outline}
                style={inputStyle}
              />
            </FieldGroup>

            <FieldGroup label={`Baris item (${lines.length})`}>
              {lines.map((l) => (
                <YStack
                  key={l.key}
                  bg={COLORS.surfaceContainerLowest}
                  br={10}
                  p="$3"
                  gap="$2"
                  borderWidth={1}
                  borderColor={COLORS.borderSubtle}
                >
                  <XStack ai="center" jc="space-between">
                    <YStack flex={1}>
                      <Paragraph
                        fontFamily={FONTS.bodySemi}
                        fontSize={13}
                        color={COLORS.onSurface}
                        numberOfLines={1}
                      >
                        {l.itemName}
                      </Paragraph>
                      <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                        {l.unitLabel}
                      </Stat>
                    </YStack>
                    <Pressable
                      onPress={() => removeLine(l.key)}
                      hitSlop={8}
                      style={{ padding: 6 }}
                    >
                      <Trash2 size={14} color={COLORS.danger} />
                    </Pressable>
                  </XStack>
                  <XStack gap="$2">
                    <YStack flex={1} gap="$1">
                      <Paragraph
                        fontFamily={FONTS.bodyBold}
                        fontSize={10}
                        color={COLORS.onSurfaceVariant}
                        textTransform="uppercase"
                        letterSpacing={0.4}
                      >
                        Qty
                      </Paragraph>
                      <TextInput
                        value={l.orderedQty}
                        onChangeText={(v) =>
                          updateLine(l.key, { orderedQty: v })
                        }
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={COLORS.outline}
                        style={inputStyle}
                      />
                    </YStack>
                    <YStack flex={2} gap="$1">
                      <Paragraph
                        fontFamily={FONTS.bodyBold}
                        fontSize={10}
                        color={COLORS.onSurfaceVariant}
                        textTransform="uppercase"
                        letterSpacing={0.4}
                      >
                        Harga / {l.unitLabel}
                      </Paragraph>
                      <CurrencyInputCompact
                        value={l.unitCost}
                        onChange={(v) =>
                          updateLine(l.key, { unitCost: v })
                        }
                      />
                    </YStack>
                  </XStack>
                </YStack>
              ))}

              <Pressable
                onPress={() => setPicker({ kind: 'item' })}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: COLORS.primary,
                  backgroundColor: COLORS.primaryFixed,
                }}
              >
                <Plus size={14} color={COLORS.primary} />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={12}
                  color={COLORS.primary}
                >
                  Tambah item
                </Paragraph>
              </Pressable>
            </FieldGroup>

            <FieldGroup label="Catatan (opsional)">
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Mis. PO langganan mingguan"
                placeholderTextColor={COLORS.outline}
                multiline
                style={{
                  ...inputStyle,
                  minHeight: 70,
                  paddingTop: 10,
                  textAlignVertical: 'top' as const,
                  height: undefined,
                }}
              />
            </FieldGroup>

            <XStack
              ai="center"
              jc="space-between"
              bg={COLORS.surfaceContainerLowest}
              br={10}
              p="$3"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={14}
                color={COLORS.onSurface}
              >
                Subtotal
              </Paragraph>
              <Money amount={subtotal} fontSize={16} emphasis />
            </XStack>

            <Pressable
              onPress={handleSave}
              disabled={createPo.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: createPo.isPending
                  ? COLORS.outline
                  : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {createPo.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Simpan sebagai Draft
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        {picker?.kind === 'branch' && (
          <PickList
            title="Pilih cabang"
            items={branches.map((b) => ({ key: b.id, label: b.name }))}
            selectedKey={branchId ?? ''}
            onClose={() => setPicker(null)}
            onSelect={(id) => {
              setBranchId(id)
              setPicker(null)
            }}
          />
        )}
        {picker?.kind === 'supplier' && (
          <PickList
            title="Pilih supplier"
            items={suppliers.map((s) => ({ key: s.id, label: s.name }))}
            selectedKey={supplierId ?? ''}
            onClose={() => setPicker(null)}
            onSelect={(id) => {
              setSupplierId(id)
              setPicker(null)
            }}
          />
        )}
        {picker?.kind === 'item' && (
          <ItemPicker
            items={items}
            onClose={() => setPicker(null)}
            onPick={(item, unit) => {
              addLine(item, unit)
              setPicker(null)
            }}
          />
        )}
      </YStack>
    </Modal>
  )
}

function ItemPicker({
  items,
  onClose,
  onPick,
}: {
  items: POItemOption[]
  onClose: () => void
  onPick: (item: POItemOption, unit: POItemUnit) => void
}) {
  const [q, setQ] = useState('')
  const [selectedItem, setSelectedItem] = useState<POItemOption | null>(null)
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(needle) ||
        (it.sku ?? '').toLowerCase().includes(needle),
    )
  }, [items, q])

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
            {selectedItem ? 'Pilih satuan' : 'Pilih item'}
          </H2>
          <Pressable
            onPress={() =>
              selectedItem ? setSelectedItem(null) : onClose()
            }
            hitSlop={8}
          >
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        {!selectedItem ? (
          <>
            <YStack px="$4" pt="$3">
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
                  value={q}
                  onChangeText={setQ}
                  placeholder="Cari item…"
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
            </YStack>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
              {filtered.length === 0 ? (
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={13}
                  color={COLORS.onSurfaceVariant}
                  ta="center"
                  py="$6"
                >
                  Tidak ada item ditemukan.
                </Paragraph>
              ) : (
                filtered.map((it) => (
                  <Pressable key={it.id} onPress={() => setSelectedItem(it)}>
                    <XStack
                      ai="center"
                      jc="space-between"
                      p="$3"
                      br={10}
                      bg={COLORS.surfaceContainerLowest}
                      borderWidth={1}
                      borderColor={COLORS.borderSubtle}
                    >
                      <YStack flex={1}>
                        <Paragraph
                          fontFamily={FONTS.bodyMedium}
                          fontSize={14}
                          color={COLORS.onSurface}
                        >
                          {it.name}
                        </Paragraph>
                        {it.sku ? (
                          <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                            SKU {it.sku}
                          </Stat>
                        ) : null}
                        <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                          {it.units.length} satuan ·{' '}
                          {formatRupiah(it.costPrice ?? 0)}/{it.baseUnitLabel}
                        </Stat>
                      </YStack>
                      <ChevronRight size={16} color={COLORS.outline} />
                    </XStack>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Pilih satuan order untuk{' '}
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={COLORS.onSurface}
              >
                {selectedItem.name}
              </Paragraph>
            </Paragraph>
            {selectedItem.units.map((u) => (
              <Pressable
                key={u.unitId}
                onPress={() => onPick(selectedItem, u)}
              >
                <XStack
                  ai="center"
                  jc="space-between"
                  p="$3"
                  br={10}
                  bg={COLORS.surfaceContainerLowest}
                  borderWidth={1}
                  borderColor={COLORS.borderSubtle}
                >
                  <YStack flex={1}>
                    <Paragraph
                      fontFamily={FONTS.bodySemi}
                      fontSize={14}
                      color={COLORS.onSurface}
                    >
                      {u.unitLabel}
                      {u.isDefault ? ' (default)' : ''}
                    </Paragraph>
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                      Rasio {u.ratioToBase} × {selectedItem.baseUnitLabel}
                    </Stat>
                  </YStack>
                  <Check size={16} color={COLORS.primary} />
                </XStack>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </YStack>
    </Modal>
  )
}

function PickList({
  title,
  items,
  selectedKey,
  onClose,
  onSelect,
}: {
  title: string
  items: Array<{ key: string; label: string }>
  selectedKey: string
  onClose: () => void
  onSelect: (key: string) => void
}) {
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
            {title}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          {items.map((it) => {
            const selected = it.key === selectedKey
            return (
              <Pressable key={it.key} onPress={() => onSelect(it.key)}>
                <XStack
                  ai="center"
                  jc="space-between"
                  p="$3"
                  br={10}
                  bg={
                    selected
                      ? COLORS.primaryFixed
                      : COLORS.surfaceContainerLowest
                  }
                  borderWidth={1}
                  borderColor={selected ? COLORS.primary : COLORS.borderSubtle}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {it.label}
                  </Paragraph>
                  {selected && <Check size={16} color={COLORS.primary} />}
                </XStack>
              </Pressable>
            )
          })}
        </ScrollView>
      </YStack>
    </Modal>
  )
}

function FieldGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <YStack gap="$2">
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={12}
        color={COLORS.onSurface}
        textTransform="uppercase"
        letterSpacing={0.4}
      >
        {label}
      </Paragraph>
      {children}
    </YStack>
  )
}

function CurrencyInputCompact({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const display =
    value === '' ? '' : formatRupiah(parseRupiah(value)).replace('Rp ', '')
  return (
    <XStack
      ai="center"
      bg={COLORS.surface}
      br={10}
      px="$3"
      h={44}
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      gap="$2"
    >
      <Paragraph
        fontFamily={FONTS.bodyMedium}
        fontSize={13}
        color={COLORS.onSurfaceVariant}
      >
        Rp
      </Paragraph>
      <TextInput
        value={display}
        onChangeText={(v) => onChange(String(parseRupiah(v)))}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={COLORS.outline}
        style={{
          flex: 1,
          fontFamily: FONTS.monoMedium,
          fontSize: 13,
          color: COLORS.onSurface,
          paddingVertical: 0,
        }}
      />
    </XStack>
  )
}

const inputStyle = {
  backgroundColor: COLORS.surface,
  borderRadius: 10,
  paddingHorizontal: 12,
  height: 44,
  borderWidth: 1,
  borderColor: COLORS.borderSubtle,
  fontFamily: FONTS.body,
  fontSize: 13,
  color: COLORS.onSurface,
}

const pickerStyle = {
  backgroundColor: COLORS.surfaceContainerLowest,
  borderRadius: 10,
  paddingHorizontal: 12,
  height: 44,
  borderWidth: 1,
  borderColor: COLORS.borderSubtle,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  justifyContent: 'space-between' as const,
}
