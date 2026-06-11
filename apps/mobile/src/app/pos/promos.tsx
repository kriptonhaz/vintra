/**
 * Promotions — list + editor (Komplit feature).
 *
 * Mobile editor covers the 3 common scopes:
 *   - code     (kupon yang dipakai cashier)
 *   - cart     (diskon otomatis dari total belanja)
 *   - multi_product (diskon untuk daftar produk tertentu)
 *
 * Skipped vs web (use web for these): category scope, banner image
 * upload, schedule editor with HH:MM granularity. The bones are here
 * — extend in v2 when usage warrants.
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
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Edit,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useDeactivatePromotion,
  usePromotions,
  useSellablePromoProducts,
  useUpsertPromotion,
  type PromoRow,
  type PromoScope,
} from '~/lib/pos'
import { ApiError } from '~/lib/api'
import { formatRupiah, parseRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const SUPPORTED_SCOPES: Array<{ key: PromoScope; label: string; desc: string }> = [
  { key: 'cart', label: 'Diskon Keranjang', desc: 'Otomatis saat total > minimum' },
  { key: 'code', label: 'Kode Kupon', desc: 'Cashier ketik kode di checkout' },
  { key: 'multi_product', label: 'Per Produk', desc: 'Berlaku hanya untuk produk yang dipilih' },
]

const SCOPE_LABELS: Record<PromoScope | string, string> = {
  code: 'Kupon',
  cart: 'Diskon Keranjang',
  product: 'Per Produk',
  multi_product: 'Per Produk',
  category: 'Per Kategori',
}

export default function PromosScreen() {
  const [includeInactive, setIncludeInactive] = useState(true)
  const [editing, setEditing] = useState<PromoRow | 'new' | null>(null)

  const query = usePromotions(includeInactive)
  const deactivate = useDeactivatePromotion()

  const promos = query.data?.promotions ?? []

  function confirmDeactivate(p: PromoRow) {
    Alert.alert(
      'Non-aktifkan promo?',
      `"${p.name}" tidak akan dipakai lagi oleh checkout. Bisa diaktifkan kembali dari editor.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Non-aktifkan',
          style: 'destructive',
          onPress: () =>
            deactivate.mutate(p.id, {
              onError: (err) =>
                Alert.alert(
                  'Gagal',
                  err instanceof Error ? err.message : 'Coba lagi.',
                ),
            }),
        },
      ],
    )
  }

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Promo" back />
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
        <ScreenHeader title="Promo" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke promo.'
              : msg.includes('Komplit') || msg.includes('promos')
                ? 'Promo tersedia mulai paket Komplit. Upgrade dulu yuk.'
                : 'Gagal memuat promo.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Promo"
        subtitle={`${promos.length} promo`}
        back
        right={
          <Pressable
            onPress={() => setEditing('new')}
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
              Baru
            </Paragraph>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => query.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        <Pressable onPress={() => setIncludeInactive((v) => !v)}>
          <XStack ai="center" gap="$2">
            <YStack
              w={20}
              h={20}
              br={6}
              bg={includeInactive ? COLORS.primary : COLORS.surface}
              borderWidth={1}
              borderColor={includeInactive ? COLORS.primary : COLORS.outline}
              ai="center"
              jc="center"
            >
              {includeInactive && <Check size={12} color="#fff" />}
            </YStack>
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={12}
              color={COLORS.onSurface}
            >
              Tampilkan yang non-aktif
            </Paragraph>
          </XStack>
        </Pressable>

        {promos.length === 0 ? (
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
              <Tag size={26} color={COLORS.primary} />
            </YStack>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={16}
              color={COLORS.onSurface}
            >
              Belum ada promo
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
            >
              Buat diskon otomatis atau kode kupon untuk mendorong
              transaksi pelanggan.
            </Paragraph>
            <Pressable
              onPress={() => setEditing('new')}
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
                Buat promo baru
              </Paragraph>
            </Pressable>
          </YStack>
        ) : (
          promos.map((p) => (
            <PromoCard
              key={p.id}
              promo={p}
              onEdit={() => setEditing(p)}
              onDeactivate={() => confirmDeactivate(p)}
            />
          ))
        )}
      </ScrollView>

      <PromoEditorModal editing={editing} onClose={() => setEditing(null)} />
    </YStack>
  )
}

// ─── Card ───────────────────────────────────────────────────────────

function PromoCard({
  promo,
  onEdit,
  onDeactivate,
}: {
  promo: PromoRow
  onEdit: () => void
  onDeactivate: () => void
}) {
  const dv = Number(promo.discountValue) || 0
  const summary =
    promo.discountType === 'percent'
      ? `${dv}% off`
      : `${formatRupiah(dv)} off`
  const subtitleParts: string[] = []
  if (promo.code) subtitleParts.push(`Kode: ${promo.code}`)
  if (promo.minCartTotal && Number(promo.minCartTotal) > 0) {
    subtitleParts.push(`Min ${formatRupiah(Number(promo.minCartTotal))}`)
  }
  if (promo.itemTargets.length > 0) {
    subtitleParts.push(`${promo.itemTargets.length} produk`)
  }
  if (promo.categoryTargets.length > 0) {
    subtitleParts.push(`${promo.categoryTargets.length} kategori`)
  }

  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={promo.isActive ? COLORS.borderSubtle : COLORS.outlineVariant}
      opacity={promo.isActive ? 1 : 0.65}
      style={SHADOWS.card}
    >
      <XStack ai="center" jc="space-between" gap="$2">
        <YStack flex={1}>
          <XStack ai="center" gap="$2">
            <YStack
              px={8}
              py={2}
              br={6}
              bg={promo.isActive ? COLORS.primaryFixed : COLORS.surfaceContainerLow}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={10}
                color={promo.isActive ? COLORS.primary : COLORS.onSurfaceVariant}
              >
                {SCOPE_LABELS[promo.triggerType] ?? promo.triggerType}
              </Paragraph>
            </YStack>
            {!promo.isActive && (
              <YStack px={8} py={2} br={6} bg={COLORS.surfaceContainerLow}>
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={10}
                  color={COLORS.onSurfaceVariant}
                >
                  NON-AKTIF
                </Paragraph>
              </YStack>
            )}
          </XStack>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={14}
            color={COLORS.onSurface}
            mt={4}
          >
            {promo.name}
          </Paragraph>
          {subtitleParts.length > 0 && (
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              {subtitleParts.join(' · ')}
            </Stat>
          )}
        </YStack>
        <YStack ai="flex-end">
          <Paragraph
            fontFamily={FONTS.headingBold}
            fontSize={18}
            color={COLORS.primary}
          >
            {summary}
          </Paragraph>
        </YStack>
      </XStack>

      <XStack ai="center" gap="$2" mt="$1">
        <Pressable
          onPress={onEdit}
          style={{
            flex: 1,
            paddingVertical: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: COLORS.borderSubtle,
            backgroundColor: COLORS.surface,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Edit size={13} color={COLORS.onSurface} />
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={12}
            color={COLORS.onSurface}
          >
            Edit
          </Paragraph>
        </Pressable>
        {promo.isActive && (
          <Pressable
            onPress={onDeactivate}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: COLORS.dangerTint,
              backgroundColor: COLORS.dangerTint,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Trash2 size={13} color={COLORS.danger} />
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={12}
              color={COLORS.danger}
            >
              Non-aktif
            </Paragraph>
          </Pressable>
        )}
      </XStack>
    </YStack>
  )
}

// ─── Editor modal ───────────────────────────────────────────────────

interface EditorState {
  name: string
  scope: PromoScope
  code: string
  discountType: 'percent' | 'fixed'
  discountValue: string
  minCartTotal: string
  maxDiscountAmount: string
  itemIds: Set<string>
  isActive: boolean
}

const EMPTY_STATE: EditorState = {
  name: '',
  scope: 'cart',
  code: '',
  discountType: 'percent',
  discountValue: '',
  minCartTotal: '',
  maxDiscountAmount: '',
  itemIds: new Set(),
  isActive: true,
}

function PromoEditorModal({
  editing,
  onClose,
}: {
  editing: PromoRow | 'new' | null
  onClose: () => void
}) {
  const visible = editing !== null
  const isNew = editing === 'new'
  const initial = isNew ? null : editing

  const [s, setS] = useState<EditorState>(EMPTY_STATE)
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const upsert = useUpsertPromotion()

  // Hydrate when opening
  useEffect(() => {
    if (!visible) return
    if (initial) {
      const mappedScope: PromoScope =
        initial.triggerType === 'product'
          ? 'multi_product'
          : (initial.triggerType as PromoScope)
      setS({
        name: initial.name,
        scope: mappedScope,
        code: initial.code ?? '',
        discountType: (initial.discountType as 'percent' | 'fixed') ?? 'percent',
        discountValue: initial.discountValue,
        minCartTotal: initial.minCartTotal ?? '',
        maxDiscountAmount: initial.maxDiscountAmount ?? '',
        itemIds: new Set(initial.itemTargets.map((t) => t.id)),
        isActive: initial.isActive,
      })
    } else {
      setS(EMPTY_STATE)
    }
  }, [visible, initial])

  const supportedScope = SUPPORTED_SCOPES.find((sc) => sc.key === s.scope)
  const requiresProducts = s.scope === 'multi_product'

  async function handleSave() {
    if (!s.name.trim()) {
      Alert.alert('Wajib diisi', 'Nama promo tidak boleh kosong.')
      return
    }
    if (!s.discountValue || Number(s.discountValue) <= 0) {
      Alert.alert('Wajib diisi', 'Nilai diskon harus > 0.')
      return
    }
    if (s.scope === 'code' && (s.code ?? '').trim().length < 2) {
      Alert.alert('Wajib diisi', 'Kode kupon minimal 2 karakter.')
      return
    }
    if (s.scope === 'multi_product' && s.itemIds.size === 0) {
      Alert.alert('Wajib diisi', 'Pilih minimal satu produk.')
      return
    }
    try {
      await upsert.mutateAsync({
        id: initial?.id,
        name: s.name.trim(),
        scope: s.scope,
        code: s.scope === 'code' ? s.code.trim().toUpperCase() : null,
        itemIds: s.scope === 'multi_product' ? [...s.itemIds] : undefined,
        discountType: s.discountType,
        discountValue: Number(s.discountValue),
        maxDiscountAmount:
          s.discountType === 'percent' && s.maxDiscountAmount
            ? Number(parseRupiah(s.maxDiscountAmount))
            : null,
        minCartTotal: s.minCartTotal
          ? Number(parseRupiah(s.minCartTotal))
          : null,
        isActive: s.isActive,
      })
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
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
            {isNew ? 'Promo baru' : 'Edit promo'}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{
              padding: 16,
              gap: 14,
              paddingBottom: 100,
            }}
          >
            {/* Name */}
            <FieldGroup label="Nama promo *">
              <TextInput
                value={s.name}
                onChangeText={(v) => setS({ ...s, name: v })}
                placeholder="Mis. Diskon Akhir Bulan"
                placeholderTextColor={COLORS.outline}
                maxLength={100}
                style={inputStyle}
              />
            </FieldGroup>

            {/* Scope */}
            <FieldGroup label="Tipe promo">
              <YStack gap="$2">
                {SUPPORTED_SCOPES.map((sc) => {
                  const on = sc.key === s.scope
                  return (
                    <Pressable
                      key={sc.key}
                      onPress={() => setS({ ...s, scope: sc.key })}
                    >
                      <XStack
                        ai="flex-start"
                        jc="space-between"
                        gap="$2"
                        bg={on ? COLORS.primaryFixed : COLORS.surfaceContainerLowest}
                        br={10}
                        p="$3"
                        borderWidth={1}
                        borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                      >
                        <YStack flex={1}>
                          <Paragraph
                            fontFamily={FONTS.bodySemi}
                            fontSize={13}
                            color={COLORS.onSurface}
                          >
                            {sc.label}
                          </Paragraph>
                          <Paragraph
                            fontFamily={FONTS.body}
                            fontSize={11}
                            color={COLORS.onSurfaceVariant}
                          >
                            {sc.desc}
                          </Paragraph>
                        </YStack>
                        {on && <Check size={16} color={COLORS.primary} />}
                      </XStack>
                    </Pressable>
                  )
                })}
              </YStack>
            </FieldGroup>

            {s.scope === 'code' && (
              <FieldGroup label="Kode kupon *">
                <TextInput
                  value={s.code}
                  onChangeText={(v) =>
                    setS({ ...s, code: v.toUpperCase().slice(0, 50) })
                  }
                  placeholder="MIS. AKHIRBULAN"
                  placeholderTextColor={COLORS.outline}
                  autoCapitalize="characters"
                  style={inputStyle}
                />
              </FieldGroup>
            )}

            {/* Discount */}
            <FieldGroup label="Diskon *">
              <XStack gap="$2">
                <Pressable
                  onPress={() => setS({ ...s, discountType: 'percent' })}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor:
                      s.discountType === 'percent'
                        ? COLORS.primary
                        : COLORS.borderSubtle,
                    backgroundColor:
                      s.discountType === 'percent'
                        ? COLORS.primaryFixed
                        : COLORS.surfaceContainerLowest,
                    alignItems: 'center',
                  }}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={13}
                    color={COLORS.onSurface}
                  >
                    Persen
                  </Paragraph>
                </Pressable>
                <Pressable
                  onPress={() => setS({ ...s, discountType: 'fixed' })}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor:
                      s.discountType === 'fixed'
                        ? COLORS.primary
                        : COLORS.borderSubtle,
                    backgroundColor:
                      s.discountType === 'fixed'
                        ? COLORS.primaryFixed
                        : COLORS.surfaceContainerLowest,
                    alignItems: 'center',
                  }}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={13}
                    color={COLORS.onSurface}
                  >
                    Rupiah
                  </Paragraph>
                </Pressable>
              </XStack>
              {s.discountType === 'percent' ? (
                <XStack
                  ai="center"
                  bg={COLORS.surfaceContainerLowest}
                  br={10}
                  px="$3"
                  h={44}
                  borderWidth={1}
                  borderColor={COLORS.borderSubtle}
                  gap="$2"
                  mt="$2"
                >
                  <TextInput
                    value={s.discountValue}
                    onChangeText={(v) => setS({ ...s, discountValue: v })}
                    keyboardType="decimal-pad"
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
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={14}
                    color={COLORS.onSurfaceVariant}
                  >
                    %
                  </Paragraph>
                </XStack>
              ) : (
                <CurrencyField
                  value={s.discountValue}
                  onChange={(v) => setS({ ...s, discountValue: v })}
                />
              )}
            </FieldGroup>

            {s.discountType === 'percent' && (
              <FieldGroup label="Max diskon (opsional)">
                <CurrencyField
                  value={s.maxDiscountAmount}
                  onChange={(v) => setS({ ...s, maxDiscountAmount: v })}
                />
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.onSurfaceVariant}
                >
                  Batas potongan total walau persentase besar.
                </Paragraph>
              </FieldGroup>
            )}

            {s.scope !== 'multi_product' && (
              <FieldGroup label="Minimum belanja (opsional)">
                <CurrencyField
                  value={s.minCartTotal}
                  onChange={(v) => setS({ ...s, minCartTotal: v })}
                />
              </FieldGroup>
            )}

            {requiresProducts && (
              <FieldGroup label={`Produk *  (${s.itemIds.size} dipilih)`}>
                <Pressable
                  onPress={() => setProductPickerOpen(true)}
                  style={pickerStyle}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={13}
                    color={COLORS.onSurface}
                  >
                    Atur produk
                  </Paragraph>
                  <ChevronRight size={16} color={COLORS.outline} />
                </Pressable>
              </FieldGroup>
            )}

            {/* Active toggle */}
            <Pressable onPress={() => setS({ ...s, isActive: !s.isActive })}>
              <XStack
                ai="center"
                jc="space-between"
                bg={COLORS.surfaceContainerLowest}
                br={10}
                px="$3"
                py="$3"
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  Aktifkan promo
                </Paragraph>
                <YStack
                  w={48}
                  h={28}
                  br={999}
                  bg={s.isActive ? COLORS.primary : COLORS.outline}
                  ai={s.isActive ? 'flex-end' : 'flex-start'}
                  jc="center"
                  px={2}
                >
                  <YStack w={24} h={24} br={999} bg="#fff" />
                </YStack>
              </XStack>
            </Pressable>

            {supportedScope && (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
              >
                {supportedScope.desc}
              </Paragraph>
            )}

            <Pressable
              onPress={handleSave}
              disabled={upsert.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: upsert.isPending
                  ? COLORS.outline
                  : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {upsert.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Simpan promo
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        <ProductPickerModal
          visible={productPickerOpen}
          selected={s.itemIds}
          onClose={() => setProductPickerOpen(false)}
          onApply={(ids) => {
            setS((prev) => ({ ...prev, itemIds: ids }))
            setProductPickerOpen(false)
          }}
        />
      </YStack>
    </Modal>
  )
}

