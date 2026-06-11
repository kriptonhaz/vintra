/**
 * Absensi tab — splits between manager + staff views.
 *
 * The same tab serves two audiences with very different needs:
 *
 *   - Managers (`attendance.manage` permission): mirror the web's
 *     /attendance + /attendance/records — today summary tiles + a
 *     paginated records list scoped to the active outlet. Tenant
 *     owners land here.
 *   - Staff (no manage permission): the original check-in/out flow.
 *     Renders one of several states based on the combined (today-
 *     status, device-location) result:
 *       - loading / no-profile / no-branch / permission-denied
 *       - outside-geofence / inside-geofence
 *       - done-today
 *
 * The mobile staff view used to also catch the owner case (no staff
 * profile → "Akun staf belum dibuat"). Owners now route to the
 * manager view instead, matching the web's `/attendance` redirect.
 */
import { Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import {
  AlertTriangle,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  MapPin,
  Navigation,
  Store,
} from '~/lib/icons'
import { Paragraph, Spinner, XStack, YStack } from 'tamagui'
import {
  distanceToBranch,
  useTodayStatus,
  type AttendanceBranch,
  type AttendanceRecord,
} from '../../lib/attendance'
import { useDeviceLocation, type LocationStatus } from '../../lib/use-location'
import { useTenant } from '../../lib/tenant-context'
import { ManagerView } from '../../components/attendance/ManagerView'
import { COLORS, FONTS, SHADOWS } from '../../lib/theme'

export default function AbsensiTab() {
  const { hasPermission } = useTenant()

  // Owners + admins + report-viewers (e.g. supervisor) get the manager
  // view (today's stats + records). Server fns still re-check the
  // permission, so this client-side branch is purely a UX router.
  if (
    hasPermission('attendance.manage') ||
    hasPermission('attendance.report')
  ) {
    return <ManagerView />
  }

  return <StaffAbsensi />
}

function StaffAbsensi() {
  const router = useRouter()
  const today = useTodayStatus()
  const { status: locStatus, refresh: refreshLoc } = useDeviceLocation()

  // ── Loading / hard-error gates ─────────────────────────────────────
  if (today.isLoading) {
    return (
      <StaffShell>
        <YStack flex={1} ai="center" jc="center">
          <Spinner size="large" color={COLORS.primary} />
        </YStack>
      </StaffShell>
    )
  }
  if (today.error) {
    return (
      <StaffShell>
        <ErrorState
          message={
            today.error instanceof Error
              ? today.error.message
              : 'Gagal memuat status absensi.'
          }
          onRetry={() => today.refetch()}
        />
      </StaffShell>
    )
  }

  const data = today.data!

  // ── Setup gates: profile + branch must exist before location matters
  if (!data.hasProfile || !data.profile) {
    return (
      <StaffShell>
        <EmptyState
          icon={<Calendar size={40} color={COLORS.primary} />}
          title="Akun staf belum dibuat"
          body="Hubungi owner untuk menambahkanmu sebagai staf di modul Absensi."
        />
      </StaffShell>
    )
  }
  if (!data.branch || !data.profile.branchId) {
    return (
      <StaffShell>
        <EmptyState
          icon={<MapPin size={40} color={COLORS.primary} />}
          title="Belum ditugaskan ke cabang"
          body="Owner perlu menugaskanmu ke salah satu cabang sebelum kamu bisa check-in."
        />
      </StaffShell>
    )
  }

  // ── Today's record — decide if next action is in / out / done ──────
  const rec = data.todayRecord
  const nextAction = decideNextAction(rec)

  if (nextAction === 'done') {
    return (
      <StaffShell branchName={data.branch.name}>
        <YStack flex={1} p="$4" gap="$3">
          <SuccessSummary record={rec!} />
          <YStack flex={1} />
          <HistoryLink onPress={() => router.push('/attendance/history')} />
        </YStack>
      </StaffShell>
    )
  }

  // ── Location resolution — needed to show distance + enable submit ──
  return (
    <StaffShell branchName={data.branch.name}>
      <YStack flex={1} p="$4" gap="$3">
        <LocationCard
          locStatus={locStatus}
          branch={data.branch}
          onRetry={refreshLoc}
        />
        <ActionButton
          locStatus={locStatus}
          branch={data.branch}
          nextAction={nextAction}
          onPress={() => router.push('/attendance/capture')}
        />
        {rec && nextAction === 'check-out' && <OpenCheckInSummary record={rec} />}
        <YStack flex={1} />
        <HistoryLink onPress={() => router.push('/attendance/history')} />
      </YStack>
    </StaffShell>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────

/**
 * Brand-green header strip + content surface. Mirrors ManagerView's
 * chrome so the two tab modes feel like one screen. `branchName` is
 * surfaced as a chip under the title for context — omitted on early
 * states where the branch isn't loaded yet.
 */
function StaffShell({
  branchName,
  children,
}: {
  branchName?: string | null
  children: React.ReactNode
}) {
  return (
    <YStack flex={1} bg={COLORS.background}>
      <YStack bg={COLORS.primary} pt={60} pb="$4" px="$5" gap="$1.5">
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={12}
          color="white"
          opacity={0.85}
        >
          Absensi Saya
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={24}
          color="white"
        >
          Absensi
        </Paragraph>
        {branchName && (
          <XStack ai="center" gap="$1.5" mt="$1">
            <Store size={12} color="white" />
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={11}
              color="white"
              opacity={0.9}
              numberOfLines={1}
            >
              {branchName}
            </Paragraph>
          </XStack>
        )}
      </YStack>
      {children}
    </YStack>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────

/**
 * White-surface card with soft shadow, subtle border, and an optional
 * left-edge accent stripe for status-coloring (matches the manager
 * tile chrome).
 */
function StatusCard({
  accent,
  children,
}: {
  accent?: string
  children: React.ReactNode
}) {
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={18}
      p="$4"
      gap="$3"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
      overflow="hidden"
      position="relative"
    >
      {accent && (
        <YStack
          position="absolute"
          top={0}
          bottom={0}
          left={0}
          w={3}
          bg={accent}
        />
      )}
      {children}
    </YStack>
  )
}

function LocationCard({
  locStatus,
  branch,
  onRetry,
}: {
  locStatus: LocationStatus
  branch: AttendanceBranch
  onRetry: () => void
}) {
  if (
    locStatus.kind === 'idle' ||
    locStatus.kind === 'requesting-permission' ||
    locStatus.kind === 'fetching'
  ) {
    const label =
      locStatus.kind === 'fetching'
        ? 'Mengambil lokasi GPS...'
        : 'Meminta izin lokasi...'
    return (
      <StatusCard>
        <XStack ai="center" gap="$3">
          <YStack
            w={40}
            h={40}
            br={14}
            bg={COLORS.surfaceContainerLow}
            ai="center"
            jc="center"
          >
            <Spinner color={COLORS.primary} />
          </YStack>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={14}
            color={COLORS.onSurface}
            flex={1}
          >
            {label}
          </Paragraph>
        </XStack>
      </StatusCard>
    )
  }

  if (locStatus.kind === 'permission-denied' || locStatus.kind === 'error') {
    const isPerm = locStatus.kind === 'permission-denied'
    return (
      <StatusCard accent={COLORS.danger}>
        <XStack ai="center" gap="$3">
          <YStack
            w={40}
            h={40}
            br={14}
            bg={COLORS.dangerTint}
            ai="center"
            jc="center"
          >
            <AlertTriangle size={20} color={COLORS.danger} />
          </YStack>
          <YStack flex={1} gap={2}>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={15}
              color={COLORS.onSurface}
            >
              {isPerm ? 'Izinkan lokasi dulu' : 'Gagal ambil lokasi'}
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={COLORS.onSurfaceVariant}
              lineHeight={17}
            >
              {isPerm
                ? 'Check-in butuh GPS untuk memastikan kamu di cabang. Buka pengaturan aplikasi → Lokasi → Izinkan untuk Vintra.'
                : locStatus.kind === 'error'
                  ? locStatus.message
                  : ''}
            </Paragraph>
          </YStack>
        </XStack>
        <Pressable onPress={onRetry}>
          <YStack
            bg={COLORS.primary}
            br={9999}
            py="$2.5"
            ai="center"
            jc="center"
          >
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={13}
              color="white"
            >
              {isPerm ? 'Minta Izin Lagi' : 'Coba Lagi'}
            </Paragraph>
          </YStack>
        </Pressable>
      </StatusCard>
    )
  }

  // ready
  const dist = distanceToBranch(
    { lat: locStatus.lat, lng: locStatus.lng },
    branch,
  )
  const inside = dist <= branch.radiusMeters
  const distLabel =
    dist < 1000
      ? `${Math.round(dist)} m`
      : `${(dist / 1000).toFixed(2)} km`
  const tint = inside ? COLORS.successTint : COLORS.warningTint
  const fg = inside ? COLORS.success : COLORS.warning
  const Icon = inside ? CheckCircle2 : Navigation

  return (
    <StatusCard accent={fg}>
      <XStack ai="center" gap="$3">
        <YStack w={40} h={40} br={14} bg={tint} ai="center" jc="center">
          <Icon size={20} color={fg} />
        </YStack>
        <YStack flex={1} gap={2}>
          <Paragraph
            fontFamily={FONTS.headingBold}
            fontSize={15}
            color={COLORS.onSurface}
          >
            {inside
              ? 'Kamu di lokasi cabang'
              : `Kamu ${distLabel} dari cabang`}
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
            lineHeight={17}
          >
            {inside
              ? `Jarak: ${distLabel} (radius diizinkan ${branch.radiusMeters} m). Siap check-in.`
              : `Mendekat ke cabang dulu — radius check-in: ${branch.radiusMeters} m.`}
          </Paragraph>
        </YStack>
      </XStack>
      {locStatus.accuracyMeters && locStatus.accuracyMeters > 50 && (
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={11}
          color={COLORS.outline}
        >
          Akurasi GPS: ±{Math.round(locStatus.accuracyMeters)} m — pindah ke
          luar ruangan untuk hasil lebih tepat.
        </Paragraph>
      )}
    </StatusCard>
  )
}

function ActionButton({
  locStatus,
  branch,
  nextAction,
  onPress,
}: {
  locStatus: LocationStatus
  branch: AttendanceBranch
  nextAction: 'check-in' | 'check-out'
  onPress: () => void
}) {
  const ready = locStatus.kind === 'ready'
  const inside =
    ready &&
    distanceToBranch({ lat: locStatus.lat, lng: locStatus.lng }, branch) <=
      branch.radiusMeters
  const disabled = !ready || !inside

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{ opacity: disabled ? 0.55 : 1 }}
    >
      <XStack
        ai="center"
        jc="center"
        gap="$2"
        bg={COLORS.primary}
        br={9999}
        h={56}
        style={SHADOWS.card}
      >
        <Camera size={20} color="white" />
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={15}
          color="white"
        >
          {nextAction === 'check-in'
            ? 'Check-In dengan Selfie'
            : 'Check-Out dengan Selfie'}
        </Paragraph>
      </XStack>
    </Pressable>
  )
}

function OpenCheckInSummary({ record }: { record: AttendanceRecord }) {
  return (
    <StatusCard accent={COLORS.success}>
      <XStack ai="center" gap="$3">
        <YStack
          w={40}
          h={40}
          br={14}
          bg={COLORS.primaryFixed}
          ai="center"
          jc="center"
        >
          <Clock size={20} color={COLORS.primary} />
        </YStack>
        <YStack flex={1} gap={2}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={10}
            color={COLORS.outline}
            letterSpacing={0.5}
          >
            SUDAH CHECK-IN
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.headingBold}
            fontSize={18}
            color={COLORS.onSurface}
          >
            Masuk {formatJakartaTime(record.clockInAt)}
          </Paragraph>
          {record.clockInStatus && (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={COLORS.onSurfaceVariant}
            >
              Status: {record.clockInStatus}
            </Paragraph>
          )}
        </YStack>
      </XStack>
    </StatusCard>
  )
}

function SuccessSummary({ record }: { record: AttendanceRecord }) {
  return (
    <StatusCard accent={COLORS.success}>
      <XStack ai="center" gap="$3">
        <YStack
          w={40}
          h={40}
          br={14}
          bg={COLORS.successTint}
          ai="center"
          jc="center"
        >
          <CheckCircle2 size={20} color={COLORS.success} />
        </YStack>
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.headingBold}
            fontSize={16}
            color={COLORS.onSurface}
          >
            Kehadiran hari ini selesai
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
          >
            Lihat catatan lagi besok ya.
          </Paragraph>
        </YStack>
      </XStack>

      <YStack h={1} bg={COLORS.borderSubtle} />

      <XStack gap="$3">
        <TimeCol label="MASUK" value={formatJakartaTime(record.clockInAt)} />
        <TimeCol label="PULANG" value={formatJakartaTime(record.clockOutAt)} />
      </XStack>
    </StatusCard>
  )
}

