/**
 * Master suppliers — list + CRUD. Used by HPP (bahan baku) and PO
 * (purchase orders). Mobile keeps the form minimal: name + phone +
 * PIC + address + notes.
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
import { Stat } from '~/components/Money'
import {
  AlertTriangle,
  Edit,
  Phone,
  Plus,
  Search,
  Trash2,
  Truck,
  User,
  X,
} from '~/lib/icons'
import {
  useCreateMasterSupplier,
  useDeleteMasterSupplier,
  useMasterSuppliers,
  useUpdateMasterSupplier,
  type MasterSupplier,
} from '~/lib/master'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function MasterSuppliersScreen() {
  const query = useMasterSuppliers()
  const remove = useDeleteMasterSupplier()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<MasterSupplier | 'new' | null>(null)

  const rows = useMemo(() => {
    const all = query.data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.phoneNumber ?? '').toLowerCase().includes(q),
    )
  }, [query.data, search])

  function confirmDelete(s: MasterSupplier) {
    Alert.alert(
      `Hapus "${s.name}"?`,
      'Bahan baku yang sudah tertaut ke supplier ini tidak ikut terhapus, hanya kehilangan link.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () =>
            remove.mutate(s.id, {
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
        <ScreenHeader title="Supplier" back />
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
        <ScreenHeader title="Supplier" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa kelola supplier.'
              : 'Gagal memuat supplier.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Supplier"
        subtitle={`${query.data?.length ?? 0} supplier`}
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

      <YStack px="$4" pt="$3" pb="$2">
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
            value={search}
            onChangeText={setSearch}
            placeholder="Cari nama / telepon"
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
            <Truck size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              px="$4"
            >
              {search
                ? `Tidak ada supplier cocok dengan "${search}".`
                : 'Belum ada supplier.'}
            </Paragraph>
          </YStack>
        ) : (
          rows.map((s) => (
            <YStack
              key={s.id}
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
                  w={40}
                  h={40}
                  br={12}
                  bg="#dbeafe"
                  ai="center"
                  jc="center"
                >
                  <Truck size={18} color="#2563eb" />
                </YStack>
                <YStack flex={1}>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {s.name}
                  </Paragraph>
                  {s.phoneNumber && (
                    <XStack ai="center" gap={4}>
                      <Phone size={11} color={COLORS.onSurfaceVariant} />
                      <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                        {s.phoneNumber}
                      </Stat>
                    </XStack>
                  )}
                  {s.personInCharge && (
                    <XStack ai="center" gap={4}>
                      <User size={11} color={COLORS.onSurfaceVariant} />
                      <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                        {s.personInCharge}
                      </Stat>
                    </XStack>
                  )}
                </YStack>
                <Pressable
                  onPress={() => setEditing(s)}
                  hitSlop={6}
                  style={{ padding: 6 }}
                >
                  <Edit size={15} color={COLORS.outline} />
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(s)}
                  hitSlop={6}
                  style={{ padding: 6 }}
                >
                  <Trash2 size={15} color={COLORS.danger} />
                </Pressable>
              </XStack>
              {s.address && (
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={12}
                  color={COLORS.onSurfaceVariant}
                  numberOfLines={2}
                >
                  {s.address}
                </Paragraph>
              )}
              {s.notes && (
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.outline}
                  numberOfLines={2}
                >
                  {s.notes}
                </Paragraph>
              )}
            </YStack>
          ))
        )}
      </ScrollView>

      {editing !== null && (
        <SupplierEditorModal
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </YStack>
  )
}

function SupplierEditorModal({
  editing,
  onClose,
}: {
  editing: MasterSupplier | 'new'
  onClose: () => void
}) {
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const create = useCreateMasterSupplier()
  const update = useUpdateMasterSupplier()

  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phoneNumber ?? '')
  const [pic, setPic] = useState(initial?.personInCharge ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Nama wajib', 'Isi nama supplier.')
      return
    }
    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          name: name.trim(),
          phoneNumber: phone.trim() || null,
          personInCharge: pic.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        })
      } else {
        await create.mutateAsync({
          name: name.trim(),
          phoneNumber: phone.trim() || null,
          personInCharge: pic.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
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
            {isNew ? 'Supplier baru' : 'Edit supplier'}
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
            <FieldLabel>Nama supplier</FieldLabel>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Mis. CV Sumber Jaya"
              placeholderTextColor={COLORS.outline}
              autoFocus={isNew}
              style={inputStyle}
            />
            <FieldLabel>Nomor HP / WA</FieldLabel>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="08xx"
              placeholderTextColor={COLORS.outline}
              keyboardType="phone-pad"
              style={inputStyle}
            />
            <FieldLabel>PIC (contact person)</FieldLabel>
            <TextInput
              value={pic}
              onChangeText={setPic}
              placeholder="Mis. Pak Budi"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
            <FieldLabel>Alamat</FieldLabel>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="Mis. Jl. Mawar No. 5"
              placeholderTextColor={COLORS.outline}
              multiline
              style={{
                ...inputStyle,
                minHeight: 60,
                paddingTop: 10,
                textAlignVertical: 'top' as const,
                height: undefined,
              }}
            />
            <FieldLabel>Catatan</FieldLabel>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Mis. Order min 50kg"
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
