/**
 * Manager-side attendance view for the (tabs)/absensi tab.
 *
 * Mirrors the web's `/attendance` + `/attendance/records` screens but
 * trimmed for a single phone column:
 *   1. Today summary strip (Hadir / Terlambat / Belum). On scheduled
 *      branches we also show On-time vs Late instead of plain "Hadir".
 *   2. Filter row — date range (this month default), staff picker.
 *   3. Records list — newest first, paginated; tap a row to expand
 *      photos + notes inline.
 *
 * Branch scope tracks the global outlet switcher (apps/mobile/src/lib/
 * outlet-context.tsx), matching how the web ties stats + records to
 * the topbar branch picker.
 *
 * Access: rendered when the current member has `attendance.manage` or
 * `attendance.report` (supervisor-style read-only). The server fns
 * enforce the same OR on every list/stats endpoint — defence in depth.
 *
 * For users who can ALSO check in themselves (have `attendance.write` +
 * a staff_profile row), a compact "Absensi Saya" card surfaces at the
 * top with a quick check-in / check-out CTA — so a supervisor doesn't
 * need to switch screens to do their own clock.
 */
import { useMemo, useState } from 'react'
import {
  Dimensions,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Image, Paragraph, Sheet, Spinner, XStack, YStack } from 'tamagui'
import {
  AlertCircle,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  Clock,
  MapPin,
  Navigation,
  Store,
  UserMinus,
  Users,
  X,
} from '~/lib/icons'
import {
  useAttendanceDashboardStats,
  useAttendanceRecords,
  useAttendanceStaff,
  useTodayStatus,
  type AttendanceRecordRow,
  type AttendanceStaffRow,
  type TodayStatus,
} from '../../lib/attendance'
import { useOutlet } from '../../lib/outlet-context'
import { useTenant } from '../../lib/tenant-context'
import { COLORS, FONTS, SHADOWS } from '../../lib/theme'

// ─── Date helpers (Jakarta-anchored, matches web) ──────────────────

