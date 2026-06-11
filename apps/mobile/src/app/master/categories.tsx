/**
 * Master categories — product/service categories. Toggle "tampil di
 * situs" controls whether the category appears in the public microsite
 * menu.
 */
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  TextInput,
} from 'react-native'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertTriangle,
  Edit,
  Globe,
  Plus,
  Tag,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useCreateMasterCategory,
  useDeleteMasterCategory,
  useMasterCategories,
  useUpdateMasterCategory,
  type MasterCategory,
} from '~/lib/master'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function MasterCategoriesScreen() {
  const query = useMasterCategories()
  const remove = useDeleteMasterCategory()
  const [editing, setEditing] = useState<MasterCategory | 'new' | null>(null)

  function confirmDelete(c: MasterCategory) {
    Alert.alert(
      `Hapus "${c.name}"?`,
      'Produk yang sudah pakai kategori ini akan kehilangan label.',
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
              ? 'Akun kamu tidak bisa kelola kategori.'
              : 'Gagal memuat kategori.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const rows = query.data ?? []

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Kategori"
        subtitle={`${rows.length} kategori`}
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
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => query.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {rows.length === 0 ? (
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
              Belum ada kategori.
            </Paragraph>
          </YStack>
        ) : (
          rows.map((c) => (
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
              <XStack ai="center" gap="$3">
                <YStack
                  w={36}
                  h={36}
                  br={10}
                  bg="#cffafe"
                  ai="center"
                  jc="center"
                >
                  <Tag size={16} color="#0891b2" />
                </YStack>
                <YStack flex={1}>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {c.name}
                  </Paragraph>
                  <XStack ai="center" gap="$2">
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                      Urutan {c.sortOrder}
                    </Stat>
                    {c.isVisibleOnSitus && (
                      <YStack px={6} py={2} br={6} bg="#ede9fe">
                        <XStack ai="center" gap={4}>
                          <Globe size={9} color="#7c3aed" />
                          <Paragraph
                            fontFamily={FONTS.bodyBold}
                            fontSize={9}
                            color="#7c3aed"
                          >
                            DI SITUS
                          </Paragraph>
                        </XStack>
                      </YStack>
                    )}
                  </XStack>
                </YStack>
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
            </YStack>
          ))
        )}
      </ScrollView>

      {editing !== null && (
        <CategoryEditorModal
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </YStack>
  )
}

function CategoryEditorModal({
  editing,
  onClose,
}: {
  editing: MasterCategory | 'new'
  onClose: () => void
}) {
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const create = useCreateMasterCategory()
  const update = useUpdateMasterCategory()

  const [name, setName] = useState(initial?.name ?? '')
  const [sortOrder, setSortOrder] = useState(
    String(initial?.sortOrder ?? 100),
  )
  const [visibleOnSitus, setVisibleOnSitus] = useState(
    initial?.isVisibleOnSitus ?? false,
  )

  useEffect(() => {
    if (initial) {
      setName(initial.name)
      setSortOrder(String(initial.sortOrder))
      setVisibleOnSitus(initial.isVisibleOnSitus)
    }
  }, [initial])

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Nama wajib', 'Isi nama kategori.')
      return
    }
    const sort = parseInt(sortOrder, 10) || 100
    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          name: name.trim(),
          sortOrder: sort,
          isVisibleOnSitus: visibleOnSitus,
        })
      } else {
        await create.mutateAsync({
          name: name.trim(),
          sortOrder: sort,
          isVisibleOnSitus: visibleOnSitus,
        })
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
            {isNew ? 'Kategori baru' : 'Edit kategori'}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            <FieldLabel>Nama</FieldLabel>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Mis. Minuman, Makanan"
              placeholderTextColor={COLORS.outline}
              autoFocus={isNew}
              style={inputStyle}
            />
            <FieldLabel>Urutan tampil</FieldLabel>
            <TextInput
              value={sortOrder}
              onChangeText={(v) => setSortOrder(v.replace(/\D/g, ''))}
              keyboardType="number-pad"
              placeholder="100"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              Angka kecil tampil di kiri/atas. Default 100.
            </Stat>
            <XStack ai="center" jc="space-between" mt="$1">
              <YStack flex={1}>
                <Paragraph
                  fontFamily={FONTS.bodySemi}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  Tampil di situs publik
                </Paragraph>
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.onSurfaceVariant}
                >
                  Pelanggan lihat kategori ini di menu situs.
                </Paragraph>
              </YStack>
              <Switch
                value={visibleOnSitus}
                onValueChange={setVisibleOnSitus}
                trackColor={{ false: COLORS.outline, true: COLORS.primary }}
                thumbColor="#fff"
              />
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
                  Simpan
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </YStack>
    </Modal>
  )
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Paragraph
      fontFamily={FONTS.bodyBold}
      fontSize={12}
      color={COLORS.onSurface}
      textTransform="uppercase"
      letterSpacing={0.4}
    >
      {children}
    </Paragraph>
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
