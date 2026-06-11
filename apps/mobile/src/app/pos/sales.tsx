/**
 * Z-Report (Laporan Penjualan Harian) — daily POS rollup that the
 * web's /pos/sales?date= notification deep-links into.
 *
 * Surfaces:
 *   - Date picker chip (defaults to today, ?date= overrides)
 *   - Summary tiles: transaksi, omzet, void
 *   - Metode bayar breakdown (rows w/ count + amount)
 *   - Top 5 items by qty
 *   - Rekonsiliasi Kas (cash session list w/ variance)
 *
 * The data is one server call (`getDailyZReport`) so the screen is a
 * single query state — loading / error / data. Tier-gated server-side
 * (`daily_zreport` POS feature, Toko+).
 */
import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView } from 'react-native'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Paragraph, Sheet, Spinner, XStack, YStack } from 'tamagui'
import {
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronDown,
  Check,
  Banknote,
  ShoppingCart,
  Package,
  TrendingDown,
} from '~/lib/icons'
import {
  useDailyZReport,
  type DailyZReport,
  type CashSessionRow,
  type POSPaymentMethod,
} from '../../lib/pos-sales'
import { useOutlet } from '../../lib/outlet-context'
import { formatRupiah } from '../../lib/currency'
import { COLORS, FONTS, SHADOWS } from '../../lib/theme'

const PAYMENT_METHOD_LABEL: Record<POSPaymentMethod, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  ewallet: 'E-Wallet',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
  ovo: 'OVO',
}

function jakartaTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isValidYmd(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

export default function SalesScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ date?: string }>()
  const initialDate = isValidYmd(params.date) ? params.date : jakartaTodayYmd()
  const [date, setDate] = useState(initialDate)
  const [pickerOpen, setPickerOpen] = useState(false)

  const { selectedBranchId } = useOutlet()
  const query = useDailyZReport({ date, branchId: selectedBranchId })

  const isAccessError = useMemo(() => {
    if (!query.error) return false
    const msg = query.error instanceof Error ? query.error.message : ''
    return (
      msg.toLowerCase().includes('forbidden') ||
      msg.toLowerCase().includes('upgrade') ||
      msg.toLowerCase().includes('toko') ||
      msg.toLowerCase().includes('feature')
    )
  }, [query.error])

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <YStack flex={1} bg={COLORS.background}>
        <YStack bg={COLORS.primary} pt={60} pb="$4" px="$5" gap="$3">
          <XStack ai="center" jc="space-between">
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <YStack
                w={36}
                h={36}
                br={18}
                bg={COLORS.primaryFixed}
                ai="center"
                jc="center"
              >
                <ChevronLeft size={22} color={COLORS.primary} />
              </YStack>
            </Pressable>
            <YStack flex={1} ai="center">
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color="white"
                opacity={0.8}
              >
                Laporan Harian (Z-Report)
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.headingBold}
                fontSize={18}
                color="white"
              >
                Penjualan
              </Paragraph>
            </YStack>
            <YStack w={36} />
          </XStack>

          <Pressable onPress={() => setPickerOpen(true)}>
            <XStack
              ai="center"
              gap="$2"
              bg="rgba(255,255,255,0.15)"
              br={9999}
              px="$3.5"
              h={42}
              borderWidth={1}
              borderColor="rgba(255,255,255,0.25)"
              alignSelf="center"
            >
              <Calendar size={14} color="white" />
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={13}
                color="white"
              >
                {formatJakartaDate(date)}
              </Paragraph>
              <ChevronDown size={14} color="white" />
            </XStack>
          </Pressable>
        </YStack>

        {query.isLoading ? (
          <YStack flex={1} ai="center" jc="center" gap="$3">
            <Spinner color={COLORS.primary} size="large" />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Memuat laporan...
            </Paragraph>
          </YStack>
        ) : query.error ? (
          <ErrorState
            isAccessError={isAccessError}
            message={
              query.error instanceof Error
                ? query.error.message
                : 'Gagal memuat laporan.'
            }
            onRetry={() => query.refetch()}
          />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={query.isFetching}
                onRefresh={() => query.refetch()}
                tintColor={COLORS.primary}
              />
            }
          >
            <SummaryTiles report={query.data!} />
            <PaymentMethodCard report={query.data!} />
            <TopItemsCard report={query.data!} />
            <CashReconciliationCard report={query.data!} />
          </ScrollView>
        )}

        <DatePickerSheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          current={date}
          onPick={(d) => {
            setDate(d)
            setPickerOpen(false)
          }}
        />
      </YStack>
    </>
  )
}

