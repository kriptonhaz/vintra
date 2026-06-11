/**
 * Customer detail — profile + edit. Loyalty / stamp / kasbon tabs are
 * deferred to the desktop view for v1 (the relevant fns are already
 * wired and ready when we extend mobile).
 */
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Phone,
  Trash2,
  User,
} from '~/lib/icons'
import {
  useDeleteMasterCustomer,
  useMasterCustomer,
  useUpsertMasterCustomer,
} from '~/lib/master'
import { ApiError } from '~/lib/api'
import { Platform } from 'react-native'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function CustomerDetailScreen() {
  const router = useRouter()
  const { customerId } = useLocalSearchParams<{ customerId: string }>()
  const customer = useMasterCustomer(customerId)
  const upsert = useUpsertMasterCustomer()
  const remove = useDeleteMasterCustomer()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!customer.data) return
    setName(customer.data.name)
    setPhone(customer.data.phone ?? '')
    setEmail(customer.data.email ?? '')
    setNotes(customer.data.notes ?? '')
    setDirty(false)
  }, [customer.data])

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v)
      setDirty(true)
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Nama wajib', 'Isi nama pelanggan.')
      return
    }
    try {
      await upsert.mutateAsync({
        id: customerId,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
      })
      setDirty(false)
      Alert.alert('Tersimpan', 'Profil pelanggan diperbarui.')
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  function handleDelete() {
    Alert.alert(
      `Hapus "${customer.data?.name ?? 'pelanggan'}"?`,
      'Riwayat transaksi pelanggan tetap tersimpan, hanya kehilangan link.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () =>
            remove.mutate(customerId, {
              onSuccess: () => router.back(),
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

  if (customer.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pelanggan" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (customer.error || !customer.data) {
    const isForbidden =
      customer.error instanceof ApiError && customer.error.status === 403
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
              ? 'Akun kamu tidak bisa lihat pelanggan ini.'
              : 'Pelanggan tidak ditemukan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader title={customer.data.name} back />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={customer.isFetching}
              onRefresh={() => customer.refetch()}
              tintColor={COLORS.primary}
            />
          }
        >
          {/* Hero */}
          <YStack
            bg={COLORS.surfaceContainerLowest}
            br={16}
            p="$4"
            gap="$2"
            ai="center"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
            style={SHADOWS.card}
          >
            <YStack
              w={72}
              h={72}
              br={36}
              bg={COLORS.primaryFixed}
              ai="center"
              jc="center"
            >
              <User size={32} color={COLORS.primary} />
            </YStack>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={18}
              color={COLORS.onSurface}
              ta="center"
            >
              {customer.data.name}
            </Paragraph>
            {customer.data.phone && (
              <XStack ai="center" gap={4}>
                <Phone size={12} color={COLORS.onSurfaceVariant} />
                <Stat fontSize={12} color={COLORS.onSurfaceVariant}>
                  {customer.data.phone}
                </Stat>
              </XStack>
            )}
          </YStack>

          {/* Loyalty / stamps hint */}
          <XStack
            ai="flex-start"
            gap="$2"
            bg={COLORS.warningTint}
            br={12}
            p="$3"
          >
            <AlertCircle size={14} color="#92400e" />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color="#92400e"
              flex={1}
            >
              Loyalti poin + kartu stempel + riwayat penjualan tampil
              di versi web. Mobile hanya untuk edit profil dasar.
            </Paragraph>
          </XStack>

          {/* Edit form */}
          <YStack
            bg={COLORS.surfaceContainerLowest}
            br={14}
            p="$3"
            gap="$3"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <FieldRow
              label="Nama"
              value={name}
              onChange={markDirty(setName)}
            />
            <FieldRow
              label="Nomor HP / WA"
              value={phone}
              onChange={markDirty(setPhone)}
              keyboardType="phone-pad"
            />
            <FieldRow
              label="Email"
              value={email}
              onChange={markDirty(setEmail)}
              keyboardType="email-address"
            />
            <FieldRow
              label="Catatan"
              value={notes}
              onChange={markDirty(setNotes)}
              multiline
            />
          </YStack>

          <Pressable
            onPress={handleDelete}
            style={{
              marginTop: 8,
              paddingVertical: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: COLORS.danger,
              backgroundColor: COLORS.dangerTint,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Trash2 size={14} color={COLORS.danger} />
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={13}
              color={COLORS.danger}
            >
              Hapus pelanggan
            </Paragraph>
          </Pressable>
        </ScrollView>

        {dirty && (
          <YStack
            bg={COLORS.surfaceContainerLowest}
            px="$4"
            pt="$3"
            pb="$5"
            borderTopWidth={1}
            borderTopColor={COLORS.borderSubtle}
          >
            <Pressable
              onPress={handleSave}
              disabled={upsert.isPending}
              style={{
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
                <>
                  <Check size={14} color="#fff" />
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={14}
                    color="#fff"
                  >
                    Simpan perubahan
                  </Paragraph>
                </>
              )}
            </Pressable>
          </YStack>
        )}
      </KeyboardAvoidingView>
    </YStack>
  )
}

function FieldRow({
  label,
  value,
  onChange,
  multiline,
  keyboardType,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  keyboardType?: 'phone-pad' | 'email-address'
}) {
  return (
    <YStack gap={4}>
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={11}
        color={COLORS.onSurfaceVariant}
        letterSpacing={0.4}
        textTransform="uppercase"
      >
        {label}
      </Paragraph>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={COLORS.outline}
        multiline={multiline}
        keyboardType={keyboardType}
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 10,
          paddingHorizontal: 12,
          minHeight: multiline ? 70 : 40,
          height: multiline ? undefined : 40,
          paddingTop: multiline ? 10 : 0,
          textAlignVertical: multiline ? 'top' : 'auto',
          borderWidth: 1,
          borderColor: COLORS.borderSubtle,
          fontFamily: FONTS.body,
          fontSize: 14,
          color: COLORS.onSurface,
        }}
      />
    </YStack>
  )
}
