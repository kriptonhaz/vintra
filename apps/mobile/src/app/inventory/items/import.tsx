/**
 * Bulk-import inventory items from HPP catalog. Tabs: Bahan (materials)
 * vs Produk (products).
 *
 * Materials inherit their unit from HPP. Products need a base unit
 * picked by the user. Both let the user opt-in to "isSellable" /
 * "isBookable" flags. Already-imported rows are listed but disabled.
 *
 * Submit fires per-source bulk import calls (materials + products
 * separately) — the server requires one source per call.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
} from 'react-native'
import { useRouter } from 'expo-router'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronRight,
  Package,
  X,
} from '~/lib/icons'
import {
  useBulkImportFromHpp,
  useHppImportCandidates,
  type HppImportUnit,
  type HppMaterialCandidate,
  type HppProductCandidate,
} from '~/lib/inventory'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

type Tab = 'material' | 'product'

interface MaterialFlags {
  selected: boolean
  isSellable: boolean
  isBookable: boolean
}
interface ProductFlags {
  selected: boolean
  isSellable: boolean
  isBookable: boolean
  baseUnitId: string | null
}

export default function ImportScreen() {
  const router = useRouter()
  const query = useHppImportCandidates()
  const importer = useBulkImportFromHpp()

  const [tab, setTab] = useState<Tab>('material')
  const [matFlags, setMatFlags] = useState<Record<string, MaterialFlags>>({})
  const [prodFlags, setProdFlags] = useState<Record<string, ProductFlags>>({})
  const [unitPickerProductId, setUnitPickerProductId] = useState<string | null>(
    null,
  )

  const data = query.data
  const materials = useMemo(
    () => (data?.materials ?? []).filter((m) => !m.alreadyImported),
    [data?.materials],
  )
  const products = useMemo(
    () => (data?.products ?? []).filter((p) => !p.alreadyImported),
    [data?.products],
  )

  const selectedMatIds = useMemo(
    () => Object.entries(matFlags).filter(([, v]) => v.selected).map(([k]) => k),
    [matFlags],
  )
  const selectedProdIds = useMemo(
    () =>
      Object.entries(prodFlags)
        .filter(([, v]) => v.selected)
        .map(([k]) => k),
    [prodFlags],
  )
  const totalSelected = selectedMatIds.length + selectedProdIds.length

  function toggleMat(m: HppMaterialCandidate) {
    setMatFlags((prev) => {
      const cur = prev[m.id] ?? {
        selected: false,
        isSellable: false,
        isBookable: false,
      }
      return {
        ...prev,
        [m.id]: { ...cur, selected: !cur.selected },
      }
    })
  }
  function setMatFlag(
    id: string,
    key: 'isSellable' | 'isBookable',
    val: boolean,
  ) {
    setMatFlags((prev) => ({
      ...prev,
      [id]: {
        selected: prev[id]?.selected ?? false,
        isSellable: prev[id]?.isSellable ?? false,
        isBookable: prev[id]?.isBookable ?? false,
        [key]: val,
      } as MaterialFlags,
    }))
  }
  function toggleProd(p: HppProductCandidate) {
    setProdFlags((prev) => {
      const cur = prev[p.id] ?? {
        selected: false,
        isSellable: true, // products default to sellable
        isBookable: false,
        baseUnitId: null,
      }
      return {
        ...prev,
        [p.id]: { ...cur, selected: !cur.selected },
      }
    })
  }
  function setProdFlag(
    id: string,
    key: 'isSellable' | 'isBookable',
    val: boolean,
  ) {
    setProdFlags((prev) => ({
      ...prev,
      [id]: {
        selected: prev[id]?.selected ?? false,
        isSellable: prev[id]?.isSellable ?? true,
        isBookable: prev[id]?.isBookable ?? false,
        baseUnitId: prev[id]?.baseUnitId ?? null,
        [key]: val,
      } as ProductFlags,
    }))
  }
  function setProdUnit(id: string, unitId: string) {
    setProdFlags((prev) => ({
      ...prev,
      [id]: {
        selected: prev[id]?.selected ?? true,
        isSellable: prev[id]?.isSellable ?? true,
        isBookable: prev[id]?.isBookable ?? false,
        baseUnitId: unitId,
      } as ProductFlags,
    }))
  }

  async function handleImport() {
    if (!data) return
    if (totalSelected === 0) {
      Alert.alert('Pilih dulu', 'Centang item yang mau diimpor.')
      return
    }

    // Validate products have a unit picked
    for (const pid of selectedProdIds) {
      if (!prodFlags[pid]?.baseUnitId) {
        const prod = products.find((p) => p.id === pid)
        Alert.alert(
          'Pilih satuan dasar',
          `Set satuan dasar untuk "${prod?.name ?? 'produk'}" sebelum import.`,
        )
        return
      }
    }

    try {
      let created = 0
      if (selectedMatIds.length > 0) {
        const res = await importer.mutateAsync({
          source: 'material',
          items: selectedMatIds.map((id) => {
            const mat = materials.find((m) => m.id === id)!
            const flags = matFlags[id]!
            return {
              hppId: id,
              baseUnitId: mat.unitId,
              isSellable: flags.isSellable,
              isBookable: flags.isBookable,
            }
          }),
        })
        created += res.createdCount
      }
      if (selectedProdIds.length > 0) {
        const res = await importer.mutateAsync({
          source: 'product',
          items: selectedProdIds.map((id) => {
            const flags = prodFlags[id]!
            return {
              hppId: id,
              baseUnitId: flags.baseUnitId!,
              isSellable: flags.isSellable,
              isBookable: flags.isBookable,
            }
          }),
        })
        created += res.createdCount
      }
      Alert.alert(
        'Selesai',
        `${created} item berhasil diimpor ke inventory.`,
        [{ text: 'OK', onPress: () => router.back() }],
      )
    } catch (err) {
      Alert.alert(
        'Gagal import',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Import dari HPP" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (query.error || !data) {
    const isForbidden =
      query.error instanceof ApiError && query.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Import dari HPP" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke import.'
              : 'Gagal memuat kandidat import.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const capRemaining =
    data.skuCap !== null ? Math.max(0, data.skuCap - data.skuCount) : null

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Import dari HPP"
        subtitle={`${data.materials.length} bahan · ${data.products.length} produk`}
        back
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => query.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {capRemaining !== null && (
          <XStack
            ai="flex-start"
            gap="$2"
            bg={capRemaining === 0 ? COLORS.dangerTint : COLORS.warningTint}
            br={10}
            p="$3"
          >
            <AlertCircle
              size={14}
              color={capRemaining === 0 ? COLORS.danger : '#92400e'}
            />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={capRemaining === 0 ? COLORS.danger : '#92400e'}
              flex={1}
            >
              Paket kamu: {data.skuCount}/{data.skuCap} SKU terpakai —
              sisa {capRemaining} slot.
            </Paragraph>
          </XStack>
        )}

        {/* Tabs */}
        <XStack
          ai="center"
          gap="$1"
          bg={COLORS.surfaceContainerLow}
          br={999}
          p={4}
        >
          {(['material', 'product'] as const).map((t) => {
            const on = t === tab
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
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
                  fontSize={12}
                  color={on ? COLORS.onSurface : COLORS.onSurfaceVariant}
                >
                  {t === 'material'
                    ? `Bahan (${materials.length})`
                    : `Produk (${products.length})`}
                </Paragraph>
              </Pressable>
            )
          })}
        </XStack>

        {tab === 'material' &&
          (materials.length === 0 ? (
            <EmptyHint label="Semua bahan sudah ada di inventory." />
          ) : (
            materials.map((m) => (
              <MaterialCard
                key={m.id}
                m={m}
                flags={
                  matFlags[m.id] ?? {
                    selected: false,
                    isSellable: false,
                    isBookable: false,
                  }
                }
                onToggle={() => toggleMat(m)}
                onFlag={(k, v) => setMatFlag(m.id, k, v)}
              />
            ))
          ))}

        {tab === 'product' &&
          (products.length === 0 ? (
            <EmptyHint label="Semua produk sudah ada di inventory." />
          ) : (
            products.map((p) => (
              <ProductCard
                key={p.id}
                p={p}
                units={data.units}
                flags={
                  prodFlags[p.id] ?? {
                    selected: false,
                    isSellable: true,
                    isBookable: false,
                    baseUnitId: null,
                  }
                }
                onToggle={() => toggleProd(p)}
                onFlag={(k, v) => setProdFlag(p.id, k, v)}
                onPickUnit={() => setUnitPickerProductId(p.id)}
              />
            ))
          ))}
      </ScrollView>

      {/* Sticky bottom CTA */}
      <YStack
        bg={COLORS.surfaceContainerLowest}
        px="$4"
        pt="$3"
        pb="$5"
        borderTopWidth={1}
        borderTopColor={COLORS.borderSubtle}
      >
        <Pressable
          onPress={handleImport}
          disabled={importer.isPending || totalSelected === 0}
          style={{
            paddingVertical: 14,
            borderRadius: 12,
            backgroundColor:
              importer.isPending || totalSelected === 0
                ? COLORS.outline
                : COLORS.primary,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {importer.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
              Import {totalSelected > 0 ? `${totalSelected} item` : ''}
            </Paragraph>
          )}
        </Pressable>
      </YStack>

      {unitPickerProductId && (
        <UnitPickerModal
          units={data.units}
          selectedId={prodFlags[unitPickerProductId]?.baseUnitId ?? null}
          onClose={() => setUnitPickerProductId(null)}
          onPick={(id) => {
            setProdUnit(unitPickerProductId, id)
            setUnitPickerProductId(null)
          }}
        />
      )}
    </YStack>
  )
}