function ProductPickerModal({
  visible,
  selected,
  onClose,
  onApply,
}: {
  visible: boolean
  selected: Set<string>
  onClose: () => void
  onApply: (ids: Set<string>) => void
}) {
  const [q, setQ] = useState('')
  const [local, setLocal] = useState<Set<string>>(new Set())
  const products = useSellablePromoProducts()

  useEffect(() => {
    if (visible) setLocal(new Set(selected))
  }, [visible, selected])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const all = products.data ?? []
    if (!needle) return all
    return all.filter((p) => p.name.toLowerCase().includes(needle))
  }, [products.data, q])

  function toggle(id: string) {
    setLocal((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
            Pilih produk
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

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
        </YStack>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          {products.isLoading ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : filtered.length === 0 ? (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              py="$6"
            >
              Tidak ada produk ditemukan.
            </Paragraph>
          ) : (
            filtered.map((p) => {
              const on = local.has(p.id)
              return (
                <Pressable key={p.id} onPress={() => toggle(p.id)}>
                  <XStack
                    ai="center"
                    jc="space-between"
                    p="$3"
                    br={12}
                    bg={
                      on
                        ? COLORS.primaryFixed
                        : COLORS.surfaceContainerLowest
                    }
                    borderWidth={1}
                    borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                  >
                    <YStack flex={1}>
                      <Paragraph
                        fontFamily={FONTS.bodyMedium}
                        fontSize={13}
                        color={COLORS.onSurface}
                      >
                        {p.name}
                      </Paragraph>
                      <Money
                        amount={Number(p.sellingPrice) || 0}
                        fontSize={11}
                        color={COLORS.onSurfaceVariant}
                      />
                    </YStack>
                    {on && <Check size={16} color={COLORS.primary} />}
                  </XStack>
                </Pressable>
              )
            })
          )}
        </ScrollView>

        <YStack
          bg={COLORS.surfaceContainerLowest}
          px="$4"
          pt="$3"
          pb="$5"
          borderTopWidth={1}
          borderTopColor={COLORS.borderSubtle}
        >
          <Pressable
            onPress={() => onApply(local)}
            style={{
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: COLORS.primary,
              alignItems: 'center',
            }}
          >
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
              Pilih ({local.size})
            </Paragraph>
          </Pressable>
        </YStack>
      </YStack>
    </Modal>
  )
}

// ─── Common building blocks ────────────────────────────────────────

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

function CurrencyField({
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
      bg={COLORS.surfaceContainerLowest}
      br={10}
      px="$3"
      h={44}
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
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

const inputStyle = {
  backgroundColor: COLORS.surfaceContainerLowest,
  borderRadius: 10,
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
  borderRadius: 10,
  paddingHorizontal: 14,
  height: 44,
  borderWidth: 1,
  borderColor: COLORS.borderSubtle,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  justifyContent: 'space-between' as const,
}
