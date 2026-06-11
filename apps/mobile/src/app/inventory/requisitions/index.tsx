/**
 * Requisitions list — inter-branch stock requests (JUR-190).
 *
 * Filter chips at the top: Semua / Pending / Disetujui / Terpenuhi /
 * Ditolak / Dibatalkan. Tap a row → detail screen.
 *
 * FAB "Buat Permintaan" opens the create sheet (CreateRequisitionSheet).
 * Visible only when the user has access to a non-main branch (the
 * server enforces this too — outlet-owners create, main-branch users
 * receive).
 */
import { useState } from 'react'
import { Pressable, RefreshControl } from 'react-native'
import { useRouter, Stack } from 'expo-router'
import {
  Paragraph,
  ScrollView,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Package,
  Plus,
  TrendingUp,
} from '~/lib/icons'
import {
  useRequisitions,
  useInventoryBranches,
  type RequisitionRow,
  type RequisitionStatus,
} from '../../../lib/inventory'
import { CreateRequisitionSheet } from '../../../components/inventory/CreateRequisitionSheet'
import { COLORS, FONTS } from '../../../lib/theme'

const FILTERS: Array<{ value: RequisitionStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Semua' },
  { value: 'pending', label: 'Menunggu' },
  { value: 'approved', label: 'Disetujui' },
  { value: 'fulfilled', label: 'Terpenuhi' },
  { value: 'rejected', label: 'Ditolak' },
  { value: 'cancelled', label: 'Dibatalkan' },
]

export default function RequisitionsListScreen() {
  const router = useRouter()
  const [filter, setFilter] = useState<RequisitionStatus | 'all'>('all')
  const [createOpen, setCreateOpen] = useState(false)

  const query = useRequisitions(
    filter === 'all' ? {} : { status: filter },
  )
  const branchesQuery = useInventoryBranches()

  const items = query.data?.items ?? []

  // Show the FAB only when there's at least one non-main branch the user
  // can request from. (Single-branch tenants can't make inter-branch
  // requests.)
  const canCreate = (branchesQuery.data?.branches.length ?? 0) > 1

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <YStack flex={1} bg={COLORS.background}>
        {/* Header */}
        <YStack bg={COLORS.primary} pt={60} pb="$4" px="$5" gap="$2">
          <XStack ai="center" gap="$3">
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
            <YStack flex={1}>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color="white"
                opacity={0.85}
              >
                Inventory
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.headingBold}
                fontSize={20}
                color="white"
              >
                Mutasi Stok
              </Paragraph>
            </YStack>
          </XStack>
        </YStack>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 8,
          }}
        >
          {FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={filter === f.value}
              onPress={() => setFilter(f.value)}
            />
          ))}
        </ScrollView>

        {/* List */}
        {query.isLoading ? (
          <YStack flex={1} ai="center" jc="center" gap="$3">
            <Spinner color={COLORS.primary} size="large" />
          </YStack>
        ) : query.error ? (
          <ErrorState error={query.error} />
        ) : items.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 96 }}
            refreshControl={
              <RefreshControl
                refreshing={query.isFetching}
                onRefresh={() => query.refetch()}
                tintColor={COLORS.primary}
              />
            }
          >
            {items.map((r) => (
              <RequisitionListRow key={r.id} req={r} />
            ))}
          </ScrollView>
        )}

        {/* FAB */}
        {canCreate && (
          <YStack
            position="absolute"
            bottom={24}
            right={20}
            shadowColor="#000"
            shadowOpacity={0.18}
            shadowRadius={12}
            shadowOffset={{ width: 0, height: 6 }}
            elevation={8}
          >
            <Pressable onPress={() => setCreateOpen(true)}>
              <XStack
                ai="center"
                gap="$2"
                bg={COLORS.primary}
                br={9999}
                px="$4"
                h={52}
              >
                <Plus size={20} color="white" />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="white"
                >
                  Buat Permintaan
                </Paragraph>
              </XStack>
            </Pressable>
          </YStack>
        )}

        <CreateRequisitionSheet
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={(id) => {
            // After create, push straight to the new req detail so user
            // sees confirmation + can take next action.
            router.push(`/inventory/requisitions/${id}` as never)
          }}
        />
      </YStack>
    </>
  )
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress}>
      <YStack
        bg={active ? COLORS.primary : COLORS.surfaceContainerLow}
        br={9999}
        px="$3.5"
        py="$1.5"
        borderWidth={1}
        borderColor={active ? COLORS.primary : COLORS.outlineVariant}
      >
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={12}
          color={active ? 'white' : COLORS.onSurface}
        >
          {label}
        </Paragraph>
      </YStack>
    </Pressable>
  )
}

