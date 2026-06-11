/**
 * Peti Kas history — all cash sessions (open + closed) with opening
 * balance, expected vs actual closing, and variance. Tap a row to
 * see its movement ledger.
 *
 * Server-side gating: cashiers see only their own sessions; supervisors
 * + owners see everyone. The fn enforces this — we don't filter
 * client-side.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
} from 'react-native'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  X,
} from '~/lib/icons'
import {
  useCashSessionDetail,
  useCashSessionsList,
  type CashMovement,
  type CashSessionListRow,
} from '~/lib/pos-cash'
import { ApiError } from '~/lib/api'
import { formatRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

type StatusFilter = 'all' | 'open' | 'closed'

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'open', label: 'Buka' },
  { key: 'closed', label: 'Tutup' },
]

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function cashierName(s: CashSessionListRow): string {
  const first = s.cashierFirstName?.trim() ?? ''
  const last = s.cashierLastName?.trim() ?? ''
  const name = `${first} ${last}`.trim()
  return name || '(Kasir)'
}

export default function CashSessionsScreen() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [varianceOnly, setVarianceOnly] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const listQuery = useCashSessionsList({
    status: statusFilter,
    hasVarianceOnly: varianceOnly,
  })

  const sessions = listQuery.data?.sessions ?? []
  const stats = useMemo(() => {
    const open = sessions.filter((s) => s.status === 'open').length
    const variance = sessions
      .map((s) => Number(s.variance ?? 0))
      .filter((v) => v !== 0)
    const totalVar = variance.reduce((acc, v) => acc + v, 0)
    return { open, varianceCount: variance.length, totalVar }
  }, [sessions])

  if (listQuery.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Peti Kas" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }

  if (listQuery.error) {
    const err = listQuery.error
    const isForbidden = err instanceof ApiError && err.status === 403
    const isLocked =
      err instanceof ApiError && /Peti Kas/i.test(err.message)
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Peti Kas" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke Peti Kas.'
              : isLocked
                ? 'Peti Kas belum aktif untuk usaha ini. Aktifkan di Pengaturan POS.'
                : 'Gagal memuat sesi kas. Cek koneksi & coba lagi.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Peti Kas"
        subtitle={`${listQuery.data?.total ?? 0} sesi`}
        back
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={listQuery.isFetching}
            onRefresh={() => listQuery.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Stat strip */}
        <XStack gap="$3">
          <StatTile
            label="Sesi Terbuka"
            value={String(stats.open)}
            tint={COLORS.primaryFixed}
            fg={COLORS.primary}
          />
          <StatTile
            label="Ada Selisih"
            value={String(stats.varianceCount)}
            tint={
              stats.varianceCount > 0 ? COLORS.dangerTint : COLORS.successTint
            }
            fg={stats.varianceCount > 0 ? COLORS.danger : COLORS.success}
          />
        </XStack>

        {/* Filters */}
        <YStack gap="$2">
          <XStack gap="$2">
            {STATUS_OPTIONS.map((opt) => {
              const active = opt.key === statusFilter
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setStatusFilter(opt.key)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    backgroundColor: active
                      ? COLORS.primary
                      : COLORS.surfaceContainerLowest,
                    borderWidth: 1,
                    borderColor: active ? COLORS.primary : COLORS.borderSubtle,
                  }}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={12}
                    color={active ? '#fff' : COLORS.onSurface}
                  >
                    {opt.label}
                  </Paragraph>
                </Pressable>
              )
            })}
            <Pressable
              onPress={() => setVarianceOnly((v) => !v)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 999,
                backgroundColor: varianceOnly
                  ? COLORS.danger
                  : COLORS.surfaceContainerLowest,
                borderWidth: 1,
                borderColor: varianceOnly ? COLORS.danger : COLORS.borderSubtle,
              }}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={varianceOnly ? '#fff' : COLORS.onSurface}
              >
                Selisih
              </Paragraph>
            </Pressable>
          </XStack>
        </YStack>

        {/* List */}
        {sessions.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={14}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada sesi kas dengan filter ini.
            </Paragraph>
          </YStack>
        ) : (
          <YStack gap="$2">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                onPress={() => setOpenId(s.id)}
              />
            ))}
          </YStack>
        )}
      </ScrollView>

      <SessionDetailModal
        sessionId={openId}
        onClose={() => setOpenId(null)}
      />
    </YStack>
  )
}

// ─── Subcomponents ──────────────────────────────────────────────────

