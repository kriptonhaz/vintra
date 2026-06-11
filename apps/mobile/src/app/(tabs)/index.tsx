/**
 * Beranda — the home / dashboard tab. Three vertical zones:
 *
 *   1. HEADER  — avatar + "Selamat pagi/siang/sore" + user name on
 *                the left; notification bell (with unread badge) on
 *                the right. Inside a brand-green strip.
 *
 *   2. CARDS   — role-aware:
 *
 *      Staff role (cashier / employee):
 *        - "Status Absensi" card with clock-in/out CTA → routes to
 *          the Absensi tab.
 *        - "Mulai Transaksi" CTA card → routes to Kasir.
 *
 *      Owner / admin role:
 *        - "Penjualan hari ini" (revenue + transaction count, taps
 *          through to Kasir for the full POS dashboard).
 *        - "Status Absensi" (the owner's own clock-in status — soft-
 *          hides if they don't have a staff profile).
 *        - "Kas hari ini" (income vs expense, taps to /lainnya for
 *          the full cashflow — until we wire a deeper screen).
 *        - "Stok menipis" (count of low-stock items, taps to
 *          Inventory tab).
 *        Each widget renders only when its server fn returns data —
 *        a 403 from access middleware (e.g. POS not subscribed) just
 *        hides that card.
 *
 *   Role detection: tenant_members.role. 'owner' | 'admin' get the
 *   dashboard treatment; everyone else gets the staff treatment.
 */
import { useEffect, useState } from 'react'
import { Image as RNImage, Pressable, RefreshControl, ScrollView } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Card,
  Paragraph,
  ScrollView as TGScrollView,
  Sheet,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import {
  AlertCircle,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  HandWave,
  MapPin,
  Megaphone,
  Package,
  ShoppingCart,
  Store,
  Users,
} from '~/lib/icons'
import { useAuth } from '../../lib/auth-context'
import { useTenant } from '../../lib/tenant-context'
import { useOutlet } from '../../lib/outlet-context'
import {
  useAttendanceHistory,
  useTodayStatus,
  type AttendanceHistoryRecord,
  type AttendanceRecord,
  type TodayStatus,
} from '../../lib/attendance'
import { usePosOverview } from '../../lib/pos'
import {
  useAttendanceTodayOverview,
  useInventoryOverview,
} from '../../lib/home'
import { useUnreadCount } from '../../lib/notifications'
import {
  useAnnouncements,
  type AnnouncementListItem,
} from '../../lib/announcements'
import { formatRupiah } from '../../lib/currency'
import { SalesChart } from '../../components/SalesChart'
import { COLORS, FONTS, SHADOWS } from '../../lib/theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../../../assets/icon.png')

/**
 * Translate raw role keys (from tenant_members.role) into the
 * Indonesian label the user expects to see. Falls back to a title-
 * cased version of whatever the server sent so unknown future roles
 * still render gracefully.
 */
const ROLE_LABELS: Record<string, string> = {
  owner: 'Pemilik',
  admin: 'Admin',
  manager: 'Manajer',
  supervisor: 'Supervisor',
  cashier: 'Kasir',
  employee: 'Karyawan',
  staff: 'Staf',
  member: 'Anggota',
}

