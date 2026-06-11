/**
 * Attendance history — last 30 days, newest first. Tap a row to see
 * the detail sheet with clock-in/out times, status pills, photos,
 * and GPS coords. Map embed deferred to Phase 5 (Leaflet on RN is
 * non-trivial; bare coords + a "buka di Google Maps" link is
 * sufficient for v1).
 */
import { useState } from 'react'
import { Linking, Pressable } from 'react-native'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar,
  MapPin,
  Navigation,
  X,
} from '~/lib/icons'
import {
  Button,
  Card,
  H1,
  H4,
  Image,
  Paragraph,
  ScrollView,
  Separator,
  Sheet,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import {
  useAttendanceHistory,
  type AttendanceHistoryRecord,
} from '../../lib/attendance'
import { ScreenHeader } from '../../components/ScreenHeader'
import { COLORS } from '../../lib/theme'

export default function HistoryScreen() {
  const history = useAttendanceHistory(30)
  const [selected, setSelected] = useState<AttendanceHistoryRecord | null>(null)

  return (
    <YStack flex={1} bg={COLORS.surfaceSubtle}>
      <ScreenHeader title="Riwayat Absensi" back subtitle="30 hari terakhir" />
      {history.isLoading ? (
        <YStack flex={1} ai="center" jc="center">
          <Spinner size="large" color={COLORS.brand} />
        </YStack>
      ) : history.error || !history.data ? (
        <YStack flex={1} ai="center" jc="center" p="$6" gap="$3">
          <Calendar size={48} color={COLORS.textPlaceholder} />
          <H4>Gagal memuat riwayat</H4>
          <Button
            size="$4"
            bg={COLORS.brand}
            color="white"
            fontWeight="700"
            borderWidth={0}
            onPress={() => history.refetch()}
          >
            Coba Lagi
          </Button>
        </YStack>
      ) : history.data.records.length === 0 ? (
        <YStack flex={1} ai="center" jc="center" p="$6" gap="$3">
          <Calendar size={48} color={COLORS.textPlaceholder} />
          <H4>Belum ada catatan</H4>
          <Paragraph ta="center" col={COLORS.textMuted} maxWidth={280}>
            Riwayat absensi 30 hari terakhir akan muncul di sini setelah kamu
            check-in.
          </Paragraph>
        </YStack>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {groupByDate(history.data.records).map(([date, rows]) => (
            <YStack key={date} gap="$2">
              <Paragraph
                fontSize="$2"
                fontWeight="600"
                col={COLORS.textMuted}
                px="$1"
              >
                {formatJakartaDate(date)}
              </Paragraph>
              {rows.map((r) => (
                <HistoryRow
                  key={r.id}
                  record={r}
                  onPress={() => setSelected(r)}
                />
              ))}
            </YStack>
          ))}
        </ScrollView>
      )}

      <DetailSheet
        record={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </YStack>
  )
}

function HistoryRow({
  record,
  onPress,
}: {
  record: AttendanceHistoryRecord
  onPress: () => void
}) {
  const status = derivePillStatus(record)
  const branchLabel = record.branchName ?? 'Tanpa cabang'

  return (
    <Pressable onPress={onPress}>
      <Card bordered padding="$3.5" gap="$2">
        <XStack jc="space-between" ai="center" gap="$2">
          <XStack ai="center" gap="$1.5" flex={1} minWidth={0}>
            <MapPin size={14} color={COLORS.textMuted} />
            <Paragraph fontWeight="600" numberOfLines={1}>
              {branchLabel}
            </Paragraph>
          </XStack>
          <StatusPill kind={status} />
        </XStack>
        <XStack gap="$3">
          <XStack ai="center" gap="$1.5" flex={1}>
            <ArrowDownToLine size={14} color="$green10" />
            <Paragraph fontSize="$2" col="$color11">
              Masuk {formatJakartaTime(record.clockInAt)}
            </Paragraph>
          </XStack>
          <XStack ai="center" gap="$1.5" flex={1}>
            <ArrowUpFromLine size={14} color="$orange10" />
            <Paragraph fontSize="$2" col="$color11">
              Keluar {formatJakartaTime(record.clockOutAt)}
            </Paragraph>
          </XStack>
        </XStack>
      </Card>
    </Pressable>
  )
}

/** Stable date grouping for the history list. Server returns rows
 *  already ordered by date DESC, so within a group the per-branch
 *  rows appear in insertion order. */
function groupByDate(
  records: AttendanceHistoryRecord[],
): Array<[string, AttendanceHistoryRecord[]]> {
  const map = new Map<string, AttendanceHistoryRecord[]>()
  for (const r of records) {
    const list = map.get(r.date)
    if (list) list.push(r)
    else map.set(r.date, [r])
  }
  return Array.from(map.entries())
}

function StatusPill({ kind }: { kind: PillStatus }) {
  const palette: Record<PillStatus, { bg: string; col: string; label: string }> = {
    hadir: { bg: '$green3', col: '$green11', label: 'Hadir' },
    terlambat: { bg: '$orange3', col: '$orange11', label: 'Terlambat' },
    'belum-keluar': { bg: '$orange3', col: '$orange11', label: 'Belum keluar' },
    alpa: { bg: '$red3', col: '$red11', label: 'Alpa' },
    lain: { bg: '$gray3', col: '$gray11', label: '—' },
  }
  const p = palette[kind]
  return (
    <Paragraph
      bg={p.bg}
      col={p.col}
      fontSize="$1"
      fontWeight="600"
      px="$2"
      py="$0.5"
      br="$3"
    >
      {p.label}
    </Paragraph>
  )
}

function DetailSheet({
  record,
  open,
  onClose,
}: {
  record: AttendanceHistoryRecord | null
  open: boolean
  onClose: () => void
}) {
  if (!record) return null
  const dateLabel = formatJakartaDate(record.date)

  return (
    <Sheet open={open} onOpenChange={onClose} snapPoints={[80]} modal>
      <Sheet.Overlay />
      <Sheet.Frame padding="$4" gap="$3">
        <Sheet.Handle />
        <XStack jc="space-between" ai="center">
          <H1 fontSize="$7">{dateLabel}</H1>
          <Pressable onPress={onClose}>
            <YStack
              w={36}
              h={36}
              br={18}
              bg="$gray3"
              ai="center"
              jc="center"
            >
              <X size={18} />
            </YStack>
          </Pressable>
        </XStack>
        <ScrollView>
          <YStack gap="$4">
            <DetailBlock
              kind="in"
              time={record.clockInAt}
              status={record.clockInStatus}
              lat={record.clockInLat}
              lng={record.clockInLng}
              photoUrl={record.clockInPhotoUrl}
            />
            <Separator />
            <DetailBlock
              kind="out"
              time={record.clockOutAt}
              status={record.clockOutStatus}
              lat={record.clockOutLat}
              lng={record.clockOutLng}
              photoUrl={record.clockOutPhotoUrl}
            />
          </YStack>
        </ScrollView>
      </Sheet.Frame>
    </Sheet>
  )
}

function DetailBlock({
  kind,
  time,
  status,
  lat,
  lng,
  photoUrl,
}: {
  kind: 'in' | 'out'
  time: string | null
  status: string | null
  lat: string | null
  lng: string | null
  photoUrl: string | null
}) {
  const label = kind === 'in' ? 'Masuk' : 'Keluar'
  const Icon = kind === 'in' ? ArrowDownToLine : ArrowUpFromLine
  const tint = kind === 'in' ? '$green10' : '$orange10'

  if (!time) {
    return (
      <YStack gap="$2">
        <XStack ai="center" gap="$2">
          <Icon size={18} color="$color9" />
          <H4 col="$color9">{label}</H4>
        </XStack>
        <Paragraph col="$color9" fontSize="$2">
          Tidak ada catatan {kind === 'in' ? 'check-in' : 'check-out'}.
        </Paragraph>
      </YStack>
    )
  }

  return (
    <YStack gap="$2">
      <XStack ai="center" gap="$2">
        <Icon size={18} color={tint} />
        <H4>
          {label} {formatJakartaTime(time)}
        </H4>
        {status && (
          <Paragraph
            bg="$gray3"
            col="$gray11"
            fontSize="$1"
            fontWeight="600"
            px="$2"
            py="$0.5"
            br="$3"
          >
            {status}
          </Paragraph>
        )}
      </XStack>
      {photoUrl && (
        <Image
          source={{ uri: photoUrl }}
          width="100%"
          height={200}
          br="$3"
          resizeMode="cover"
        />
      )}
      {lat && lng && (
        <Pressable
          onPress={() => Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`)}
        >
          <XStack ai="center" gap="$1.5">
            <MapPin size={14} color="$color10" />
            <Paragraph fontSize="$2" col="$green11" textDecorationLine="underline">
              Lihat lokasi di Google Maps
            </Paragraph>
            <Navigation size={12} color="$green11" />
          </XStack>
        </Pressable>
      )}
    </YStack>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

type PillStatus = 'hadir' | 'terlambat' | 'belum-keluar' | 'alpa' | 'lain'

function derivePillStatus(r: AttendanceHistoryRecord): PillStatus {
  if (!r.clockInAt) return 'alpa'
  if (!r.clockOutAt) return 'belum-keluar'
  const inStatus = (r.clockInStatus ?? '').toLowerCase()
  if (inStatus.includes('terlambat') || inStatus.includes('late')) return 'terlambat'
  return 'hadir'
}

function formatJakartaDate(yyyymmdd: string): string {
  try {
    const d = new Date(yyyymmdd + 'T00:00:00+07:00')
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
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