function StatTile({
  label,
  value,
  tint,
  fg,
}: {
  label: string
  value: string
  tint: string
  fg: string
}) {
  return (
    <YStack
      flex={1}
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$1"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <Paragraph
        fontFamily={FONTS.bodySemi}
        fontSize={11}
        color={COLORS.onSurfaceVariant}
        textTransform="uppercase"
        letterSpacing={0.4}
      >
        {label}
      </Paragraph>
      <XStack ai="center" gap="$2">
        <YStack w={8} h={8} br={4} bg={fg} />
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={20}
          color={COLORS.onSurface}
        >
          {value}
        </Paragraph>
      </XStack>
    </YStack>
  )
}

function SessionCard({
  session,
  onPress,
}: {
  session: CashSessionListRow
  onPress: () => void
}) {
  const variance = session.variance !== null ? Number(session.variance) : null
  const hasVar = variance !== null && variance !== 0
  const isOpen = session.status === 'open'

  return (
    <Pressable onPress={onPress}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
      >
        <XStack ai="center" jc="space-between">
          <XStack ai="center" gap="$2">
            <StatusPill status={isOpen ? 'open' : 'closed'} />
            {session.forceClosed && (
              <YStack px={8} py={2} br={6} bg={COLORS.warningTint}>
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={10}
                  color="#92400e"
                >
                  Force Closed
                </Paragraph>
              </YStack>
            )}
          </XStack>
          <ChevronRight size={18} color={COLORS.outline} />
        </XStack>

        <Paragraph
          fontFamily={FONTS.bodySemi}
          fontSize={14}
          color={COLORS.onSurface}
        >
          {session.branchName}
        </Paragraph>
        <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
          {cashierName(session)} · {fmtDateTime(session.openedAt)}
          {session.closedAt ? ` → ${fmtDateTime(session.closedAt)}` : ''}
        </Stat>

        <XStack ai="center" jc="space-between" mt={4}>
          <YStack gap={2}>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
            >
              Modal Awal
            </Paragraph>
            <Money amount={Number(session.openingBalance) || 0} fontSize={13} />
          </YStack>
          {session.expectedClosing !== null && (
            <YStack gap={2} ai="flex-end">
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
              >
                Selisih
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.monoMedium}
                fontSize={13}
                color={
                  !hasVar
                    ? COLORS.success
                    : (variance ?? 0) > 0
                      ? COLORS.success
                      : COLORS.danger
                }
              >
                {hasVar ? formatVariance(variance ?? 0) : 'Pas'}
              </Paragraph>
            </YStack>
          )}
        </XStack>
      </YStack>
    </Pressable>
  )
}

function StatusPill({ status }: { status: 'open' | 'closed' }) {
  const isOpen = status === 'open'
  return (
    <YStack
      px={8}
      py={2}
      br={6}
      bg={isOpen ? COLORS.primaryFixed : COLORS.surfaceContainerLow}
    >
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={10}
        color={isOpen ? COLORS.primary : COLORS.onSurfaceVariant}
      >
        {isOpen ? 'BUKA' : 'TUTUP'}
      </Paragraph>
    </YStack>
  )
}

function formatVariance(v: number): string {
  const sign = v > 0 ? '+' : '-'
  return `${sign}${formatRupiah(Math.abs(v))}`
}

// ─── Detail modal ───────────────────────────────────────────────────

const MOVEMENT_LABELS: Record<string, { label: string; color: string }> = {
  sale: { label: 'Penjualan Tunai', color: COLORS.success },
  refund: { label: 'Refund', color: COLORS.danger },
  drop: { label: 'Setor Tunai', color: COLORS.primary },
  payout: { label: 'Tarik Tunai', color: COLORS.danger },
}

