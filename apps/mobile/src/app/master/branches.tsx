/**
 * Master branches — outlets/cabang. Mobile CRUD covers name, address,
 * phone, GPS coords + radius (for attendance geofence). Per-module
 * activation and full weekly schedules stay in the desktop editor for
 * v1 — we surface a hint.
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
  Switch,
  TextInput,
} from 'react-native'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Edit,
  MapPin,
  Phone,
  Plus,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useCreateMasterBranch,
  useDeleteMasterBranch,
  useMasterBranches,
  useUpdateMasterBranch,
  type MasterBranch,
} from '~/lib/master'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function MasterBranchesScreen() {
  const query = useMasterBranches()
  const remove = useDeleteMasterBranch()
  const [editing, setEditing] = useState<MasterBranch | 'new' | null>(null)

  function confirmDelete(b: MasterBranch) {
    if (b.isMain) {
      Alert.alert(
        'Cabang utama tidak bisa dihapus',
        'Set cabang lain sebagai utama dulu, baru hapus.',
      )
      return
    }
    Alert.alert(
      `Hapus "${b.name}"?`,
      'Transaksi yang tertaut ke cabang ini tidak ikut terhapus, hanya kehilangan link.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () =>
            remove.mutate(b.id, {
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
        <ScreenHeader title="Cabang" back />
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
        <ScreenHeader title="Cabang" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa kelola cabang.'
              : 'Gagal memuat cabang.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const rows = query.data ?? []

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Cabang"
        subtitle={`${rows.length} outlet`}
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
        {/* Web-only hint for schedules */}
        <YStack
          bg={COLORS.warningTint}
          br={12}
          p="$3"
          gap="$2"
          borderWidth={1}
          borderColor="#92400e"
        >
          <XStack ai="flex-start" gap="$2">
            <AlertCircle size={14} color="#92400e" />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color="#92400e"
              flex={1}
            >
              Jadwal jam buka mingguan + modul yang aktif per cabang
              diatur di web. Mobile hanya untuk profil dasar + GPS.
            </Paragraph>
          </XStack>
        </YStack>

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
            <Building2 size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada cabang.
            </Paragraph>
          </YStack>
        ) : (
          rows.map((b) => (
            <YStack
              key={b.id}
              bg={COLORS.surfaceContainerLowest}
              br={12}
              p="$3"
              gap="$2"
              borderWidth={1}
              borderColor={b.isMain ? COLORS.primary : COLORS.borderSubtle}
              style={SHADOWS.card}
              opacity={b.isActive ? 1 : 0.6}
            >
              <XStack ai="center" gap="$3">
                <YStack
                  w={40}
                  h={40}
                  br={12}
                  bg={COLORS.primaryFixed}
                  ai="center"
                  jc="center"
                >
                  <Building2 size={18} color={COLORS.primary} />
                </YStack>
                <YStack flex={1}>
                  <XStack ai="center" gap="$2">
                    <Paragraph
                      fontFamily={FONTS.bodySemi}
                      fontSize={14}
                      color={COLORS.onSurface}
                    >
                      {b.name}
                    </Paragraph>
                    {b.isMain && (
                      <YStack px={6} py={2} br={6} bg={COLORS.primary}>
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          fontSize={9}
                          color="#fff"
                        >
                          UTAMA
                        </Paragraph>
                      </YStack>
                    )}
                    {!b.isActive && (
                      <YStack
                        px={6}
                        py={2}
                        br={6}
                        bg={COLORS.surfaceContainerLow}
                      >
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          fontSize={9}
                          color={COLORS.onSurfaceVariant}
                        >
                          NON-AKTIF
                        </Paragraph>
                      </YStack>
                    )}
                  </XStack>
                  {b.address && (
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant} numberOfLines={2}>
                      {b.address}
                    </Stat>
                  )}
                  {b.phoneNumber && (
                    <XStack ai="center" gap={4} mt={2}>
                      <Phone size={11} color={COLORS.onSurfaceVariant} />
                      <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                        {b.phoneNumber}
                      </Stat>
                    </XStack>
                  )}
                  {b.latitude && b.longitude && (
                    <XStack ai="center" gap={4}>
                      <MapPin size={11} color={COLORS.success} />
                      <Stat fontSize={11} color={COLORS.success}>
                        GPS aktif{b.radiusMeters ? ` · ${b.radiusMeters}m` : ''}
                      </Stat>
                    </XStack>
                  )}
                </YStack>
                <Pressable
                  onPress={() => setEditing(b)}
                  hitSlop={6}
                  style={{ padding: 6 }}
                >
                  <Edit size={15} color={COLORS.outline} />
                </Pressable>
                {!b.isMain && (
                  <Pressable
                    onPress={() => confirmDelete(b)}
                    hitSlop={6}
                    style={{ padding: 6 }}
                  >
                    <Trash2 size={15} color={COLORS.danger} />
                  </Pressable>
                )}
              </XStack>
            </YStack>
          ))
        )}
      </ScrollView>

      {editing !== null && (
        <BranchEditorModal
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </YStack>
  )
}

