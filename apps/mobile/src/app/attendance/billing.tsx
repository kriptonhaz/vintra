/**
 * Attendance billing — per-staff per-month plans (1/3/6/12 month
 * variants). Server returns the current plan + billing history; we
 * render the active plan card + the plan options + the txn history.
 */
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView } from 'react-native'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import { AlertTriangle, Check, MessageCircle, Wallet } from '~/lib/icons'
import {
  useAttendanceBillingHistory,
  useAttendanceOverview,
  type AttendanceTransaction,
} from '~/lib/attendance'
import { ApiError } from '~/lib/api'
import { formatRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

interface PlanTier {
  key: string
  durationMonths: number
  pricePerStaffPerMonth: number
  label: string
  savings?: string
}

const PLANS: PlanTier[] = [
  { key: 'attendance_1mo', durationMonths: 1, pricePerStaffPerMonth: 8000, label: 'Bulanan' },
  { key: 'attendance_3mo', durationMonths: 3, pricePerStaffPerMonth: 7000, label: '3 Bulan', savings: '12%' },
  { key: 'attendance_6mo', durationMonths: 6, pricePerStaffPerMonth: 6500, label: '6 Bulan', savings: '19%' },
  { key: 'attendance_12mo', durationMonths: 12, pricePerStaffPerMonth: 6000, label: 'Tahunan', savings: '25%' },
]

const SALES_WA =
  'https://wa.me/6285881732869?text=' +
  encodeURIComponent('Halo Vintra, saya ingin upgrade modul Absensi.')

export const ATT_SALES_WA_PERPANJANG =
  'https://wa.me/6285881732869?text=' +
  encodeURIComponent(
    'Halo Vintra, langganan Absensi saya tidak aktif. Saya ingin perpanjang.',
  )

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

const TX_STATUS_COLOR: Record<string, string> = {
  paid: COLORS.success,
  pending: '#92400e',
  refund: COLORS.danger,
  cancelled: COLORS.outline,
}

export default function AttendanceBillingScreen() {
  const overview = useAttendanceOverview()
  const history = useAttendanceBillingHistory()

  if (overview.isLoading || history.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Paket Absensi" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (overview.error || history.error) {
    const err = overview.error ?? history.error
    const isForbidden = err instanceof ApiError && err.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Paket Absensi" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat billing absensi.'
              : 'Gagal memuat data billing.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const current = overview.data?.currentPlan ?? null
  const settings = overview.data?.settings
  const staff = overview.data?.staff ?? { total: 0, active: 0 }
  const billedCount = settings?.billedStaffCount ?? staff.active

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Paket Absensi"
        subtitle={
          current
            ? `${current.isTrial ? 'Trial' : 'Aktif'} hingga ${fmtDate(current.periodEndAt)}`
            : 'Belum berlangganan'
        }
        back
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={overview.isFetching || history.isFetching}
            onRefresh={() => {
              void overview.refetch()
              void history.refetch()
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Current subscription card */}
        <YStack
          bg={current ? COLORS.primary : COLORS.surfaceContainerLow}
          br={16}
          p="$4"
          gap="$2"
          style={SHADOWS.card}
        >
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={11}
            color={current ? 'rgba(255,255,255,0.85)' : COLORS.onSurfaceVariant}
            letterSpacing={0.4}
          >
            {current?.isTrial ? 'TRIAL AKTIF' : current ? 'PAKET AKTIF' : 'BELUM AKTIF'}
          </Paragraph>
          {current ? (
            <>
              <Money
                amount={current.amountIdr}
                color="#fff"
                fontSize={24}
                emphasis
              />
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color="rgba(255,255,255,0.85)"
              >
                {current.billedStaffCount} staff ×{' '}
                {formatRupiah(current.pricePerStaffPerMonth)}/bulan ·{' '}
                {current.durationMonths} bulan
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color="rgba(255,255,255,0.85)"
              >
                {fmtDate(current.periodStartAt)} → {fmtDate(current.periodEndAt)}
              </Paragraph>
            </>
          ) : (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurface}
            >
              Mulai trial 14 hari atau hubungi sales untuk berlangganan.
            </Paragraph>
          )}
        </YStack>

        {/* Staff usage */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$2"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <SectionLabel>STAFF</SectionLabel>
          <XStack ai="center" jc="space-between">
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Total terdaftar
            </Paragraph>
            <Stat fontSize={14} color={COLORS.onSurface}>
              {staff.total}
            </Stat>
          </XStack>
          <XStack ai="center" jc="space-between">
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Aktif (ditagih)
            </Paragraph>
            <Stat fontSize={14} color={COLORS.primary}>
              {billedCount}
            </Stat>
          </XStack>
        </YStack>

        {/* Plan options */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$3"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <SectionLabel>PILIHAN PAKET</SectionLabel>
          {PLANS.map((p) => {
            const monthlyCost = p.pricePerStaffPerMonth * billedCount
            const isCurrent = current?.planKey === p.key
            return (
              <YStack
                key={p.key}
                bg={isCurrent ? COLORS.primaryFixed : COLORS.surface}
                br={12}
                p="$3"
                gap="$2"
                borderWidth={1}
                borderColor={isCurrent ? COLORS.primary : COLORS.borderSubtle}
              >
                <XStack ai="center" jc="space-between">
                  <XStack ai="center" gap="$2">
                    <Paragraph
                      fontFamily={FONTS.bodySemi}
                      fontSize={14}
                      color={COLORS.onSurface}
                    >
                      {p.label}
                    </Paragraph>
                    {p.savings && (
                      <YStack px={8} py={2} br={999} bg={COLORS.success}>
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          fontSize={10}
                          color="#fff"
                        >
                          HEMAT {p.savings}
                        </Paragraph>
                      </YStack>
                    )}
                    {isCurrent && (
                      <YStack px={8} py={2} br={999} bg={COLORS.primary}>
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          fontSize={10}
                          color="#fff"
                        >
                          AKTIF
                        </Paragraph>
                      </YStack>
                    )}
                  </XStack>
                </XStack>
                <Stat fontSize={12} color={COLORS.onSurfaceVariant}>
                  {formatRupiah(p.pricePerStaffPerMonth)}/staff/bulan
                </Stat>
                <XStack ai="baseline" gap="$2">
                  <Money amount={monthlyCost} fontSize={16} emphasis />
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    / bulan untuk {billedCount} staff
                  </Paragraph>
                </XStack>
              </YStack>
            )
          })}
          <Pressable
            onPress={() => void Linking.openURL(SALES_WA)}
            style={{
              marginTop: 4,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Wallet size={14} color="#fff" />
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={13} color="#fff">
              {current ? 'Perpanjang via sales' : 'Hubungi sales'}
            </Paragraph>
          </Pressable>
        </YStack>

        {/* Billing history */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$3"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <SectionLabel>RIWAYAT TRANSAKSI</SectionLabel>
          {(history.data ?? []).length === 0 ? (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada transaksi tercatat.
            </Paragraph>
          ) : (
            (history.data ?? []).map((tx) => <TxRow key={tx.id} tx={tx} />)
          )}
        </YStack>
      </ScrollView>
    </YStack>
  )
}

function TxRow({ tx }: { tx: AttendanceTransaction }) {
  const color = TX_STATUS_COLOR[tx.status] ?? COLORS.onSurfaceVariant
  return (
    <YStack
      gap={4}
      py="$2"
      borderBottomWidth={1}
      borderBottomColor={COLORS.borderSubtle}
    >
      <XStack ai="center" jc="space-between">
        <Paragraph
          fontFamily={FONTS.bodySemi}
          fontSize={13}
          color={COLORS.onSurface}
        >
          {tx.invoiceNumber ?? `Trx ${tx.id.slice(0, 8)}`}
        </Paragraph>
        <Money
          amount={tx.amountIdr}
          fontSize={13}
          color={tx.status === 'refund' ? COLORS.danger : COLORS.onSurface}
          emphasis
        />
      </XStack>
      <XStack ai="center" gap="$2">
        <YStack px={6} py={2} br={6} bg={`${color}22`}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={10}
            color={color}
            textTransform="uppercase"
          >
            {tx.status}
          </Paragraph>
        </YStack>
        <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
          {tx.billedStaffCount ?? 0} staff ·{' '}
          {fmtDate(tx.periodStartAt)} → {fmtDate(tx.periodEndAt)}
        </Stat>
      </XStack>
    </YStack>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Paragraph
      fontFamily={FONTS.bodyBold}
      fontSize={11}
      color={COLORS.onSurfaceVariant}
      letterSpacing={0.55}
    >
      {children}
    </Paragraph>
  )
}

// Re-export to keep Check import live in case future review actions need it
export const _CheckIcon = Check
export const _MessageCircleIcon = MessageCircle
