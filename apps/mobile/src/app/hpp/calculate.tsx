/**
 * HPP Calculator — 3-step wizard.
 *
 *   1. Info Produk    name, kategori, harga jual, qty produksi
 *   2. Komponen Biaya pick materials + quantities; live HPP total
 *   3. Ringkasan      HPP per unit, margin, save
 *
 * Edit mode is entered via `?editProductId=<uuid>`; we hydrate the
 * form from getProductForEdit, then save through createProduct or
 * updateProduct + replaceProductMaterials + calculateProductHpp.
 *
 * Inline material create — the picker has a "Bahan baru" CTA that
 * pushes a second modal with name + unit + supplier + purchase
 * (price + qty) so the cashier never bounces back to a master-data
 * screen mid-wizard.
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
import { useLocalSearchParams, useRouter } from 'expo-router'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertCircle,
  Check,
  ChevronRight,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useCreateMaterial,
  useCreateProduct,
  useFindOrCreateSupplier,
  useHppMaterials,
  useHppSuppliers,
  useHppUnits,
  useProductForEdit,
  useReplaceProductMaterials,
  useTenantCategories,
  useUpdateProduct,
  type HppMaterial,
  type HppUnit,
} from '~/lib/hpp'
import { ApiError } from '~/lib/api'
import { formatRupiah, parseRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

// ─── Step shell ──────────────────────────────────────────────────────

type Step = 1 | 2 | 3

interface RecipeRow {
  /** Local key for FlatList rendering — not sent to server. */
  key: string
  materialId: string
  materialName: string
  unitId: string
  unitLabel: string
  pricePerUnit: number
  /** Free-text qty so partial typing ("1.") stays editable. */
  quantity: string
}

// ─── Page ────────────────────────────────────────────────────────────

