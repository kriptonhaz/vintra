/**
 * Item create/edit sheet — used both from the inventory list (FAB →
 * create) and the item detail screen (edit button). The form is the
 * minimum set of fields an owner needs to track an item; the
 * heavier toggles (booking, prep mode, HPP link, multi-tier pricing)
 * stay on the web admin so the mobile form doesn't feel like a
 * settings dump.
 *
 * Fields:
 *   - Name (required)
 *   - SKU (optional, free text)
 *   - Category (picker, optional)
 *   - Base unit (picker, REQUIRED — can't change after first movement)
 *   - Cost price per unit (optional, default 0)
 *   - Min stock level (optional — drives the low-stock alert)
 *   - Notes (optional)
 *
 * Deferred to a future iteration: photo upload (needs expo-image-picker
 * + S3 pre-signed URL plumbing), initial selling price (couples this
 * sheet to POS pricing tiers which are non-trivial), franchise price.
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
import { Check, ChevronDown, X } from '~/lib/icons'
import { IconInput } from '../IconInput'
import {
  useCreateItem,
  useFormMasters,
  useUpdateItem,
  type InventoryItemDetail,
} from '../../lib/inventory'
import { COLORS, FONTS } from '../../lib/theme'

interface ItemFormSheetProps {
  open: boolean
  onClose: () => void
  /** Pass the existing item to edit; omit/null for create. */
  item?: InventoryItemDetail | null
  onSuccess?: () => void
}

interface FormState {
  name: string
  sku: string
  categoryId: string | null
  baseUnitId: string
  costPrice: string
  minStockLevel: string
  notes: string
}

function emptyForm(): FormState {
  return {
    name: '',
    sku: '',
    categoryId: null,
    baseUnitId: '',
    costPrice: '',
    minStockLevel: '',
    notes: '',
  }
}

function fromItem(item: InventoryItemDetail): FormState {
  return {
    name: item.name,
    sku: item.sku ?? '',
    categoryId: item.categoryId,
    baseUnitId: item.baseUnitId,
    costPrice: item.costPrice ? String(item.costPrice) : '',
    minStockLevel: item.minStockLevel ? String(item.minStockLevel) : '',
    notes: item.notes ?? '',
  }
}