function jakartaToday(): Date {
  // The device clock is the source of truth; we just want a Date that
  // represents "now in Jakarta wall-clock time" for the YYYY-MM-DD
  // strings the API expects.
  return new Date()
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function formatJakartaDate(yyyymmdd: string): string {
  try {
    const d = new Date(yyyymmdd + 'T00:00:00+07:00')
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(d)
  } catch {
    return yyyymmdd
  }
}

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

// ─── Status helpers ────────────────────────────────────────────────

type StatusKind = 'on-time' | 'late' | 'present' | 'open' | 'unknown'

function deriveStatusKind(r: AttendanceRecordRow): StatusKind {
  if (!r.clockInAt) return 'unknown'
  const s = (r.clockInStatus ?? '').toLowerCase()
  if (s === 'late') return 'late'
  if (s === 'on_time') return 'on-time'
  if (s === 'present') return 'present'
  if (!r.clockOutAt) return 'open'
  return 'present'
}

function statusLabel(kind: StatusKind, hasClockOut: boolean): string {
  if (kind === 'on-time') return 'Tepat waktu'
  if (kind === 'late') return 'Terlambat'
  if (kind === 'present') return hasClockOut ? 'Hadir' : 'Masuk'
  if (kind === 'open') return 'Belum keluar'
  return 'Tidak hadir'
}

function statusColor(kind: StatusKind): { bg: string; fg: string } {
  if (kind === 'on-time')
    return { bg: COLORS.successTint, fg: COLORS.success }
  if (kind === 'late')
    return { bg: COLORS.warningTint, fg: COLORS.warning }
  if (kind === 'present')
    return { bg: COLORS.successTint, fg: COLORS.success }
  if (kind === 'open')
    return { bg: COLORS.infoTint, fg: COLORS.info }
  return { bg: COLORS.surfaceContainerHigh, fg: COLORS.outline }
}

// ─── Tile filter ───────────────────────────────────────────────────

type TileFilterKind =
  | 'hadir'
  | 'belum'
  | 'pulang'
  | 'on-time'
  | 'late'

const TILE_FILTER_LABELS: Record<TileFilterKind, string> = {
  hadir: 'Hadir',
  belum: 'Belum hadir',
  pulang: 'Sudah pulang',
  'on-time': 'Tepat waktu',
  late: 'Terlambat',
}

function matchesTileFilter(r: AttendanceRecordRow, kind: TileFilterKind): boolean {
  const status = (r.clockInStatus ?? '').toLowerCase()
  if (kind === 'hadir') return !!r.clockInAt
  if (kind === 'belum') return !r.clockInAt
  if (kind === 'pulang') return !!r.clockOutAt
  if (kind === 'on-time') return status === 'on_time' || status === 'present'
  if (kind === 'late') return status === 'late'
  return true
}

// ─── Main view ─────────────────────────────────────────────────────

export function ManagerView() {
  const router = useRouter()
  const { hasPermission } = useTenant()
  const { selectedBranchId, selectedBranch, branches } = useOutlet()
  const today = useMemo(() => jakartaToday(), [])
  const [from, setFrom] = useState(() => toYmd(startOfMonth(today)))
  const [to, setTo] = useState(() => toYmd(today))
  const [staffId, setStaffId] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [tileFilter, setTileFilter] = useState<TileFilterKind | null>(null)
  // Fullscreen photo viewer state. Holding a URL here keeps the modal
  // logic at the ManagerView root, so a single Modal element handles
  // every row's photo without each RecordCard needing its own copy.
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)

  // Self check-in surface — only fetched when this user can clock in. For
  // pure report-viewers (no `attendance.write` or no staff profile) the
  // card is hidden, so the query stays disabled.
  const canClockIn = hasPermission('attendance.write')
  const selfStatus = useTodayStatus({ enabled: canClockIn })
  const showSelfCard =
    canClockIn && !!selfStatus.data?.hasProfile && !!selfStatus.data?.branch

  const statsQuery = useAttendanceDashboardStats(selectedBranchId)
  const recordsQuery = useAttendanceRecords({
    from,
    to,
    staffId: staffId ?? undefined,
    branchId: selectedBranchId ?? undefined,
    page: 1,
    pageSize: 30,
  })
  // Staff roster — only consumed when "belum hadir" filter is active, to
  // derive the absent list = active staff in branch minus staff who have a
  // record with clockInAt. Cached 5 min, so this is cheap even if the
  // filter is never toggled.
  const staffQuery = useAttendanceStaff()

  const refreshing =
    (statsQuery.isFetching && !statsQuery.isLoading) ||
    (recordsQuery.isFetching && !recordsQuery.isLoading)

  const onRefresh = () => {
    void statsQuery.refetch()
    void recordsQuery.refetch()
  }

  const rawRecords = recordsQuery.data?.records ?? []
  const records = tileFilter
    ? rawRecords.filter((r) => matchesTileFilter(r, tileFilter))
    : rawRecords

  // Absent-staff derivation. Only meaningful when the date range is today,
  // since "belum hadir" is inherently a today-only concept.
  const todayYmd = toYmd(jakartaToday())
  const isTodayRange = from === todayYmd && to === todayYmd
  const absentStaff = useMemo<AttendanceStaffRow[]>(() => {
    if (tileFilter !== 'belum' || !isTodayRange) return []
    const staff = staffQuery.data ?? []
    const attendedIds = new Set(
      rawRecords.filter((r) => !!r.clockInAt).map((r) => r.staffId),
    )
    return staff
      .filter((s) => s.isActive)
      .filter((s) => !selectedBranchId || s.branchId === selectedBranchId)
      .filter((s) => !attendedIds.has(s.id))
  }, [tileFilter, isTodayRange, staffQuery.data, rawRecords, selectedBranchId])

  const totalCount =
    tileFilter === 'belum' && isTodayRange
      ? absentStaff.length
      : tileFilter
        ? records.length
        : (recordsQuery.data?.totalCount ?? 0)

  // Tapping a tile narrows the date range to today and applies the
  // matching client-side filter; tapping the same tile again clears it.
  function onTilePress(kind: TileFilterKind) {
    const ymd = toYmd(jakartaToday())
    setFrom(ymd)
    setTo(ymd)
    setTileFilter((cur) => (cur === kind ? null : kind))
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      {/* HEADER */}
      <YStack bg={COLORS.primary} pt={60} pb="$4" px="$5" gap="$1.5">
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={12}
          color="white"
          opacity={0.85}
        >
          Ringkasan Kehadiran
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={24}
          color="white"
        >
          Absensi
        </Paragraph>
        {selectedBranch && branches.length > 1 && (
          <XStack ai="center" gap="$1.5" mt="$1">
            <Store size={12} color="white" />
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={11}
              color="white"
              opacity={0.9}
              numberOfLines={1}
            >
              {selectedBranch.name}
            </Paragraph>
          </XStack>
        )}
      </YStack>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* SELF CHECK-IN — only when this user is also on the staff roster */}
        {showSelfCard && (
          <YStack px="$4" pt="$4">
            <SelfCheckInCard
              today={selfStatus.data!}
              onPress={() => router.push('/attendance/capture')}
              onHistoryPress={() => router.push('/attendance/history')}
            />
          </YStack>
        )}

        {/* SUMMARY TILES */}
        <YStack px="$4" pt="$4" gap="$2.5">
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
            textTransform="uppercase"
          >
            Hari ini
          </Paragraph>
          {statsQuery.isLoading ? (
            <YStack
              ai="center"
              jc="center"
              h={88}
              bg={COLORS.surfaceContainerLow}
              br="$4"
            >
              <Spinner color={COLORS.primary} />
            </YStack>
          ) : statsQuery.isError ? (
            <YStack
              ai="center"
              jc="center"
              h={88}
              bg={COLORS.dangerTint}
              br="$4"
              p="$3"
            >
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.error}
                ta="center"
              >
                Gagal memuat ringkasan
              </Paragraph>
            </YStack>
          ) : (
            <SummaryTiles
              stats={statsQuery.data!}
              activeKind={tileFilter}
              onTilePress={onTilePress}
            />
          )}
        </YStack>

        {/* FILTERS */}
        <YStack px="$4" pt="$4" gap="$2">
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
            textTransform="uppercase"
          >
            Riwayat
          </Paragraph>
          <Pressable onPress={() => setFilterOpen(true)}>
            <XStack
              ai="center"
              gap="$2"
              bg={COLORS.surfaceContainerLow}
              br={9999}
              px="$3.5"
              h={44}
              borderWidth={1}
              borderColor={COLORS.outlineVariant}
            >
              <Calendar size={16} color={COLORS.primary} />
              <YStack flex={1}>
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={13}
                  color={COLORS.onSurface}
                  numberOfLines={1}
                >
                  {formatJakartaDate(from)} – {formatJakartaDate(to)}
                  {staffId ? ' · 1 staf' : ''}
                </Paragraph>
              </YStack>
              <ChevronDown size={16} color={COLORS.outline} />
            </XStack>
          </Pressable>
          {tileFilter && (
            <Pressable onPress={() => setTileFilter(null)}>
              <XStack
                ai="center"
                gap="$1.5"
                alignSelf="flex-start"
                bg={COLORS.primaryFixed}
                br={9999}
                px="$2.5"
                py="$1.5"
                borderWidth={1}
                borderColor={COLORS.primary}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={11}
                  color={COLORS.primary}
                >
                  {TILE_FILTER_LABELS[tileFilter]}
                </Paragraph>
                <X size={12} color={COLORS.primary} />
              </XStack>
            </Pressable>
          )}
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            {recordsQuery.isLoading
              ? 'Memuat...'
              : `${totalCount} catatan${!tileFilter && totalCount > 30 ? ' · menampilkan 30 terbaru' : ''}`}
          </Paragraph>
        </YStack>

        {/* RECORDS LIST */}
        <YStack px="$4" pt="$3" gap="$2">
          {tileFilter === 'belum' ? (
            !isTodayRange ? (
              <YStack ai="center" jc="center" py="$10" gap="$2">
                <Calendar size={36} color={COLORS.outline} />
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  Hanya tersedia untuk hari ini
                </Paragraph>
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={12}
                  color={COLORS.onSurfaceVariant}
                  ta="center"
                  maxWidth={280}
                >
                  Daftar "belum hadir" dihitung dari roster staf, jadi hanya
                  bermakna untuk tanggal hari ini.
                </Paragraph>
              </YStack>
            ) : staffQuery.isLoading || recordsQuery.isLoading ? (
              <YStack ai="center" jc="center" py="$10">
                <Spinner color={COLORS.primary} />
              </YStack>
            ) : staffQuery.isError ? (
              <RecordsError
                message={
                  staffQuery.error instanceof Error
                    ? staffQuery.error.message
                    : 'Gagal memuat daftar staf.'
                }
                onRetry={() => staffQuery.refetch()}
              />
            ) : absentStaff.length === 0 ? (
              <YStack ai="center" jc="center" py="$10" gap="$2">
                <Check size={36} color={COLORS.success} />
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  Semua sudah hadir
                </Paragraph>
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={12}
                  color={COLORS.onSurfaceVariant}
                  ta="center"
                  maxWidth={260}
                >
                  Tidak ada staf aktif yang belum check-in hari ini.
                </Paragraph>
              </YStack>
            ) : (
              absentStaff.map((s) => <AbsentStaffCard key={s.id} staff={s} />)
            )
          ) : recordsQuery.isLoading ? (
            <YStack ai="center" jc="center" py="$10">
              <Spinner color={COLORS.primary} />
            </YStack>
          ) : recordsQuery.isError ? (
            <RecordsError
              message={
                recordsQuery.error instanceof Error
                  ? recordsQuery.error.message
                  : 'Gagal memuat catatan absensi.'
              }
              onRetry={() => recordsQuery.refetch()}
            />
          ) : records.length === 0 ? (
            <YStack ai="center" jc="center" py="$10" gap="$2">
              <Calendar size={36} color={COLORS.outline} />
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={14}
                color={COLORS.onSurface}
              >
                Belum ada absensi
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
                ta="center"
                maxWidth={260}
              >
                Tidak ada catatan untuk rentang tanggal & filter yang dipilih.
              </Paragraph>
            </YStack>
          ) : (
            records.map((r) => (
              <RecordCard
                key={r.id}
                record={r}
                onViewPhoto={setViewerUrl}
              />
            ))
          )}
        </YStack>
      </ScrollView>

      {/* FILTER SHEET */}
      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        from={from}
        to={to}
        staffId={staffId}
        onApply={(next) => {
          setFrom(next.from)
          setTo(next.to)
          setStaffId(next.staffId)
          setFilterOpen(false)
        }}
      />

      {/* FULLSCREEN PHOTO VIEWER */}
      <PhotoViewer url={viewerUrl} onClose={() => setViewerUrl(null)} />
    </YStack>
  )
}