export default function CalculateScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ editProductId?: string }>()
  const editProductId = params.editProductId ?? null
  const isEditMode = !!editProductId

  // ── Master data ───────────────────────────────────────────────────
  const unitsQuery = useHppUnits()
  const categoriesQuery = useTenantCategories()
  const materialsQuery = useHppMaterials()
  const suppliersQuery = useHppSuppliers()
  const editQuery = useProductForEdit(editProductId)

  const units = unitsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const materials = materialsQuery.data ?? []
  const suppliers = suppliersQuery.data ?? []

  // ── Form state ────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>('')
  const [sellingPrice, setSellingPrice] = useState('')
  const [productionQty, setProductionQty] = useState('1')
  const [productionUnitId, setProductionUnitId] = useState<string>('')
  const [rows, setRows] = useState<RecipeRow[]>([])

  // ── Picker visibility ─────────────────────────────────────────────
  const [showUnitPicker, setShowUnitPicker] = useState(false)
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [showMaterialPicker, setShowMaterialPicker] = useState(false)
  const [showCreateMaterial, setShowCreateMaterial] = useState(false)

  // ── Mutations ─────────────────────────────────────────────────────
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const replaceMaterials = useReplaceProductMaterials()
  const [saving, setSaving] = useState(false)

  // ── Hydrate edit mode (once master + product are loaded) ──────────
  useEffect(() => {
    if (!isEditMode || !editQuery.data || units.length === 0) return
    if (name || rows.length > 0) return // already hydrated

    const { product, materials: bom } = editQuery.data
    setName(product.name)
    setCategory(product.category ?? '')
    setSellingPrice(String(Number(product.sellingPrice) || 0))
    setProductionQty(product.productionQty ?? '1')

    // production unit: match by label/value
    if (product.productionUnit) {
      const matched = units.find(
        (u) => u.value === product.productionUnit || u.label === product.productionUnit,
      )
      if (matched) setProductionUnitId(matched.id)
    }

    // Recipe rows from BOM (material-only; sub-product rows skipped in v1)
    const hydratedRows: RecipeRow[] = bom
      .filter((r) => r.materialId)
      .map((r, i) => {
        const matUnit = units.find((u) => u.id === r.unitId)
        return {
          key: `e-${i}`,
          materialId: r.materialId!,
          materialName: r.materialName ?? '(tanpa nama)',
          unitId: r.unitId,
          unitLabel: matUnit?.label ?? r.unit,
          pricePerUnit: Number(r.pricePerUnit ?? 0),
          quantity: r.quantity,
        }
      })
    setRows(hydratedRows)
  }, [isEditMode, editQuery.data, units, name, rows.length])

  // Default production unit to first available once master is loaded
  useEffect(() => {
    if (!productionUnitId && units.length > 0) {
      const pcs = units.find((u) => u.value === 'pcs')
      setProductionUnitId(pcs?.id ?? units[0]!.id)
    }
  }, [productionUnitId, units])

  // ── Derived ───────────────────────────────────────────────────────
  const totalMaterialCost = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const q = parseFloat(r.quantity) || 0
        return sum + q * r.pricePerUnit
      }, 0),
    [rows],
  )

  const prodQtyNum = Math.max(1, parseFloat(productionQty) || 1)
  const hppPerUnit = totalMaterialCost / prodQtyNum
  const sellingPriceNum = parseRupiah(sellingPrice)
  const margin =
    sellingPriceNum > 0
      ? ((sellingPriceNum - hppPerUnit) / sellingPriceNum) * 100
      : 0

  // ── Step nav guards ───────────────────────────────────────────────
  const step1Valid = name.trim().length > 0 && sellingPriceNum > 0
  const step2Valid =
    rows.length > 0 && rows.every((r) => (parseFloat(r.quantity) || 0) > 0)

  // ── Save ──────────────────────────────────────────────────────────
  async function handleSave() {
    if (!step1Valid || !step2Valid) {
      Alert.alert(
        'Belum lengkap',
        'Cek info produk + komponen biaya sebelum simpan.',
      )
      return
    }
    setSaving(true)
    try {
      const productionUnit =
        units.find((u) => u.id === productionUnitId)?.value ?? null

      let productId: string
      if (isEditMode && editProductId) {
        const result = await updateProduct.mutateAsync({
          id: editProductId,
          name: name.trim(),
          category: category || null,
          sellingPrice: String(sellingPriceNum),
          productionQty,
          productionUnit,
          hpp: hppPerUnit.toFixed(2),
          margin: margin.toFixed(2),
        })
        productId = result.id
      } else {
        const result = await createProduct.mutateAsync({
          name: name.trim(),
          category: category || null,
          sellingPrice: String(sellingPriceNum),
          productionQty,
          productionUnit,
        })
        productId = result.id
      }

      // Atomic BOM replace
      await replaceMaterials.mutateAsync({
        productId,
        items: rows.map((r) => ({
          materialId: r.materialId,
          quantity: r.quantity,
          unitId: r.unitId,
          addAt: 'prep' as const,
        })),
      })

      // Persist the computed HPP + margin on the product row for the
      // dashboard list. The web wizard does this too (the calc fn lives
      // server-side but we already have the numbers locally).
      if (!isEditMode) {
        await updateProduct.mutateAsync({
          id: productId,
          hpp: hppPerUnit.toFixed(2),
          margin: margin.toFixed(2),
        })
      }

      router.replace('/hpp' as never)
    } catch (err) {
      Alert.alert('Gagal simpan', errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  // ── Loading ───────────────────────────────────────────────────────
  if (
    unitsQuery.isLoading ||
    materialsQuery.isLoading ||
    suppliersQuery.isLoading ||
    (isEditMode && editQuery.isLoading)
  ) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Hitung HPP" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title={isEditMode ? 'Edit Produk' : 'Hitung HPP'}
        subtitle={`Langkah ${step} dari 3`}
        back
      />

      <StepBar step={step} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={materialsQuery.isFetching || unitsQuery.isFetching}
              onRefresh={() => {
                void materialsQuery.refetch()
                void unitsQuery.refetch()
                void categoriesQuery.refetch()
                void suppliersQuery.refetch()
              }}
              tintColor={COLORS.primary}
            />
          }
        >
          {step === 1 && (
            <Step1Form
              name={name}
              setName={setName}
              category={category}
              onPickCategory={() => setShowCategoryPicker(true)}
              sellingPrice={sellingPrice}
              setSellingPrice={setSellingPrice}
              productionQty={productionQty}
              setProductionQty={setProductionQty}
              productionUnitLabel={
                units.find((u) => u.id === productionUnitId)?.label ?? '-'
              }
              onPickUnit={() => setShowUnitPicker(true)}
            />
          )}

          {step === 2 && (
            <Step2Recipe
              rows={rows}
              setRows={setRows}
              totalMaterialCost={totalMaterialCost}
              productionQty={prodQtyNum}
              hppPerUnit={hppPerUnit}
              onAddRow={() => setShowMaterialPicker(true)}
            />
          )}

          {step === 3 && (
            <Step3Summary
              name={name}
              category={category}
              sellingPrice={sellingPriceNum}
              productionQty={prodQtyNum}
              productionUnitLabel={
                units.find((u) => u.id === productionUnitId)?.label ?? ''
              }
              rows={rows}
              totalMaterialCost={totalMaterialCost}
              hppPerUnit={hppPerUnit}
              margin={margin}
            />
          )}
        </ScrollView>

        {/* Sticky footer nav */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          px="$4"
          pt="$3"
          pb="$5"
          borderTopWidth={1}
          borderTopColor={COLORS.borderSubtle}
        >
          <XStack gap="$3">
            {step > 1 ? (
              <Pressable
                onPress={() => setStep((s) => (s - 1) as Step)}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: COLORS.borderSubtle,
                  alignItems: 'center',
                }}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  Kembali
                </Paragraph>
              </Pressable>
            ) : null}

            {step < 3 ? (
              <Pressable
                onPress={() => {
                  if (step === 1 && !step1Valid) {
                    Alert.alert(
                      'Lengkapi info produk',
                      'Nama + harga jual wajib diisi.',
                    )
                    return
                  }
                  if (step === 2 && !step2Valid) {
                    Alert.alert(
                      'Tambah komponen biaya',
                      'Minimal 1 bahan dengan jumlah > 0.',
                    )
                    return
                  }
                  setStep((s) => (s + 1) as Step)
                }}
                style={{
                  flex: 2,
                  paddingVertical: 14,
                  borderRadius: 12,
                  backgroundColor: COLORS.primary,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Lanjut
                </Paragraph>
                <ChevronRight size={16} color="#fff" />
              </Pressable>
            ) : (
              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={{
                  flex: 2,
                  paddingVertical: 14,
                  borderRadius: 12,
                  backgroundColor: saving ? COLORS.outline : COLORS.primary,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Check size={16} color="#fff" />
                    <Paragraph
                      fontFamily={FONTS.bodyBold}
                      fontSize={14}
                      color="#fff"
                    >
                      Simpan
                    </Paragraph>
                  </>
                )}
              </Pressable>
            )}
          </XStack>
        </YStack>
      </KeyboardAvoidingView>

      {/* Pickers */}
      <PickerModal
        visible={showUnitPicker}
        title="Pilih satuan produksi"
        onClose={() => setShowUnitPicker(false)}
        items={units.map((u) => ({ key: u.id, label: u.label, sub: u.value }))}
        selectedKey={productionUnitId}
        onSelect={(id) => {
          setProductionUnitId(id)
          setShowUnitPicker(false)
        }}
      />

      <PickerModal
        visible={showCategoryPicker}
        title="Pilih kategori"
        onClose={() => setShowCategoryPicker(false)}
        items={[
          { key: '', label: 'Tanpa kategori', sub: undefined },
          ...categories.map((c) => ({
            key: c.name,
            label: c.name,
            sub: undefined,
          })),
        ]}
        selectedKey={category}
        onSelect={(key) => {
          setCategory(key)
          setShowCategoryPicker(false)
        }}
      />

      <MaterialPickerModal
        visible={showMaterialPicker}
        materials={materials}
        units={units}
        onClose={() => setShowMaterialPicker(false)}
        onCreateNew={() => {
          setShowMaterialPicker(false)
          setShowCreateMaterial(true)
        }}
        onSelect={(m) => {
          setRows((prev) => [
            ...prev,
            {
              key: `r-${Date.now()}-${m.id}`,
              materialId: m.id,
              materialName: m.name,
              unitId: m.unitId,
              unitLabel: m.unitLabel,
              pricePerUnit: Number(m.pricePerUnit) || 0,
              quantity: '',
            },
          ])
          setShowMaterialPicker(false)
        }}
      />

      <CreateMaterialModal
        visible={showCreateMaterial}
        units={units}
        suppliers={suppliers}
        onClose={() => setShowCreateMaterial(false)}
        onCreated={(m) => {
          setRows((prev) => [
            ...prev,
            {
              key: `r-${Date.now()}-${m.id}`,
              materialId: m.id,
              materialName: m.name,
              unitId: m.unitId,
              unitLabel: m.unitLabel,
              pricePerUnit: Number(m.pricePerUnit) || 0,
              quantity: '',
            },
          ])
          setShowCreateMaterial(false)
        }}
      />
    </YStack>
  )
}

// ─── Step bar ────────────────────────────────────────────────────────

function StepBar({ step }: { step: Step }) {
  return (
    <XStack
      ai="center"
      jc="space-between"
      gap="$2"
      px="$4"
      py="$3"
      bg={COLORS.surfaceContainerLowest}
      borderBottomWidth={1}
      borderBottomColor={COLORS.borderSubtle}
    >
      {[1, 2, 3].map((n) => {
        const active = n <= step
        return (
          <XStack key={n} ai="center" flex={1} gap="$2">
            <YStack
              w={26}
              h={26}
              br={13}
              ai="center"
              jc="center"
              bg={active ? COLORS.primary : COLORS.surfaceContainerLow}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={active ? '#fff' : COLORS.onSurfaceVariant}
              >
                {n}
              </Paragraph>
            </YStack>
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={11}
              color={active ? COLORS.onSurface : COLORS.onSurfaceVariant}
              numberOfLines={1}
              flex={1}
            >
              {n === 1 ? 'Info' : n === 2 ? 'Resep' : 'Ringkasan'}
            </Paragraph>
          </XStack>
        )
      })}
    </XStack>
  )
}

// ─── Step 1 — Info Produk ────────────────────────────────────────────

interface Step1Props {
  name: string
  setName: (v: string) => void
  category: string
  onPickCategory: () => void
  sellingPrice: string
  setSellingPrice: (v: string) => void
  productionQty: string
  setProductionQty: (v: string) => void
  productionUnitLabel: string
  onPickUnit: () => void
}

function Step1Form(p: Step1Props) {
  return (
    <YStack gap="$4">
      <FieldLabel label="Nama Produk" required />
      <TextInput
        value={p.name}
        onChangeText={p.setName}
        placeholder="Mis. Kopi Susu Gula Aren"
        placeholderTextColor={COLORS.outline}
        style={inputStyle}
      />

      <FieldLabel label="Kategori" />
      <Pressable onPress={p.onPickCategory} style={pickerStyle}>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={14}
          color={p.category ? COLORS.onSurface : COLORS.outline}
        >
          {p.category || 'Pilih kategori (opsional)'}
        </Paragraph>
        <ChevronRight size={16} color={COLORS.outline} />
      </Pressable>

      <FieldLabel label="Harga Jual" required />
      <CurrencyInput value={p.sellingPrice} onChange={p.setSellingPrice} />

      <XStack gap="$3">
        <YStack flex={2} gap="$2">
          <FieldLabel label="Jumlah Produksi" required />
          <TextInput
            value={p.productionQty}
            onChangeText={p.setProductionQty}
            keyboardType="decimal-pad"
            placeholder="1"
            placeholderTextColor={COLORS.outline}
            style={inputStyle}
          />
        </YStack>
        <YStack flex={3} gap="$2">
          <FieldLabel label="Satuan" />
          <Pressable onPress={p.onPickUnit} style={pickerStyle}>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={14}
              color={COLORS.onSurface}
            >
              {p.productionUnitLabel}
            </Paragraph>
            <ChevronRight size={16} color={COLORS.outline} />
          </Pressable>
        </YStack>
      </XStack>

      <Paragraph
        fontFamily={FONTS.body}
        fontSize={12}
        color={COLORS.onSurfaceVariant}
        mt="$2"
      >
        Jumlah produksi = berapa unit yang dihasilkan oleh resep ini. HPP
        per unit dibagi dari total biaya bahan.
      </Paragraph>
    </YStack>
  )
}

// ─── Step 2 — Komponen Biaya ────────────────────────────────────────

interface Step2Props {
  rows: RecipeRow[]
  setRows: React.Dispatch<React.SetStateAction<RecipeRow[]>>
  totalMaterialCost: number
  productionQty: number
  hppPerUnit: number
  onAddRow: () => void
}

function Step2Recipe(p: Step2Props) {
  function updateQty(key: string, qty: string) {
    p.setRows((prev) => prev.map((r) => (r.key === key ? { ...r, quantity: qty } : r)))
  }
  function removeRow(key: string) {
    p.setRows((prev) => prev.filter((r) => r.key !== key))
  }

  return (
    <YStack gap="$3">
      {p.rows.length === 0 ? (
        <YStack
          ai="center"
          gap="$3"
          py="$8"
          bg={COLORS.surfaceContainerLowest}
          br={14}
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <Package size={28} color={COLORS.outline} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={13}
            color={COLORS.onSurfaceVariant}
            ta="center"
            px="$4"
          >
            Tambah bahan-bahan yang dipakai untuk produk ini.
          </Paragraph>
        </YStack>
      ) : (
        p.rows.map((row) => {
          const qty = parseFloat(row.quantity) || 0
          const subtotal = qty * row.pricePerUnit
          return (
            <YStack
              key={row.key}
              bg={COLORS.surfaceContainerLowest}
              br={14}
              p="$3"
              gap="$2"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
            >
              <XStack ai="flex-start" jc="space-between" gap="$2">
                <YStack flex={1} gap={2}>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                    numberOfLines={1}
                  >
                    {row.materialName}
                  </Paragraph>
                  <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                    {formatRupiah(row.pricePerUnit)}/{row.unitLabel}
                  </Stat>
                </YStack>
                <Pressable
                  onPress={() => removeRow(row.key)}
                  hitSlop={8}
                  style={{
                    padding: 6,
                  }}
                >
                  <Trash2 size={16} color={COLORS.danger} />
                </Pressable>
              </XStack>
              <XStack ai="center" gap="$2">
                <TextInput
                  value={row.quantity}
                  onChangeText={(v) => updateQty(row.key, v)}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={COLORS.outline}
                  style={{
                    ...inputStyle,
                    flex: 1,
                    height: 40,
                  }}
                />
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={13}
                  color={COLORS.onSurfaceVariant}
                  minWidth={40}
                >
                  {row.unitLabel}
                </Paragraph>
                <Money amount={subtotal} fontSize={13} emphasis />
              </XStack>
            </YStack>
          )
        })
      )}

      <Pressable
        onPress={p.onAddRow}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: COLORS.primary,
          backgroundColor: COLORS.primaryFixed,
        }}
      >
        <Plus size={16} color={COLORS.primary} />
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={13}
          color={COLORS.primary}
        >
          Tambah Bahan
        </Paragraph>
      </Pressable>

      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        mt="$3"
        style={SHADOWS.card}
      >
        <SummaryRow label="Total Biaya Bahan" value={formatRupiah(p.totalMaterialCost)} />
        <SummaryRow label="Jumlah Produksi" value={`${p.productionQty} unit`} />
        <YStack h={1} bg={COLORS.borderSubtle} my="$1" />
        <SummaryRow
          label="HPP per Unit"
          value={formatRupiah(p.hppPerUnit)}
          bold
        />
      </YStack>
    </YStack>
  )
}