function roleLabel(role: string): string {
  const key = role.trim().toLowerCase()
  if (!key) return ''
  return ROLE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

export default function HomeTab() {
  const { user } = useAuth()
  const { state } = useTenant()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  const role = state.status === 'ready' ? state.tenant.role : ''

  const fullName =
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email?.split('@')[0] ??
    'Pemilik Usaha'
  const firstName = fullName.split(' ')[0]

  // Pull-to-refresh re-fetches every home widget (announcements, sales,
  // inventory, pos, attendance, bell) — invalidating all active queries
  // is simplest and the home only mounts a handful.
  async function onRefresh() {
    setRefreshing(true)
    try {
      await queryClient.invalidateQueries()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <Header
        firstName={firstName}
        roleText={roleLabel(role)}
        onNotificationsPress={() => router.push('/notifications')}
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      >
        <HomeBody />
      </ScrollView>
    </YStack>
  )
}

/**
 * Permission-driven home body. Every widget renders only when the
 * active role grants the permission behind it — so the same screen
 * composes correctly for an owner (everything), a stock manager
 * (just product/stock), a cashier (sales), an attendance employee
 * (just their own clock-status), or a custom role. No role-name
 * branching: the home is the union of the widgets the user is allowed.
 *
 * Permission map:
 *   - SalesChart + Transaksi  → pos.read       (revenue visibility)
 *   - Hadir Hari Ini (team)   → attendance.manage (oversight, not self)
 *   - Total Produk + Stok     → inventory.read
 *   - Absensi Saya (self)     → attendance.write + has staff profile
 *
 * All supporting cards live in the StatGrid so they share the 2×2
 * layout — including the user's own attendance, which taps through to
 * the Absensi tab for the actual check-in/out flow. We intentionally
 * don't show a "Buka Kasir" shortcut: the Kasir bottom-tab already does
 * that, so a duplicate CTA is just noise.
 */
function HomeBody() {
  const { hasPermission } = useTenant()

  const canSeePos = hasPermission('pos.read')
  const canSeeInventory = hasPermission('inventory.read')
  const canSeeAttendance =
    hasPermission('attendance.manage') || hasPermission('attendance.report')
  const canClockIn = hasPermission('attendance.write')

  // Staff-only: their personal attendance is the only thing the home can
  // surface (no dashboards to oversee). Give them the richer "shift
  // companion" layout instead of one lonely status tile.
  const isStaffOnly =
    canClockIn && !canSeePos && !canSeeInventory && !canSeeAttendance
  if (isStaffOnly) {
    return (
      <>
        <AnnouncementsCard />
        <StaffHome />
      </>
    )
  }

  // True if the role grants nothing the home can surface — show a
  // friendly fallback instead of a blank screen.
  const hasAnyWidget =
    canSeePos || canSeeInventory || canSeeAttendance || canClockIn

  return (
    <>
      {canSeePos && <SalesChart />}

      <AnnouncementsCard />

      <StatGrid
        showPos={canSeePos}
        showInventory={canSeeInventory}
        showAttendance={canSeeAttendance}
        showSelfAttendance={canClockIn}
      />

      {!hasAnyWidget && <WelcomeFallback />}
    </>
  )
}

/**
 * "Pengumuman" card — surfaces the latest broadcasts from the owner to
 * every role. Self-hides when there are none. Shows up to two, unread
 * ones flagged with a dot + bold title; tap routes to the detail screen
 * (which marks it read). Announcements also land in the bell via the
 * publish fan-out, so this is a glanceable shortcut, not the only place.
 */
function AnnouncementsCard() {
  const router = useRouter()
  const { data: items = [] } = useAnnouncements(20)

  if (items.length === 0) return null

  const shown = items.slice(0, 3)
  const unreadCount = items.filter((a) => !a.readAt).length
  const hasMore = items.length > shown.length

  return (
    <ShadowCard>
      <XStack ai="center" jc="space-between">
        <XStack ai="center" gap="$2">
          <Megaphone size={16} color={COLORS.primary} />
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={13}
            color={COLORS.onSurfaceVariant}
          >
            Pengumuman
          </Paragraph>
          {unreadCount > 0 && (
            <YStack bg={COLORS.primary} br={9999} px="$2" py={1}>
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={10}
                color="white"
              >
                {unreadCount} baru
              </Paragraph>
            </YStack>
          )}
        </XStack>
      </XStack>

      <YStack gap="$2.5">
        {shown.map((a) => (
          <AnnouncementRow
            key={a.id}
            item={a}
            onPress={() => router.push(`/announcements/${a.id}`)}
          />
        ))}
      </YStack>

      {hasMore && (
        <Pressable onPress={() => router.push('/announcements')}>
          <XStack ai="center" jc="center" gap="$1" pt="$1">
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={12}
              color={COLORS.primary}
            >
              Lihat semua ({items.length})
            </Paragraph>
            <ChevronRight size={14} color={COLORS.primary} />
          </XStack>
        </Pressable>
      )}
    </ShadowCard>
  )
}

function AnnouncementRow({
  item,
  onPress,
}: {
  item: AnnouncementListItem
  onPress: () => void
}) {
  const unread = !item.readAt
  return (
    <Pressable onPress={onPress}>
      <XStack ai="center" gap="$2.5">
        <YStack
          w={7}
          h={7}
          br={9999}
          bg={unread ? COLORS.primary : 'transparent'}
        />
        <YStack flex={1}>
          <Paragraph
            fontFamily={unread ? FONTS.bodyBold : FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            numberOfLines={1}
          >
            {item.title}
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
            numberOfLines={1}
          >
            {item.body}
          </Paragraph>
        </YStack>
        <ChevronRight size={16} color={COLORS.outlineVariant} />
      </XStack>
    </Pressable>
  )
}

// ─── Staff-only home ─────────────────────────────────────────────────

/**
 * The "shift companion" home for an attendance-only staff member. Two
 * cards: a hero showing today's clock status (live worked duration +
 * shift schedule + the one action they came for), and a month recap of
 * their own attendance pulled from their 31-day history.
 */
function StaffHome() {
  const router = useRouter()
  const today = useTodayStatus()

  if (today.isLoading && !today.data) {
    return (
      <ShadowCard>
        <XStack ai="center" gap="$2" py="$3">
          <Spinner color={COLORS.primary} />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={13}
            color={COLORS.onSurfaceVariant}
          >
            Memuat absensi...
          </Paragraph>
        </XStack>
      </ShadowCard>
    )
  }

  if (!today.data?.hasProfile) {
    return (
      <ShadowCard>
        <YStack gap="$2" py="$1">
          <Paragraph
            fontFamily={FONTS.headingBold}
            fontSize={16}
            color={COLORS.onSurface}
          >
            Profil staf belum disiapkan
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={13}
            color={COLORS.onSurfaceVariant}
            lineHeight={19}
          >
            Hubungi admin usaha untuk menugaskan Anda ke cabang sebelum
            mulai absen.
          </Paragraph>
        </YStack>
      </ShadowCard>
    )
  }

  return (
    <>
      <AttendanceHeroCard
        today={today.data}
        onAction={() => router.push('/(tabs)/absensi')}
      />
      <MonthSummaryCard onPress={() => router.push('/(tabs)/absensi')} />
    </>
  )
}

/**
 * The staff hero. Reflects today's clock state and offers the single
 * relevant action (check-in / check-out), which routes to the Absensi
 * tab to complete GPS/photo/QR verification. While on shift it shows a
 * live-ticking worked duration so the staff can see their hours accrue.
 */
function AttendanceHeroCard({
  today,
  onAction,
}: {
  today: TodayStatus
  onAction: () => void
}) {
  const now = useNowTick(30000)
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
  const statusText =
    status === 'pending'
      ? 'Belum absen'
      : status === 'in'
        ? 'Sedang shift'
        : 'Shift selesai'

  const shiftLine = buildShiftLine(today.todaySchedule, today.branch?.name ?? null)

  return (
    <ShadowCard>
      <XStack ai="center" gap="$2.5">
        <YStack w={40} h={40} br={14} bg={COLORS.primaryFixed} ai="center" jc="center">
          <Clock size={20} color={COLORS.primary} />
        </YStack>
        <YStack flex={1}>
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
              fontSize={18}
              color={COLORS.onSurface}
            >
              {statusText}
            </Paragraph>
          </XStack>
        </YStack>
      </XStack>

      {shiftLine && (
        <XStack ai="center" gap="$2">
          <Calendar size={14} color={COLORS.onSurfaceVariant} />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
          >
            {shiftLine}
          </Paragraph>
        </XStack>
      )}

      {status === 'in' && record && (
        <YStack
          bg={COLORS.surfaceContainerLow}
          br={14}
          px="$3.5"
          py="$3"
          gap={2}
        >
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            Sudah bekerja
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.headingBold}
            fontSize={22}
            color={COLORS.onSurface}
          >
            {formatDuration(record.clockInAt, new Date(now).toISOString())}
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            Masuk {formatJakartaTime(record.clockInAt)}
          </Paragraph>
        </YStack>
      )}

      {status === 'done' && record && (
        <YStack gap="$1.5">
          <HeroKv label="Masuk" value={formatJakartaTime(record.clockInAt)} />
          <HeroKv label="Keluar" value={formatJakartaTime(record.clockOutAt)} />
          <HeroKv
            label="Total kerja"
            value={formatDuration(record.clockInAt, record.clockOutAt)}
            highlight
          />
        </YStack>
      )}

      {status === 'pending' && (
        <Button
          bg={COLORS.primary}
          pressStyle={{ bg: COLORS.brandActive }}
          borderWidth={0}
          br={9999}
          h={48}
          onPress={onAction}
        >
          <MapPin size={16} color="white" />
          <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="white">
            Check-in Sekarang
          </Paragraph>
        </Button>
      )}
      {status === 'in' && (
        <Button
          bg={COLORS.primary}
          pressStyle={{ bg: COLORS.brandActive }}
          borderWidth={0}
          br={9999}
          h={48}
          onPress={onAction}
        >
          <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="white">
            Check-out
          </Paragraph>
        </Button>
      )}
    </ShadowCard>
  )
}

function HeroKv({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <XStack jc="space-between" py="$1">
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        color={COLORS.onSurfaceVariant}
      >
        {label}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={13}
        color={highlight ? COLORS.primary : COLORS.onSurface}
      >
        {value}
      </Paragraph>
    </XStack>
  )
}

/**
 * Month-to-date recap of the staff's own attendance, computed from their
 * 31-day history: present days, late count, total hours, plus a row of
 * the last 7 days as colored dots. Taps through to the Absensi tab for
 * the full history.
 */
function MonthSummaryCard({ onPress }: { onPress: () => void }) {
  const history = useAttendanceHistory(31)
  const records = history.data?.records ?? []
  const { hadir, telat, totalMinutes } = summarizeThisMonth(records)
  const days = lastSevenDays(records)

  return (
    <Pressable onPress={onPress}>
      <ShadowCard>
        <XStack ai="center" jc="space-between">
          <XStack ai="center" gap="$2">
            <Calendar size={16} color={COLORS.onSurfaceVariant} />
            <Paragraph
              fontFamily={FONTS.bodySemi}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Rekap Bulan Ini
            </Paragraph>
          </XStack>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.primary}
          >
            Lihat semua
          </Paragraph>
        </XStack>

        {history.isLoading && records.length === 0 ? (
          <XStack ai="center" jc="center" py="$3">
            <Spinner color={COLORS.primary} />
          </XStack>
        ) : (
          <>
            <XStack>
              <RecapStat value={String(hadir)} label="Hadir" />
              <RecapStat
                value={String(telat)}
                label="Telat"
                valueColor={telat > 0 ? COLORS.warning : COLORS.onSurface}
              />
              <RecapStat
                value={String(Math.round(totalMinutes / 60))}
                label="Jam kerja"
              />
            </XStack>

            <YStack h={1} bg={COLORS.borderSubtle} />

            <XStack jc="space-between">
              {days.map((d) => (
                <YStack key={d.date} ai="center" gap="$1.5" flex={1}>
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={9}
                    color={COLORS.onSurfaceVariant}
                  >
                    {d.label}
                  </Paragraph>
                  <YStack w={10} h={10} br={9999} bg={d.color} />
                </YStack>
              ))}
            </XStack>
          </>
        )}
      </ShadowCard>
    </Pressable>
  )
}

function RecapStat({
  value,
  label,
  valueColor,
}: {
  value: string
  label: string
  valueColor?: string
}) {
  return (
    <YStack flex={1} ai="center" gap={2}>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={24}
        color={valueColor ?? COLORS.onSurface}
      >
        {value}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={11}
        color={COLORS.onSurfaceVariant}
      >
        {label}
      </Paragraph>
    </YStack>
  )
}

/**
 * Shown when the role grants no home widgets at all (e.g. a freshly
 * invited member with an empty permission set). Keeps the screen from
 * looking broken and points them at the person who can grant access.
 */
function WelcomeFallback() {
  return (
    <ShadowCard>
      <YStack gap="$2" py="$1">
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={16}
          color={COLORS.onSurface}
        >
          Selamat datang di Vintra
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={13}
          color={COLORS.onSurfaceVariant}
          lineHeight={19}
        >
          Akun Anda belum punya akses modul. Hubungi pemilik usaha untuk
          mengaktifkan menu yang Anda butuhkan.
        </Paragraph>
      </YStack>
    </ShadowCard>
  )
}

// ─── Header ──────────────────────────────────────────────────────────

function Header({
  firstName,
  roleText,
  onNotificationsPress,
}: {
  firstName: string
  roleText: string
  onNotificationsPress: () => void
}) {
  const greeting = greetingForNow()
  const unread = useUnreadCount()
  const unreadCount = unread.data?.count ?? 0
  const {
    branches,
    totalCount,
    selectedBranch,
    selectedBranchId,
    setSelectedBranchId,
  } = useOutlet()
  const [pickerOpen, setPickerOpen] = useState(false)

  // Visibility — mirrors apps/web/src/components/layout/branch-switcher.tsx
  //   • single-outlet tenant (totalCount <= 1) → hide chip (it's noise)
  //   • pinned staff (1 of many) → locked label, no tap
  //   • multi-outlet user → tappable chip opens the picker
  const showChip = !!selectedBranch && totalCount > 1
  const canSwitch = branches.length > 1

  return (
    <YStack bg={COLORS.primary} pt={60} pb="$5" px="$5" gap="$3">
      <XStack ai="center" jc="space-between">
        <XStack ai="center" gap="$3" flex={1}>
          {/* Avatar — Vintra logo on a white circle. We don't expose
              a profile-photo upload (yet) so showing initials creates
              the false expectation that they can change it. The brand
              mark is more honest until we ship avatars. */}
          <YStack
            w={44}
            h={44}
            br={22}
            bg="white"
            ai="center"
            jc="center"
            overflow="hidden"
          >
            <RNImage
              source={logo}
              style={{ width: 52, height: 52 }}
              resizeMode="cover"
            />
          </YStack>
          <YStack flex={1}>
            {/* Greeting + waving hand. Vector icon, not the 👋 emoji —
                the emoji renders as font tofu in our Expo build. */}
            <XStack ai="center" gap="$1.5">
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color="white"
                opacity={0.85}
              >
                {greeting}
              </Paragraph>
              <HandWave size={13} color="#FFD54A" />
            </XStack>
            {/* Name + role pill on one line — keeps the header to two
                lines so it stays balanced beside the 44px avatar.
                flexWrap lets the outlet chip drop to its own row on
                tight screens with long names rather than clipping. */}
            <XStack ai="center" gap="$2" mt={1} flexWrap="wrap">
              <Paragraph
                fontFamily={FONTS.headingBold}
                fontSize={18}
                color="white"
                numberOfLines={1}
                flexShrink={1}
              >
                {firstName}
              </Paragraph>
              {roleText !== '' && (
                <YStack
                  bg="rgba(255,255,255,0.18)"
                  br={9999}
                  px="$2"
                  py={2}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={10}
                    color="white"
                    letterSpacing={0.3}
                  >
                    {roleText}
                  </Paragraph>
                </YStack>
              )}
              {showChip && (
                <Pressable
                  onPress={canSwitch ? () => setPickerOpen(true) : undefined}
                  hitSlop={6}
                  disabled={!canSwitch}
                >
                  <XStack
                    ai="center"
                    gap="$1.5"
                    bg="rgba(255,255,255,0.18)"
                    br={9999}
                    px="$2"
                    py={3}
                  >
                    <Store size={11} color="white" />
                    <Paragraph
                      fontFamily={FONTS.bodyBold}
                      fontSize={10}
                      color="white"
                      letterSpacing={0.3}
                      numberOfLines={1}
                      maxWidth={140}
                    >
                      {selectedBranch!.name}
                    </Paragraph>
                    {canSwitch && (
                      <ChevronDown size={11} color="white" />
                    )}
                  </XStack>
                </Pressable>
              )}
            </XStack>
          </YStack>
        </XStack>

        <Pressable onPress={onNotificationsPress} hitSlop={10}>
          <YStack
            w={44}
            h={44}
            br={22}
            bg={COLORS.primaryFixed}
            ai="center"
            jc="center"
            position="relative"
          >
            <Bell size={20} color={COLORS.primary} />
            {unreadCount > 0 && (
              <YStack
                position="absolute"
                top={-2}
                right={-2}
                minWidth={20}
                h={20}
                br={10}
                bg={COLORS.danger}
                ai="center"
                jc="center"
                px={5}
                borderWidth={2}
                borderColor={COLORS.primary}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={10}
                  color="white"
                  lineHeight={12}
                >
                  {unreadCount > 9 ? '9+' : String(unreadCount)}
                </Paragraph>
              </YStack>
            )}
          </YStack>
        </Pressable>
      </XStack>

      {/* Outlet picker — only mounted while open. Tamagui Sheet is
          modal/portaled so the brand-green header bleed doesn't matter. */}
      <Sheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        snapPoints={[55]}
        modal
        dismissOnSnapToBottom
      >
        <Sheet.Overlay />
        <Sheet.Handle />
        <Sheet.Frame
          padding="$4"
          gap="$3"
          bg={COLORS.surfaceContainerLowest}
        >
          <Paragraph
            fontFamily={FONTS.headingBold}
            fontSize={18}
            color={COLORS.onSurface}
          >
            Pilih Outlet
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
          >
            Pilihan ini berlaku di semua modul (Kasir, Inventory, dll).
          </Paragraph>
          <TGScrollView>
            <YStack gap="$1.5">
              {branches.map((b) => (
                <OutletPickerRow
                  key={b.id}
                  label={b.name}
                  isMain={b.isMain}
                  active={b.id === selectedBranchId}
                  onPress={() => {
                    setSelectedBranchId(b.id)
                    setPickerOpen(false)
                  }}
                />
              ))}
            </YStack>
          </TGScrollView>
        </Sheet.Frame>
      </Sheet>
    </YStack>
  )
}

function OutletPickerRow({
  label,
  isMain,
  active,
  onPress,
}: {
  label: string
  isMain: boolean
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress}>
      <XStack
        ai="center"
        gap="$3"
        p="$3"
        br="$3"
        bg={active ? COLORS.primaryFixed : 'transparent'}
        borderWidth={1}
        borderColor={active ? COLORS.primary : COLORS.outlineVariant}
      >
        <Store
          size={18}
          color={active ? COLORS.primary : COLORS.onSurfaceVariant}
        />
        <YStack flex={1}>
          <Paragraph
            fontFamily={active ? FONTS.headingSemi : FONTS.bodyMedium}
            fontSize={14}
            color={active ? COLORS.primary : COLORS.onSurface}
          >
            {label}
          </Paragraph>
          {isMain && (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
            >
              Cabang utama
            </Paragraph>
          )}
        </YStack>
        {active && <Check size={18} color={COLORS.primary} />}
      </XStack>
    </Pressable>
  )
}

