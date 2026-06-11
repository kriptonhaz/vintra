/**
 * Commission & claim — summary, payout method, submit-claim CTA,
 * commissions ledger, claim history.
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
  TextInput,
} from 'react-native'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  CreditCard,
  Edit,
  Wallet,
  X,
} from '~/lib/icons'
import {
  useMyClaimRequests,
  useMyCommissions,
  useMyCommissionSummary,
  useMyPayoutMethod,
  useSubmitClaimRequest,
  useUpsertPayoutMethod,
} from '~/lib/referrals'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const COMMISSION_STATUS_COLOR: Record<string, { fg: string; bg: string; label: string }> = {
  pending: { fg: '#92400e', bg: COLORS.warningTint, label: 'Pending' },
  ready: { fg: COLORS.primary, bg: COLORS.primaryFixed, label: 'Siap klaim' },
  paid: { fg: COLORS.success, bg: '#dcfce7', label: 'Dibayar' },
  reversed: { fg: COLORS.danger, bg: COLORS.dangerTint, label: 'Dibalik' },
}

const CLAIM_STATUS_COLOR: Record<string, { fg: string; bg: string; label: string }> = {
  submitted: { fg: '#92400e', bg: COLORS.warningTint, label: 'Diajukan' },
  approved: { fg: '#2563eb', bg: '#dbeafe', label: 'Disetujui' },
  paid: { fg: COLORS.success, bg: '#dcfce7', label: 'Dibayar' },
  rejected: { fg: COLORS.danger, bg: COLORS.dangerTint, label: 'Ditolak' },
}

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

export default function CommissionScreen() {
  const summary = useMyCommissionSummary()
  const commissions = useMyCommissions()
  const claims = useMyClaimRequests()
  const payout = useMyPayoutMethod()
  const submit = useSubmitClaimRequest()
  const [payoutOpen, setPayoutOpen] = useState(false)

  async function handleSubmit() {
    if (!payout.data) {
      Alert.alert(
        'Atur metode pencairan',
        'Tambah rekening bank dulu sebelum klaim.',
      )
      setPayoutOpen(true)
      return
    }
    Alert.alert(
      'Klaim komisi?',
      `Semua komisi siap-klaim akan diajukan untuk pencairan ke ${payout.data.bankName} ${payout.data.accountNumber} a/n ${payout.data.accountHolder}. Diproses dalam 3-7 hari kerja.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Klaim',
          onPress: () =>
            submit.mutate(undefined, {
              onSuccess: () =>
                Alert.alert('Berhasil', 'Pencairan diajukan.'),
              onError: (err) =>
                Alert.alert(
                  'Gagal',
                  err instanceof Error ? err.message : 'Coba lagi.',
                ),
            }),
        },
      ],
    )
  }

  if (summary.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Komisi & Pencairan" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (summary.error) {
    const isForbidden =
      summary.error instanceof ApiError && summary.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Komisi & Pencairan" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat komisi.'
              : 'Gagal memuat komisi.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const ready = summary.data?.readyToClaimIdr ?? 0

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader title="Komisi & Pencairan" back />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={
              summary.isFetching || commissions.isFetching || claims.isFetching
            }
            onRefresh={() => {
              void summary.refetch()
              void commissions.refetch()
              void claims.refetch()
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Hero */}
        <YStack
          bg={COLORS.primary}
          br={16}
          p="$4"
          gap="$2"
          style={SHADOWS.card}
        >
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={11}
            color="rgba(255,255,255,0.85)"
            letterSpacing={0.4}
          >
            SIAP DICAIRKAN
          </Paragraph>
          <Money amount={ready} color="#fff" fontSize={24} emphasis />
          <Pressable
            onPress={handleSubmit}
            disabled={ready <= 0 || submit.isPending}
            style={{
              marginTop: 8,
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor:
                ready <= 0 || submit.isPending
                  ? 'rgba(255,255,255,0.18)'
                  : '#fff',
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {submit.isPending ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <>
                <Wallet size={14} color={ready > 0 ? COLORS.primary : '#fff'} />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={13}
                  color={ready > 0 ? COLORS.primary : '#fff'}
                >
                  {ready > 0 ? 'Klaim sekarang' : 'Belum ada yang bisa diklaim'}
                </Paragraph>
              </>
            )}
          </Pressable>
        </YStack>

        <XStack gap="$2">
          <StatTile label="Lifetime" value={summary.data?.lifetimeIdr ?? 0} />
          <StatTile label="Pending" value={summary.data?.pendingIdr ?? 0} />
          <StatTile label="Sudah dibayar" value={summary.data?.paidIdr ?? 0} />
        </XStack>

        {/* Payout method */}
        <Pressable onPress={() => setPayoutOpen(true)}>
          <YStack
            bg={COLORS.surfaceContainerLowest}
            br={14}
            p="$3"
            gap="$2"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
            style={SHADOWS.card}
          >
            <XStack ai="center" gap="$3">
              <YStack
                w={40}
                h={40}
                br={12}
                bg="#dbeafe"
                ai="center"
                jc="center"
              >
                <CreditCard size={18} color="#2563eb" />
              </YStack>
              <YStack flex={1}>
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={13}
                  color={COLORS.onSurface}
                >
                  Metode pencairan
                </Paragraph>
                {payout.data ? (
                  <>
                    <Paragraph
                      fontFamily={FONTS.bodyMedium}
                      fontSize={12}
                      color={COLORS.onSurface}
                    >
                      {payout.data.bankName} · {payout.data.accountNumber}
                    </Paragraph>
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                      a/n {payout.data.accountHolder}
                    </Stat>
                  </>
                ) : (
                  <Stat fontSize={11} color={COLORS.danger}>
                    Belum diatur — tap untuk tambah
                  </Stat>
                )}
              </YStack>
              <Edit size={14} color={COLORS.outline} />
            </XStack>
          </YStack>
        </Pressable>

        {/* Claim history */}
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
            RIWAYAT PENCAIRAN
          </Paragraph>
          {(claims.data ?? []).length === 0 ? (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={COLORS.onSurfaceVariant}
            >
              Belum pernah klaim.
            </Paragraph>
          ) : (
            (claims.data ?? []).map((c) => {
              const status = CLAIM_STATUS_COLOR[c.status] ?? {
                fg: COLORS.outline,
                bg: COLORS.surfaceContainerLow,
                label: c.status,
              }
              return (
                <XStack
                  key={c.id}
                  ai="center"
                  jc="space-between"
                  py="$2"
                  borderBottomWidth={1}
                  borderBottomColor={COLORS.borderSubtle}
                >
                  <YStack flex={1}>
                    <Money amount={c.amountIdr} fontSize={13} emphasis />
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                      Diajukan {fmtDate(c.submittedAt)}
                      {c.resolvedAt ? ` · Selesai ${fmtDate(c.resolvedAt)}` : ''}
                    </Stat>
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
              )
            })
          )}
        </YStack>

        {/* Commissions ledger */}
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
            RINCIAN KOMISI
          </Paragraph>
          {(commissions.data ?? []).length === 0 ? (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada komisi tercatat.
            </Paragraph>
          ) : (
            (commissions.data ?? []).slice(0, 50).map((c) => {
              const status = COMMISSION_STATUS_COLOR[c.status] ?? {
                fg: COLORS.outline,
                bg: COLORS.surfaceContainerLow,
                label: c.status,
              }
              return (
                <XStack
                  key={c.id}
                  ai="center"
                  jc="space-between"
                  py="$2"
                  borderBottomWidth={1}
                  borderBottomColor={COLORS.borderSubtle}
                >
                  <YStack flex={1}>
                    <Paragraph
                      fontFamily={FONTS.bodySemi}
                      fontSize={13}
                      color={COLORS.onSurface}
                      numberOfLines={1}
                    >
                      {c.attributedTenantName ?? '-'}
                    </Paragraph>
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                      {fmtDate(c.createdAt)}
                    </Stat>
                  </YStack>
                  <YStack ai="flex-end">
                    <Money amount={c.amountIdr} fontSize={13} />
                    <YStack px={6} py={2} br={6} bg={status.bg}>
                      <Paragraph
                        fontFamily={FONTS.bodyBold}
                        fontSize={9}
                        color={status.fg}
                      >
                        {status.label.toUpperCase()}
                      </Paragraph>
                    </YStack>
                  </YStack>
                </XStack>
              )
            })
          )}
        </YStack>
      </ScrollView>

      {payoutOpen && (
        <PayoutModal
          initial={payout.data ?? null}
          onClose={() => setPayoutOpen(false)}
        />
      )}
    </YStack>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <YStack
      flex={1}
      bg={COLORS.surfaceContainerLowest}
      br={12}
      p="$3"
      gap={2}
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={10}
        color={COLORS.onSurfaceVariant}
        letterSpacing={0.4}
        textTransform="uppercase"
      >
        {label}
      </Paragraph>
      <Money amount={value} fontSize={14} emphasis />
    </YStack>
  )
}