// ─── Step 3 — Ringkasan ────────────────────────────────────────────

interface Step3Props {
  name: string
  category: string
  sellingPrice: number
  productionQty: number
  productionUnitLabel: string
  rows: RecipeRow[]
  totalMaterialCost: number
  hppPerUnit: number
  margin: number
}

function Step3Summary(p: Step3Props) {
  const profit = p.sellingPrice - p.hppPerUnit
  const marginTone =
    p.margin >= 40
      ? COLORS.success
      : p.margin >= 20
        ? '#92400e'
        : COLORS.danger

  return (
    <YStack gap="$3">
      <YStack
        bg={COLORS.primary}
        br={16}
        p="$4"
        gap="$2"
        style={SHADOWS.card}
      >
        <Paragraph
          fontFamily={FONTS.bodyMedium}
          fontSize={12}
          color="rgba(255,255,255,0.85)"
        >
          {p.name || '(Belum ada nama)'}
        </Paragraph>
        <XStack ai="baseline" jc="space-between">
          <YStack>
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={11}
              color="rgba(255,255,255,0.85)"
            >
              MARGIN
            </Paragraph>
            <H2 fontSize={28} color="#fff" fontWeight="800">
              {p.margin.toFixed(1)}%
            </H2>
          </YStack>
          <YStack ai="flex-end">
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={11}
              color="rgba(255,255,255,0.85)"
            >
              UNTUNG/UNIT
            </Paragraph>
            <Money amount={profit} color="#fff" fontSize={18} emphasis />
          </YStack>
        </XStack>
      </YStack>

      {p.margin < 20 && (
        <XStack
          gap="$2"
          ai="flex-start"
          bg={COLORS.dangerTint}
          br={12}
          p="$3"
        >
          <AlertCircle size={16} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.danger}
            flex={1}
          >
            Margin di bawah 20% — pertimbangkan naikkan harga jual atau
            kurangi biaya bahan.
          </Paragraph>
        </XStack>
      )}

      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
      >
        <SectionLabel>RINCIAN</SectionLabel>
        <SummaryRow label="Kategori" value={p.category || '-'} />
        <SummaryRow
          label="Harga Jual"
          value={formatRupiah(p.sellingPrice)}
        />
        <SummaryRow
          label="Jumlah Produksi"
          value={`${p.productionQty} ${p.productionUnitLabel}`}
        />
        <SummaryRow
          label="Total Biaya Bahan"
          value={formatRupiah(p.totalMaterialCost)}
        />
        <YStack h={1} bg={COLORS.borderSubtle} my="$1" />
        <SummaryRow
          label="HPP per Unit"
          value={formatRupiah(p.hppPerUnit)}
          bold
        />
      </YStack>

      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
      >
        <SectionLabel>{`BAHAN (${p.rows.length})`}</SectionLabel>
        {p.rows.map((row) => {
          const q = parseFloat(row.quantity) || 0
          const subtotal = q * row.pricePerUnit
          return (
            <XStack key={row.key} ai="center" jc="space-between" gap="$2">
              <YStack flex={1}>
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={13}
                  color={COLORS.onSurface}
                  numberOfLines={1}
                >
                  {row.materialName}
                </Paragraph>
                <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                  {row.quantity} {row.unitLabel} × {formatRupiah(row.pricePerUnit)}
                </Stat>
              </YStack>
              <Money amount={subtotal} fontSize={13} />
            </XStack>
          )
        })}
      </YStack>
    </YStack>
  )
}

