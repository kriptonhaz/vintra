/**
 * Pengumuman detail — pushed from the home "Pengumuman" card. Shows the
 * full announcement; opening it marks the matching notification read
 * server-side (handled inside getAnnouncement), so the unread highlight
 * on the home card clears on return.
 */
import { Pressable, ScrollView } from 'react-native'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Paragraph, Spinner, XStack, YStack } from 'tamagui'
import { ChevronLeft, Megaphone } from '~/lib/icons'
import { useAnnouncement } from '../../lib/announcements'
import { COLORS, FONTS } from '../../lib/theme'

export default function AnnouncementDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const q = useAnnouncement(id ?? '')

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

        {q.isLoading ? (
          <YStack flex={1} ai="center" jc="center">
            <Spinner color={COLORS.primary} size="large" />
          </YStack>
        ) : q.error || !q.data ? (
          <YStack flex={1} ai="center" jc="center" px="$5">
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={14}
              color={COLORS.onSurfaceVariant}
            >
              Pengumuman tidak ditemukan.
            </Paragraph>
          </YStack>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 20, gap: 12 }}
            showsVerticalScrollIndicator={false}
          >
            <XStack ai="center" gap="$2">
              <Megaphone size={16} color={COLORS.primary} />
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
              >
                {formatDateTime(q.data.publishedAt)}
              </Paragraph>
            </XStack>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={22}
              lineHeight={28}
              color={COLORS.onSurface}
            >
              {q.data.title}
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={15}
              lineHeight={23}
              color={COLORS.onSurface}
            >
              {q.data.body}
            </Paragraph>
          </ScrollView>
        )}
      </YStack>
    </>
  )
}

function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}
