/**
 * Stock adjustment sheet — record an in/out/adjustment movement for
 * an item at a branch. Always launched with a pre-selected item (from
 * the item detail screen "Sesuaikan Stok" button) so we don't need an
 * item picker — just branch + direction + quantity.
 *
 * Three movement types:
 *   - in       — stock arrived (purchase, transfer-in)
 *   - out      — stock left (waste, sample, manual sale)
 *   - adjustment — recount: server treats the quantity as a DELTA,
 *                  not an absolute, so negative values aren't allowed
 *                  in the form. Use `out` for negative adjustments.
 */
import { useEffect, useState } from 'react'
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
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  RotateCcw,
  X,
} from '~/lib/icons'
import { IconInput } from '../IconInput'
import {
  useFormMasters,
  useRecordMovement,
  type InventoryItemDetail,
} from '../../lib/inventory'
import { COLORS, FONTS } from '../../lib/theme'

type MovementType = 'in' | 'out' | 'adjustment'

interface StockAdjustSheetProps {
  open: boolean
  onClose: () => void
  item: InventoryItemDetail
  /** Pre-fill branch if launched from a branch-specific row. */
  defaultBranchId?: string | null
  onSuccess?: () => void
}

export function StockAdjustSheet({
  open,
  onClose,
  item,
  defaultBranchId,
  onSuccess,
}: StockAdjustSheetProps) {
  const masters = useFormMasters()
  const record = useRecordMovement()

  const [movementType, setMovementType] = useState<MovementType>('in')
  const [branchId, setBranchId] = useState<string>(defaultBranchId ?? '')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setMovementType('in')
      setBranchId(defaultBranchId ?? '')
      setQuantity('')
      setReason('')
      setNotes('')
      setError(null)
    }
  }, [open, defaultBranchId])

  const qty = parseFloat(quantity.replace(/[^\d.]/g, ''))
  const canSubmit =
    branchId !== '' && Number.isFinite(qty) && qty > 0 && !record.isPending

  async function handleSubmit() {
    if (!canSubmit) return
    setError(null)
    try {
      await record.mutateAsync({
        itemId: item.id,
        branchId,
        movementType,
        quantity: qty,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
      })
      onSuccess?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onClose}
      snapPoints={[80]}
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
            <YStack flex={1}>
              <Paragraph
                fontFamily={FONTS.headingBold}
                fontSize={18}
                color={COLORS.onSurface}
              >
                Sesuaikan Stok
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
                numberOfLines={1}
              >
                {item.name}
              </Paragraph>
            </YStack>
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
            {/* Movement type picker — segmented */}
            <YStack gap="$1.5">
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Jenis Pergerakan
              </Paragraph>
              <XStack gap="$2">
                <TypeChip
                  active={movementType === 'in'}
                  onPress={() => setMovementType('in')}
                  icon={
                    <ArrowDownToLine
                      size={16}
                      color={movementType === 'in' ? 'white' : COLORS.success}
                    />
                  }
                  label="Masuk"
                  activeBg={COLORS.success}
                />
                <TypeChip
                  active={movementType === 'out'}
                  onPress={() => setMovementType('out')}
                  icon={
                    <ArrowUpFromLine
                      size={16}
                      color={movementType === 'out' ? 'white' : COLORS.danger}
                    />
                  }
                  label="Keluar"
                  activeBg={COLORS.danger}
                />
                <TypeChip
                  active={movementType === 'adjustment'}
                  onPress={() => setMovementType('adjustment')}
                  icon={
                    <RotateCcw
                      size={16}
                      color={
                        movementType === 'adjustment'
                          ? 'white'
                          : COLORS.primary
                      }
                    />
                  }
                  label="Recount"
                  activeBg={COLORS.primary}
                />
              </XStack>
            </YStack>

            {/* Branch picker */}
            <YStack gap="$1.5">
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Cabang *
              </Paragraph>
              <Select
                value={branchId}
                onValueChange={setBranchId}
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
                    color={branchId ? COLORS.onSurface : COLORS.outline}
                  >
                    {masters.data?.branches.find((b) => b.id === branchId)
                      ?.name ?? 'Pilih cabang'}
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
            </YStack>

            {/* Quantity */}
            <YStack gap="$1.5">
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Jumlah *
              </Paragraph>
              <IconInput
                leading={null}
                value={quantity}
                onChangeText={setQuantity}
                placeholder="0"
                keyboardType="numeric"
              />
            </YStack>

            {/* Reason */}
            <YStack gap="$1.5">
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Alasan
              </Paragraph>
              <IconInput
                leading={null}
                value={reason}
                onChangeText={setReason}
                placeholder={
                  movementType === 'in'
                    ? 'mis: pembelian, transfer masuk'
                    : movementType === 'out'
                      ? 'mis: rusak, sample, retur'
                      : 'mis: stock-take selisih'
                }
              />
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
                placeholder="Catatan tambahan (opsional)"
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
              {record.isPending ? (
                <Spinner color="white" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={15}
                  color="white"
                >
                  Simpan
                </Paragraph>
              )}
            </Button>
          </YStack>
        </YStack>
      </Sheet.Frame>
    </Sheet>
  )
}

function TypeChip({
  active,
  onPress,
  icon,
  label,
  activeBg,
}: {
  active: boolean
  onPress: () => void
  icon: React.ReactNode
  label: string
  activeBg: string
}) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <YStack
        ai="center"
        jc="center"
        gap="$1"
        h={56}
        br="$4"
        bg={active ? activeBg : COLORS.surfaceContainerLow}
        borderWidth={1}
        borderColor={active ? activeBg : COLORS.outlineVariant}
      >
        {icon}
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={11}
          color={active ? 'white' : COLORS.onSurface}
        >
          {label}
        </Paragraph>
      </YStack>
    </Pressable>
  )
}