// ─── Summary ─────────────────────────────────────────────────────────

function SummaryTiles({ report }: { report: DailyZReport }) {
  return (
    <YStack gap="$2.5">
      <SectionLabel>Ringkasan Hari Ini</SectionLabel>
      <XStack gap="$2.5">
        <SummaryTile
          icon={<ShoppingCart size={18} color={COLORS.success} />}
          tint={COLORS.successTint}
          fg={COLORS.success}
          value={String(report.salesCount)}
          label="Transaksi"
        />
        <SummaryTile
          icon={<Banknote size={18} color={COLORS.primary} />}
          tint={COLORS.primaryFixed}
          fg={COLORS.primary}
          value={formatRupiahShort(report.totalRevenue)}
          label="Omzet"
        />
        <SummaryTile
          icon={<TrendingDown size={18} color={COLORS.danger} />}
          tint={COLORS.dangerTint}
          fg={COLORS.danger}
          value={String(report.voidedCount)}
          label="Dibatalkan"
        />
      </XStack>
    </YStack>
  )
}

function SummaryTile({
  icon,
  tint,
  fg,
  value,
  label,
}: {
  icon: React.ReactNode
  tint: string
  fg: string
  value: string
  label: string
}) {
  return (
    <YStack
      flex={1}
      bg={COLORS.surfaceContainerLowest}
      br={18}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
      overflow="hidden"
      position="relative"
    >
      <YStack
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        w={3}
        bg={fg}
      />
      <YStack
        w={32}
        h={32}
        br={10}
        bg={tint}
        ai="center"
        jc="center"
      >
        {icon}
      </YStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        lineHeight={22}
        color={fg}
        numberOfLines={1}
      >
        {value}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.bodyMedium}
        fontSize={11}
        color={COLORS.onSurface}
        numberOfLines={1}
      >
        {label}
      </Paragraph>
    </YStack>
  )
}

// ─── Payment-method breakdown ────────────────────────────────────────

function PaymentMethodCard({ report }: { report: DailyZReport }) {
  if (report.byPaymentMethod.length === 0) return null

  const total = report.byPaymentMethod.reduce((acc, r) => acc + r.total, 0)

  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={18}
      p="$4"
      gap="$3"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <SectionLabel>Metode Pembayaran</SectionLabel>
      <YStack gap="$2">
        {report.byPaymentMethod.map((row) => {
          const pct = total > 0 ? (row.total / total) * 100 : 0
          return (
            <YStack key={row.method} gap={4}>
              <XStack ai="center" jc="space-between" gap="$2">
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={13}
                  color={COLORS.onSurface}
                >
                  {PAYMENT_METHOD_LABEL[row.method] ?? row.method}
                </Paragraph>
                <YStack ai="flex-end">
                  <Paragraph
                    fontFamily={FONTS.monoMedium}
                    fontSize={13}
                    color={COLORS.onSurface}
                  >
                    {formatRupiah(row.total)}
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={10}
                    color={COLORS.onSurfaceVariant}
                  >
                    {row.count} transaksi
                  </Paragraph>
                </YStack>
              </XStack>
              {/* Progress bar */}
              <YStack
                h={4}
                br={9999}
                bg={COLORS.surfaceContainerLow}
                overflow="hidden"
              >
                <YStack
                  h="100%"
                  bg={COLORS.primary}
                  width={`${Math.max(2, pct)}%`}
                />
              </YStack>
            </YStack>
          )
        })}
      </YStack>
    </YStack>
  )
}

// ─── Top items ──────────────────────────────────────────────────────

