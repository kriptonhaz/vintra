/**
 * Booking settings — mode (slot/queue/stay), slot duration, max
 * concurrent, staff bookable toggles, blackout dates. Add-non-member
 * staff is available as a small CTA.
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
  Calendar,
  Check,
  Plus,
  Trash2,
  User,
  X,
} from '~/lib/icons'
import {
  useAddBookingStaff,
  useBookingSettingsState,
  useDeleteBookingResource,
  useSaveBookingSettings,
  useToggleMemberBookable,
  type BookingMode,
} from '~/lib/booking'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const MODES: Array<{
  key: BookingMode
  label: string
  desc: string
}> = [
  {
    key: 'slot',
    label: 'Slot',
    desc: 'Pelanggan booking pada jam tertentu — cocok untuk salon, klinik, jasa.',
  },
  {
    key: 'queue',
    label: 'Antrian',
    desc: 'FIFO walk-in queue — cocok untuk barbershop, klinik tanpa jadwal.',
  },
  {
    key: 'stay',
    label: 'Menginap',
    desc: 'Check-in / check-out berhari-hari — cocok untuk penginapan.',
  },
]

export default function BookingSettingsScreen() {
  const state = useBookingSettingsState()
  const save = useSaveBookingSettings()
  const toggleMember = useToggleMemberBookable()
  const deleteResource = useDeleteBookingResource()
  const addStaff = useAddBookingStaff()

  const [mode, setMode] = useState<BookingMode>('slot')
  const [slotDur, setSlotDur] = useState('30')
  const [maxConcurrent, setMaxConcurrent] = useState('1')
  const [blackouts, setBlackouts] = useState<string[]>([])
  const [blackoutInput, setBlackoutInput] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    const s = state.data?.settings
    if (!s) return
    setMode(s.mode)
    setSlotDur(String(s.slotDurationMin))
    setMaxConcurrent(s.maxConcurrentSlots ? String(s.maxConcurrentSlots) : '1')
    setBlackouts(s.blackoutDates ?? [])
  }, [state.data?.settings])

  async function handleSave() {
    try {
      await save.mutateAsync({
        mode,
        slotDurationMin: Math.max(5, Math.min(720, parseInt(slotDur, 10) || 30)),
        maxConcurrentSlots: Math.max(1, parseInt(maxConcurrent, 10) || 1),
        blackoutDates: blackouts,
      })
      Alert.alert('Tersimpan', 'Pengaturan booking diperbarui.')
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  function addBlackout() {
    const d = blackoutInput.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      Alert.alert('Tanggal tidak valid', 'Format YYYY-MM-DD.')
      return
    }
    if (!blackouts.includes(d)) {
      setBlackouts([...blackouts, d].sort())
    }
    setBlackoutInput('')
  }

  if (state.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pengaturan Booking" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (state.error) {
    const isForbidden =
      state.error instanceof ApiError && state.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pengaturan Booking" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa edit pengaturan booking.'
              : 'Gagal memuat pengaturan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const members = state.data?.members ?? []
  const resources = state.data?.resources ?? []
  // Resources w/o memberId are standalone (added via addBookingStaff)
  const standaloneResources = resources.filter((r) => !r.memberId)

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader title="Pengaturan Booking" back />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}
          refreshControl={
            <RefreshControl
              refreshing={state.isFetching}
              onRefresh={() => state.refetch()}
              tintColor={COLORS.primary}
            />
          }
        >
          {/* Mode */}
          <Section title="Mode Booking">
            <YStack gap="$2">
              {MODES.map((m) => {
                const on = m.key === mode
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => setMode(m.key)}
                  >
                    <YStack
                      bg={
                        on ? COLORS.primaryFixed : COLORS.surfaceContainerLowest
                      }
                      br={12}
                      p="$3"
                      gap={2}
                      borderWidth={1}
                      borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                    >
                      <XStack ai="center" jc="space-between">
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          fontSize={14}
                          color={COLORS.onSurface}
                        >
                          {m.label}
                        </Paragraph>
                        {on && <Check size={16} color={COLORS.primary} />}
                      </XStack>
                      <Paragraph
                        fontFamily={FONTS.body}
                        fontSize={11}
                        color={COLORS.onSurfaceVariant}
                      >
                        {m.desc}
                      </Paragraph>
                    </YStack>
                  </Pressable>
                )
              })}
            </YStack>
          </Section>

          {/* Slot config */}
          <Section title="Slot">
            <XStack gap="$2">
              <YStack flex={1} gap="$1">
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={10}
                  color={COLORS.onSurfaceVariant}
                  letterSpacing={0.4}
                  textTransform="uppercase"
                >
                  Durasi slot
                </Paragraph>
                <XStack
                  ai="center"
                  bg={COLORS.surface}
                  br={10}
                  px="$3"
                  h={44}
                  borderWidth={1}
                  borderColor={COLORS.borderSubtle}
                  gap="$2"
                >
                  <TextInput
                    value={slotDur}
                    onChangeText={(v) => setSlotDur(v.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                    placeholder="30"
                    placeholderTextColor={COLORS.outline}
                    style={numberInputStyle}
                  />
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    menit
                  </Paragraph>
                </XStack>
              </YStack>
              <YStack flex={1} gap="$1">
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={10}
                  color={COLORS.onSurfaceVariant}
                  letterSpacing={0.4}
                  textTransform="uppercase"
                >
                  Maks paralel
                </Paragraph>
                <XStack
                  ai="center"
                  bg={COLORS.surface}
                  br={10}
                  px="$3"
                  h={44}
                  borderWidth={1}
                  borderColor={COLORS.borderSubtle}
                  gap="$2"
                >
                  <TextInput
                    value={maxConcurrent}
                    onChangeText={(v) => setMaxConcurrent(v.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                    placeholder="1"
                    placeholderTextColor={COLORS.outline}
                    style={numberInputStyle}
                  />
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    slot
                  </Paragraph>
                </XStack>
              </YStack>
            </XStack>
          </Section>

          {/* Members */}
          <Section
            title="Staff yang bisa di-booking"
            subtitle="Centang anggota tim yang menerima booking. Tambah staff non-member jika perlu."
            right={
              <Pressable
                onPress={() => setAddOpen(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  backgroundColor: COLORS.primaryFixed,
                  borderRadius: 999,
                }}
              >
                <Plus size={12} color={COLORS.primary} />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={11}
                  color={COLORS.primary}
                >
                  Tambah
                </Paragraph>
              </Pressable>
            }
          >
            {members.length === 0 ? (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
              >
                Belum ada anggota tim.
              </Paragraph>
            ) : (
              members.map((m) => {
                const name =
                  [m.firstName, m.lastName].filter(Boolean).join(' ') ||
                  '(tanpa nama)'
                return (
                  <XStack
                    key={m.userId}
                    ai="center"
                    gap="$3"
                    py="$2"
                    borderBottomWidth={1}
                    borderBottomColor={COLORS.borderSubtle}
                  >
                    <YStack
                      w={32}
                      h={32}
                      br={16}
                      bg={COLORS.surfaceContainerLow}
                      ai="center"
                      jc="center"
                    >
                      <User size={14} color={COLORS.outline} />
                    </YStack>
                    <YStack flex={1}>
                      <Paragraph
                        fontFamily={FONTS.bodyMedium}
                        fontSize={14}
                        color={COLORS.onSurface}
                      >
                        {name}
                      </Paragraph>
                      <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                        {m.isBookable ? 'Bisa di-booking' : 'Tidak aktif'}
                      </Stat>
                    </YStack>
                    <Switch
                      value={m.isBookable}
                      onValueChange={(v) =>
                        toggleMember.mutate(
                          { userId: m.userId, bookable: v },
                          {
                            onError: (err) =>
                              Alert.alert(
                                'Gagal',
                                err instanceof Error ? err.message : 'Coba lagi.',
                              ),
                          },
                        )
                      }
                      trackColor={{ false: COLORS.outline, true: COLORS.primary }}
                      thumbColor="#fff"
                    />
                  </XStack>
                )
              })
            )}

            {standaloneResources.length > 0 && (
              <>
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={11}
                  color={COLORS.onSurfaceVariant}
                  letterSpacing={0.55}
                  mt="$2"
                >
                  STAFF NON-MEMBER
                </Paragraph>
                {standaloneResources.map((r) => (
                  <XStack
                    key={r.id}
                    ai="center"
                    gap="$3"
                    py="$2"
                    borderBottomWidth={1}
                    borderBottomColor={COLORS.borderSubtle}
                  >
                    <YStack
                      w={32}
                      h={32}
                      br={16}
                      bg={COLORS.primaryFixed}
                      ai="center"
                      jc="center"
                    >
                      <User size={14} color={COLORS.primary} />
                    </YStack>
                    <Paragraph
                      fontFamily={FONTS.bodyMedium}
                      fontSize={14}
                      color={COLORS.onSurface}
                      flex={1}
                    >
                      {r.name}
                    </Paragraph>
                    <Pressable
                      onPress={() =>
                        Alert.alert(
                          `Hapus "${r.name}"?`,
                          'Staff ini tidak akan muncul lagi di booking.',
                          [
                            { text: 'Batal', style: 'cancel' },
                            {
                              text: 'Hapus',
                              style: 'destructive',
                              onPress: () =>
                                deleteResource.mutate(r.id, {
                                  onError: (err) =>
                                    Alert.alert(
                                      'Gagal',
                                      err instanceof Error
                                        ? err.message
                                        : 'Coba lagi.',
                                    ),
                                }),
                            },
                          ],
                        )
                      }
                      hitSlop={6}
                      style={{ padding: 6 }}
                    >
                      <Trash2 size={14} color={COLORS.danger} />
                    </Pressable>
                  </XStack>
                ))}
              </>
            )}
          </Section>

          {/* Blackout dates */}
          <Section
            title="Tanggal libur"
            subtitle="Booking tidak bisa dibuat di tanggal-tanggal ini."
          >
            <XStack ai="center" gap="$2">
              <TextInput
                value={blackoutInput}
                onChangeText={setBlackoutInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.outline}
                style={{
                  flex: 1,
                  backgroundColor: COLORS.surface,
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  height: 44,
                  borderWidth: 1,
                  borderColor: COLORS.borderSubtle,
                  fontFamily: FONTS.monoMedium,
                  fontSize: 14,
                  color: COLORS.onSurface,
                }}
              />
              <Pressable
                onPress={addBlackout}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: 10,
                  backgroundColor: COLORS.primary,
                }}
              >
                <Plus size={14} color="#fff" />
              </Pressable>
            </XStack>
            {blackouts.length > 0 && (
              <XStack flexWrap="wrap" gap="$2" mt="$1">
                {blackouts.map((d) => (
                  <XStack
                    key={d}
                    ai="center"
                    bg={COLORS.warningTint}
                    br={999}
                    px={10}
                    py={4}
                    gap={6}
                  >
                    <Calendar size={11} color="#92400e" />
                    <Paragraph
                      fontFamily={FONTS.bodyBold}
                      fontSize={11}
                      color="#92400e"
                    >
                      {d}
                    </Paragraph>
                    <Pressable
                      onPress={() => setBlackouts(blackouts.filter((x) => x !== d))}
                      hitSlop={4}
                    >
                      <X size={11} color="#92400e" />
                    </Pressable>
                  </XStack>
                ))}
              </XStack>
            )}
          </Section>
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
            onPress={handleSave}
            disabled={save.isPending}
            style={{
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: save.isPending ? COLORS.outline : COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {save.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
                Simpan pengaturan
              </Paragraph>
            )}
          </Pressable>
        </YStack>
      </KeyboardAvoidingView>

      {addOpen && (
        <AddStaffModal
          busy={addStaff.isPending}
          onClose={() => setAddOpen(false)}
          onAdd={async (name) => {
            try {
              await addStaff.mutateAsync({ name })
              setAddOpen(false)
            } catch (err) {
              Alert.alert(
                'Gagal tambah staff',
                err instanceof Error ? err.message : 'Coba lagi.',
              )
            }
          }}
        />
      )}
    </YStack>
  )
}

function AddStaffModal({
  busy,
  onClose,
  onAdd,
}: {
  busy: boolean
  onClose: () => void
  onAdd: (name: string) => void
}) {
  const [name, setName] = useState('')
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
            Tambah staff
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
          >
            Tambah staff yang bisa di-booking tanpa harus invite ke
            Vintra sebagai user. Cocok untuk freelance / asisten.
          </Paragraph>
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
            placeholder="Mis. Bu Tini"
            placeholderTextColor={COLORS.outline}
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
          <Pressable
            onPress={() => {
              if (!name.trim()) return
              onAdd(name.trim())
            }}
            disabled={busy}
            style={{
              marginTop: 8,
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
              <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
                Simpan
              </Paragraph>
            )}
          </Pressable>
        </ScrollView>
      </YStack>
    </Modal>
  )
}

function Section({
  title,
  subtitle,
  children,
  right,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$3"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <XStack ai="flex-start" jc="space-between" gap="$2">
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={13}
            color={COLORS.onSurface}
          >
            {title}
          </Paragraph>
          {subtitle && (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
            >
              {subtitle}
            </Paragraph>
          )}
        </YStack>
        {right}
      </XStack>
      {children}
    </YStack>
  )
}

const numberInputStyle = {
  flex: 1,
  fontFamily: FONTS.monoMedium,
  fontSize: 14,
  color: COLORS.onSurface,
  paddingVertical: 0,
}