// ─── Stat grid ───────────────────────────────────────────────────────

/**
 * Supporting-metric cards under the sales chart. The set is permission-
 * driven by the `show*` flags from HomeBody:
 *   - showAttendance     (attendance.manage) → Hadir Hari Ini (team)
 *   - showInventory      (inventory.read)    → Total Produk + Stok Menipis
 *   - showPos            (pos.read)          → Transaksi Hari Ini
 *   - showSelfAttendance (attendance.write)  → Absensi Saya (personal)
 *
 * Cards are collected in display order then laid out two-per-row; a
 * trailing odd card keeps its half-width column via a flex spacer, so
 * any subset (1–5 cards) stays aligned. Disabled widgets don't fetch
 * (the hooks take an `enabled` flag), so a stock manager never hits the
 * POS endpoint, etc. If nothing is shown the grid renders nothing.
 */
function StatGrid({
  showPos,
  showInventory,
  showAttendance,
  showSelfAttendance,
}: {
  showPos: boolean
  showInventory: boolean
  showAttendance: boolean
  showSelfAttendance: boolean
}) {
  const router = useRouter()
  const { selectedBranchId } = useOutlet()
  const attendance = useAttendanceTodayOverview({ enabled: showAttendance })
  // Outlet-aware: switching outlets in the header chip re-fetches the
  // inventory + POS widgets with the new branch scope. Attendance
  // summary stays tenant-wide (it's an HR view, not branch-bound).
  const inventory = useInventoryOverview({
    enabled: showInventory,
    branchId: selectedBranchId,
  })
  const pos = usePosOverview({
    enabled: showPos,
    branchId: selectedBranchId,
  })
  const self = useTodayStatus({ enabled: showSelfAttendance })

  const lowStock = inventory.data?.usage.lowStockItems ?? 0

  const cards: React.ReactNode[] = []

  if (showAttendance) {
    if (attendance.data) {
      cards.push(
        <AttendanceStatCard
          key="hadir"
          present={attendance.data.presentCount}
          total={attendance.data.totalCount}
          percentage={attendance.data.percentage}
          onPress={() => router.push('/(tabs)/absensi')}
        />,
      )
    } else if (attendance.isLoading) {
      cards.push(<StatCardSkeleton key="hadir" loading />)
    }
  }

  if (showInventory) {
    if (inventory.data) {
      cards.push(
        <StatCard
          key="produk"
          icon={<Package size={20} color={COLORS.primary} />}
          iconBg={COLORS.primaryFixed}
          label="Total Produk"
          value={String(inventory.data.usage.activeItems)}
          caption="barang aktif"
          onPress={() => router.push('/(tabs)/inventory')}
        />,
        <StatCard
          key="stok"
          icon={
            <AlertCircle
              size={20}
              color={lowStock > 0 ? COLORS.warning : COLORS.primary}
            />
          }
          iconBg={lowStock > 0 ? COLORS.warningTint : COLORS.primaryFixed}
          label="Stok Menipis"
          value={String(lowStock)}
          caption={lowStock > 0 ? 'perlu restock' : 'stok aman'}
          valueColor={lowStock > 0 ? COLORS.warning : COLORS.onSurface}
          onPress={() => router.push('/(tabs)/inventory')}
        />,
      )
    } else if (inventory.isLoading) {
      cards.push(
        <StatCardSkeleton key="produk" loading />,
        <StatCardSkeleton key="stok" loading />,
      )
    }
  }

  if (showPos) {
    if (pos.data) {
      cards.push(
        <StatCard
          key="transaksi"
          icon={<ShoppingCart size={20} color={COLORS.primary} />}
          iconBg={COLORS.primaryFixed}
          label="Transaksi Hari Ini"
          value={String(pos.data.today.salesCount)}
          caption={
            pos.data.today.revenue > 0
              ? formatRupiah(pos.data.today.revenue)
              : 'belum ada transaksi'
          }
          onPress={() => router.push('/(tabs)/pos')}
        />,
      )
    } else if (pos.isLoading) {
      cards.push(<StatCardSkeleton key="transaksi" loading />)
    }
  }

  if (showSelfAttendance) {
    const data = self.data
    if (data?.hasProfile) {
      const record = data.todayRecord
      const checkedIn = !!record?.clockInAt
      const checkedOut = !!record?.clockOutAt
      const selfStatus: 'pending' | 'in' | 'done' = !checkedIn
        ? 'pending'
        : !checkedOut
          ? 'in'
          : 'done'
      cards.push(
        <AttendanceSelfCard
          key="absensi-self"
          status={selfStatus}
          clockInAt={record?.clockInAt ?? null}
          clockOutAt={record?.clockOutAt ?? null}
          onPress={() => router.push('/(tabs)/absensi')}
        />,
      )
    } else if (self.isLoading) {
      cards.push(<StatCardSkeleton key="absensi-self" loading />)
    }
    // No staff profile (e.g. owners) → no personal card.
  }

  if (cards.length === 0) return null

  const rows: React.ReactNode[][] = []
  for (let i = 0; i < cards.length; i += 2) {
    rows.push(cards.slice(i, i + 2))
  }

  return (
    <YStack gap="$3">
      {rows.map((row, i) => (
        <XStack key={i} gap="$3">
          {row}
          {row.length === 1 && <YStack flex={1} />}
        </XStack>
      ))}
    </YStack>
  )
}