function TopItemsCard({ report }: { report: DailyZReport }) {
  if (report.topItems.length === 0) return null

  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={18}
      p="$4"
      gap="$3"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <SectionLabel>Top 5 Item</SectionLabel>
      <YStack gap="$2">
        {report.topItems.map((item, idx) => (
          <XStack key={`${item.name}-${idx}`} ai="center" gap="$3">
            <YStack
              w={28}
              h={28}
              br={14}
              bg={COLORS.primaryFixed}
              ai="center"
              jc="center"
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.primary}
              >
                {idx + 1}
              </Paragraph>
            </YStack>
            <YStack flex={1}>
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={13}
                color={COLORS.onSurface}
                numberOfLines={1}
              >
                {item.name}
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
              >
                {item.qtySold % 1 === 0
                  ? item.qtySold.toLocaleString('id-ID')
                  : item.qtySold.toFixed(2)}{' '}
                terjual
              </Paragraph>
            </YStack>
            <Paragraph
              fontFamily={FONTS.monoMedium}
              fontSize={13}
              color={COLORS.onSurface}
            >
              {formatRupiah(item.revenue)}
            </Paragraph>
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}

// ─── Cash reconciliation ────────────────────────────────────────────

function CashReconciliationCard({ report }: { report: DailyZReport }) {
  const { sessions, totalVariance } = report.cashReconciliation
  if (sessions.length === 0) {
    return (
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={18}
        p="$4"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        style={SHADOWS.card}
      >
        <SectionLabel>Rekonsiliasi Kas</SectionLabel>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={12}
          color={COLORS.onSurfaceVariant}
        >
          Tidak ada sesi kas dibuka di hari ini.
        </Paragraph>
      </YStack>
    )
  }

  const varianceColor =
    totalVariance === 0
      ? COLORS.onSurface
      : totalVariance > 0
        ? COLORS.success
        : COLORS.danger

  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={18}
      p="$4"
      gap="$3"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <XStack ai="center" jc="space-between">
        <SectionLabel>Rekonsiliasi Kas</SectionLabel>
        <YStack ai="flex-end">
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={10}
            color={COLORS.onSurfaceVariant}
          >
            Total selisih
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.monoMedium}
            fontSize={14}
            color={varianceColor}
          >
            {totalVariance >= 0 ? '+' : ''}
            {formatRupiah(totalVariance)}
          </Paragraph>
        </YStack>
      </XStack>
      <YStack gap="$2">
        {sessions.map((s) => (
          <CashSessionRowCard key={s.id} session={s} />
        ))}
      </YStack>
    </YStack>
  )
}

function CashSessionRowCard({ session }: { session: CashSessionRow }) {
  const variance = session.variance
  const isOpen = session.status === 'open'
  const varianceColor =
    variance == null
      ? COLORS.onSurfaceVariant
      : variance === 0
        ? COLORS.success
        : variance > 0
          ? COLORS.success
          : COLORS.danger

  return (
    <YStack
      bg={COLORS.surfaceContainerLow}
      br={12}
      px="$3"
      py="$2.5"
      gap="$1.5"
      borderWidth={1}
      borderColor={COLORS.outlineVariant}
    >
      <XStack ai="center" jc="space-between" gap="$2">
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={13}
            color={COLORS.onSurface}
            numberOfLines={1}
          >
            {session.branchName}
          </Paragraph>
          {session.cashierName && (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
            >
              {session.cashierName}
            </Paragraph>
          )}
        </YStack>
        <YStack
          bg={isOpen ? COLORS.warningTint : COLORS.successTint}
          br={9999}
          px="$2"
          py={1}
        >
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={9}
            color={isOpen ? COLORS.warning : COLORS.success}
            letterSpacing={0.3}
          >
            {isOpen ? 'BUKA' : session.forceClosed ? 'TUTUP PAKSA' : 'TUTUP'}
          </Paragraph>
        </YStack>
      </XStack>
      <XStack gap="$3">
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={9}
            color={COLORS.outline}
            letterSpacing={0.3}
          >
            EXPECTED
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.monoMedium}
            fontSize={12}
            color={COLORS.onSurface}
          >
            {formatRupiah(session.expectedClosing)}
          </Paragraph>
        </YStack>
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={9}
            color={COLORS.outline}
            letterSpacing={0.3}
          >
            AKTUAL
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.monoMedium}
            fontSize={12}
            color={COLORS.onSurface}
          >
            {session.actualClosing != null
              ? formatRupiah(session.actualClosing)
              : '—'}
          </Paragraph>
        </YStack>
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={9}
            color={COLORS.outline}
            letterSpacing={0.3}
          >
            SELISIH
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.monoMedium}
            fontSize={12}
            color={varianceColor}
          >
            {variance != null
              ? `${variance > 0 ? '+' : ''}${formatRupiah(variance)}`
              : '—'}
          </Paragraph>
        </YStack>
      </XStack>
    </YStack>
  )
}

// ─── States ──────────────────────────────────────────────────────────

