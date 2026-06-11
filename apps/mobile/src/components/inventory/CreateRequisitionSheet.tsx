/**
 * CreateRequisitionSheet — the outlet user requests stock from the
 * main branch. Picks:
 *   - requesting branch (the outlet — defaults to the user's first
 *     allowed non-main branch)
 *   - one or more items + qty
 *   - optional overall notes
 *
 * Source branch is auto-resolved server-side (the tenant's main branch).
 * Franchise outlets need a franchisePrice on every line item — the server
 * surfaces a clear error if any item is missing one, no client-side check
 * needed.
 */
import { useEffect, useMemo, useState } from 'react'
import { Pressable } from 'react-native'
import {
  Adapt,
  Button,
  Paragraph,
  ScrollView,
  Select,
  Sheet,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import {
  Check,
  ChevronDown,
  Minus,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from '~/lib/icons'
import { IconInput } from '../IconInput'
import {
  useCreateRequisition,
  useFormMasters,
  useInventoryItems,
  type InventoryItemRow,
} from '../../lib/inventory'
import { Stat } from '../Money'
import { COLORS, FONTS } from '../../lib/theme'

interface LineDraft {
  itemId: string
  itemName: string
  baseUnitLabel: string
  qty: string
}

interface CreateRequisitionSheetProps {
  open: boolean
  onClose: () => void
  onSuccess?: (newRequisitionId: string) => void
}

export function CreateRequisitionSheet({
  open,
  onClose,
  onSuccess,
}: CreateRequisitionSheetProps) {
  const masters = useFormMasters()
  const create = useCreateRequisition()

  const [requestingBranchId, setRequestingBranchId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // First non-main branch as the default requesting outlet.
  useEffect(() => {
    if (open) {
      setRequestingBranchId('')
      setNotes('')
      setLines([])
      setError(null)
    }
  }, [open])

  const canSubmit =
    requestingBranchId !== '' &&
    lines.length > 0 &&
    lines.every((l) => parseFloat(l.qty || '0') > 0) &&
    !create.isPending

  async function handleSubmit() {
    if (!canSubmit) return
    setError(null)
    try {
      const res = await create.mutateAsync({
        requestingBranchId,
        notes: notes.trim() || null,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          requestedQty: parseFloat(l.qty),
        })),
      })
      onSuccess?.(res.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    }
  }

  function addLine(item: InventoryItemRow) {
    // Prevent duplicates — if item already in list, just close picker.
    if (lines.some((l) => l.itemId === item.id)) {
      setPickerOpen(false)
      return
    }
    setLines((prev) => [
      ...prev,
      {
        itemId: item.id,
        itemName: item.name,
        baseUnitLabel: item.baseUnit.label,
        qty: '1',
      },
    ])
    setPickerOpen(false)
  }

  function updateLineQty(itemId: string, qty: string) {
    setLines((prev) =>
      prev.map((l) => (l.itemId === itemId ? { ...l, qty } : l)),
    )
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId))
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onClose}
        snapPoints={[90]}
        modal
        dismissOnSnapToBottom
      >
        <Sheet.Overlay />
        <Sheet.Handle />
        <Sheet.Frame bg={COLORS.surfaceContainerLowest}>
          <YStack flex={1}>
            {/* Header */}
            <XStack
              ai="center"
              jc="space-between"
              px="$4"
              py="$3"
              borderBottomWidth={1}
              borderBottomColor={COLORS.outlineVariant}
            >
              <Paragraph
                fontFamily={FONTS.headingBold}
                fontSize={18}
                color={COLORS.onSurface}
              >
                Buat Permintaan
              </Paragraph>
              <Pressable onPress={onClose} hitSlop={8}>
                <YStack
                  w={32}
                  h={32}
                  br={16}
                  bg={COLORS.surfaceContainerLow}
                  ai="center"
                  jc="center"
                >
                  <X size={18} color={COLORS.onSurfaceVariant} />
                </YStack>
              </Pressable>
            </XStack>

            {/* Body */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, gap: 14 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Requesting branch */}
              <YStack gap="$1.5">
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={13}
                  color={COLORS.onSurface}
                >
                  Cabang Pemohon *
                </Paragraph>
                <Select
                  value={requestingBranchId}
                  onValueChange={setRequestingBranchId}
                  disablePreventBodyScroll
                >
                  <Select.Trigger
                    h={56}
                    br={9999}
                    px="$4"
                    bg={COLORS.surfaceContainerLow}
                    borderWidth={1}
                    borderColor={COLORS.outlineVariant}
                  >
                    <Paragraph
                      flex={1}
                      fontFamily={FONTS.body}
                      fontSize={14}
                      color={
                        requestingBranchId
                          ? COLORS.onSurface
                          : COLORS.outline
                      }
                    >
                      {masters.data?.branches.find(
                        (b) => b.id === requestingBranchId,
                      )?.name ?? 'Pilih cabang outlet'}
                    </Paragraph>
                    <Select.Icon>
                      <ChevronDown size={16} color={COLORS.outline} />
                    </Select.Icon>
                  </Select.Trigger>

                  <Adapt platform="touch">
                    <Sheet
                      modal
                      dismissOnSnapToBottom
                      animation="medium"
                      snapPoints={[55]}
                    >
                      <Sheet.Frame>
                        <Sheet.ScrollView>
                          <Adapt.Contents />
                        </Sheet.ScrollView>
                      </Sheet.Frame>
                      <Sheet.Overlay />
                    </Sheet>
                  </Adapt>

                  <Select.Content>
                    <Select.Viewport>
                      {masters.data?.branches.map((b, idx) => (
                        <Select.Item key={b.id} index={idx} value={b.id}>
                          <Select.ItemText>{b.name}</Select.ItemText>
                          <Select.ItemIndicator marginLeft="auto">
                            <Check size={16} color={COLORS.primary} />
                          </Select.ItemIndicator>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </Select.Content>
                </Select>
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.onSurfaceVariant}
                  pl="$2"
                >
                  Stok akan dikirim dari cabang utama ke sini.
                </Paragraph>
              </YStack>

              {/* Lines */}
              <YStack gap="$2">
                <XStack ai="center" jc="space-between">
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={13}
                    color={COLORS.onSurface}
                  >
                    Barang ({lines.length})
                  </Paragraph>
                  <Pressable onPress={() => setPickerOpen(true)} hitSlop={6}>
                    <XStack ai="center" gap="$1">
                      <Plus size={14} color={COLORS.primary} />
                      <Paragraph
                        fontFamily={FONTS.bodyBold}
                        fontSize={12}
                        color={COLORS.primary}
                      >
                        Tambah Item
                      </Paragraph>
                    </XStack>
                  </Pressable>
                </XStack>

                {lines.length === 0 ? (
                  <YStack
                    bg={COLORS.surfaceContainerLow}
                    br="$3"
                    p="$4"
                    ai="center"
                    gap="$2"
                  >
                    <Package size={28} color={COLORS.outline} />
                    <Paragraph
                      fontFamily={FONTS.body}
                      fontSize={12}
                      color={COLORS.onSurfaceVariant}
                      ta="center"
                    >
                      Belum ada item. Tap “Tambah Item” untuk mulai.
                    </Paragraph>
                  </YStack>
                ) : (
                  <YStack gap="$2">
                    {lines.map((l) => (
                      <LineEditor
                        key={l.itemId}
                        line={l}
                        onQtyChange={(q) => updateLineQty(l.itemId, q)}
                        onRemove={() => removeLine(l.itemId)}
                      />
                    ))}
                  </YStack>
                )}
              </YStack>

              {/* Notes */}
              <YStack gap="$1.5">
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={13}
                  color={COLORS.onSurface}
                >
                  Catatan
                </Paragraph>
                <IconInput
                  leading={null}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Catatan untuk admin gudang (opsional)"
                  multiline
                />
              </YStack>

              {error && (
                <YStack
                  bg={COLORS.errorContainer}
                  br="$3"
                  p="$3"
                  borderWidth={1}
                  borderColor={COLORS.error}
                >
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={13}
                    color={COLORS.onErrorContainer}
                  >
                    {error}
                  </Paragraph>
                </YStack>
              )}
            </ScrollView>

            {/* Footer */}
            <YStack
              px="$4"
              py="$3"
              borderTopWidth={1}
              borderTopColor={COLORS.outlineVariant}
            >
              <Button
                bg={COLORS.primary}
                pressStyle={{ bg: COLORS.brandActive }}
                borderWidth={0}
                br={9999}
                h={52}
                onPress={handleSubmit}
                disabled={!canSubmit}
                opacity={canSubmit ? 1 : 0.55}
              >
                {create.isPending ? (
                  <Spinner color="white" />
                ) : (
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={15}
                    color="white"
                  >
                    Kirim Permintaan
                  </Paragraph>
                )}
              </Button>
            </YStack>
          </YStack>
        </Sheet.Frame>
      </Sheet>

      <ItemPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addLine}
        excludeIds={lines.map((l) => l.itemId)}
      />
    </>
  )
}