export function ItemFormSheet({
  open,
  onClose,
  item,
  onSuccess,
}: ItemFormSheetProps) {
  const isEdit = !!item
  const masters = useFormMasters()
  const create = useCreateItem()
  const update = useUpdateItem()

  const [form, setForm] = useState<FormState>(() =>
    item ? fromItem(item) : emptyForm(),
  )
  const [error, setError] = useState<string | null>(null)

  // Reset whenever the sheet (re)opens with different item context.
  useEffect(() => {
    if (open) {
      setForm(item ? fromItem(item) : emptyForm())
      setError(null)
    }
  }, [open, item])

  const busy = create.isPending || update.isPending
  const canSubmit = form.name.trim().length > 0 && form.baseUnitId !== '' && !busy

  async function handleSubmit() {
    if (!canSubmit) return
    setError(null)

    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      categoryId: form.categoryId,
      baseUnitId: form.baseUnitId,
      costPrice: parseNumeric(form.costPrice) ?? 0,
      minStockLevel: parseNumeric(form.minStockLevel),
      notes: form.notes.trim() || null,
    }

    try {
      if (isEdit && item) {
        await update.mutateAsync({ ...payload, id: item.id })
      } else {
        await create.mutateAsync(payload)
      }
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
      snapPoints={[85]}
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
              {isEdit ? 'Edit Barang' : 'Tambah Barang'}
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
            {masters.isLoading ? (
              <XStack ai="center" gap="$2" py="$4">
                <Spinner color={COLORS.primary} />
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={13}
                  color={COLORS.onSurfaceVariant}
                >
                  Memuat opsi form...
                </Paragraph>
              </XStack>
            ) : (
              <>
                <Field label="Nama Barang" required>
                  <IconInput
                    leading={null}
                    value={form.name}
                    onChangeText={(v) => setForm({ ...form, name: v })}
                    placeholder="Mis: Kopi Robusta"
                    autoCapitalize="words"
                  />
                </Field>

                <Field label="SKU">
                  <IconInput
                    leading={null}
                    value={form.sku}
                    onChangeText={(v) => setForm({ ...form, sku: v })}
                    placeholder="Mis: KOPI-001"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </Field>

                <Field label="Kategori">
                  <PickerSelect
                    placeholder="Pilih kategori (opsional)"
                    value={form.categoryId ?? ''}
                    onChange={(v) =>
                      setForm({ ...form, categoryId: v || null })
                    }
                    options={[
                      { value: '', label: '— Tanpa kategori —' },
                      ...(masters.data?.categories.map((c) => ({
                        value: c.id,
                        label: c.name,
                      })) ?? []),
                    ]}
                  />
                </Field>

                <Field label="Satuan Dasar" required>
                  <PickerSelect
                    placeholder="Pilih satuan"
                    value={form.baseUnitId}
                    onChange={(v) => setForm({ ...form, baseUnitId: v })}
                    options={
                      masters.data?.units.map((u) => ({
                        value: u.id,
                        label: `${u.label}${u.value !== u.label ? ` (${u.value})` : ''}`,
                      })) ?? []
                    }
                    disabled={isEdit}
                    helper={
                      isEdit
                        ? 'Satuan dasar tidak bisa diubah setelah ada pergerakan stok.'
                        : undefined
                    }
                  />
                </Field>

                <XStack gap="$3">
                  <YStack flex={1}>
                    <Field label="Harga Modal">
                      <IconInput
                        leading={null}
                        value={form.costPrice}
                        onChangeText={(v) =>
                          setForm({ ...form, costPrice: v })
                        }
                        placeholder="0"
                        keyboardType="numeric"
                      />
                    </Field>
                  </YStack>
                  <YStack flex={1}>
                    <Field label="Stok Minimum">
                      <IconInput
                        leading={null}
                        value={form.minStockLevel}
                        onChangeText={(v) =>
                          setForm({ ...form, minStockLevel: v })
                        }
                        placeholder="0"
                        keyboardType="numeric"
                      />
                    </Field>
                  </YStack>
                </XStack>

                <Field label="Catatan">
                  <IconInput
                    leading={null}
                    value={form.notes}
                    onChangeText={(v) => setForm({ ...form, notes: v })}
                    placeholder="Catatan internal (opsional)"
                    multiline
                  />
                </Field>

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
              </>
            )}
          </ScrollView>

          {/* Footer */}
          <YStack
            px="$4"
            py="$3"
            borderTopWidth={1}
            borderTopColor={COLORS.outlineVariant}
            bg={COLORS.surfaceContainerLowest}
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
              {busy ? (
                <Spinner color="white" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={15}
                  color="white"
                >
                  {isEdit ? 'Simpan Perubahan' : 'Tambah Barang'}
                </Paragraph>
              )}
            </Button>
          </YStack>
        </YStack>
      </Sheet.Frame>
    </Sheet>
  )
}

// ─── Field wrapper ───────────────────────────────────────────────────

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <YStack gap="$1.5">
      <XStack ai="center" gap="$1">
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={13}
          color={COLORS.onSurface}
        >
          {label}
        </Paragraph>
        {required && (
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={13}
            color={COLORS.danger}
          >
            *
          </Paragraph>
        )}
      </XStack>
      {children}
    </YStack>
  )
}

// ─── Picker — wraps Tamagui Select with our pill styling ────────────

interface PickerOption {
  value: string
  label: string
}

function PickerSelect({
  placeholder,
  value,
  onChange,
  options,
  disabled,
  helper,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  options: PickerOption[]
  disabled?: boolean
  helper?: string
}) {
  const selected = options.find((o) => o.value === value)
  const displayValue = selected?.label ?? placeholder

  return (
    <YStack gap="$1">
      <Select
        value={value}
        onValueChange={onChange}
        disablePreventBodyScroll
      >
        <Select.Trigger
          h={56}
          br={9999}
          px="$4"
          bg={
            disabled
              ? COLORS.surfaceContainerHigh
              : COLORS.surfaceContainerLow
          }
          borderWidth={1}
          borderColor={COLORS.outlineVariant}
          opacity={disabled ? 0.7 : 1}
          disabled={disabled}
        >
          <Paragraph
            flex={1}
            fontFamily={FONTS.body}
            fontSize={14}
            color={selected ? COLORS.onSurface : COLORS.outline}
            numberOfLines={1}
          >
            {displayValue}
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
            <Select.Group>
              {options.map((opt, idx) => (
                <Select.Item
                  key={opt.value}
                  index={idx}
                  value={opt.value}
                >
                  <Select.ItemText>{opt.label}</Select.ItemText>
                  <Select.ItemIndicator marginLeft="auto">
                    <Check size={16} color={COLORS.primary} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Viewport>
        </Select.Content>
      </Select>
      {helper && (
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={11}
          color={COLORS.onSurfaceVariant}
          pl="$2"
        >
          {helper}
        </Paragraph>
      )}
    </YStack>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseNumeric(input: string): number | null {
  const cleaned = input.replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