// ─── Stat cards ──────────────────────────────────────────────────────

/**
 * Shared card chrome for the 2×2 metric grid. White surface, soft
 * tinted shadow, a squircle icon chip + label header, then whatever
 * body the caller passes. `minHeight` keeps both cards in a row the
 * same height even when one has a ring and the other a caption.
 */
function StatCardShell({
  icon,
  iconBg,
  label,
  onPress,
  children,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  onPress?: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <YStack
        flex={1}
        bg={COLORS.surfaceContainerLowest}
        br={20}
        p="$4"
        gap="$3"
        minHeight={128}
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        style={SHADOWS.card}
      >
        <XStack ai="center" gap="$2.5">
          <YStack w={40} h={40} br={14} bg={iconBg} ai="center" jc="center">
            {icon}
          </YStack>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
            flex={1}
            numberOfLines={2}
          >
            {label}
          </Paragraph>
        </XStack>
        {children}
      </YStack>
    </Pressable>
  )
}

function StatCard({
  icon,
  iconBg,
  label,
  value,
  caption,
  valueColor,
  onPress,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: string
  caption: string
  valueColor?: string
  onPress?: () => void
}) {
  return (
    <StatCardShell icon={icon} iconBg={iconBg} label={label} onPress={onPress}>
      <YStack gap={2} mt="auto">
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={28}
          lineHeight={32}
          color={valueColor ?? COLORS.onSurface}
        >
          {value}
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={11}
          color={COLORS.onSurfaceVariant}
          numberOfLines={1}
        >
          {caption}
        </Paragraph>
      </YStack>
    </StatCardShell>
  )
}

