/**
 * Notifications screen — shown when the user taps the bell on the
 * home header.
 *
 * Behavior:
 *   - Lists every notification newest-first, paginated in 20-row
 *     chunks via `useInfiniteNotifications`; the next page loads
 *     automatically when the FlatList nears the bottom (no "Lihat
 *     semua" button to tap).
 *   - Tap a row to:
 *       1. Mark it read (optimistic via the mutation's invalidate)
 *       2. Resolve its `url` through `resolveNotificationUrl` — mobile
 *          routes get `router.push`, everything else opens on the
 *          tenant subdomain. This is what stops the "Unmatched Route"
 *          black screen when a web-only URL (z-report, admin/feedback,
 *          /pos/sales) lands on mobile.
 *   - "Tandai semua dibaca" button in the header runs
 *     `markAllNotificationsRead`.
 */
import { useCallback } from 'react'
import { FlatList, Linking, Pressable, RefreshControl } from 'react-native'
import { useRouter, Stack } from 'expo-router'
import { Paragraph, Spinner, XStack, YStack } from 'tamagui'
import {
  Bell,
  ChevronLeft,
  AlertCircle,
  CheckCircle,
  Calendar,
  ShoppingCart,
  Package,
  MessageCircle,
} from '~/lib/icons'
import {
  useInfiniteNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  type Notification,
} from '../lib/notifications'
import { resolveNotificationUrl } from '../lib/notification-routing'
import { useTenant } from '../lib/tenant-context'
import { COLORS, FONTS } from '../lib/theme'

const PAGE_SIZE = 20

export default function NotificationsScreen() {
  const router = useRouter()
  const { state } = useTenant()
  const slug = state.status === 'ready' ? state.tenant.slug : null
  const list = useInfiniteNotifications(PAGE_SIZE)
  const markAll = useMarkAllNotificationsRead()
  const markRead = useMarkNotificationRead()

  // Flatten paginated chunks into one stream; React Query keeps page
  // identities stable so this isn't a re-keying churn.
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const unreadCount = list.data?.pages[0]?.unreadCount ?? 0

  const handleNotificationPress = useCallback(
    (n: Notification) => {
      if (n.readAt === null) markRead.mutate(n.id)
      const resolved = resolveNotificationUrl(n.url, slug)
      if (resolved.kind === 'mobile') {
        router.push(resolved.target as never)
      } else if (resolved.kind === 'web') {
        void Linking.openURL(resolved.target).catch(() => {})
      }
    },
    [markRead, router, slug],
  )

  const onEndReached = useCallback(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) {
      void list.fetchNextPage()
    }
  }, [list])

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
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={18}
              color="white"
            >
              Notifikasi
            </Paragraph>
            {unreadCount > 0 ? (
              <Pressable
                onPress={() => markAll.mutate()}
                hitSlop={8}
                disabled={markAll.isPending}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={12}
                  color="white"
                  opacity={markAll.isPending ? 0.5 : 1}
                >
                  Tandai semua
                </Paragraph>
              </Pressable>
            ) : (
              // Keeps the title centered when there's nothing on the right.
              <YStack w={36} />
            )}
          </XStack>
        </YStack>

        {list.isLoading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(n) => n.id}
            renderItem={({ item }) => (
              <NotificationRow
                notification={item}
                onPress={() => handleNotificationPress(item)}
              />
            )}
            contentContainerStyle={{
              padding: 16,
              gap: 8,
              paddingBottom: 32,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={list.isFetching && !list.isFetchingNextPage}
                onRefresh={() => list.refetch()}
                tintColor={COLORS.primary}
              />
            }
            ItemSeparatorComponent={() => <YStack h={8} />}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              list.isFetchingNextPage ? (
                <YStack ai="center" py="$3">
                  <Spinner color={COLORS.primary} />
                </YStack>
              ) : null
            }
          />
        )}
      </YStack>
    </>
  )
}