function MaterialCard({
  m,
  flags,
  onToggle,
  onFlag,
}: {
  m: HppMaterialCandidate
  flags: MaterialFlags
  onToggle: () => void
  onFlag: (k: 'isSellable' | 'isBookable', v: boolean) => void
}) {
  return (
    <Pressable onPress={onToggle}>
      <YStack
        bg={
          flags.selected
            ? COLORS.primaryFixed
            : COLORS.surfaceContainerLowest
        }
        br={12}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={flags.selected ? COLORS.primary : COLORS.borderSubtle}
        style={SHADOWS.card}
      >
        <XStack ai="center" gap="$3">
          <Checkbox on={flags.selected} />
          <YStack flex={1}>
            <Paragraph
              fontFamily={FONTS.bodySemi}
              fontSize={14}
              color={COLORS.onSurface}
            >
              {m.name}
              {m.brand ? ` · ${m.brand}` : ''}
            </Paragraph>
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              {m.unitLabel} ·{' '}
              <Paragraph
                fontFamily={FONTS.monoMedium}
                fontSize={11}
                color={COLORS.onSurface}
              >
                Rp {Number(m.pricePerUnit).toLocaleString('id-ID')}/{m.unitLabel}
              </Paragraph>
            </Stat>
          </YStack>
        </XStack>
        {flags.selected && (
          <YStack gap="$2" mt="$1">
            <ToggleRow
              label="Bisa dijual di kasir"
              value={flags.isSellable}
              onChange={(v) => onFlag('isSellable', v)}
            />
            <ToggleRow
              label="Bisa dipesan via booking"
              value={flags.isBookable}
              onChange={(v) => onFlag('isBookable', v)}
            />
          </YStack>
        )}
      </YStack>
    </Pressable>
  )
}