function SessionDetailModal({
  sessionId,
  onClose,
}: {
  sessionId: string | null
  onClose: () => void
}) {
  const detailQuery = useCashSessionDetail(sessionId)
  const session = detailQuery.data?.session
  const movements = detailQuery.data?.movements ?? []

  return (
    <Modal
      visible={!!sessionId}
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
            Detail Sesi Kas
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        {detailQuery.isLoading ? (
          <YStack flex={1} ai="center" jc="center">
            <ActivityIndicator color={COLORS.primary} />
          </YStack>
        ) : !session ? (
          <YStack flex={1} ai="center" jc="center" px="$5">
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={14}
              color={COLORS.onSurfaceVariant}
              ta="center"
            >
              Sesi kas tidak ditemukan.
            </Paragraph>
          </YStack>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            <YStack
              bg={COLORS.surfaceContainerLowest}
              br={14}
              p="$3"
              gap="$2"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
            >
              <XStack ai="center" jc="space-between">
                <Paragraph
                  fontFamily={FONTS.bodySemi}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  {session.branchName}
                </Paragraph>
                <StatusPill
                  status={session.status === 'open' ? 'open' : 'closed'}
                />
              </XStack>
              <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                {cashierName(session)}
              </Stat>
              <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                {fmtDateTime(session.openedAt)}
                {session.closedAt ? ` → ${fmtDateTime(session.closedAt)}` : ''}
              </Stat>
              {session.openingNotes ? (
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={12}
                  color={COLORS.onSurfaceVariant}
                >
                  Catatan buka: {session.openingNotes}
                </Paragraph>
              ) : null}
              {session.closingNotes ? (
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={12}
                  color={COLORS.onSurfaceVariant}
                >
                  Catatan tutup: {session.closingNotes}
                </Paragraph>
              ) : null}
            </YStack>

            <YStack
              bg={COLORS.surfaceContainerLowest}
              br={14}
              p="$3"
              gap="$2"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
            >
              <SummaryRow
                label="Modal Awal"
                value={formatRupiah(Number(session.openingBalance) || 0)}
              />
              <SummaryRow
                label="Setor Tunai"
                value={`+ ${formatRupiah(Number(session.cashInTotal) || 0)}`}
              />
              <SummaryRow
                label="Tarik / Refund"
                value={`- ${formatRupiah(Number(session.cashOutTotal) || 0)}`}
              />
              {session.expectedClosing !== null && (
                <SummaryRow
                  label="Seharusnya"
                  value={formatRupiah(Number(session.expectedClosing) || 0)}
                />
              )}
              {session.actualClosing !== null && (
                <SummaryRow
                  label="Aktual"
                  value={formatRupiah(Number(session.actualClosing) || 0)}
                />
              )}
              {session.variance !== null && (
                <SummaryRow
                  label="Selisih"
                  value={formatVariance(Number(session.variance))}
                  bold
                />
              )}
            </YStack>

            <YStack
              bg={COLORS.surfaceContainerLowest}
              br={14}
              p="$3"
              gap="$2"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
                letterSpacing={0.55}
              >
                {`PERGERAKAN KAS (${movements.length})`}
              </Paragraph>
              {movements.length === 0 ? (
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={12}
                  color={COLORS.onSurfaceVariant}
                >
                  Belum ada pergerakan kas di sesi ini.
                </Paragraph>
              ) : (
                movements.map((m) => <MovementRow key={m.id} m={m} />)
              )}
            </YStack>
          </ScrollView>
        )}
      </YStack>
    </Modal>
  )
}

function MovementRow({ m }: { m: CashMovement }) {
  const meta = MOVEMENT_LABELS[m.type] ?? {
    label: m.type,
    color: COLORS.onSurfaceVariant,
  }
  const amount = Number(m.amount) || 0
  const incoming = m.type === 'sale' || m.type === 'drop'
  const Icon = incoming ? ArrowDownToLine : ArrowUpFromLine
  return (
    <XStack ai="center" gap="$2" py="$1">
      <YStack
        w={28}
        h={28}
        br={9}
        ai="center"
        jc="center"
        bg={`${meta.color}22`}
      >
        <Icon size={14} color={meta.color} />
      </YStack>
      <YStack flex={1}>
        <Paragraph
          fontFamily={FONTS.bodyMedium}
          fontSize={13}
          color={COLORS.onSurface}
        >
          {meta.label}
          {m.referenceSaleNumber ? ` · ${m.referenceSaleNumber}` : ''}
        </Paragraph>
        {m.reason ? (
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            numberOfLines={1}
          >
            {m.reason}
          </Paragraph>
        ) : null}
        <Stat fontSize={10} color={COLORS.onSurfaceVariant}>
          {fmtDateTime(m.createdAt)}
        </Stat>
      </YStack>
      <Paragraph
        fontFamily={FONTS.monoMedium}
        fontSize={13}
        color={incoming ? COLORS.success : COLORS.danger}
      >
        {incoming ? '+' : '-'}
        {formatRupiah(amount)}
      </Paragraph>
    </XStack>
  )
}

function SummaryRow({
  label,
  value,
  bold,
}: {
  label: string
  value: string
  bold?: boolean
}) {
  return (
    <XStack ai="center" jc="space-between">
      <Paragraph
        fontFamily={bold ? FONTS.bodyBold : FONTS.body}
        fontSize={13}
        color={bold ? COLORS.onSurface : COLORS.onSurfaceVariant}
      >
        {label}
      </Paragraph>
      <Paragraph
        fontFamily={bold ? FONTS.monoMedium : FONTS.mono}
        fontSize={bold ? 14 : 13}
        color={COLORS.onSurface}
      >
        {value}
      </Paragraph>
    </XStack>
  )
}