function BranchEditorModal({
  editing,
  onClose,
}: {
  editing: MasterBranch | 'new'
  onClose: () => void
}) {
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const create = useCreateMasterBranch()
  const update = useUpdateMasterBranch()

  const [name, setName] = useState(initial?.name ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [phone, setPhone] = useState(initial?.phoneNumber ?? '')
  const [lat, setLat] = useState(initial?.latitude ?? '')
  const [lng, setLng] = useState(initial?.longitude ?? '')
  const [radius, setRadius] = useState(
    initial?.radiusMeters ? String(initial.radiusMeters) : '100',
  )
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Nama wajib', 'Isi nama cabang.')
      return
    }
    const latNum = lat ? parseFloat(lat) : null
    const lngNum = lng ? parseFloat(lng) : null
    const radNum = radius ? Math.max(10, parseInt(radius, 10) || 0) : null
    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          name: name.trim(),
          address: address.trim() || null,
          phoneNumber: phone.trim() || null,
          latitude: latNum,
          longitude: lngNum,
          radiusMeters: radNum,
          isActive,
        })
      } else {
        await create.mutateAsync({
          name: name.trim(),
          address: address.trim() || null,
          phoneNumber: phone.trim() || null,
          latitude: latNum,
          longitude: lngNum,
          radiusMeters: radNum,
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
            {isNew ? 'Cabang baru' : 'Edit cabang'}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
            <FieldLabel>Nama cabang</FieldLabel>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Mis. Cabang Cengkareng"
              placeholderTextColor={COLORS.outline}
              autoFocus={isNew}
              style={inputStyle}
            />
            <FieldLabel>Alamat</FieldLabel>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="Jl. ..."
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
            <FieldLabel>Nomor telepon</FieldLabel>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="08xx"
              placeholderTextColor={COLORS.outline}
              keyboardType="phone-pad"
              style={inputStyle}
            />

            <YStack
              bg={COLORS.surfaceContainerLowest}
              br={12}
              p="$3"
              gap="$3"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.onSurface}
                textTransform="uppercase"
                letterSpacing={0.4}
              >
                GPS (untuk absensi)
              </Paragraph>
              <XStack gap="$2">
                <YStack flex={1} gap={4}>
                  <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                    Latitude
                  </Stat>
                  <TextInput
                    value={lat}
                    onChangeText={setLat}
                    placeholder="-6.21..."
                    placeholderTextColor={COLORS.outline}
                    keyboardType="decimal-pad"
                    style={numStyle}
                  />
                </YStack>
                <YStack flex={1} gap={4}>
                  <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                    Longitude
                  </Stat>
                  <TextInput
                    value={lng}
                    onChangeText={setLng}
                    placeholder="106.82..."
                    placeholderTextColor={COLORS.outline}
                    keyboardType="decimal-pad"
                    style={numStyle}
                  />
                </YStack>
              </XStack>
              <YStack gap={4}>
                <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                  Radius geofence (meter)
                </Stat>
                <TextInput
                  value={radius}
                  onChangeText={(v) => setRadius(v.replace(/\D/g, ''))}
                  placeholder="100"
                  placeholderTextColor={COLORS.outline}
                  keyboardType="number-pad"
                  style={numStyle}
                />
              </YStack>
              <Stat fontSize={10} color={COLORS.outline}>
                Staff harus di dalam radius ini untuk clock-in.
              </Stat>
            </YStack>

            {!isNew && (
              <XStack
                ai="center"
                jc="space-between"
                bg={COLORS.surfaceContainerLowest}
                br={10}
                p="$3"
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  Cabang aktif
                </Paragraph>
                <Switch
                  value={isActive}
                  onValueChange={setIsActive}
                  trackColor={{ false: COLORS.outline, true: COLORS.primary }}
                  thumbColor="#fff"
                />
              </XStack>
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

const numStyle = {
  backgroundColor: COLORS.surface,
  borderRadius: 10,
  paddingHorizontal: 12,
  height: 40,
  borderWidth: 1,
  borderColor: COLORS.borderSubtle,
  fontFamily: FONTS.monoMedium,
  fontSize: 13,
  color: COLORS.onSurface,
}
