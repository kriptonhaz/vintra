/**
 * Referrals home — codes management + summary + tile links to
 * pendaftar (attributions) and commission.
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
  Share,
  Switch,
  TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Edit,
  ExternalLink,
  Gift,
  Plus,
  Users,
  Wallet,
  X,
} from '~/lib/icons'
import {
  useCreateReferralCode,
  useMyAttributions,
  useMyCommissionSummary,
  useMyReferralCodes,
  useReferralCap,
  useToggleReferralCode,
  useUpdateReferralCode,
  type ReferralCode,
} from '~/lib/referrals'
import { useTenant } from '~/lib/tenant-context'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function ReferralsHome() {
  const router = useRouter()
  const { state } = useTenant()
  const slug = state.status === 'ready' ? state.tenant.slug ?? null : null
  const codes = useMyReferralCodes()
  const cap = useReferralCap()
  const summary = useMyCommissionSummary()
  const attributions = useMyAttributions()
  const [editing, setEditing] = useState<ReferralCode | 'new' | null>(null)
  const toggle = useToggleReferralCode()

  if (codes.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Referral" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (codes.error) {
    const isForbidden =
      codes.error instanceof ApiError && codes.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Referral" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke referral.'
              : 'Gagal memuat referral.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const rows = codes.data ?? []
  const capPct = cap.data?.capPct ?? 50

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Referral"
        subtitle="Bagikan kode, dapat komisi"
        back
        right={
          <Pressable
            onPress={() => setEditing('new')}
            style={{
              backgroundColor: COLORS.primary,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Plus size={14} color="#fff" />
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={12} color="#fff">
              Kode
            </Paragraph>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={codes.isFetching || summary.isFetching}
            onRefresh={() => {
              void codes.refetch()
              void summary.refetch()
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Summary hero */}
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
          <Money
            amount={summary.data?.readyToClaimIdr ?? 0}
            color="#fff"
            fontSize={24}
            emphasis
          />
          <XStack ai="baseline" gap="$3" mt="$1">
            <YStack>
              <Stat fontSize={10} color="rgba(255,255,255,0.85)">
                Lifetime
              </Stat>
              <Money
                amount={summary.data?.lifetimeIdr ?? 0}
                fontSize={13}
                color="#fff"
                emphasis
              />
            </YStack>
            <YStack>
              <Stat fontSize={10} color="rgba(255,255,255,0.85)">
                Pending
              </Stat>
              <Money
                amount={summary.data?.pendingIdr ?? 0}
                fontSize={13}
                color="#fff"
                emphasis
              />
            </YStack>
          </XStack>
        </YStack>

        <XStack gap="$2">
          <Pressable
            onPress={() => router.push('/referrals/pendaftar' as never)}
            style={{ flex: 1 }}
          >
            <YStack
              bg={COLORS.surfaceContainerLowest}
              br={14}
              p="$3"
              gap="$1"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
              style={SHADOWS.card}
            >
              <Users size={18} color={COLORS.primary} />
              <Paragraph
                fontFamily={FONTS.bodySemi}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Pendaftar
              </Paragraph>
              <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                {attributions.data?.total ?? 0} tenant
              </Stat>
            </YStack>
          </Pressable>
          <Pressable
            onPress={() => router.push('/referrals/commission' as never)}
            style={{ flex: 1 }}
          >
            <YStack
              bg={COLORS.surfaceContainerLowest}
              br={14}
              p="$3"
              gap="$1"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
              style={SHADOWS.card}
            >
              <Wallet size={18} color="#7c3aed" />
              <Paragraph
                fontFamily={FONTS.bodySemi}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Komisi & Pencairan
              </Paragraph>
              <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                Klaim & riwayat
              </Stat>
            </YStack>
          </Pressable>
        </XStack>

        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={11}
          color={COLORS.onSurfaceVariant}
          letterSpacing={0.55}
          mt="$2"
        >
          KODE REFERRALMU
        </Paragraph>

        {rows.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Gift size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              px="$4"
            >
              Belum ada kode. Buat kode untuk mulai promosi.
            </Paragraph>
          </YStack>
        ) : (
          rows.map((c) => (
            <CodeCard
              key={c.id}
              code={c}
              slug={slug}
              onEdit={() => setEditing(c)}
              onToggle={(active) =>
                toggle.mutate(
                  { id: c.id, isActive: active },
                  {
                    onError: (err) =>
                      Alert.alert(
                        'Gagal',
                        err instanceof Error ? err.message : 'Coba lagi.',
                      ),
                  },
                )
              }
            />
          ))
        )}
      </ScrollView>

      {editing !== null && (
        <CodeEditorModal
          editing={editing}
          capPct={capPct}
          onClose={() => setEditing(null)}
        />
      )}
    </YStack>
  )
}