// ─── Picker modal (single-select list) ─────────────────────────────

interface PickerItem {
  key: string
  label: string
  sub?: string
}

interface PickerModalProps {
  visible: boolean
  title: string
  items: PickerItem[]
  selectedKey: string
  onClose: () => void
  onSelect: (key: string) => void
}

function PickerModal(p: PickerModalProps) {
  return (
    <Modal
      visible={p.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={p.onClose}
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
            {p.title}
          </H2>
          <Pressable onPress={p.onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 4 }}>
          {p.items.map((item) => {
            const selected = item.key === p.selectedKey
            return (
              <Pressable
                key={item.key || '__none'}
                onPress={() => p.onSelect(item.key)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 14,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  backgroundColor: selected
                    ? COLORS.primaryFixed
                    : COLORS.surfaceContainerLowest,
                  borderWidth: 1,
                  borderColor: selected ? COLORS.primary : COLORS.borderSubtle,
                  marginBottom: 6,
                }}
              >
                <YStack flex={1}>
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {item.label}
                  </Paragraph>
                  {item.sub ? (
                    <Paragraph
                      fontFamily={FONTS.body}
                      fontSize={11}
                      color={COLORS.onSurfaceVariant}
                    >
                      {item.sub}
                    </Paragraph>
                  ) : null}
                </YStack>
                {selected && <Check size={18} color={COLORS.primary} />}
              </Pressable>
            )
          })}
        </ScrollView>
      </YStack>
    </Modal>
  )
}