function RequisitionListRow({ req }: { req: RequisitionRow }) {
  const router = useRouter()
  return (
    <Pressable
      onPress={() =>
        router.push(`/inventory/requisitions/${req.id}` as never)
      }
    >
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br="$4"
        p="$3.5"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.outlineVariant}
      >
        <XStack jc="space-between" ai="center">
          <Paragraph
            fontFamily={FONTS.mono}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
          >
            {req.requisitionNumber}
          </Paragraph>
          <StatusBadge status={req.status} />
        </XStack>
        <XStack ai="center" gap="$2">
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={13}
            color={COLORS.onSurface}
            flex={1}
            numberOfLines={1}
          >
            {req.requestingBranchName}
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            ←
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
            flex={1}
            numberOfLines={1}
          >
            {req.sourceBranchName}
          </Paragraph>
        </XStack>
        <XStack ai="center" jc="space-between">
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            {formatJakartaDate(req.createdAt)}
          </Paragraph>
          <ChevronRight size={14} color={COLORS.outline} />
        </XStack>
      </YStack>
    </Pressable>
  )
}

function StatusBadge({ status }: { status: RequisitionStatus }) {
  const styling = STATUS_STYLE[status]
  return (
    <YStack
      bg={styling.bg}
      br={9999}
      px="$2"
      py="$0.5"
    >
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={10}
        color={styling.fg}
      >
        {styling.label}
      </Paragraph>
    </YStack>
  )
}

const STATUS_STYLE: Record<
  RequisitionStatus,
  { bg: string; fg: string; label: string }
> = {
  pending: { bg: '#FFF3CD', fg: '#9a4600', label: 'Menunggu' },
  approved: { bg: '#dbeafe', fg: '#1e40af', label: 'Disetujui' },
  fulfilled: { bg: '#e6f4ea', fg: '#148E47', label: 'Terpenuhi' },
  rejected: { bg: '#ffdad6', fg: '#93000a', label: 'Ditolak' },
  cancelled: { bg: '#e4eae0', fg: '#3e4a3f', label: 'Dibatalkan' },
}

function EmptyState({ filter }: { filter: RequisitionStatus | 'all' }) {
  const label =
    filter === 'all'
      ? 'Belum ada permintaan stok'
      : `Tidak ada yang ${STATUS_STYLE[filter as RequisitionStatus].label.toLowerCase()}`

  return (
    <YStack flex={1} ai="center" jc="center" gap="$3" px="$6">
      <YStack
        w={88}
        h={88}
        br={44}
        bg={COLORS.primaryFixed}
        ai="center"
        jc="center"
      >
        <TrendingUp size={40} color={COLORS.primary} />
      </YStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        color={COLORS.onSurface}
        ta="center"
      >
        {label}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        lineHeight={20}
        color={COLORS.onSurfaceVariant}
        ta="center"
        maxWidth={300}
      >
        Outlet bisa memesan stok dari cabang utama lewat tombol di
        bawah.
      </Paragraph>
    </YStack>
  )
}

function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Gagal memuat.'
  const isFeatureGate =
    message.toLowerCase().includes('paket') ||
    message.toLowerCase().includes('upgrade') ||
    message.toLowerCase().includes('belum aktif')

  return (
    <YStack flex={1} ai="center" jc="center" gap="$3" px="$6">
      <Package size={48} color={COLORS.outline} />
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={16}
        color={COLORS.onSurface}
        ta="center"
      >
        {isFeatureGate
          ? 'Mutasi Stok butuh paket berbayar'
          : 'Gagal memuat'}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        lineHeight={20}
        color={COLORS.onSurfaceVariant}
        ta="center"
        maxWidth={300}
      >
        {message}
      </Paragraph>
    </YStack>
  )
}

function formatJakartaDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
