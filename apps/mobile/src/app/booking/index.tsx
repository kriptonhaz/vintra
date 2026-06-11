/**
 * Booking home — day-list of bookings. Header has a date stepper
 * (← today →), and queue-mode tenants get a "Tambah antrian" CTA;
 * slot-mode tenants get "Booking baru" instead.
 *
 * Tap a booking → status sheet (confirm / in-progress / complete /
 * no-show / cancel).
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
  Calendar,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Phone,
  Plus,
  Settings,
  Trash2,
  User,
  X,
} from '~/lib/icons'
import {
  useBookingResources,
  useBookingServices,
  useBookingSettings,
  useBookings,
  useCreateBooking,
  useDeleteBooking,
  useSearchBookingCustomers,
  useUpdateBookingStatus,
  type BookingResource,
  type BookingRow,
  type BookingService,
  type BookingStatus,
} from '~/lib/booking'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

function ymd(d: Date): string {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  const jak = new Date(utcMs + 7 * 60 * 60_000)
  return `${jak.getUTCFullYear()}-${String(jak.getUTCMonth() + 1).padStart(2, '0')}-${String(jak.getUTCDate()).padStart(2, '0')}`
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

const STATUS_META: Record<
  string,
  { label: string; bg: string; fg: string }
> = {
  pending: { label: 'Menunggu', bg: COLORS.surfaceContainerLow, fg: COLORS.onSurfaceVariant },
  confirmed: { label: 'Terkonfirmasi', bg: '#dbeafe', fg: '#2563eb' },
  in_progress: { label: 'Sedang berjalan', bg: COLORS.warningTint, fg: '#92400e' },
  completed: { label: 'Selesai', bg: '#dcfce7', fg: COLORS.success },
  cancelled: { label: 'Dibatalkan', bg: COLORS.dangerTint, fg: COLORS.danger },
  no_show: { label: 'Tidak hadir', bg: COLORS.dangerTint, fg: COLORS.danger },
}

export default function BookingIndexScreen() {
  const router = useRouter()
  const [date, setDate] = useState<string>(() => ymd(new Date()))
  const settings = useBookingSettings()
  const resources = useBookingResources()
  const services = useBookingServices()
  const bookings = useBookings({ startDate: date, endDate: date })
  const updateStatus = useUpdateBookingStatus()
  const deleteBooking = useDeleteBooking()

  const [selected, setSelected] = useState<BookingRow | null>(null)
  const [creating, setCreating] = useState(false)

  const list = useMemo(() => {
    const rows = bookings.data ?? []
    return [...rows].sort((a, b) => a.startAt.localeCompare(b.startAt))
  }, [bookings.data])

  if (settings.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Booking" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (settings.error) {
    const isForbidden =
      settings.error instanceof ApiError && settings.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Booking" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat booking.'
              : 'Gagal memuat booking.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  if (!settings.data || !settings.data.setupCompleted) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Booking" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <Calendar size={40} color={COLORS.outline} />
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={16}
            color={COLORS.onSurface}
            ta="center"
          >
            Booking belum diatur
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={13}
            color={COLORS.onSurfaceVariant}
            ta="center"
          >
            Atur mode (slot atau antrian), durasi slot, dan staff yang
            bisa dibooking sebelum mulai.
          </Paragraph>
          <Pressable
            onPress={() => router.push('/booking/settings' as never)}
            style={{
              marginTop: 4,
              paddingHorizontal: 16,
              paddingVertical: 12,
              backgroundColor: COLORS.primary,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Settings size={14} color="#fff" />
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={13} color="#fff">
              Mulai setup
            </Paragraph>
          </Pressable>
        </YStack>
      </YStack>
    )
  }

  function shiftDay(delta: number) {
    const d = new Date(`${date}T00:00:00`)
    d.setDate(d.getDate() + delta)
    setDate(ymd(d))
  }

  const isQueue = settings.data.mode === 'queue'

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Booking"
        subtitle={
          isQueue ? 'Mode antrian' : settings.data.mode === 'stay' ? 'Mode menginap' : 'Mode slot'
        }
        back
        right={
          <Pressable
            onPress={() => router.push('/booking/settings' as never)}
            style={{
              padding: 8,
              borderRadius: 10,
              backgroundColor: COLORS.surfaceContainerLowest,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
            }}
          >
            <Settings size={16} color={COLORS.onSurface} />
          </Pressable>
        }
      />

      <XStack
        ai="center"
        jc="space-between"
        px="$4"
        py="$3"
        bg={COLORS.surfaceContainerLowest}
        borderBottomWidth={1}
        borderBottomColor={COLORS.borderSubtle}
      >
        <Pressable onPress={() => shiftDay(-1)} hitSlop={6} style={{ padding: 6 }}>
          <ChevronLeft size={20} color={COLORS.onSurface} />
        </Pressable>
        <YStack ai="center">
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={14}
            color={COLORS.onSurface}
          >
            {new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', {
              weekday: 'long',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </Paragraph>
          {date !== ymd(new Date()) && (
            <Pressable onPress={() => setDate(ymd(new Date()))}>
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={11}
                color={COLORS.primary}
              >
                kembali ke hari ini
              </Paragraph>
            </Pressable>
          )}
        </YStack>
        <Pressable onPress={() => shiftDay(1)} hitSlop={6} style={{ padding: 6 }}>
          <ChevronRight size={20} color={COLORS.onSurface} />
        </Pressable>
      </XStack>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={bookings.isFetching}
            onRefresh={() => bookings.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {bookings.isLoading ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : list.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Calendar size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              px="$4"
            >
              {isQueue
                ? 'Belum ada antrian untuk tanggal ini.'
                : 'Belum ada booking untuk tanggal ini.'}
            </Paragraph>
          </YStack>
        ) : (
          list.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              resources={resources.data ?? []}
              onPress={() => setSelected(b)}
            />
          ))
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
          onPress={() => setCreating(true)}
          style={{
            paddingVertical: 14,
            borderRadius: 12,
            backgroundColor: COLORS.primary,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Plus size={16} color="#fff" />
          <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
            {isQueue ? 'Tambah antrian' : 'Booking baru'}
          </Paragraph>
        </Pressable>
      </YStack>

      {selected && (
        <StatusSheet
          booking={selected}
          onClose={() => setSelected(null)}
          onUpdateStatus={(status) =>
            updateStatus.mutate(
              { id: selected.id, status },
              {
                onSuccess: () => setSelected(null),
                onError: (err) =>
                  Alert.alert(
                    'Gagal',
                    err instanceof Error ? err.message : 'Coba lagi.',
                  ),
              },
            )
          }
          onDelete={() => {
            Alert.alert('Hapus booking?', 'Booking akan dihapus permanen.', [
              { text: 'Batal', style: 'cancel' },
              {
                text: 'Hapus',
                style: 'destructive',
                onPress: () =>
                  deleteBooking.mutate(selected.id, {
                    onSuccess: () => setSelected(null),
                    onError: (err) =>
                      Alert.alert(
                        'Gagal hapus',
                        err instanceof Error ? err.message : 'Coba lagi.',
                      ),
                  }),
              },
            ])
          }}
          busy={updateStatus.isPending || deleteBooking.isPending}
        />
      )}

      {creating && (
        <CreateBookingModal
          resources={resources.data ?? []}
          services={services.data ?? []}
          dateYmd={date}
          onClose={() => setCreating(false)}
        />
      )}
    </YStack>
  )
}

function BookingCard({
  booking,
  resources,
  onPress,
}: {
  booking: BookingRow
  resources: BookingResource[]
  onPress: () => void
}) {
  const status = STATUS_META[booking.status] ?? {
    label: booking.status,
    bg: COLORS.surfaceContainerLow,
    fg: COLORS.onSurfaceVariant,
  }
  const resource = resources.find((r) => r.id === booking.resourceId)
  return (
    <Pressable onPress={onPress}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={
          booking.status === 'in_progress' ? COLORS.primary : COLORS.borderSubtle
        }
        style={SHADOWS.card}
      >
        <XStack ai="flex-start" jc="space-between" gap="$2">
          <YStack flex={1}>
            <Paragraph
              fontFamily={FONTS.bodySemi}
              fontSize={14}
              color={COLORS.onSurface}
            >
              {booking.publicName ?? '(Tanpa nama)'}
            </Paragraph>
            {booking.publicPhone && (
              <XStack ai="center" gap={4}>
                <Phone size={11} color={COLORS.onSurfaceVariant} />
                <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                  {booking.publicPhone}
                </Stat>
              </XStack>
            )}
          </YStack>
          <YStack px={8} py={3} br={6} bg={status.bg}>
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={10}
              color={status.fg}
            >
              {status.label.toUpperCase()}
            </Paragraph>
          </YStack>
        </XStack>
        <XStack ai="center" gap="$3">
          <XStack ai="center" gap={4}>
            <Clock size={12} color={COLORS.onSurfaceVariant} />
            <Stat fontSize={12} color={COLORS.onSurfaceVariant}>
              {fmtTime(booking.startAt)}
              {booking.endAt ? ` – ${fmtTime(booking.endAt)}` : ''}
            </Stat>
          </XStack>
          {resource && (
            <XStack ai="center" gap={4}>
              <User size={12} color={COLORS.onSurfaceVariant} />
              <Stat fontSize={12} color={COLORS.onSurfaceVariant}>
                {resource.name}
              </Stat>
            </XStack>
          )}
        </XStack>
        {booking.note && (
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
            numberOfLines={2}
          >
            {booking.note}
          </Paragraph>
        )}
      </YStack>
    </Pressable>
  )
}

function StatusSheet({
  booking,
  onClose,
  onUpdateStatus,
  onDelete,
  busy,
}: {
  booking: BookingRow
  onClose: () => void
  onUpdateStatus: (s: BookingStatus) => void
  onDelete: () => void
  busy: boolean
}) {
  const transitions: Array<{ status: BookingStatus; label: string; color: string }> = [
    { status: 'confirmed', label: 'Konfirmasi', color: '#2563eb' },
    { status: 'in_progress', label: 'Mulai jalankan', color: '#92400e' },
    { status: 'completed', label: 'Selesai', color: COLORS.success },
    { status: 'no_show', label: 'Tidak hadir', color: COLORS.danger },
    { status: 'cancelled', label: 'Batalkan', color: COLORS.danger },
  ]
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
            {booking.publicName ?? 'Booking'}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          <YStack
            bg={COLORS.surfaceContainerLowest}
            br={14}
            p="$3"
            gap="$2"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <XStack ai="center" gap={4}>
              <Clock size={14} color={COLORS.onSurfaceVariant} />
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={13}
                color={COLORS.onSurface}
              >
                {fmtTime(booking.startAt)}
                {booking.endAt ? ` – ${fmtTime(booking.endAt)}` : ''}
              </Paragraph>
            </XStack>
            {booking.publicPhone && (
              <XStack ai="center" gap={4}>
                <Phone size={14} color={COLORS.onSurfaceVariant} />
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={13}
                  color={COLORS.onSurface}
                >
                  {booking.publicPhone}
                </Paragraph>
              </XStack>
            )}
            {booking.note && (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
                mt="$1"
              >
                Catatan: {booking.note}
              </Paragraph>
            )}
          </YStack>

          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
            mt="$2"
          >
            UBAH STATUS
          </Paragraph>

          {transitions.map((t) => (
            <Pressable
              key={t.status}
              onPress={() => onUpdateStatus(t.status)}
              disabled={booking.status === t.status || busy}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 10,
                borderWidth: 1,
                borderColor:
                  booking.status === t.status
                    ? COLORS.primary
                    : COLORS.borderSubtle,
                backgroundColor:
                  booking.status === t.status
                    ? COLORS.primaryFixed
                    : COLORS.surfaceContainerLowest,
                opacity: busy ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={t.color}
              >
                {t.label}
              </Paragraph>
              {booking.status === t.status && (
                <Check size={14} color={COLORS.primary} />
              )}
            </Pressable>
          ))}

          <Pressable
            onPress={onDelete}
            disabled={busy}
            style={{
              marginTop: 8,
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: COLORS.dangerTint,
              borderWidth: 1,
              borderColor: COLORS.danger,
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
              Hapus booking
            </Paragraph>
          </Pressable>
        </ScrollView>
      </YStack>
    </Modal>
  )
}

function CreateBookingModal({
  resources,
  services,
  dateYmd,
  onClose,
}: {
  resources: BookingResource[]
  services: BookingService[]
  dateYmd: string
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [time, setTime] = useState('09:00')
  const [resourceId, setResourceId] = useState<string | null>(
    resources[0]?.id ?? null,
  )
  const [selectedServices, setSelectedServices] = useState<Set<string>>(
    new Set(),
  )
  const [note, setNote] = useState('')
  const [picker, setPicker] = useState<null | 'resource' | 'service'>(null)
  const create = useCreateBooking()

  const customers = useSearchBookingCustomers(name, name.length >= 2)
  const [customerId, setCustomerId] = useState<string | null>(null)

  // Reset customer link if user edits name freely
  useEffect(() => {
    if (customerId) {
      const match = (customers.data ?? []).find((c) => c.id === customerId)
      if (!match) return // we still have a valid pick
      if (match.name !== name) setCustomerId(null)
    }
  }, [name, customerId, customers.data])

  async function submit() {
    if (!name.trim()) {
      Alert.alert('Nama wajib', 'Isi nama pelanggan.')
      return
    }
    if (!resourceId) {
      Alert.alert('Staff wajib', 'Pilih staff yang menangani.')
      return
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      Alert.alert('Jam tidak valid', 'Gunakan format 24-jam (mis. 09:30).')
      return
    }
    try {
      const startAt = `${dateYmd}T${time}:00`
      await create.mutateAsync({
        customerId: customerId ?? undefined,
        publicName: name.trim(),
        publicPhone: phone.trim() || undefined,
        startAt,
        resourceId,
        serviceIds: [...selectedServices],
        note: note.trim() || undefined,
        source: 'manual',
      })
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal buat booking',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  const resource = resources.find((r) => r.id === resourceId)
  const selectedServiceNames = services
    .filter((s) => selectedServices.has(s.id))
    .map((s) => s.name)

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
            Booking baru
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
            <FieldLabel>Nama pelanggan</FieldLabel>
            <TextInput
              value={name}
              onChangeText={(v) => {
                setName(v)
                setCustomerId(null)
              }}
              placeholder="Mis. Bu Vinna"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
            {customers.data && customers.data.length > 0 && !customerId && (
              <YStack gap={4}>
                {customers.data.slice(0, 3).map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      setName(c.name)
                      setPhone(c.phone ?? '')
                      setCustomerId(c.id)
                    }}
                  >
                    <XStack
                      ai="center"
                      gap="$2"
                      px="$3"
                      py="$2"
                      br={8}
                      bg={COLORS.surfaceContainerLowest}
                      borderWidth={1}
                      borderColor={COLORS.borderSubtle}
                    >
                      <User size={12} color={COLORS.primary} />
                      <Paragraph
                        fontFamily={FONTS.bodyMedium}
                        fontSize={12}
                        color={COLORS.onSurface}
                        flex={1}
                      >
                        {c.name}
                      </Paragraph>
                      {c.phone && (
                        <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                          {c.phone}
                        </Stat>
                      )}
                    </XStack>
                  </Pressable>
                ))}
              </YStack>
            )}

            <FieldLabel>Nomor HP (opsional)</FieldLabel>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="08xx"
              placeholderTextColor={COLORS.outline}
              keyboardType="phone-pad"
              style={inputStyle}
            />

            <FieldLabel>Jam mulai</FieldLabel>
            <TextInput
              value={time}
              onChangeText={setTime}
              placeholder="HH:MM"
              placeholderTextColor={COLORS.outline}
              maxLength={5}
              style={inputStyle}
            />

            <FieldLabel>Staff</FieldLabel>
            <Pressable onPress={() => setPicker('resource')}>
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
                  color={resource ? COLORS.onSurface : COLORS.outline}
                >
                  {resource?.name ?? 'Pilih staff'}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>

            <FieldLabel>{`Layanan (${selectedServices.size})`}</FieldLabel>
            <Pressable onPress={() => setPicker('service')}>
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
                  color={
                    selectedServices.size > 0 ? COLORS.onSurface : COLORS.outline
                  }
                  flex={1}
                  numberOfLines={1}
                >
                  {selectedServices.size === 0
                    ? 'Pilih layanan (opsional)'
                    : selectedServiceNames.join(', ')}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>

            <FieldLabel>Catatan (opsional)</FieldLabel>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Mis. minta tukang potong khusus"
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

            {customerId && (
              <XStack ai="center" gap="$2" bg={COLORS.primaryFixed} br={8} p="$2">
                <CheckCircle size={12} color={COLORS.primary} />
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={11}
                  color={COLORS.primary}
                  flex={1}
                >
                  Tertaut ke pelanggan database
                </Paragraph>
              </XStack>
            )}

            <Pressable
              onPress={submit}
              disabled={create.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: create.isPending
                  ? COLORS.outline
                  : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {create.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Simpan booking
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        {picker === 'resource' && (
          <PickList
            title="Pilih staff"
            items={resources.map((r) => ({ key: r.id, label: r.name }))}
            selectedKey={resourceId ?? ''}
            onClose={() => setPicker(null)}
            onSelect={(id) => {
              setResourceId(id)
              setPicker(null)
            }}
          />
        )}
        {picker === 'service' && (
          <PickMulti
            items={services.map((s) => ({
              key: s.id,
              label: s.name,
              sub:
                s.basePrice !== null
                  ? `Rp ${s.basePrice.toLocaleString('id-ID')}`
                  : undefined,
            }))}
            selected={selectedServices}
            onClose={() => setPicker(null)}
            onApply={(ids) => {
              setSelectedServices(ids)
              setPicker(null)
            }}
          />
        )}
      </YStack>
    </Modal>
  )
}

function PickList({
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
        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          {items.length === 0 ? (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              py="$6"
            >
              Belum ada pilihan.
            </Paragraph>
          ) : (
            items.map((it) => {
              const on = it.key === selectedKey
              return (
                <Pressable key={it.key} onPress={() => onSelect(it.key)}>
                  <XStack
                    ai="center"
                    jc="space-between"
                    p="$3"
                    br={10}
                    bg={
                      on
                        ? COLORS.primaryFixed
                        : COLORS.surfaceContainerLowest
                    }
                    borderWidth={1}
                    borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                  >
                    <Paragraph
                      fontFamily={FONTS.bodyMedium}
                      fontSize={14}
                      color={COLORS.onSurface}
                    >
                      {it.label}
                    </Paragraph>
                    {on && <Check size={16} color={COLORS.primary} />}
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

function PickMulti({
  items,
  selected,
  onClose,
  onApply,
}: {
  items: Array<{ key: string; label: string; sub?: string }>
  selected: Set<string>
  onClose: () => void
  onApply: (ids: Set<string>) => void
}) {
  const [local, setLocal] = useState<Set<string>>(new Set(selected))
  function toggle(k: string) {
    setLocal((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
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
            Pilih layanan
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          {items.length === 0 ? (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              py="$6"
            >
              Belum ada layanan. Tambah dari menu Inventaris.
            </Paragraph>
          ) : (
            items.map((it) => {
              const on = local.has(it.key)
              return (
                <Pressable key={it.key} onPress={() => toggle(it.key)}>
                  <XStack
                    ai="center"
                    jc="space-between"
                    p="$3"
                    br={10}
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
                        fontSize={14}
                        color={COLORS.onSurface}
                      >
                        {it.label}
                      </Paragraph>
                      {it.sub && (
                        <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                          {it.sub}
                        </Stat>
                      )}
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

// AlertCircle reserved for future "outside business hours" warnings.
const _AlertCircle = AlertCircle