function ErrorState({
  isAccessError,
  message,
  onRetry,
}: {
  isAccessError: boolean
  message: string
  onRetry: () => void
}) {
  return (
    <YStack flex={1} ai="center" jc="center" gap="$3" px="$6">
      <YStack
        w={88}
        h={88}
        br={44}
        bg={isAccessError ? COLORS.primaryFixed : COLORS.dangerTint}
        ai="center"
        jc="center"
      >
        {isAccessError ? (
          <Package size={40} color={COLORS.primary} />
        ) : (
          <AlertCircle size={40} color={COLORS.danger} />
        )}
      </YStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        color={COLORS.onSurface}
        ta="center"
      >
        {isAccessError ? 'Fitur Z-Report belum aktif' : 'Gagal memuat laporan'}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        lineHeight={20}
        color={COLORS.onSurfaceVariant}
        ta="center"
        maxWidth={300}
      >
        {isAccessError
          ? 'Z-Report harian tersedia mulai paket Toko ke atas. Upgrade dari dashboard web untuk mengaktifkan.'
          : message}
      </Paragraph>
      {!isAccessError && (
        <Pressable onPress={onRetry}>
          <YStack bg={COLORS.primary} br={9999} px="$5" py="$2.5" mt="$2">
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={14}
              color="white"
            >
              Coba lagi
            </Paragraph>
          </YStack>
        </Pressable>
      )}
    </YStack>
  )
}

// ─── Date picker — quick relative dates + raw YMD input ─────────────

function DatePickerSheet({
  open,
  onClose,
  current,
  onPick,
}: {
  open: boolean
  onClose: () => void
  current: string
  onPick: (date: string) => void
}) {
  const today = jakartaTodayYmd()
  const quickRanges = useMemo(() => buildQuickDates(today), [today])

  return (
    <Sheet
      modal
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose()
      }}
      snapPoints={[40]}
      dismissOnSnapToBottom
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame
        bg={COLORS.surfaceContainerLowest}
        padding="$4"
        gap="$3"
      >
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={16}
          color={COLORS.onSurface}
        >
          Pilih Tanggal
        </Paragraph>
        <YStack gap="$1.5">
          {quickRanges.map((opt) => {
            const active = opt.value === current
            return (
              <Pressable key={opt.value} onPress={() => onPick(opt.value)}>
                <XStack
                  ai="center"
                  jc="space-between"
                  bg={active ? COLORS.primaryFixed : COLORS.surfaceContainerLow}
                  br="$3"
                  px="$3"
                  py="$2.5"
                  borderWidth={1}
                  borderColor={active ? COLORS.primary : COLORS.outlineVariant}
                >
                  <Paragraph
                    fontFamily={active ? FONTS.bodySemi : FONTS.bodyMedium}
                    fontSize={14}
                    color={active ? COLORS.primary : COLORS.onSurface}
                  >
                    {opt.label}
                  </Paragraph>
                  {active && <Check size={16} color={COLORS.primary} />}
                </XStack>
              </Pressable>
            )
          })}
        </YStack>
      </Sheet.Frame>
    </Sheet>
  )
}

function buildQuickDates(today: string): Array<{ value: string; label: string }> {
  const [y, m, d] = today.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  const out: Array<{ value: string; label: string }> = []
  for (let i = 0; i < 7; i++) {
    const dt = new Date(base)
    dt.setUTCDate(dt.getUTCDate() - i)
    const ymd = dt.toISOString().slice(0, 10)
    out.push({
      value: ymd,
      label: i === 0 ? 'Hari ini' : i === 1 ? 'Kemarin' : formatJakartaDate(ymd),
    })
  }
  return out
}

// ─── Helpers ────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Paragraph
      fontFamily={FONTS.bodyBold}
      fontSize={11}
      color={COLORS.onSurfaceVariant}
      letterSpacing={0.55}
      textTransform="uppercase"
    >
      {children}
    </Paragraph>
  )
}

function formatJakartaDate(ymd: string): string {
  try {
    const d = new Date(`${ymd}T00:00:00+07:00`)
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d)
  } catch {
    return ymd
  }
}

/**
 * Compact Rupiah for the summary tile — adds "jt" / "rb" suffix so
 * Rp 8.250.000 fits within a narrow column without truncation.
 */
function formatRupiahShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    const v = n / 1_000_000
    const rounded = Math.round(v * 10) / 10
    return `Rp ${rounded.toLocaleString('id-ID')}jt`
  }
  if (Math.abs(n) >= 1_000) {
    const v = n / 1_000
    const rounded = Math.round(v * 10) / 10
    return `Rp ${rounded.toLocaleString('id-ID')}rb`
  }
  return formatRupiah(n)
}