function ProductCard({
  p,
  units,
  flags,
  onToggle,
  onFlag,
  onPickUnit,
}: {
  p: HppProductCandidate
  units: HppImportUnit[]
  flags: ProductFlags
  onToggle: () => void
  onFlag: (k: 'isSellable' | 'isBookable', v: boolean) => void
  onPickUnit: () => void
}) {
  const unitLabel = units.find((u) => u.id === flags.baseUnitId)?.label
  return (
    <Pressable onPress={onToggle}>
      <YStack
        bg={
          flags.selected
            ? COLORS.primaryFixed
            : COLORS.surfaceContainerLowest
        }
        br={12}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={flags.selected ? COLORS.primary : COLORS.borderSubtle}
        style={SHADOWS.card}
      >
        <XStack ai="center" gap="$3">
          <Checkbox on={flags.selected} />
          <YStack flex={1}>
            <Paragraph
              fontFamily={FONTS.bodySemi}
              fontSize={14}
              color={COLORS.onSurface}
            >
              {p.name}
            </Paragraph>
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              {p.category ?? 'Tanpa kategori'} ·{' '}
              <Money
                amount={Number(p.sellingPrice) || 0}
                fontSize={11}
                color={COLORS.onSurface}
              />
              {p.hpp ? ` · HPP ${Number(p.hpp).toLocaleString('id-ID')}` : ''}
            </Stat>
          </YStack>
        </XStack>
        {flags.selected && (
          <YStack gap="$2" mt="$1">
            <Pressable onPress={onPickUnit}>
              <XStack
                ai="center"
                jc="space-between"
                bg={COLORS.surface}
                br={10}
                px="$3"
                h={40}
                borderWidth={1}
                borderColor={flags.baseUnitId ? COLORS.borderSubtle : COLORS.danger}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={13}
                  color={
                    flags.baseUnitId ? COLORS.onSurface : COLORS.danger
                  }
                >
                  {unitLabel ?? 'Pilih satuan dasar *'}
                </Paragraph>
                <ChevronRight size={14} color={COLORS.outline} />
              </XStack>
            </Pressable>
            <ToggleRow
              label="Bisa dijual di kasir"
              value={flags.isSellable}
              onChange={(v) => onFlag('isSellable', v)}
            />
            <ToggleRow
              label="Bisa dipesan via booking"
              value={flags.isBookable}
              onChange={(v) => onFlag('isBookable', v)}
            />
          </YStack>
        )}
      </YStack>
    </Pressable>
  )
}