function TimeCol({ label, value }: { label: string; value: string }) {
  return (
    <YStack flex={1} gap={2}>
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={9}
        color={COLORS.outline}
        letterSpacing={0.4}
      >
        {label}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.monoMedium}
        fontSize={18}
        color={COLORS.onSurface}
      >
        {value}
      </Paragraph>
    </YStack>
  )
}

function HistoryLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <XStack
        ai="center"
        jc="center"
        gap="$2"
        bg={COLORS.surfaceContainerLowest}
        br={9999}
        h={48}
        borderWidth={1}
        borderColor={COLORS.outlineVariant}
      >
        <Calendar size={16} color={COLORS.primary} />
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={14}
          color={COLORS.onSurface}
        >
          Lihat Riwayat 30 Hari
        </Paragraph>
      </XStack>
    </Pressable>
  )
}

// ─── States ──────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <YStack flex={1} ai="center" jc="center" p="$6" gap="$3">
      <YStack
        w={88}
        h={88}
        br={44}
        bg={COLORS.primaryFixed}
        ai="center"
        jc="center"
      >
        {icon}
      </YStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        color={COLORS.onSurface}
        ta="center"
      >
        {title}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        lineHeight={20}
        color={COLORS.onSurfaceVariant}
        ta="center"
        maxWidth={280}
      >
        {body}
      </Paragraph>
    </YStack>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <YStack flex={1} ai="center" jc="center" p="$6" gap="$3">
      <YStack
        w={88}
        h={88}
        br={44}
        bg={COLORS.dangerTint}
        ai="center"
        jc="center"
      >
        <AlertTriangle size={40} color={COLORS.danger} />
      </YStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        color={COLORS.onSurface}
        ta="center"
      >
        Gagal memuat absensi
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        lineHeight={20}
        color={COLORS.onSurfaceVariant}
        ta="center"
        maxWidth={280}
      >
        {message}
      </Paragraph>
      <Pressable onPress={onRetry}>
        <YStack
          bg={COLORS.primary}
          br={9999}
          px="$5"
          py="$2.5"
          mt="$2"
        >
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={14}
            color="white"
          >
            Coba Lagi
          </Paragraph>
        </YStack>
      </Pressable>
    </YStack>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

function decideNextAction(
  record: AttendanceRecord | null,
): 'check-in' | 'check-out' | 'done' {
  if (!record || !record.clockInAt) return 'check-in'
  if (!record.clockOutAt) return 'check-out'
  return 'done'
}

/** Format an ISO timestamp as Jakarta-local HH:mm. */
function formatJakartaTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