// ─── Material picker (searchable + create-new CTA) ─────────────────

interface MaterialPickerProps {
  visible: boolean
  materials: HppMaterial[]
  units: HppUnit[]
  onClose: () => void
  onCreateNew: () => void
  onSelect: (m: HppMaterial) => void
}

function MaterialPickerModal(p: MaterialPickerProps) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return p.materials
    return p.materials.filter(
      (m) =>
        m.name.toLowerCase().includes(needle) ||
        (m.brand ?? '').toLowerCase().includes(needle),
    )
  }, [p.materials, q])

  return (
    <Modal
      visible={p.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={p.onClose}
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
            Pilih Bahan
          </H2>
          <Pressable onPress={p.onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <YStack px="$4" pt="$3" gap="$3">
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
              placeholder="Cari bahan…"
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

          <Pressable
            onPress={p.onCreateNew}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: COLORS.primary,
              backgroundColor: COLORS.primaryFixed,
            }}
          >
            <Plus size={16} color={COLORS.primary} />
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={13}
              color={COLORS.primary}
            >
              Bahan Baru
            </Paragraph>
          </Pressable>
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
              Tidak ada bahan ditemukan.
            </Paragraph>
          ) : (
            filtered.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => p.onSelect(m)}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: COLORS.borderSubtle,
                  backgroundColor: COLORS.surfaceContainerLowest,
                }}
              >
                <Paragraph
                  fontFamily={FONTS.bodySemi}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  {m.name}
                  {m.brand ? (
                    <Paragraph
                      fontFamily={FONTS.body}
                      fontSize={12}
                      color={COLORS.onSurfaceVariant}
                    >
                      {' '}
                      · {m.brand}
                    </Paragraph>
                  ) : null}
                </Paragraph>
                <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                  {formatRupiah(Number(m.pricePerUnit) || 0)}/{m.unitLabel}
                  {m.supplierName ? ` · ${m.supplierName}` : ''}
                </Stat>
              </Pressable>
            ))
          )}
        </ScrollView>
      </YStack>
    </Modal>
  )
}