/**
 * Attendance card — same shell as the other stats, but the body pairs
 * the present/total fraction with a circular progress ring tinted by
 * how full the day's attendance is (green ≥80%, amber ≥50%, red below).
 */
function AttendanceStatCard({
  present,
  total,
  percentage,
  onPress,
}: {
  present: number
  total: number
  percentage: number
  onPress?: () => void
}) {
  const ringColor =
    percentage >= 80
      ? COLORS.success
      : percentage >= 50
        ? COLORS.warning
        : COLORS.danger

  return (
    <StatCardShell
      icon={<Users size={20} color={COLORS.primary} />}
      iconBg={COLORS.primaryFixed}
      label="Hadir Hari Ini"
      onPress={onPress}
    >
      <XStack ai="flex-end" jc="space-between" mt="auto">
        <YStack>
          <XStack ai="baseline" gap="$1">
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={28}
              lineHeight={32}
              color={COLORS.onSurface}
            >
              {present}
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={15}
              color={COLORS.onSurfaceVariant}
            >
              /{total}
            </Paragraph>
          </XStack>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            {total > 0 ? 'karyawan hadir' : 'belum ada karyawan'}
          </Paragraph>
        </YStack>
        <ProgressRing percentage={percentage} color={ringColor} />
      </XStack>
    </StatCardShell>
  )
}