function Checkbox({ on }: { on: boolean }) {
  return (
    <YStack
      w={22}
      h={22}
      br={7}
      bg={on ? COLORS.primary : COLORS.surface}
      borderWidth={1}
      borderColor={on ? COLORS.primary : COLORS.outline}
      ai="center"
      jc="center"
    >
      {on && <Check size={14} color="#fff" />}
    </YStack>
  )
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <XStack ai="center" jc="space-between">
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={12}
        color={COLORS.onSurfaceVariant}
      >
        {label}
      </Paragraph>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: COLORS.outline, true: COLORS.primary }}
        thumbColor="#fff"
      />
    </XStack>
  )
}

function EmptyHint({ label }: { label: string }) {
  return (
    <YStack
      ai="center"
      py="$8"
      bg={COLORS.surfaceContainerLowest}
      br={14}
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      gap="$2"
    >
      <Package size={28} color={COLORS.outline} />
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        color={COLORS.onSurfaceVariant}
      >
        {label}
      </Paragraph>
    </YStack>
  )
}

function UnitPickerModal({
  units,
  selectedId,
  onClose,
  onPick,
}: {
  units: HppImportUnit[]
  selectedId: string | null
  onClose: () => void
  onPick: (id: string) => void
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
            Pilih satuan dasar
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          {units.map((u) => {
            const on = u.id === selectedId
            return (
              <Pressable key={u.id} onPress={() => onPick(u.id)}>
                <XStack
                  ai="center"
                  jc="space-between"
                  p="$3"
                  br={10}
                  bg={on ? COLORS.primaryFixed : COLORS.surfaceContainerLowest}
                  borderWidth={1}
                  borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                >
                  <YStack>
                    <Paragraph
                      fontFamily={FONTS.bodyMedium}
                      fontSize={14}
                      color={COLORS.onSurface}
                    >
                      {u.label}
                    </Paragraph>
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                      {u.value}
                    </Stat>
                  </YStack>
                  {on && <Check size={16} color={COLORS.primary} />}
                </XStack>
              </Pressable>
            )
          })}
        </ScrollView>
      </YStack>
    </Modal>
  )
}
