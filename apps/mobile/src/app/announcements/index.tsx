/**
 * Pengumuman list — the full feed of tenant announcements, reached via
 * "Lihat semua" on the home card. Pull-to-refresh re-fetches; tapping a
 * row opens the detail (which marks it read). Pengumuman is its own
 * channel, separate from the notification bell.
 */
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView } from 'react-native'
import { useRouter, Stack } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Paragraph, Spinner, XStack, YStack } from 'tamagui'
import { ChevronLeft, ChevronRight, Megaphone } from '~/lib/icons'
import {
  useAnnouncements,
  type AnnouncementListItem,
} from '../../lib/announcements'
import { COLORS, FONTS } from '../../lib/theme'

export default function AnnouncementsListScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const query = useAnnouncements(50)
  const [refreshing, setRefreshing] = useState(false)

  const items = query.data ?? []

  async function onRefresh() {
    setRefreshing(true)
    try {
      await queryClient.invalidateQueries({ queryKey: ['announcements'] })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <YStack flex={1} bg={COLORS.background}>
        <YStack bg={COLORS.primary} pt={60} pb="$4" px="$5">
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
            <Paragraph fontFamily={FONTS.headingBold} fontSize={18} color="white">
              Pengumuman
            </Paragraph>
          </XStack>
        </YStack>

        {query.isLoading && items.length === 0 ? (
          <YStack flex={1} ai="center" jc="center">
            <Spinner color={COLORS.primary} size="large" />
          </YStack>
        ) : items.length === 0 ? (
          <YStack flex={1} ai="center" jc="center" gap="$3" px="$6">
            <Megaphone size={32} color={COLORS.outlineVariant} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={14}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada pengumuman.
            </Paragraph>
          </YStack>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
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
            {items.map((a) => (
              <ListRow
                key={a.id}
                item={a}
                onPress={() => router.push(`/announcements/${a.id}`)}
              />
            ))}
          </ScrollView>
        )}
      </YStack>
    </>
  )
}

function ListRow({
  item,
  onPress,
}: {
  item: AnnouncementListItem
  onPress: () => void
}) {
  const unread = !item.readAt
  return (
    <Pressable onPress={onPress}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={16}
        p="$3.5"
        gap="$1.5"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
      >
        <XStack ai="center" gap="$2">
          {unread && <YStack w={7} h={7} br={9999} bg={COLORS.primary} />}
          <Paragraph
            fontFamily={unread ? FONTS.bodyBold : FONTS.bodySemi}
            fontSize={15}
            color={COLORS.onSurface}
            flex={1}
            numberOfLines={1}
          >
            {item.title}
          </Paragraph>
          <ChevronRight size={16} color={COLORS.outlineVariant} />
        </XStack>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={13}
          color={COLORS.onSurfaceVariant}
          numberOfLines={2}
        >
          {item.body}
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={11}
          color={COLORS.outline}
        >
          {formatDate(item.publishedAt)}
        </Paragraph>
      </YStack>
    </Pressable>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}