function NotificationRow({
  notification,
  onPress,
}: {
  notification: Notification
  onPress: () => void
}) {
  const isUnread = notification.readAt === null

  return (
    <Pressable onPress={onPress}>
      <YStack
        bg={isUnread ? COLORS.primaryFixed : COLORS.surfaceContainerLowest}
        br="$4"
        p="$3.5"
        gap="$2"
        borderWidth={1}
        borderColor={isUnread ? COLORS.primary : COLORS.outlineVariant}
      >
        <XStack gap="$3" ai="flex-start">
          <YStack
            w={36}
            h={36}
            br={18}
            bg={isUnread ? COLORS.primary : COLORS.surfaceContainerLow}
            ai="center"
            jc="center"
          >
            <NotificationIcon
              type={notification.type}
              tintOnDark={isUnread}
            />
          </YStack>
          <YStack flex={1} gap="$1">
            <XStack jc="space-between" ai="flex-start" gap="$2">
              <Paragraph
                fontFamily={isUnread ? FONTS.headingSemi : FONTS.bodyMedium}
                fontSize={14}
                color={COLORS.onSurface}
                flex={1}
              >
                {notification.title}
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={10}
                color={COLORS.onSurfaceVariant}
              >
                {formatRelative(notification.createdAt)}
              </Paragraph>
            </XStack>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              lineHeight={17}
              color={COLORS.onSurfaceVariant}
              numberOfLines={3}
            >
              {notification.body}
            </Paragraph>
          </YStack>
        </XStack>
      </YStack>
    </Pressable>
  )
}

function LoadingState() {
  return (
    <YStack flex={1} ai="center" jc="center" gap="$3">
      <Spinner color={COLORS.primary} size="large" />
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        color={COLORS.onSurfaceVariant}
      >
        Memuat notifikasi...
      </Paragraph>
    </YStack>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <YStack flex={1} ai="center" jc="center" gap="$3" px="$6">
      <Bell size={48} color={COLORS.outline} />
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={16}
        color={COLORS.onSurface}
        ta="center"
      >
        Gagal memuat notifikasi
      </Paragraph>
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
    </YStack>
  )
}

function EmptyState() {
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
        <Bell size={40} color={COLORS.primary} />
      </YStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        color={COLORS.onSurface}
        ta="center"
      >
        Belum ada notifikasi
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        lineHeight={20}
        color={COLORS.onSurfaceVariant}
        ta="center"
        maxWidth={280}
      >
        Pemberitahuan tentang absensi, penjualan, dan stok bahan akan
        muncul di sini.
      </Paragraph>
    </YStack>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Pick an icon based on the notification's `type`. The web emits
 * specific type strings like 'stock_requisition_raised', 'sale_done',
 * 'attendance_late', etc. — we fuzzy-match prefixes here so adding a
 * new type doesn't immediately break the mobile UI.
 */
function NotificationIcon({
  type,
  tintOnDark,
}: {
  type: string
  tintOnDark: boolean
}) {
  const t = type.toLowerCase()
  const color = tintOnDark ? '#ffffff' : COLORS.onSurfaceVariant

  if (t.includes('attendance') || t.includes('clock')) {
    return <Calendar size={16} color={color} />
  }
  if (t.includes('sale') || t.includes('pos') || t.includes('order')) {
    return <ShoppingCart size={16} color={color} />
  }
  if (t.includes('stock') || t.includes('inventory') || t.includes('requisition')) {
    return <Package size={16} color={color} />
  }
  if (t.includes('wa') || t.includes('chat') || t.includes('message')) {
    return <MessageCircle size={16} color={color} />
  }
  if (t.includes('error') || t.includes('fail') || t.includes('alert')) {
    return <AlertCircle size={16} color={color} />
  }
  if (t.includes('success') || t.includes('complete') || t.includes('done')) {
    return <CheckCircle size={16} color={color} />
  }
  return <Bell size={16} color={color} />
}

/**
 * Friendly Indonesian relative time. We don't use a library (date-fns
 * isn't pulled into mobile yet) — a hand-rolled version is fine for
 * the limited buckets we care about.
 */
function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime()
    const now = Date.now()
    const diffMin = Math.round((now - then) / 60000)

    if (diffMin < 1) return 'baru saja'
    if (diffMin < 60) return `${diffMin}m`
    const diffH = Math.round(diffMin / 60)
    if (diffH < 24) return `${diffH}j`
    const diffD = Math.round(diffH / 24)
    if (diffD < 7) return `${diffD}h`
    // Older than a week — show "DD/MM"
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  } catch {
    return ''
  }
}