/**
 * Circular progress ring (react-native-svg) with the rounded percentage
 * in the center. The track is the page surface tint; the arc starts at
 * 12 o'clock (rotated -90°) and sweeps clockwise.
 */
function ProgressRing({
  percentage,
  color,
  size = 48,
  stroke = 5,
}: {
  percentage: number
  color: string
  size?: number
  stroke?: number
}) {
  const pct = Math.max(0, Math.min(100, percentage))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (pct / 100) * circumference
  const center = size / 2

  return (
    <YStack w={size} h={size} ai="center" jc="center">
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={COLORS.surfaceContainerHigh}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={12}
        color={COLORS.onSurface}
      >
        {Math.round(pct)}%
      </Paragraph>
    </YStack>
  )
}

function StatCardSkeleton({ loading }: { loading: boolean }) {
  // When the underlying query errored (no access), render an invisible
  // flex spacer so the surviving card keeps its half-width column.
  if (!loading) return <YStack flex={1} />
  return (
    <YStack
      flex={1}
      alignSelf="stretch"
      bg={COLORS.surfaceContainerLowest}
      br={20}
      p="$4"
      minHeight={128}
      ai="center"
      jc="center"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <Spinner color={COLORS.primary} />
    </YStack>
  )
}

// ─── Cards ───────────────────────────────────────────────────────────

