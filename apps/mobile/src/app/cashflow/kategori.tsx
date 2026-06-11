/**
 * Cashflow categories — tabbed income/expense list, CRUD custom rows.
 * System categories (isSystem: true) show as read-only.
 */
import { useEffect, useMemo, useState } from 'react'
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
import {
  AlertTriangle,
  Edit,
  Plus,
  Tag,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useCashflowCategories,
  useCreateCashflowCategory,
  useDeleteCashflowCategory,
  useUpdateCashflowCategory,
  type CashflowCategory,
  type CashflowKind,
} from '~/lib/cashflow'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function CashflowKategoriScreen() {
  const query = useCashflowCategories()
  const remove = useDeleteCashflowCategory()
  const [tab, setTab] = useState<CashflowKind>('expense')
  const [editing, setEditing] = useState<CashflowCategory | 'new' | null>(null)

  const filtered = useMemo(
    () => (query.data ?? []).filter((c) => c.kind === tab),
    [query.data, tab],
  )
  const incomeCount = (query.data ?? []).filter((c) => c.kind === 'income').length
  const expenseCount = (query.data ?? []).filter((c) => c.kind === 'expense').length

  function confirmDelete(c: CashflowCategory) {
    Alert.alert(
      `Hapus "${c.name}"?`,
      'Entri yang sudah memakai kategori ini tidak ikut terhapus tapi akan kehilangan label.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () =>
            remove.mutate(c.id, {
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

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Kategori" back />
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
        <ScreenHeader title="Kategori" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa edit kategori.'
              : 'Gagal memuat kategori.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Kategori Kas"
        subtitle={`${query.data?.length ?? 0} kategori`}
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
        <XStack
          ai="center"
          gap="$1"
          bg={COLORS.surfaceContainerLow}
          br={999}
          p={4}
        >
          {(['expense', 'income'] as const).map((k) => {
            const on = k === tab
            return (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
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
                  {k === 'expense'
                    ? `Pengeluaran (${expenseCount})`
                    : `Pemasukan (${incomeCount})`}
                </Paragraph>
              </Pressable>
            )
          })}
        </XStack>

        {filtered.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Tag size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada kategori {tab === 'expense' ? 'pengeluaran' : 'pemasukan'}.
            </Paragraph>
          </YStack>
        ) : (
          filtered.map((c) => (
            <YStack
              key={c.id}
              bg={COLORS.surfaceContainerLowest}
              br={12}
              p="$3"
              gap="$2"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
              style={SHADOWS.card}
            >
              <XStack ai="center" jc="space-between">
                <YStack flex={1}>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {c.name}
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    {c.isSystem ? 'Bawaan sistem' : 'Kustom'}
                  </Paragraph>
                </YStack>
                {!c.isSystem && (
                  <XStack gap="$2">
                    <Pressable
                      onPress={() => setEditing(c)}
                      hitSlop={6}
                      style={{ padding: 6 }}
                    >
                      <Edit size={15} color={COLORS.outline} />
                    </Pressable>
                    <Pressable
                      onPress={() => confirmDelete(c)}
                      hitSlop={6}
                      style={{ padding: 6 }}
                    >
                      <Trash2 size={15} color={COLORS.danger} />
                    </Pressable>
                  </XStack>
                )}
              </XStack>
            </YStack>
          ))
        )}
      </ScrollView>

      <CategoryEditorModal
        editing={editing}
        defaultKind={tab}
        onClose={() => setEditing(null)}
      />
    </YStack>
  )
}

function CategoryEditorModal({
  editing,
  defaultKind,
  onClose,
}: {
  editing: CashflowCategory | 'new' | null
  defaultKind: CashflowKind
  onClose: () => void
}) {
  const visible = editing !== null
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CashflowKind>(defaultKind)
  const create = useCreateCashflowCategory()
  const update = useUpdateCashflowCategory()

  useEffect(() => {
    if (!visible) return
    if (initial) {
      setName(initial.name)
      setKind(initial.kind)
    } else {
      setName('')
      setKind(defaultKind)
    }
  }, [visible, initial, defaultKind])

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Nama wajib', 'Tulis nama kategori sebelum simpan.')
      return
    }
    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, name: name.trim() })
      } else {
        await create.mutateAsync({ name: name.trim(), kind })
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
            {isNew ? 'Kategori baru' : 'Edit kategori'}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <YStack gap="$2">
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={12}
              color={COLORS.onSurface}
              textTransform="uppercase"
              letterSpacing={0.4}
            >
              Nama
            </Paragraph>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={
                kind === 'expense'
                  ? 'Mis. Listrik, Sewa, Gaji'
                  : 'Mis. Penjualan jasa, Komisi'
              }
              placeholderTextColor={COLORS.outline}
              maxLength={60}
              autoFocus
              style={{
                backgroundColor: COLORS.surfaceContainerLowest,
                borderRadius: 10,
                paddingHorizontal: 14,
                height: 44,
                borderWidth: 1,
                borderColor: COLORS.borderSubtle,
                fontFamily: FONTS.body,
                fontSize: 14,
                color: COLORS.onSurface,
              }}
            />
          </YStack>

          {isNew && (
            <YStack gap="$2">
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.onSurface}
                textTransform="uppercase"
                letterSpacing={0.4}
              >
                Tipe
              </Paragraph>
              <XStack gap="$2">
                {(['expense', 'income'] as const).map((k) => {
                  const on = k === kind
                  return (
                    <Pressable
                      key={k}
                      onPress={() => setKind(k)}
                      style={{
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: on
                          ? COLORS.primary
                          : COLORS.borderSubtle,
                        backgroundColor: on
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
                        {k === 'expense' ? 'Pengeluaran' : 'Pemasukan'}
                      </Paragraph>
                    </Pressable>
                  )
                })}
              </XStack>
            </YStack>
          )}

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
                Simpan
              </Paragraph>
            )}
          </Pressable>
        </ScrollView>
      </YStack>
    </Modal>
  )
}
