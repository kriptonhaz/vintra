/**
 * Loyalty stamps — programs list + simple editor (Komplit feature).
 *
 * Earn/redeem RATE config lives in Pengaturan Kasir; this screen is
 * just stamp programs (kartu cap "beli 10 dapat 1 gratis"). For v1 we
 * support `product` + `category` scopes with `single` reward only —
 * `product_set` + bundle reward stay on web.
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
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronRight,
  Edit,
  Plus,
  Settings,
  Stamp,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useCreateStampProgram,
  useDeleteStampProgram,
  useStampFormMasters,
  useStampPrograms,
  useUpdateStampProgram,
  type StampProgramRow,
  type StampScope,
} from '~/lib/pos'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const SUPPORTED_SCOPES: Array<{ key: StampScope; label: string; desc: string }> = [
  { key: 'product', label: 'Per Produk', desc: 'Cap untuk satu produk tertentu' },
  { key: 'category', label: 'Per Kategori', desc: 'Cap untuk semua produk di kategori' },
]

const SCOPE_LABEL: Record<string, string> = {
  product: 'Produk',
  category: 'Kategori',
  product_set: 'Multi-Produk',
}

export default function LoyaltyScreen() {
  const router = useRouter()
  const [editing, setEditing] = useState<StampProgramRow | 'new' | null>(null)

  const programs = useStampPrograms()
  const remove = useDeleteStampProgram()

  const rows = programs.data ?? []
  const activeCount = useMemo(() => rows.filter((r) => r.isActive).length, [rows])

  function confirmDelete(p: StampProgramRow) {
    Alert.alert(
      'Hapus program?',
      `"${p.name}" akan dihapus. Cap pelanggan yang sudah terkumpul ikut hilang.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () =>
            remove.mutate(p.id, {
              onError: (err) =>
                Alert.alert(
                  'Gagal hapus',
                  err instanceof Error ? err.message : 'Coba lagi.',
                ),
            }),
        },
      ],
    )
  }

  if (programs.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Loyalti" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (programs.error) {
    const err = programs.error
    const isForbidden = err instanceof ApiError && err.status === 403
    const msg = err instanceof Error ? err.message : ''
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Loyalti" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke loyalti.'
              : msg.includes('Komplit') || msg.includes('loyalty')
                ? 'Loyalti tersedia mulai paket Komplit. Upgrade dulu yuk.'
                : 'Gagal memuat program loyalti.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Loyalti"
        subtitle={`${activeCount} program aktif`}
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
            refreshing={programs.isFetching}
            onRefresh={() => programs.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Pointer to settings for earn/redeem rates */}
        <Pressable onPress={() => router.push('/pos/settings' as never)}>
          <XStack
            ai="center"
            gap="$3"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            p="$3"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <YStack
              w={40}
              h={40}
              br={12}
              bg={COLORS.primaryFixed}
              ai="center"
              jc="center"
            >
              <Settings size={18} color={COLORS.primary} />
            </YStack>
            <YStack flex={1}>
              <Paragraph
                fontFamily={FONTS.bodySemi}
                fontSize={14}
                color={COLORS.onSurface}
              >
                Atur poin & redeem rate
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
              >
                Konfigurasi loyalti poin (earn / redeem) ada di Pengaturan Kasir.
              </Paragraph>
            </YStack>
            <ChevronRight size={18} color={COLORS.outline} />
          </XStack>
        </Pressable>

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
              <Stamp size={26} color={COLORS.primary} />
            </YStack>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={16}
              color={COLORS.onSurface}
            >
              Belum ada program kartu cap
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
            >
              Buat program loyalti "beli 10 dapat 1 gratis" untuk dorong
              pelanggan repeat order.
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
                Buat program baru
              </Paragraph>
            </Pressable>
          </YStack>
        ) : (
          rows.map((p) => (
            <ProgramCard
              key={p.id}
              program={p}
              onEdit={() => setEditing(p)}
              onDelete={() => confirmDelete(p)}
            />
          ))
        )}
      </ScrollView>

      <StampEditorModal editing={editing} onClose={() => setEditing(null)} />
    </YStack>
  )
}