// ─── Line editor (inline qty +/-) ────────────────────────────────────

function LineEditor({
  line,
  onQtyChange,
  onRemove,
}: {
  line: LineDraft
  onQtyChange: (qty: string) => void
  onRemove: () => void
}) {
  function bump(delta: number) {
    const next = Math.max(0, (parseFloat(line.qty) || 0) + delta)
    onQtyChange(String(next))
  }

  return (
    <XStack
      ai="center"
      gap="$2.5"
      bg={COLORS.surfaceContainerLow}
      br="$3"
      p="$2.5"
      borderWidth={1}
      borderColor={COLORS.outlineVariant}
    >
      <YStack flex={1} gap={2}>
        <Paragraph
          fontFamily={FONTS.headingSemi}
          fontSize={13}
          color={COLORS.onSurface}
          numberOfLines={2}
        >
          {line.itemName}
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={10}
          color={COLORS.onSurfaceVariant}
        >
          {line.baseUnitLabel}
        </Paragraph>
      </YStack>

      <XStack ai="center" gap="$1">
        <Pressable onPress={() => bump(-1)} hitSlop={4}>
          <YStack
            w={28}
            h={28}
            br={14}
            bg={COLORS.surfaceContainerLowest}
            ai="center"
            jc="center"
            borderWidth={1}
            borderColor={COLORS.outlineVariant}
          >
            <Minus size={14} color={COLORS.onSurface} />
          </YStack>
        </Pressable>
        <YStack
          minWidth={44}
          ai="center"
          jc="center"
          px="$1"
        >
          <Stat fontSize={14} emphasis color={COLORS.onSurface}>
            {line.qty || '0'}
          </Stat>
        </YStack>
        <Pressable onPress={() => bump(1)} hitSlop={4}>
          <YStack
            w={28}
            h={28}
            br={14}
            bg={COLORS.primary}
            ai="center"
            jc="center"
          >
            <Plus size={14} color="white" />
          </YStack>
        </Pressable>
      </XStack>

      <Pressable onPress={onRemove} hitSlop={4}>
        <YStack
          w={28}
          h={28}
          br={14}
          ai="center"
          jc="center"
        >
          <Trash2 size={14} color={COLORS.danger} />
        </YStack>
      </Pressable>
    </XStack>
  )
}