// ─── Summary tiles ─────────────────────────────────────────────────

function SummaryTiles({
  stats,
  activeKind,
  onTilePress,
}: {
  stats: NonNullable<ReturnType<typeof useAttendanceDashboardStats>['data']>
  activeKind: TileFilterKind | null
  onTilePress: (kind: TileFilterKind) => void
}) {
  const { today, hasScheduledBranch } = stats
  // Scheduled branches: split on-time vs late. Simple branches: just
  // show plain "Hadir" so the tile copy isn't lying about a schedule
  // that doesn't exist.
  const tiles: {
    kind: TileFilterKind
    label: string
    value: number
    icon: React.ReactNode
    tint: string
    fg: string
  }[] = hasScheduledBranch
    ? [
        {
          kind: 'on-time',
          label: 'Tepat waktu',
          value: today.onTime,
          icon: <Check size={18} color={COLORS.success} />,
          tint: COLORS.successTint,
          fg: COLORS.success,
        },
        {
          kind: 'late',
          label: 'Terlambat',
          value: today.late,
          icon: <Clock size={18} color={COLORS.warning} />,
          tint: COLORS.warningTint,
          fg: COLORS.warning,
        },
        {
          kind: 'belum',
          label: 'Belum hadir',
          value: today.absent,
          icon: <UserMinus size={18} color={COLORS.danger} />,
          tint: COLORS.dangerTint,
          fg: COLORS.danger,
        },
      ]
    : [
        {
          kind: 'hadir',
          label: 'Hadir',
          value: today.presentToday,
          icon: <Check size={18} color={COLORS.success} />,
          tint: COLORS.successTint,
          fg: COLORS.success,
        },
        {
          kind: 'belum',
          label: 'Belum',
          value: today.absent,
          icon: <UserMinus size={18} color={COLORS.danger} />,
          tint: COLORS.dangerTint,
          fg: COLORS.danger,
        },
        {
          kind: 'pulang',
          label: 'Sudah pulang',
          value: today.clockedOut,
          icon: <Users size={18} color={COLORS.outline} />,
          tint: COLORS.surfaceContainerHigh,
          fg: COLORS.onSurfaceVariant,
        },
      ]

  return (
    <XStack gap="$2.5">
      {tiles.map((tile) => {
        const active = activeKind === tile.kind
        return (
          <Pressable
            key={tile.kind}
            onPress={() => onTilePress(tile.kind)}
            style={{ flex: 1 }}
          >
            <YStack
              bg={COLORS.surfaceContainerLowest}
              br={18}
              p="$3"
              gap="$2"
              borderWidth={1}
              borderColor={active ? tile.fg : COLORS.borderSubtle}
              style={SHADOWS.card}
              overflow="hidden"
              position="relative"
            >
              {/* Accent stripe — color-coded to the tile's status */}
              <YStack
                position="absolute"
                top={0}
                bottom={0}
                left={0}
                w={active ? 5 : 3}
                bg={tile.fg}
              />
              <XStack ai="center" gap="$2">
                <YStack
                  w={32}
                  h={32}
                  br={10}
                  bg={tile.tint}
                  ai="center"
                  jc="center"
                >
                  {tile.icon}
                </YStack>
                <Paragraph
                  fontFamily={FONTS.headingBold}
                  fontSize={26}
                  lineHeight={30}
                  color={tile.fg}
                >
                  {tile.value}
                </Paragraph>
              </XStack>
              <YStack gap={1}>
                <Paragraph
                  fontFamily={FONTS.bodySemi}
                  fontSize={11}
                  color={COLORS.onSurface}
                  numberOfLines={1}
                >
                  {tile.label}
                </Paragraph>
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={10}
                  color={COLORS.onSurfaceVariant}
                  numberOfLines={1}
                >
                  dari {today.totalActiveStaff} staf
                </Paragraph>
              </YStack>
            </YStack>
          </Pressable>
        )
      })}
    </XStack>
  )
}