function ProgramCard({
  program,
  onEdit,
  onDelete,
}: {
  program: StampProgramRow
  onEdit: () => void
  onDelete: () => void
}) {
  const target =
    program.scope === 'category'
      ? program.categoryName
      : program.scope === 'product'
        ? program.productName
        : `${program.scopeItems?.length ?? 0} produk`
  const reward =
    program.rewardMode === 'single'
      ? program.rewardItemName
      : `${program.rewardBundleItems?.length ?? 0} hadiah`

  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={program.isActive ? COLORS.borderSubtle : COLORS.outlineVariant}
      opacity={program.isActive ? 1 : 0.65}
      style={SHADOWS.card}
    >
      <XStack ai="center" jc="space-between" gap="$2">
        <YStack flex={1}>
          <XStack ai="center" gap="$2">
            <YStack
              px={8}
              py={2}
              br={6}
              bg={program.isActive ? COLORS.primaryFixed : COLORS.surfaceContainerLow}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={10}
                color={program.isActive ? COLORS.primary : COLORS.onSurfaceVariant}
              >
                {SCOPE_LABEL[program.scope] ?? program.scope}
              </Paragraph>
            </YStack>
            {!program.isActive && (
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
            {program.name}
          </Paragraph>
          <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
            {target ?? '-'} · {program.stampsRequired} cap →{' '}
            {reward ?? '(hadiah tidak terdaftar)'}
          </Stat>
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
        <Pressable
          onPress={onDelete}
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
            Hapus
          </Paragraph>
        </Pressable>
      </XStack>
    </YStack>
  )
}

// ─── Editor ─────────────────────────────────────────────────────────

interface EditorState {
  name: string
  scope: StampScope
  productId: string | null
  categoryId: string | null
  stampsRequired: string
  rewardItemId: string | null
  isActive: boolean
}

const EMPTY: EditorState = {
  name: '',
  scope: 'product',
  productId: null,
  categoryId: null,
  stampsRequired: '10',
  rewardItemId: null,
  isActive: true,
}

function StampEditorModal({
  editing,
  onClose,
}: {
  editing: StampProgramRow | 'new' | null
  onClose: () => void
}) {
  const visible = editing !== null
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const [s, setS] = useState<EditorState>(EMPTY)
  const [picker, setPicker] = useState<
    null | { kind: 'product' | 'category' | 'reward' }
  >(null)
  const masters = useStampFormMasters(visible)
  const create = useCreateStampProgram()
  const update = useUpdateStampProgram()

  // Hydrate
  useEffect(() => {
    if (!visible) return
    if (initial && initial.scope !== 'product_set') {
      setS({
        name: initial.name,
        scope: initial.scope as StampScope,
        productId: initial.productId,
        categoryId: initial.categoryId,
        stampsRequired: String(initial.stampsRequired),
        rewardItemId: initial.rewardItemId,
        isActive: initial.isActive,
      })
    } else {
      setS(EMPTY)
    }
  }, [visible, initial])

  const productName = useMemo(() => {
    if (!s.productId) return null
    return masters.data?.items.find((i) => i.id === s.productId)?.name ?? null
  }, [masters.data, s.productId])
  const categoryName = useMemo(() => {
    if (!s.categoryId) return null
    return (
      masters.data?.categories.find((c) => c.id === s.categoryId)?.name ?? null
    )
  }, [masters.data, s.categoryId])
  const rewardName = useMemo(() => {
    if (!s.rewardItemId) return null
    return (
      masters.data?.items.find((i) => i.id === s.rewardItemId)?.name ?? null
    )
  }, [masters.data, s.rewardItemId])

  async function handleSave() {
    if (!s.name.trim()) {
      Alert.alert('Wajib diisi', 'Nama program tidak boleh kosong.')
      return
    }
    if (s.scope === 'product' && !s.productId) {
      Alert.alert('Pilih produk', 'Produk yang dicap wajib dipilih.')
      return
    }
    if (s.scope === 'category' && !s.categoryId) {
      Alert.alert('Pilih kategori', 'Kategori yang dicap wajib dipilih.')
      return
    }
    if (!s.rewardItemId) {
      Alert.alert('Pilih hadiah', 'Produk hadiah wajib dipilih.')
      return
    }
    const stampsRequired = parseInt(s.stampsRequired, 10) || 0
    if (stampsRequired < 1 || stampsRequired > 100) {
      Alert.alert('Stempel tidak valid', 'Jumlah stempel 1–100.')
      return
    }
    try {
      const payload = {
        name: s.name.trim(),
        scope: s.scope,
        productId: s.scope === 'product' ? s.productId : null,
        categoryId: s.scope === 'category' ? s.categoryId : null,
        stampsRequired,
        rewardMode: 'single' as const,
        rewardItemId: s.rewardItemId,
        isActive: s.isActive,
      }
      if (initial?.id) {
        await update.mutateAsync({ id: initial.id, ...payload })
      } else {
        await create.mutateAsync(payload)
      }
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
            {isNew ? 'Program baru' : 'Edit program'}
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
            <FieldGroup label="Nama program *">
              <TextInput
                value={s.name}
                onChangeText={(v) => setS({ ...s, name: v })}
                placeholder="Mis. Kartu Cap Kopi"
                placeholderTextColor={COLORS.outline}
                maxLength={80}
                style={inputStyle}
              />
            </FieldGroup>

            <FieldGroup label="Cap untuk *">
              <YStack gap="$2">
                {SUPPORTED_SCOPES.map((sc) => {
                  const on = sc.key === s.scope
                  return (
                    <Pressable
                      key={sc.key}
                      onPress={() =>
                        setS({
                          ...s,
                          scope: sc.key,
                          productId: sc.key === 'product' ? s.productId : null,
                          categoryId:
                            sc.key === 'category' ? s.categoryId : null,
                        })
                      }
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

            {s.scope === 'product' && (
              <FieldGroup label="Produk yang dicap *">
                <Pressable
                  onPress={() => setPicker({ kind: 'product' })}
                  style={pickerStyle}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={13}
                    color={productName ? COLORS.onSurface : COLORS.outline}
                  >
                    {productName ?? 'Pilih produk'}
                  </Paragraph>
                  <ChevronRight size={16} color={COLORS.outline} />
                </Pressable>
              </FieldGroup>
            )}

            {s.scope === 'category' && (
              <FieldGroup label="Kategori yang dicap *">
                <Pressable
                  onPress={() => setPicker({ kind: 'category' })}
                  style={pickerStyle}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={13}
                    color={categoryName ? COLORS.onSurface : COLORS.outline}
                  >
                    {categoryName ?? 'Pilih kategori'}
                  </Paragraph>
                  <ChevronRight size={16} color={COLORS.outline} />
                </Pressable>
              </FieldGroup>
            )}

            <FieldGroup label="Jumlah cap untuk hadiah *">
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
                <TextInput
                  value={s.stampsRequired}
                  onChangeText={(v) =>
                    setS({ ...s, stampsRequired: v.replace(/\D/g, '') })
                  }
                  keyboardType="number-pad"
                  placeholder="10"
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
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.onSurfaceVariant}
                >
                  cap
                </Paragraph>
              </XStack>
            </FieldGroup>

            <FieldGroup label="Hadiah (produk gratis) *">
              <Pressable
                onPress={() => setPicker({ kind: 'reward' })}
                style={pickerStyle}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={13}
                  color={rewardName ? COLORS.onSurface : COLORS.outline}
                >
                  {rewardName ?? 'Pilih produk hadiah'}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </Pressable>
            </FieldGroup>

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
                  Aktifkan program
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
                fontSize={11}
                color="#92400e"
                flex={1}
              >
                Editor mobile mendukung hadiah tunggal. Untuk bundle
                hadiah multi-produk, edit dari versi web.
              </Paragraph>
            </XStack>

            <Pressable
              onPress={handleSave}
              disabled={create.isPending || update.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor:
                  create.isPending || update.isPending
                    ? COLORS.outline
                    : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {create.isPending || update.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Simpan program
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        {picker && (
          <SingleSelectModal
            title={
              picker.kind === 'category'
                ? 'Pilih kategori'
                : picker.kind === 'reward'
                  ? 'Pilih produk hadiah'
                  : 'Pilih produk'
            }
            items={
              picker.kind === 'category'
                ? (masters.data?.categories ?? []).map((c) => ({
                    key: c.id,
                    label: c.name,
                  }))
                : (masters.data?.items ?? []).map((i) => ({
                    key: i.id,
                    label: i.name,
                  }))
            }
            selectedKey={
              picker.kind === 'product'
                ? (s.productId ?? '')
                : picker.kind === 'category'
                  ? (s.categoryId ?? '')
                  : (s.rewardItemId ?? '')
            }
            onClose={() => setPicker(null)}
            onSelect={(key) => {
              if (picker.kind === 'product') {
                setS((p) => ({ ...p, productId: key }))
              } else if (picker.kind === 'category') {
                setS((p) => ({ ...p, categoryId: key }))
              } else {
                setS((p) => ({ ...p, rewardItemId: key }))
              }
              setPicker(null)
            }}
          />
        )}
      </YStack>
    </Modal>
  )
}

function SingleSelectModal({
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
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter((it) => it.label.toLowerCase().includes(needle))
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
            {title}
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
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Cari…"
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
              Tidak ada hasil.
            </Paragraph>
          ) : (
            filtered.map((it) => {
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
                    borderColor={
                      selected ? COLORS.primary : COLORS.borderSubtle
                    }
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
            })
          )}
        </ScrollView>
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