function PayoutModal({
  initial,
  onClose,
}: {
  initial: { bankName: string; accountNumber: string; accountHolder: string } | null
  onClose: () => void
}) {
  const upsert = useUpsertPayoutMethod()
  const [bank, setBank] = useState(initial?.bankName ?? '')
  const [acct, setAcct] = useState(initial?.accountNumber ?? '')
  const [holder, setHolder] = useState(initial?.accountHolder ?? '')

  async function submit() {
    if (!bank.trim() || !acct.trim() || !holder.trim()) {
      Alert.alert('Lengkapi data', 'Bank, nomor, dan nama pemegang wajib diisi.')
      return
    }
    try {
      await upsert.mutateAsync({
        bankName: bank.trim(),
        accountNumber: acct.trim(),
        accountHolder: holder.trim(),
      })
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
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
            Metode pencairan
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
            <FieldLabel>Bank</FieldLabel>
            <TextInput
              value={bank}
              onChangeText={setBank}
              placeholder="Mis. BCA, Mandiri"
              placeholderTextColor={COLORS.outline}
              autoFocus
              style={inputStyle}
            />
            <FieldLabel>Nomor rekening</FieldLabel>
            <TextInput
              value={acct}
              onChangeText={setAcct}
              keyboardType="number-pad"
              placeholder="123456789"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
            <FieldLabel>Nama pemegang</FieldLabel>
            <TextInput
              value={holder}
              onChangeText={setHolder}
              placeholder="Sesuai buku tabungan"
              placeholderTextColor={COLORS.outline}
              autoCapitalize="characters"
              style={inputStyle}
            />
            <XStack
              ai="flex-start"
              gap="$2"
              bg={COLORS.warningTint}
              br={10}
              p="$3"
            >
              <AlertCircle size={14} color="#92400e" />
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color="#92400e"
                flex={1}
              >
                Pastikan nama persis seperti di buku tabungan — transfer ke
                nama lain otomatis ditolak bank.
              </Paragraph>
            </XStack>
            <Pressable
              onPress={submit}
              disabled={upsert.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: upsert.isPending
                  ? COLORS.outline
                  : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {upsert.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <CheckCircle size={14} color="#fff" />
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={14}
                    color="#fff"
                  >
                    Simpan
                  </Paragraph>
                </>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
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