// ─── Create material modal ──────────────────────────────────────────

interface CreateMaterialProps {
  visible: boolean
  units: HppUnit[]
  suppliers: { id: string; name: string }[]
  onClose: () => void
  onCreated: (m: HppMaterial) => void
}

function CreateMaterialModal(p: CreateMaterialProps) {
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [purchaseQty, setPurchaseQty] = useState('')
  const [unitId, setUnitId] = useState<string>('')
  const [supplierName, setSupplierName] = useState('')
  const [showUnitPicker, setShowUnitPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const createMaterial = useCreateMaterial()
  const findOrCreateSupplier = useFindOrCreateSupplier()

  useEffect(() => {
    if (!p.visible) {
      // reset on close
      setName('')
      setBrand('')
      setPurchasePrice('')
      setPurchaseQty('')
      setSupplierName('')
      // keep unitId so user doesn't repick the same unit twice
    }
  }, [p.visible])

  useEffect(() => {
    if (!unitId && p.units.length > 0) {
      const gram = p.units.find((u) => u.value === 'gram')
      setUnitId(gram?.id ?? p.units[0]!.id)
    }
  }, [unitId, p.units])

  async function handleSave() {
    if (!name.trim() || !unitId || !purchasePrice || !purchaseQty) {
      Alert.alert(
        'Lengkapi data',
        'Nama, satuan, harga beli, dan jumlah beli wajib diisi.',
      )
      return
    }
    setBusy(true)
    try {
      let supplierId: string | null = null
      if (supplierName.trim()) {
        const supplier = await findOrCreateSupplier.mutateAsync(supplierName.trim())
        supplierId = supplier.id
      }
      const m = await createMaterial.mutateAsync({
        name: name.trim(),
        brand: brand.trim() || null,
        unitId,
        purchasePrice: String(parseRupiah(purchasePrice)),
        purchaseQty,
        supplierId,
      })
      p.onCreated(m)
    } catch (err) {
      Alert.alert('Gagal menambah bahan', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      visible={p.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={p.onClose}
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
            Bahan Baru
          </H2>
          <Pressable onPress={p.onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
          <YStack gap="$2">
            <FieldLabel label="Nama Bahan" required />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Mis. Kopi Robusta"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
          </YStack>

          <YStack gap="$2">
            <FieldLabel label="Merek (opsional)" />
            <TextInput
              value={brand}
              onChangeText={setBrand}
              placeholder="Mis. Aroma"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
          </YStack>

          <XStack gap="$3">
            <YStack flex={2} gap="$2">
              <FieldLabel label="Harga Beli" required />
              <CurrencyInput
                value={purchasePrice}
                onChange={setPurchasePrice}
              />
            </YStack>
            <YStack flex={2} gap="$2">
              <FieldLabel label="Jumlah Beli" required />
              <TextInput
                value={purchaseQty}
                onChangeText={setPurchaseQty}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={COLORS.outline}
                style={inputStyle}
              />
            </YStack>
          </XStack>

          <YStack gap="$2">
            <FieldLabel label="Satuan" required />
            <Pressable
              onPress={() => setShowUnitPicker(true)}
              style={pickerStyle}
            >
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={14}
                color={COLORS.onSurface}
              >
                {p.units.find((u) => u.id === unitId)?.label ?? 'Pilih'}
              </Paragraph>
              <ChevronRight size={16} color={COLORS.outline} />
            </Pressable>
          </YStack>

          <YStack gap="$2">
            <FieldLabel label="Supplier (opsional)" />
            <TextInput
              value={supplierName}
              onChangeText={setSupplierName}
              placeholder="Nama supplier — auto-create kalau baru"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
          </YStack>

          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
          >
            Harga per satuan dihitung otomatis: {formatRupiah(
              (parseRupiah(purchasePrice) || 0) /
                Math.max(1, parseFloat(purchaseQty) || 1),
            )}{' '}
            / {p.units.find((u) => u.id === unitId)?.label ?? 'satuan'}
          </Paragraph>

          <Pressable
            onPress={handleSave}
            disabled={busy}
            style={{
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: busy ? COLORS.outline : COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Check size={16} color="#fff" />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Simpan & Pilih
                </Paragraph>
              </>
            )}
          </Pressable>
        </ScrollView>

        <PickerModal
          visible={showUnitPicker}
          title="Pilih satuan"
          onClose={() => setShowUnitPicker(false)}
          items={p.units.map((u) => ({ key: u.id, label: u.label, sub: u.value }))}
          selectedKey={unitId}
          onSelect={(id) => {
            setUnitId(id)
            setShowUnitPicker(false)
          }}
        />
      </YStack>
    </Modal>
  )
}

// ─── Common building blocks ────────────────────────────────────────

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <XStack ai="center" gap={4}>
      <Paragraph
        fontFamily={FONTS.bodySemi}
        fontSize={12}
        color={COLORS.onSurface}
        textTransform="uppercase"
        letterSpacing={0.4}
      >
        {label}
      </Paragraph>
      {required && (
        <Paragraph fontFamily={FONTS.bodyBold} fontSize={12} color={COLORS.danger}>
          *
        </Paragraph>
      )}
    </XStack>
  )
}

function CurrencyInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const display = value === '' ? '' : formatRupiah(parseRupiah(value)).replace('Rp ', '')
  return (
    <XStack
      ai="center"
      bg={COLORS.surfaceContainerLowest}
      br={12}
      px="$3"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      h={44}
      gap="$2"
    >
      <Paragraph
        fontFamily={FONTS.bodyMedium}
        fontSize={14}
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
          fontSize: 14,
          color: COLORS.onSurface,
          paddingVertical: 0,
        }}
      />
    </XStack>
  )
}

