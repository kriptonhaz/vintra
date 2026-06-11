/**
 * Master customers — paginated list w/ search + create. Tap row to
 * push detail.
 */
import { useState } from 'react'
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
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Phone,
  Plus,
  Search,
  User,
  Users,
  X,
} from '~/lib/icons'
import {
  useMasterCustomers,
  useUpsertMasterCustomer,
  type MasterCustomer,
} from '~/lib/master'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function CustomersIndex() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const query = useMasterCustomers({ search, page, pageSize: 25 })
  const [creating, setCreating] = useState(false)

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pelanggan" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (query.error) {
    const isForbidden =
      query.error instanceof ApiError && query.error.status === 403
    const msg = query.error instanceof Error ? query.error.message : ''
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pelanggan" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa kelola pelanggan.'
              : msg.includes('Komplit') || msg.includes('customer_db')
                ? 'Customer database tersedia mulai paket Komplit.'
                : 'Gagal memuat pelanggan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const data = query.data
  const items = data?.items ?? []
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Pelanggan"
        subtitle={`${data?.total ?? 0} pelanggan`}
        back
        right={
          <Pressable
            onPress={() => setCreating(true)}
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
            onChangeText={(v) => {
              setSearch(v)
              setPage(1)
            }}
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
        {items.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Users size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              px="$4"
            >
              {search ? `Tidak ada pelanggan cocok dengan "${search}".` : 'Belum ada pelanggan.'}
            </Paragraph>
          </YStack>
        ) : (
          items.map((c) => (
            <Pressable
              key={c.id}
              onPress={() =>
                router.push({
                  pathname: '/master/customers/[customerId]' as never,
                  params: { customerId: c.id },
                } as never)
              }
            >
              <XStack
                ai="center"
                gap="$3"
                bg={COLORS.surfaceContainerLowest}
                br={12}
                p="$3"
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
                style={SHADOWS.card}
              >
                <YStack
                  w={40}
                  h={40}
                  br={20}
                  bg={COLORS.primaryFixed}
                  ai="center"
                  jc="center"
                >
                  <User size={18} color={COLORS.primary} />
                </YStack>
                <YStack flex={1}>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                    numberOfLines={1}
                  >
                    {c.name}
                  </Paragraph>
                  {c.phone && (
                    <XStack ai="center" gap={4}>
                      <Phone size={11} color={COLORS.onSurfaceVariant} />
                      <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                        {c.phone}
                      </Stat>
                    </XStack>
                  )}
                  {c.email && (
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant} numberOfLines={1}>
                      {c.email}
                    </Stat>
                  )}
                </YStack>
                <ChevronRight size={18} color={COLORS.outline} />
              </XStack>
            </Pressable>
          ))
        )}

        {data && data.total > data.pageSize && (
          <XStack ai="center" jc="space-between" mt="$3">
            <Pressable
              onPress={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                opacity: page === 1 ? 0.5 : 1,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: COLORS.borderSubtle,
                backgroundColor: COLORS.surfaceContainerLowest,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <ChevronLeft size={14} color={COLORS.onSurface} />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.onSurface}
              >
                Sebelumnya
              </Paragraph>
            </Pressable>
            <Stat fontSize={12} color={COLORS.onSurfaceVariant}>
              {page} / {totalPages}
            </Stat>
            <Pressable
              onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={{
                opacity: page === totalPages ? 0.5 : 1,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: COLORS.borderSubtle,
                backgroundColor: COLORS.surfaceContainerLowest,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.onSurface}
              >
                Berikutnya
              </Paragraph>
              <ChevronRight size={14} color={COLORS.onSurface} />
            </Pressable>
          </XStack>
        )}
      </ScrollView>

      {creating && <CreateCustomerModal onClose={() => setCreating(false)} />}
    </YStack>
  )
}

function CreateCustomerModal({ onClose }: { onClose: () => void }) {
  const upsert = useUpsertMasterCustomer()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Nama wajib', 'Isi nama pelanggan.')
      return
    }
    try {
      await upsert.mutateAsync({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
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
            Pelanggan baru
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
            <Field label="Nama" value={name} setValue={setName} autoFocus />
            <Field
              label="Nomor HP / WA"
              value={phone}
              setValue={setPhone}
              keyboardType="phone-pad"
            />
            <Field
              label="Email"
              value={email}
              setValue={setEmail}
              keyboardType="email-address"
            />
            <Field
              label="Catatan"
              value={notes}
              setValue={setNotes}
              multiline
            />
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

function Field({
  label,
  value,
  setValue,
  multiline,
  autoFocus,
  keyboardType,
}: {
  label: string
  value: string
  setValue: (v: string) => void
  multiline?: boolean
  autoFocus?: boolean
  keyboardType?: 'phone-pad' | 'email-address'
}) {
  return (
    <>
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={12}
        color={COLORS.onSurface}
        textTransform="uppercase"
        letterSpacing={0.4}
      >
        {label}
      </Paragraph>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder=""
        placeholderTextColor={COLORS.outline}
        autoFocus={autoFocus}
        multiline={multiline}
        keyboardType={keyboardType}
        style={{
          backgroundColor: COLORS.surfaceContainerLowest,
          borderRadius: 10,
          paddingHorizontal: 14,
          minHeight: multiline ? 70 : 44,
          height: multiline ? undefined : 44,
          paddingTop: multiline ? 10 : 0,
          textAlignVertical: multiline ? 'top' : 'auto',
          borderWidth: 1,
          borderColor: COLORS.borderSubtle,
          fontFamily: FONTS.body,
          fontSize: 14,
          color: COLORS.onSurface,
        }}
      />
    </>
  )
}

// Suppress unused-export warning — silenced via re-export
export type _MasterCustomer = MasterCustomer