/**
 * Compact personal-attendance card for the 2×2 grid. Reflects the
 * user's own clock status for today (Belum absen / Sedang shift /
 * Selesai) and taps through to the Absensi tab, where the actual
 * GPS/photo/QR check-in & check-out flow lives. This replaces the old
 * full-width clock-in card whose buttons just navigated to that tab
 * anyway — so no action is lost, and it now lines up with the other
 * stat cards instead of standing alone.
 */
function AttendanceSelfCard({
  status,
  clockInAt,
  clockOutAt,
  onPress,
}: {
  status: 'pending' | 'in' | 'done'
  clockInAt: string | null
  clockOutAt: string | null
  onPress?: () => void
}) {
  const { dotColor, title, sub } =
    status === 'pending'
      ? {
          dotColor: COLORS.warning,
          title: 'Belum absen',
          sub: 'Tap untuk check-in',
        }
      : status === 'in'
        ? {
            dotColor: COLORS.success,
            title: 'Sedang shift',
            sub: `Masuk ${formatJakartaTime(clockInAt)}`,
          }
        : {
            dotColor: COLORS.outline,
            title: 'Selesai',
            sub: formatDuration(clockInAt, clockOutAt),
          }

  return (
    <StatCardShell
      icon={<Clock size={20} color={COLORS.primary} />}
      iconBg={COLORS.primaryFixed}
      label="Absensi Saya"
      onPress={onPress}
    >
      <YStack gap={4} mt="auto">
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
    </StatCardShell>
  )
}