function SummaryRow({
  label,
  value,
  bold,
}: {
  label: string
  value: string
  bold?: boolean
}) {
  return (
    <XStack ai="center" jc="space-between">
      <Paragraph
        fontFamily={bold ? FONTS.bodyBold : FONTS.body}
        fontSize={13}
        color={bold ? COLORS.onSurface : COLORS.onSurfaceVariant}
      >
        {label}
      </Paragraph>
      <Paragraph
        fontFamily={bold ? FONTS.monoMedium : FONTS.mono}
        fontSize={bold ? 14 : 13}
        color={COLORS.onSurface}
      >
        {value}
      </Paragraph>
    </XStack>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Paragraph
      fontFamily={FONTS.bodyBold}
      fontSize={11}
      color={COLORS.onSurfaceVariant}
      letterSpacing={0.55}
    >
      {children}
    </Paragraph>
  )
}

// ─── Style consts ──────────────────────────────────────────────────

const inputStyle = {
  backgroundColor: COLORS.surfaceContainerLowest,
  borderRadius: 12,
  paddingHorizontal: 14,
  height: 44,
  borderWidth: 1,
  borderColor: COLORS.borderSubtle,
  fontFamily: FONTS.body,
  fontSize: 14,
  color: COLORS.onSurface,
}

const pickerStyle = {
  backgroundColor: COLORS.surfaceContainerLowest,
  borderRadius: 12,
  paddingHorizontal: 14,
  height: 44,
  borderWidth: 1,
  borderColor: COLORS.borderSubtle,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  justifyContent: 'space-between' as const,
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const body = JSON.parse(err.body) as { error?: string }
      if (body.error) return body.error
    } catch {
      // body wasn't JSON
    }
    return err.message
  }
  if (err instanceof Error) return err.message
  return 'Terjadi kesalahan tidak dikenal.'
}