// ─── Item picker (nested sheet) ─────────────────────────────────────

function ItemPickerSheet({
  open,
  onClose,
  onPick,
  excludeIds,
}: {
  open: boolean
  onClose: () => void
  onPick: (item: InventoryItemRow) => void
  excludeIds: string[]
}) {
  const [search, setSearch] = useState('')
  const itemsQuery = useInventoryItems({
    search: search.trim() || undefined,
    pageSize: 100,
  })
  const items = (itemsQuery.data?.items ?? []).filter(
    (i) => !excludeIds.includes(i.id),
  )

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  return (
    <Sheet
      open={open}
      onOpenChange={onClose}
      snapPoints={[80]}
      modal
      dismissOnSnapToBottom
      // Nested sheet — sits above the create sheet.
      zIndex={200_000}
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame bg={COLORS.surfaceContainerLowest}>
        <YStack flex={1}>
          <XStack
            ai="center"
            jc="space-between"
            px="$4"
            py="$3"
            borderBottomWidth={1}
            borderBottomColor={COLORS.outlineVariant}
          >
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={18}
              color={COLORS.onSurface}
            >
              Pilih Barang
            </Paragraph>
            <Pressable onPress={onClose} hitSlop={8}>
              <YStack
                w={32}
                h={32}
                br={16}
                bg={COLORS.surfaceContainerLow}
                ai="center"
                jc="center"
              >
                <X size={18} color={COLORS.onSurfaceVariant} />
              </YStack>
            </Pressable>
          </XStack>

          <YStack p="$3">
            <IconInput
              leading={<Search size={16} color={COLORS.outline} />}
              value={search}
              onChangeText={setSearch}
              placeholder="Cari nama atau SKU..."
              autoCapitalize="none"
              autoCorrect={false}
            />
          </YStack>

          <Sheet.ScrollView
            contentContainerStyle={{ padding: 12, gap: 6 }}
          >
            {itemsQuery.isLoading ? (
              <XStack ai="center" gap="$2" py="$4" jc="center">
                <Spinner color={COLORS.primary} />
              </XStack>
            ) : items.length === 0 ? (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={13}
                color={COLORS.onSurfaceVariant}
                ta="center"
                py="$6"
              >
                {search.trim() ? 'Tidak ada hasil' : 'Belum ada barang'}
              </Paragraph>
            ) : (
              items.map((item) => (
                <Pressable key={item.id} onPress={() => onPick(item)}>
                  <XStack
                    ai="center"
                    gap="$3"
                    bg={COLORS.surfaceContainerLow}
                    br="$3"
                    p="$3"
                  >
                    <YStack
                      w={36}
                      h={36}
                      br={18}
                      bg={COLORS.surfaceContainerLowest}
                      ai="center"
                      jc="center"
                    >
                      <Package size={16} color={COLORS.outline} />
                    </YStack>
                    <YStack flex={1}>
                      <Paragraph
                        fontFamily={FONTS.headingSemi}
                        fontSize={13}
                        color={COLORS.onSurface}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Paragraph>
                      <Paragraph
                        fontFamily={FONTS.body}
                        fontSize={11}
                        color={COLORS.onSurfaceVariant}
                      >
                        {item.sku ? `${item.sku} · ` : ''}
                        {item.baseUnit.label}
                      </Paragraph>
                    </YStack>
                  </XStack>
                </Pressable>
              ))
            )}
          </Sheet.ScrollView>
        </YStack>
      </Sheet.Frame>
    </Sheet>
  )
}