// ─── Self check-in (for managers who are also on the roster) ───────

/**
 * Compact "Absensi Saya" card surfaced at the top of the ManagerView for
 * users who can both view the report AND check in themselves (e.g.
 * supervisors). Shows their current clock state — Belum / Sedang shift /
 * Selesai — with the right CTA. Tapping the CTA routes to the existing
 * selfie capture flow at /attendance/capture, so this is just a shortcut
 * — no duplicated business logic.
 */
function SelfCheckInCard({
  today,
  onPress,
  onHistoryPress,
}: {
  today: TodayStatus
  onPress: () => void
  onHistoryPress: () => void
}) {
  const record = today.todayRecord
  const checkedIn = !!record?.clockInAt
  const checkedOut = !!record?.clockOutAt
  const status: 'pending' | 'in' | 'done' = !checkedIn
    ? 'pending'
    : !checkedOut
      ? 'in'
      : 'done'

  const dotColor =
    status === 'pending'
      ? COLORS.warning
      : status === 'in'
        ? COLORS.success
        : COLORS.outline
  const title =
    status === 'pending'
      ? 'Belum absen'
      : status === 'in'
        ? 'Sedang shift'
        : 'Shift selesai'
  const sub =
    status === 'pending'
      ? 'Tap untuk check-in dengan selfie'
      : status === 'in'
        ? `Masuk ${formatJakartaTime(record!.clockInAt)} — tap untuk check-out`
        : `${formatJakartaTime(record!.clockInAt)} → ${formatJakartaTime(record!.clockOutAt)}`

  const ctaLabel =
    status === 'pending'
      ? 'Check-In'
      : status === 'in'
        ? 'Check-Out'
        : 'Lihat Riwayat'
  const ctaOnPress = status === 'done' ? onHistoryPress : onPress
  const ctaBg = status === 'done' ? COLORS.surfaceContainerLow : COLORS.primary
  const ctaFg = status === 'done' ? COLORS.onSurface : 'white'

  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={18}
      p="$3.5"
      gap="$3"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
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
            fontFamily={FONTS.bodySemi}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
          >
            Absensi Saya
          </Paragraph>
          <XStack ai="center" gap="$2">
            <YStack w={9} h={9} br={9999} bg={dotColor} />
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={16}
              color={COLORS.onSurface}
              numberOfLines={1}
              flexShrink={1}
            >
              {title}
            </Paragraph>
          </XStack>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            numberOfLines={1}
          >
            {sub}
          </Paragraph>
        </YStack>
      </XStack>

      <Pressable onPress={ctaOnPress}>
        <XStack
          ai="center"
          jc="center"
          gap="$2"
          bg={ctaBg}
          br={9999}
          h={44}
          borderWidth={status === 'done' ? 1 : 0}
          borderColor={COLORS.outlineVariant}
        >
          {status !== 'done' && <Camera size={16} color="white" />}
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={13}
            color={ctaFg}
          >
            {ctaLabel}
          </Paragraph>
        </XStack>
      </Pressable>
    </YStack>
  )
}