// ─── Atoms ───────────────────────────────────────────────────────────

function ShadowCard({ children }: { children: React.ReactNode }) {
  return (
    <Card
      bg={COLORS.surfaceContainerLowest}
      br="$5"
      p="$4"
      gap="$3"
      shadowColor="#0F172A"
      shadowOpacity={0.04}
      shadowRadius={12}
      shadowOffset={{ width: 0, height: 4 }}
      elevation={2}
    >
      {children}
    </Card>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

function greetingForNow(): string {
  const h = new Date().getHours()
  if (h < 11) return 'Selamat pagi'
  if (h < 15) return 'Selamat siang'
  if (h < 19) return 'Selamat sore'
  return 'Selamat malam'
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

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime()
    if (ms <= 0) return '—'
    const totalMin = Math.round(ms / 60000)
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return h > 0 ? `${h} jam ${m} mnt` : `${m} mnt`
  } catch {
    return '—'
  }
}

/** Re-renders the caller every `ms` so a live duration stays current. */
function useNowTick(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** "Shift 08.00–16.00 · Cabang Utama" — omits the half that's missing. */
function buildShiftLine(
  sched: TodayStatus['todaySchedule'],
  branchName: string | null,
): string | null {
  const parts: string[] = []
  if (sched?.isWorkDay && sched.clockInTime && sched.clockOutTime) {
    parts.push(
      `Shift ${fmtSchedTime(sched.clockInTime)}–${fmtSchedTime(sched.clockOutTime)}`,
    )
  }
  if (branchName) parts.push(branchName)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** "08:00:00" → "08.00" (Indonesian time separator). */
function fmtSchedTime(hhmmss: string): string {
  return hhmmss.slice(0, 5).replace(':', '.')
}

/** Jakarta calendar date (YYYY-MM-DD) for `offsetDays` ago. */
function jakartaDateKey(offsetDays = 0): string {
  const ms = Date.now() - offsetDays * 86_400_000
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

/** Present days, late count, and total worked minutes for the current
 *  Jakarta month, from the staff's own history records. */
function summarizeThisMonth(records: AttendanceHistoryRecord[]): {
  hadir: number
  telat: number
  totalMinutes: number
} {
  const ym = jakartaDateKey().slice(0, 7) // "YYYY-MM"
  let hadir = 0
  let telat = 0
  let totalMinutes = 0
  for (const r of records) {
    if (!r.date.startsWith(ym) || !r.clockInAt) continue
    hadir++
    if (r.clockInStatus === 'late') telat++
    if (r.clockOutAt) {
      const ms = new Date(r.clockOutAt).getTime() - new Date(r.clockInAt).getTime()
      if (ms > 0) totalMinutes += Math.round(ms / 60000)
    }
  }
  return { hadir, telat, totalMinutes }
}

interface DayDot {
  date: string
  label: string
  color: string
}

/** Last 7 calendar days as colored dots: green on-time, amber late,
 *  neutral when there's no record (day off or absent). */
function lastSevenDays(records: AttendanceHistoryRecord[]): DayDot[] {
  const byDate = new Map(records.map((r) => [r.date, r]))
  const out: DayDot[] = []
  for (let i = 6; i >= 0; i--) {
    const date = jakartaDateKey(i)
    const rec = byDate.get(date)
    const color =
      !rec || !rec.clockInAt
        ? COLORS.surfaceContainerHighest
        : rec.clockInStatus === 'late'
          ? COLORS.warning
          : COLORS.success
    out.push({ date, label: dowLabel(date), color })
  }
  return out
}

/** Short Indonesian weekday for a YYYY-MM-DD key (tz-safe via noon). */
function dowLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  return new Intl.DateTimeFormat('id-ID', { weekday: 'short' })
    .format(d)
    .replace('.', '')
}

// Type re-export so TS doesn't trip on the AttendanceRecord import being
// "unused" — used implicitly via useTodayStatus's data shape.
export type { AttendanceRecord }
