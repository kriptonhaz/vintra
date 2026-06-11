/**
 * Pendaftar — list of tenants who signed up using your referral codes.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
} from 'react-native'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import { AlertTriangle, CheckCircle, Search, User, Users } from '~/lib/icons'
import { useMyAttributions } from '~/lib/referrals'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

function fmtDate(iso: string): string {
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

export default function PendaftarScreen() {
  const [search, setSearch] = useState('')
  const query = useMyAttributions(search)

  const items = query.data?.items ?? []
  const stats = useMemo(() => {
    const total = query.data?.total ?? 0
    const paid = items.filter((a) => a.firstPaidAt).length
    const totalCommission = items.reduce(
      (s, a) => s + a.lifetimeCommissionIdr,
      0,
    )
    return { total, paid, totalCommission }
  }, [items, query.data])

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pendaftar" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (query.error) {
    const isForbidden =
      query.error instanceof ApiError && query.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pendaftar" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat pendaftar.'
              : 'Gagal memuat pendaftar.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Pendaftar"
        subtitle={`${stats.total} tenant · ${stats.paid} bayar`}
        back
      />

      <YStack px="$4" pt="$3" pb="$2">
        <XStack
          ai="center"
          gap="$2"
          bg={COLORS.surfaceContainerLowest}
          br={12}
          px="$3"
          h={44}
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <Search size={16} color={COLORS.outline} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Cari nama tenant"
            placeholderTextColor={COLORS.outline}
            style={{
              flex: 1,
              fontFamily: FONTS.body,
              fontSize: 14,
              color: COLORS.onSurface,
              paddingVertical: 0,
            }}
          />
        </XStack>
      </YStack>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => query.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        <YStack
          bg={COLORS.primary}
          br={16}
          p="$4"
          gap="$1"
          style={SHADOWS.card}
        >
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={11}
            color="rgba(255,255,255,0.85)"
            letterSpacing={0.4}
          >
            TOTAL KOMISI DARI PENDAFTAR
          </Paragraph>
          <Money
            amount={stats.totalCommission}
            color="#fff"
            fontSize={22}
            emphasis
          />
        </YStack>

        {items.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Users size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              px="$4"
            >
              {search
                ? `Tidak ada cocok dengan "${search}".`
                : 'Belum ada tenant yang daftar pakai kodemu.'}
            </Paragraph>
          </YStack>
        ) : (
          items.map((a) => (
            <YStack
              key={a.id}
              bg={COLORS.surfaceContainerLowest}
              br={12}
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
                  br={20}
                  bg={COLORS.primaryFixed}
                  ai="center"
                  jc="center"
                >
                  <User size={18} color={COLORS.primary} />
                </YStack>
                <YStack flex={1}>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {a.tenantName}
                  </Paragraph>
                  <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                    Daftar {fmtDate(a.signedUpAt)}
                  </Stat>
                </YStack>
                <YStack ai="flex-end">
                  {a.firstPaidAt ? (
                    <XStack ai="center" gap={4}>
                      <CheckCircle size={11} color={COLORS.success} />
                      <Stat fontSize={11} color={COLORS.success}>
                        Bayar
                      </Stat>
                    </XStack>
                  ) : (
                    <Stat fontSize={11} color={COLORS.outline}>
                      Belum bayar
                    </Stat>
                  )}
                  <Money
                    amount={a.lifetimeCommissionIdr}
                    fontSize={13}
                    emphasis
                  />
                </YStack>
              </XStack>
            </YStack>
          ))
        )}
      </ScrollView>
    </YStack>
  )
}