// ─── Record row (collapsible) ──────────────────────────────────────

function RecordCard({
  record,
  onViewPhoto,
}: {
  record: AttendanceRecordRow
  onViewPhoto: (url: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const kind = deriveStatusKind(record)
  const label = statusLabel(kind, !!record.clockOutAt)
  const colors = statusColor(kind)

  return (
    <Pressable onPress={() => setExpanded((v) => !v)}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br="$4"
        p="$3"
        gap="$2.5"
        borderWidth={1}
        borderColor={COLORS.outlineVariant}
      >
        <XStack ai="center" gap="$2.5">
          <YStack flex={1} gap="$0.5">
            <Paragraph
              fontFamily={FONTS.bodySemi}
              fontSize={14}
              color={COLORS.onSurface}
              numberOfLines={1}
            >
              {record.staffName || 'Tanpa nama'}
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
              numberOfLines={1}
            >
              {formatJakartaDate(record.date)}
              {record.branchName ? ` · ${record.branchName}` : ''}
              {record.branchShiftName ? ` · ${record.branchShiftName}` : ''}
            </Paragraph>
          </YStack>
          <YStack
            bg={colors.bg}
            br={9999}
            px="$2.5"
            py="$1"
          >
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={10}
              color={colors.fg}
              letterSpacing={0.4}
            >
              {label.toUpperCase()}
            </Paragraph>
          </YStack>
        </XStack>

        <XStack ai="center" gap="$3">
          <TimePill label="MASUK" time={formatJakartaTime(record.clockInAt)} />
          <TimePill label="PULANG" time={formatJakartaTime(record.clockOutAt)} />
        </XStack>

        {expanded && (
          <YStack gap="$2.5" mt="$1">
            {(record.clockInPhotoUrl || record.clockOutPhotoUrl) && (
              <XStack gap="$2">
                {record.clockInPhotoUrl && (
                  <PhotoThumb
                    url={record.clockInPhotoUrl}
                    label="Foto masuk"
                    onPress={() => onViewPhoto(record.clockInPhotoUrl!)}
                  />
                )}
                {record.clockOutPhotoUrl && (
                  <PhotoThumb
                    url={record.clockOutPhotoUrl}
                    label="Foto pulang"
                    onPress={() => onViewPhoto(record.clockOutPhotoUrl!)}
                  />
                )}
              </XStack>
            )}
            {record.clockInLat && record.clockInLng && (
              <Pressable
                onPress={() =>
                  Linking.openURL(
                    `https://maps.google.com/?q=${record.clockInLat},${record.clockInLng}`,
                  )
                }
              >
                <XStack ai="center" gap="$1.5">
                  <MapPin size={12} color={COLORS.primary} />
                  <Paragraph
                    fontFamily={FONTS.mono}
                    fontSize={11}
                    color={COLORS.primary}
                    textDecorationLine="underline"
                  >
                    {Number(record.clockInLat).toFixed(5)},{' '}
                    {Number(record.clockInLng).toFixed(5)}
                  </Paragraph>
                  <Navigation size={10} color={COLORS.primary} />
                </XStack>
              </Pressable>
            )}
            {record.clockInNotes && (
              <NoteLine label="Catatan masuk" body={record.clockInNotes} />
            )}
            {record.clockOutNotes && (
              <NoteLine label="Catatan pulang" body={record.clockOutNotes} />
            )}
          </YStack>
        )}
      </YStack>
    </Pressable>
  )
}

/**
 * Lightweight card for "belum hadir" staff — no clock times to render,
 * so it's just the name, branch, and a danger-tinted badge. Matches the
 * RecordCard chrome so the list reads as a single visual unit.
 */
function AbsentStaffCard({ staff }: { staff: AttendanceStaffRow }) {
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br="$4"
      p="$3"
      gap="$1"
      borderWidth={1}
      borderColor={COLORS.outlineVariant}
    >
      <XStack ai="center" gap="$2.5">
        <YStack
          w={36}
          h={36}
          br={12}
          bg={COLORS.dangerTint}
          ai="center"
          jc="center"
        >
          <UserMinus size={18} color={COLORS.danger} />
        </YStack>
        <YStack flex={1} gap="$0.5">
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={14}
            color={COLORS.onSurface}
            numberOfLines={1}
          >
            {staff.fullName || 'Tanpa nama'}
          </Paragraph>
          {staff.branchName && (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
              numberOfLines={1}
            >
              {staff.branchName}
            </Paragraph>
          )}
        </YStack>
        <YStack
          bg={COLORS.dangerTint}
          br={9999}
          px="$2.5"
          py="$1"
        >
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={10}
            color={COLORS.danger}
            letterSpacing={0.4}
          >
            BELUM HADIR
          </Paragraph>
        </YStack>
      </XStack>
    </YStack>
  )
}

function TimePill({ label, time }: { label: string; time: string }) {
  return (
    <YStack flex={1} gap="$0.5">
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
        fontSize={15}
        color={COLORS.onSurface}
      >
        {time}
      </Paragraph>
    </YStack>
  )
}

function PhotoThumb({
  url,
  label,
  onPress,
}: {
  url: string
  label: string
  onPress: () => void
}) {
  // The photoUrl is a presigned S3 URL minted by the server with a
  // 5-minute TTL. We render the actual thumbnail inline so the user
  // can see *which* photo they're about to tap into.
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <YStack
        bg={COLORS.surfaceContainerLow}
        br="$3"
        overflow="hidden"
        borderWidth={1}
        borderColor={COLORS.outlineVariant}
      >
        <Image
          source={{ uri: url }}
          width="100%"
          height={120}
          resizeMode="cover"
        />
        <Paragraph
          fontFamily={FONTS.bodyMedium}
          fontSize={11}
          color={COLORS.onSurfaceVariant}
          px="$2"
          py="$1.5"
          ta="center"
        >
          {label}
        </Paragraph>
      </YStack>
    </Pressable>
  )
}