function CodeCard({
  code,
  slug,
  onEdit,
  onToggle,
}: {
  code: ReferralCode
  slug: string | null
  onEdit: () => void
  onToggle: (active: boolean) => void
}) {
  const refUrl = `https://vintra.my.id?ref=${code.code}`
  async function handleShare() {
    try {
      await Share.share({
        message: `Daftar Vintra pakai kodeku "${code.code}" dapat diskon ${code.discountPct}% — ${refUrl}`,
      })
    } catch {
      // ignore
    }
  }
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={code.isActive ? COLORS.borderSubtle : COLORS.outlineVariant}
      opacity={code.isActive ? 1 : 0.7}
      style={SHADOWS.card}
    >
      <XStack ai="center" jc="space-between">
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.monoMedium}
            fontSize={18}
            color={COLORS.onSurface}
          >
            {code.code}
          </Paragraph>
          {code.label && (
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              {code.label}
            </Stat>
          )}
          <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
            Diskon {code.discountPct}% · Komisi {code.commissionPct}% ·{' '}
            {code.uses} pakai
          </Stat>
        </YStack>
        <Switch
          value={code.isActive}
          onValueChange={onToggle}
          trackColor={{ false: COLORS.outline, true: COLORS.primary }}
          thumbColor="#fff"
        />
      </XStack>
      <XStack gap="$2" mt="$1">
        <Pressable
          onPress={handleShare}
          style={{
            flex: 1,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: COLORS.primary,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <ExternalLink size={12} color="#fff" />
          <Paragraph fontFamily={FONTS.bodyBold} fontSize={12} color="#fff">
            Bagikan
          </Paragraph>
        </Pressable>
        <Pressable
          onPress={onEdit}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: COLORS.borderSubtle,
            backgroundColor: COLORS.surface,
            alignItems: 'center',
            flexDirection: 'row',
            gap: 4,
          }}
        >
          <Edit size={12} color={COLORS.onSurface} />
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={12}
            color={COLORS.onSurface}
          >
            Edit
          </Paragraph>
        </Pressable>
      </XStack>
    </YStack>
  )
}

function CodeEditorModal({
  editing,
  capPct,
  onClose,
}: {
  editing: ReferralCode | 'new'
  capPct: number
  onClose: () => void
}) {
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const create = useCreateReferralCode()
  const update = useUpdateReferralCode()

  const [code, setCode] = useState(initial?.code ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [discount, setDiscount] = useState(
    initial ? String(initial.discountPct) : '10',
  )
  const [commission, setCommission] = useState(
    initial ? String(initial.commissionPct) : '10',
  )

  async function submit() {
    const d = parseFloat(discount) || 0
    const c = parseFloat(commission) || 0
    if (d + c > capPct) {
      Alert.alert(
        'Melebihi cap',
        `Diskon + komisi maksimal ${capPct}% (sekarang ${(d + c).toFixed(1)}%).`,
      )
      return
    }
    if (isNew && !/^[A-Z0-9]{3,20}$/.test(code.trim().toUpperCase())) {
      Alert.alert(
        'Kode tidak valid',
        'Huruf besar + angka, 3-20 karakter.',
      )
      return
    }
    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          label: label.trim() || null,
          discountPct: d,
          commissionPct: c,
        })
      } else {
        await create.mutateAsync({
          code: code.trim().toUpperCase(),
          label: label.trim() || undefined,
          discountPct: d,
          commissionPct: c,
        })
      }
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
            {isNew ? 'Kode baru' : 'Edit kode'}
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
            {isNew && (
              <>
                <FieldLabel>Kode (huruf+angka, 3-20)</FieldLabel>
                <TextInput
                  value={code}
                  onChangeText={(v) => setCode(v.toUpperCase())}
                  placeholder="MIS. BUDI20"
                  placeholderTextColor={COLORS.outline}
                  autoCapitalize="characters"
                  maxLength={20}
                  style={inputStyle}
                />
              </>
            )}
            <FieldLabel>Label (opsional)</FieldLabel>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Mis. Kode FB Ads"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              Total diskon + komisi maks {capPct}%.
            </Stat>
            <XStack gap="$2">
              <YStack flex={1} gap={4}>
                <FieldLabel>Diskon %</FieldLabel>
                <TextInput
                  value={discount}
                  onChangeText={(v) =>
                    setDiscount(v.replace(/[^\d.]/g, ''))
                  }
                  keyboardType="decimal-pad"
                  placeholder="10"
                  placeholderTextColor={COLORS.outline}
                  style={inputStyle}
                />
              </YStack>
              <YStack flex={1} gap={4}>
                <FieldLabel>Komisi %</FieldLabel>
                <TextInput
                  value={commission}
                  onChangeText={(v) =>
                    setCommission(v.replace(/[^\d.]/g, ''))
                  }
                  keyboardType="decimal-pad"
                  placeholder="10"
                  placeholderTextColor={COLORS.outline}
                  style={inputStyle}
                />
              </YStack>
            </XStack>
            <Pressable
              onPress={submit}
              disabled={create.isPending || update.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor:
                  create.isPending || update.isPending
                    ? COLORS.outline
                    : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {create.isPending || update.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Simpan
                </Paragraph>
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

// Check import reserved for future "applied" badge on attributions
const _Check = Check
const _ChevronRight = ChevronRight
const _useEffect = useEffect
