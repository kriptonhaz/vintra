/**
 * Attendance settings — mode toggles (GPS/photo/QR), QR rotation,
 * reminder windows (clock-in + clock-out, before/after, minutes).
 *
 * Saves split into 3 mutation buttons so partial saves don't blow
 * away unrelated state. Server enforces "at least one mode active".
 */
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  TextInput,
} from 'react-native'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  Clock,
  MapPin,
  QrCode,
} from '~/lib/icons'
import {
  useAttendanceOverview,
  useUpdateAttendanceReminders,
  useUpdateModeToggles,
  useUpdateQrRotation,
} from '~/lib/attendance'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function AttendanceSettingsScreen() {
  const overview = useAttendanceOverview()
  const updateModes = useUpdateModeToggles()
  const updateRotation = useUpdateQrRotation()
  const updateReminders = useUpdateAttendanceReminders()

  const settings = overview.data?.settings

  // ── Local state ───────────────────────────────────────────────────
  const [gps, setGps] = useState(true)
  const [photo, setPhoto] = useState(false)
  const [qr, setQr] = useState(false)
  const [qrSeconds, setQrSeconds] = useState('30')

  const [inEnabled, setInEnabled] = useState(false)
  const [inMinutes, setInMinutes] = useState('10')
  const [inDirection, setInDirection] = useState<'before' | 'after'>('before')
  const [outEnabled, setOutEnabled] = useState(false)
  const [outMinutes, setOutMinutes] = useState('10')
  const [outDirection, setOutDirection] = useState<'before' | 'after'>('after')

  useEffect(() => {
    if (!settings) return
    setGps(settings.modeGpsEnabled)
    setPhoto(settings.modePhotoEnabled)
    setQr(settings.modeQrEnabled)
    setQrSeconds(String(settings.qrRotationSeconds))
    setInEnabled(settings.clockinReminderEnabled)
    setInMinutes(String(settings.clockinReminderMinutes))
    setInDirection(settings.clockinReminderDirection)
    setOutEnabled(settings.clockoutReminderEnabled)
    setOutMinutes(String(settings.clockoutReminderMinutes))
    setOutDirection(settings.clockoutReminderDirection)
  }, [settings])

  async function saveModes() {
    if (!gps && !photo && !qr) {
      Alert.alert(
        'Minimal satu mode',
        'Pilih minimal satu metode verifikasi (GPS / Foto / QR).',
      )
      return
    }
    try {
      await updateModes.mutateAsync({ gps, photo, qr })
      Alert.alert('Tersimpan', 'Mode verifikasi diperbarui.')
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  async function saveRotation() {
    const sec = Math.max(15, Math.min(120, parseInt(qrSeconds, 10) || 30))
    try {
      await updateRotation.mutateAsync(sec)
      Alert.alert('Tersimpan', `Rotasi QR diatur ke ${sec} detik.`)
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  async function saveReminders() {
    const inMin = Math.max(1, Math.min(120, parseInt(inMinutes, 10) || 10))
    const outMin = Math.max(1, Math.min(120, parseInt(outMinutes, 10) || 10))
    try {
      await updateReminders.mutateAsync({
        clockinReminderEnabled: inEnabled,
        clockinReminderMinutes: inMin,
        clockinReminderDirection: inDirection,
        clockoutReminderEnabled: outEnabled,
        clockoutReminderMinutes: outMin,
        clockoutReminderDirection: outDirection,
      })
      Alert.alert('Tersimpan', 'Pengaturan pengingat diperbarui.')
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  if (overview.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pengaturan Absensi" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (overview.error) {
    const isForbidden =
      overview.error instanceof ApiError && overview.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pengaturan Absensi" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa edit pengaturan absensi.'
              : 'Gagal memuat pengaturan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Pengaturan Absensi"
        subtitle={`${overview.data?.staff.active ?? 0} staff aktif`}
        back
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}
          refreshControl={
            <RefreshControl
              refreshing={overview.isFetching}
              onRefresh={() => overview.refetch()}
              tintColor={COLORS.primary}
            />
          }
        >
          {/* Mode toggles */}
          <Section
            title="Metode Verifikasi"
            subtitle="Pilih cara staff verifikasi saat absen masuk/keluar."
          >
            <ModeRow
              icon={MapPin}
              label="GPS / Lokasi"
              hint="Staff harus berada di radius cabang."
              value={gps}
              onChange={setGps}
            />
            <ModeRow
              icon={Camera}
              label="Foto Selfie"
              hint="Staff ambil foto saat clock-in."
              value={photo}
              onChange={setPhoto}
            />
            <ModeRow
              icon={QrCode}
              label="QR Kiosk"
              hint="Scan QR rotating di kasir."
              value={qr}
              onChange={setQr}
            />
            <SaveButton
              busy={updateModes.isPending}
              onPress={saveModes}
            />
          </Section>

          {/* QR rotation */}
          {qr && (
            <Section
              title="Rotasi QR"
              subtitle="Berapa detik token QR diganti otomatis (15-120)."
            >
              <NumberInput
                value={qrSeconds}
                onChange={setQrSeconds}
                suffix="detik"
              />
              <SaveButton
                busy={updateRotation.isPending}
                onPress={saveRotation}
              />
            </Section>
          )}

          {/* Reminders */}
          <Section
            title="Pengingat"
            subtitle="Notifikasi otomatis untuk staff yang lupa clock-in/out."
          >
            <ReminderBlock
              label="Pengingat Clock-In"
              icon={Clock}
              enabled={inEnabled}
              onEnabledChange={setInEnabled}
              minutes={inMinutes}
              onMinutesChange={setInMinutes}
              direction={inDirection}
              onDirectionChange={setInDirection}
            />
            <YStack h={1} bg={COLORS.borderSubtle} my="$2" />
            <ReminderBlock
              label="Pengingat Clock-Out"
              icon={Clock}
              enabled={outEnabled}
              onEnabledChange={setOutEnabled}
              minutes={outMinutes}
              onMinutesChange={setOutMinutes}
              direction={outDirection}
              onDirectionChange={setOutDirection}
            />
            <SaveButton
              busy={updateReminders.isPending}
              onPress={saveReminders}
            />
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </YStack>
  )
}

// ─── Building blocks ───────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
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
      <YStack gap={2}>
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
      {children}
    </YStack>
  )
}

function ModeRow({
  icon: Icon,
  label,
  hint,
  value,
  onChange,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>
  label: string
  hint: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <XStack
      ai="center"
      gap="$3"
      bg={value ? COLORS.primaryFixed : COLORS.surface}
      br={12}
      p="$3"
      borderWidth={1}
      borderColor={value ? COLORS.primary : COLORS.borderSubtle}
    >
      <YStack
        w={36}
        h={36}
        br={10}
        bg={value ? '#fff' : COLORS.surfaceContainerLow}
        ai="center"
        jc="center"
      >
        <Icon size={16} color={value ? COLORS.primary : COLORS.outline} />
      </YStack>
      <YStack flex={1}>
        <Paragraph
          fontFamily={FONTS.bodySemi}
          fontSize={14}
          color={COLORS.onSurface}
        >
          {label}
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={11}
          color={COLORS.onSurfaceVariant}
        >
          {hint}
        </Paragraph>
      </YStack>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: COLORS.outline, true: COLORS.primary }}
        thumbColor="#fff"
      />
    </XStack>
  )
}

function ReminderBlock({
  label,
  icon: Icon,
  enabled,
  onEnabledChange,
  minutes,
  onMinutesChange,
  direction,
  onDirectionChange,
}: {
  label: string
  icon: React.ComponentType<{ size?: number; color?: string }>
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  minutes: string
  onMinutesChange: (v: string) => void
  direction: 'before' | 'after'
  onDirectionChange: (v: 'before' | 'after') => void
}) {
  return (
    <YStack gap="$2">
      <XStack ai="center" jc="space-between">
        <XStack ai="center" gap="$2">
          <Icon size={16} color={COLORS.primary} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={13}
            color={COLORS.onSurface}
          >
            {label}
          </Paragraph>
        </XStack>
        <Switch
          value={enabled}
          onValueChange={onEnabledChange}
          trackColor={{ false: COLORS.outline, true: COLORS.primary }}
          thumbColor="#fff"
        />
      </XStack>
      {enabled && (
        <YStack gap="$2">
          <XStack gap="$2">
            <Pressable
              onPress={() => onDirectionChange('before')}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 10,
                borderWidth: 1,
                borderColor:
                  direction === 'before'
                    ? COLORS.primary
                    : COLORS.borderSubtle,
                backgroundColor:
                  direction === 'before'
                    ? COLORS.primaryFixed
                    : COLORS.surface,
                alignItems: 'center',
              }}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.onSurface}
              >
                Sebelum
              </Paragraph>
            </Pressable>
            <Pressable
              onPress={() => onDirectionChange('after')}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 10,
                borderWidth: 1,
                borderColor:
                  direction === 'after'
                    ? COLORS.primary
                    : COLORS.borderSubtle,
                backgroundColor:
                  direction === 'after' ? COLORS.primaryFixed : COLORS.surface,
                alignItems: 'center',
              }}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.onSurface}
              >
                Sesudah
              </Paragraph>
            </Pressable>
          </XStack>
          <NumberInput value={minutes} onChange={onMinutesChange} suffix="menit" />
          <XStack ai="flex-start" gap="$2" bg={COLORS.warningTint} br={8} p="$2">
            <AlertCircle size={12} color="#92400e" />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color="#92400e"
              flex={1}
            >
              Fired {minutes || '0'} menit {direction === 'before' ? 'sebelum' : 'sesudah'}{' '}
              jadwal {label.includes('Out') ? 'pulang' : 'masuk'}.
            </Paragraph>
          </XStack>
        </YStack>
      )}
    </YStack>
  )
}

function NumberInput({
  value,
  onChange,
  suffix,
}: {
  value: string
  onChange: (v: string) => void
  suffix?: string
}) {
  return (
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
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, ''))}
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
      {suffix && (
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={12}
          color={COLORS.onSurfaceVariant}
        >
          {suffix}
        </Paragraph>
      )}
    </XStack>
  )
}

function SaveButton({
  busy,
  onPress,
}: {
  busy: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={{
        marginTop: 4,
        paddingVertical: 12,
        borderRadius: 10,
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
        <Paragraph fontFamily={FONTS.bodyBold} fontSize={13} color="#fff">
          Simpan
        </Paragraph>
      )}
    </Pressable>
  )
}