function PhotoViewer({
  url,
  onClose,
}: {
  url: string | null
  onClose: () => void
}) {
  const { width, height } = Dimensions.get('window')
  return (
    <Modal
      visible={!!url}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.92)',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {url && (
          <Image
            source={{ uri: url }}
            width={width}
            height={height * 0.85}
            resizeMode="contain"
          />
        )}
        <Pressable
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 56,
            right: 20,
            backgroundColor: 'rgba(0,0,0,0.5)',
            borderRadius: 999,
            padding: 10,
          }}
          hitSlop={12}
        >
          <X size={22} color="#ffffff" />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function NoteLine({ label, body }: { label: string; body: string }) {
  return (
    <YStack gap="$0.5">
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={9}
        color={COLORS.outline}
        letterSpacing={0.4}
      >
        {label.toUpperCase()}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={12}
        color={COLORS.onSurface}
      >
        {body}
      </Paragraph>
    </YStack>
  )
}

function RecordsError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <YStack ai="center" jc="center" py="$8" gap="$2">
      <AlertCircle size={36} color={COLORS.danger} />
      <Paragraph
        fontFamily={FONTS.bodyMedium}
        fontSize={14}
        color={COLORS.onSurface}
      >
        Gagal memuat catatan
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={12}
        color={COLORS.onSurfaceVariant}
        ta="center"
        maxWidth={280}
      >
        {message}
      </Paragraph>
      <Pressable onPress={onRetry}>
        <YStack
          mt="$2"
          bg={COLORS.primary}
          br={9999}
          px="$4"
          py="$2"
        >
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={13}
            color="white"
          >
            Coba lagi
          </Paragraph>
        </YStack>
      </Pressable>
    </YStack>
  )
}

// ─── Filter sheet ──────────────────────────────────────────────────

const QUICK_RANGES = [
  { key: 'today', label: 'Hari ini' },
  { key: 'last7', label: '7 hari' },
  { key: 'last30', label: '30 hari' },
  { key: 'month', label: 'Bulan ini' },
] as const

type QuickRangeKey = (typeof QUICK_RANGES)[number]['key']

function resolveQuickRange(
  key: QuickRangeKey,
): { from: string; to: string } {
  const today = jakartaToday()
  const to = toYmd(today)
  if (key === 'today') return { from: to, to }
  if (key === 'last7') {
    const d = new Date(today)
    d.setDate(d.getDate() - 6)
    return { from: toYmd(d), to }
  }
  if (key === 'last30') {
    const d = new Date(today)
    d.setDate(d.getDate() - 29)
    return { from: toYmd(d), to }
  }
  return { from: toYmd(startOfMonth(today)), to }
}

function FilterSheet({
  open,
  onClose,
  from,
  to,
  staffId,
  onApply,
}: {
  open: boolean
  onClose: () => void
  from: string
  to: string
  staffId: string | null
  onApply: (next: { from: string; to: string; staffId: string | null }) => void
}) {
  const [localFrom, setLocalFrom] = useState(from)
  const [localTo, setLocalTo] = useState(to)
  const [localStaffId, setLocalStaffId] = useState<string | null>(staffId)

  const staffQuery = useAttendanceStaff()
  const staff: AttendanceStaffRow[] = staffQuery.data ?? []

  // Sync local state when the sheet re-opens with new external values.
  // Re-syncing on `open` (rather than on every prop change) keeps the
  // sheet feeling stable while it's already open.
  useMemo(() => {
    if (open) {
      setLocalFrom(from)
      setLocalTo(to)
      setLocalStaffId(staffId)
    }
  }, [open, from, to, staffId])

  return (
    <Sheet
      modal
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose()
      }}
      snapPoints={[70]}
      dismissOnSnapToBottom
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame bg={COLORS.background} p="$4" gap="$3">
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={18}
          color={COLORS.onSurface}
        >
          Filter
        </Paragraph>

        <YStack gap="$2">
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
            textTransform="uppercase"
          >
            Rentang Tanggal
          </Paragraph>
          <XStack gap="$2" flexWrap="wrap">
            {QUICK_RANGES.map((r) => {
              const isActive =
                resolveQuickRange(r.key).from === localFrom &&
                resolveQuickRange(r.key).to === localTo
              return (
                <Pressable
                  key={r.key}
                  onPress={() => {
                    const next = resolveQuickRange(r.key)
                    setLocalFrom(next.from)
                    setLocalTo(next.to)
                  }}
                >
                  <YStack
                    bg={isActive ? COLORS.primary : COLORS.surfaceContainerLow}
                    br={9999}
                    px="$3"
                    py="$2"
                    borderWidth={1}
                    borderColor={
                      isActive ? COLORS.primary : COLORS.outlineVariant
                    }
                  >
                    <Paragraph
                      fontFamily={FONTS.bodyMedium}
                      fontSize={12}
                      color={isActive ? 'white' : COLORS.onSurface}
                    >
                      {r.label}
                    </Paragraph>
                  </YStack>
                </Pressable>
              )
            })}
          </XStack>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            {formatJakartaDate(localFrom)} – {formatJakartaDate(localTo)}
          </Paragraph>
        </YStack>

        <YStack gap="$2" flex={1}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
            textTransform="uppercase"
          >
            Staf
          </Paragraph>
          <ScrollView style={{ flex: 1, maxHeight: 280 }}>
            <YStack gap="$1.5">
              <Pressable onPress={() => setLocalStaffId(null)}>
                <XStack
                  ai="center"
                  jc="space-between"
                  bg={
                    localStaffId === null
                      ? COLORS.primaryFixed
                      : COLORS.surfaceContainerLow
                  }
                  br="$3"
                  px="$3"
                  py="$2.5"
                  borderWidth={1}
                  borderColor={
                    localStaffId === null
                      ? COLORS.primary
                      : COLORS.outlineVariant
                  }
                >
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={13}
                    color={COLORS.onSurface}
                  >
                    Semua staf
                  </Paragraph>
                  {localStaffId === null && (
                    <Check size={14} color={COLORS.primary} />
                  )}
                </XStack>
              </Pressable>
              {staff.map((s) => {
                const active = localStaffId === s.id
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setLocalStaffId(s.id)}
                  >
                    <XStack
                      ai="center"
                      jc="space-between"
                      bg={
                        active
                          ? COLORS.primaryFixed
                          : COLORS.surfaceContainerLow
                      }
                      br="$3"
                      px="$3"
                      py="$2.5"
                      borderWidth={1}
                      borderColor={
                        active ? COLORS.primary : COLORS.outlineVariant
                      }
                    >
                      <YStack flex={1}>
                        <Paragraph
                          fontFamily={FONTS.bodyMedium}
                          fontSize={13}
                          color={COLORS.onSurface}
                          numberOfLines={1}
                        >
                          {s.fullName || 'Tanpa nama'}
                        </Paragraph>
                        {s.branchName && (
                          <Paragraph
                            fontFamily={FONTS.body}
                            fontSize={11}
                            color={COLORS.onSurfaceVariant}
                            numberOfLines={1}
                          >
                            {s.branchName}
                          </Paragraph>
                        )}
                      </YStack>
                      {active && <Check size={14} color={COLORS.primary} />}
                    </XStack>
                  </Pressable>
                )
              })}
              {staffQuery.isLoading && (
                <YStack ai="center" py="$4">
                  <Spinner color={COLORS.primary} />
                </YStack>
              )}
            </YStack>
          </ScrollView>
        </YStack>

        <Pressable
          onPress={() =>
            onApply({
              from: localFrom,
              to: localTo,
              staffId: localStaffId,
            })
          }
        >
          <YStack
            bg={COLORS.primary}
            br={9999}
            py="$3"
            ai="center"
          >
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={14}
              color="white"
            >
              Terapkan
            </Paragraph>
          </YStack>
        </Pressable>
      </Sheet.Frame>
    </Sheet>
  )
}
