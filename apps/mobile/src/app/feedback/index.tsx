/**
 * Feedback (Bantuan & Saran) — list of the tenant's threads with the
 * platform admin. Tap a row → thread detail. FAB → new-thread sheet.
 *
 * UX zones:
 *   - Brand-green header with back chevron + title
 *   - List of threads as cards (subject, last message preview, status
 *     pill, unread dot if `lastMessageAt > tenantLastViewedAt`)
 *   - Empty state when there are no threads
 *   - FAB "+ Buat Baru" to open the new-thread sheet
 */
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView } from 'react-native'
import { useRouter, Stack } from 'expo-router'
import { Paragraph, Sheet, Spinner, TextArea, Input, XStack, YStack } from 'tamagui'
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Plus,
} from '~/lib/icons'
import {
  isThreadUnread,
  useCreateFeedbackThread,
  useFeedbackThreads,
  type FeedbackStatus,
  type FeedbackThread,
} from '../../lib/feedback'
import { COLORS, FONTS, SHADOWS } from '../../lib/theme'

export default function FeedbackIndexScreen() {
  const router = useRouter()
  const list = useFeedbackThreads()
  const [createOpen, setCreateOpen] = useState(false)

  const threads = list.data ?? []

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
              Bantuan & Saran
            </Paragraph>
            <YStack w={36} />
          </XStack>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color="white"
            opacity={0.85}
            ta="center"
          >
            Hubungi tim Vintra kapan saja
          </Paragraph>
        </YStack>

        {list.isLoading ? (
          <YStack flex={1} ai="center" jc="center" gap="$3">
            <Spinner color={COLORS.primary} size="large" />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Memuat percakapan...
            </Paragraph>
          </YStack>
        ) : list.error ? (
          <ErrorState onRetry={() => list.refetch()} />
        ) : threads.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              padding: 16,
              gap: 8,
              paddingBottom: 96,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={list.isFetching}
                onRefresh={() => list.refetch()}
                tintColor={COLORS.primary}
              />
            }
          >
            {threads.map((t) => (
              <ThreadCard
                key={t.id}
                thread={t}
                onPress={() => router.push(`/feedback/${t.id}` as never)}
              />
            ))}
          </ScrollView>
        )}

        {/* FAB */}
        {threads.length > 0 && (
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
                  Buat Baru
                </Paragraph>
              </XStack>
            </Pressable>
          </YStack>
        )}

        <NewThreadSheet
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false)
            router.push(`/feedback/${id}` as never)
          }}
        />
      </YStack>
    </>
  )
}

function ThreadCard({
  thread,
  onPress,
}: {
  thread: FeedbackThread
  onPress: () => void
}) {
  const unread = isThreadUnread(thread)

  return (
    <Pressable onPress={onPress}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br="$4"
        p="$3.5"
        gap="$2"
        borderWidth={1}
        borderColor={unread ? COLORS.primary : COLORS.outlineVariant}
        style={SHADOWS.card}
      >
        <XStack ai="flex-start" gap="$3">
          <YStack
            w={36}
            h={36}
            br={12}
            bg={unread ? COLORS.primary : COLORS.surfaceContainerLow}
            ai="center"
            jc="center"
          >
            <MessageCircle
              size={18}
              color={unread ? 'white' : COLORS.onSurfaceVariant}
            />
          </YStack>
          <YStack flex={1} gap={2}>
            <XStack ai="center" jc="space-between" gap="$2">
              <Paragraph
                fontFamily={unread ? FONTS.headingSemi : FONTS.bodyMedium}
                fontSize={14}
                color={COLORS.onSurface}
                numberOfLines={1}
                flex={1}
              >
                {thread.subject}
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={10}
                color={COLORS.onSurfaceVariant}
              >
                {formatRelative(thread.lastMessageAt)}
              </Paragraph>
            </XStack>
            <XStack ai="center" gap="$2">
              <StatusPill status={thread.status} />
              {unread && (
                <YStack w={8} h={8} br={9999} bg={COLORS.primary} />
              )}
            </XStack>
          </YStack>
          <ChevronRight size={16} color={COLORS.outlineVariant} />
        </XStack>
      </YStack>
    </Pressable>
  )
}

function StatusPill({ status }: { status: FeedbackStatus }) {
  const map: Record<FeedbackStatus, { label: string; bg: string; fg: string }> = {
    open: {
      label: 'Menunggu',
      bg: COLORS.warningTint,
      fg: COLORS.warning,
    },
    replied: {
      label: 'Dibalas',
      bg: COLORS.successTint,
      fg: COLORS.success,
    },
    resolved: {
      label: 'Selesai',
      bg: COLORS.surfaceContainerHigh,
      fg: COLORS.onSurfaceVariant,
    },
  }
  const s = map[status]
  return (
    <YStack bg={s.bg} br={9999} px="$2" py={1}>
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={10}
        color={s.fg}
        letterSpacing={0.3}
      >
        {s.label.toUpperCase()}
      </Paragraph>
    </YStack>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
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
        <MessageCircle size={40} color={COLORS.primary} />
      </YStack>
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={18}
        color={COLORS.onSurface}
        ta="center"
      >
        Belum ada percakapan
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        lineHeight={20}
        color={COLORS.onSurfaceVariant}
        ta="center"
        maxWidth={300}
      >
        Punya saran, kendala, atau pertanyaan? Mulai percakapan dengan tim
        Vintra — kami biasanya balas dalam 1×24 jam.
      </Paragraph>
      <Pressable onPress={onCreate}>
        <XStack
          ai="center"
          gap="$2"
          bg={COLORS.primary}
          br={9999}
          px="$4"
          py="$2.5"
          mt="$2"
        >
          <Plus size={16} color="white" />
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={14}
            color="white"
          >
            Kirim Pesan Pertama
          </Paragraph>
        </XStack>
      </Pressable>
    </YStack>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <YStack flex={1} ai="center" jc="center" gap="$3" px="$6">
      <MessageCircle size={48} color={COLORS.outline} />
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={16}
        color={COLORS.onSurface}
        ta="center"
      >
        Gagal memuat percakapan
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

function NewThreadSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (threadId: string) => void
}) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const create = useCreateFeedbackThread()

  const canSubmit =
    subject.trim().length > 0 && body.trim().length > 0 && !create.isPending

  function handleSubmit() {
    if (!canSubmit) return
    create.mutate(
      { subject: subject.trim(), body: body.trim() },
      {
        onSuccess: (thread) => {
          setSubject('')
          setBody('')
          onCreated(thread.id)
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose()
      }}
      snapPoints={[70]}
      modal
      dismissOnSnapToBottom
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame
        padding="$4"
        gap="$3"
        bg={COLORS.surfaceContainerLowest}
      >
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={18}
          color={COLORS.onSurface}
        >
          Mulai Percakapan
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={12}
          color={COLORS.onSurfaceVariant}
        >
          Tim Vintra akan membaca pesanmu dan membalas via notifikasi.
        </Paragraph>

        <YStack gap="$2">
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
            textTransform="uppercase"
          >
            Subjek
          </Paragraph>
          <Input
            value={subject}
            onChangeText={setSubject}
            placeholder="Contoh: Cara menambah cabang"
            maxLength={255}
            bg={COLORS.surfaceContainerLow}
            borderColor={COLORS.outlineVariant}
          />
        </YStack>

        <YStack gap="$2" flex={1}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
            textTransform="uppercase"
          >
            Pesan
          </Paragraph>
          <TextArea
            value={body}
            onChangeText={setBody}
            placeholder="Tulis pertanyaan, saran, atau kendala..."
            numberOfLines={6}
            minHeight={120}
            bg={COLORS.surfaceContainerLow}
            borderColor={COLORS.outlineVariant}
          />
        </YStack>

        {create.isError && (
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.danger}
          >
            {create.error instanceof Error
              ? create.error.message
              : 'Gagal mengirim pesan. Coba lagi.'}
          </Paragraph>
        )}

        <Pressable onPress={handleSubmit} disabled={!canSubmit}>
          <YStack
            bg={COLORS.primary}
            br={9999}
            py="$3"
            ai="center"
            opacity={canSubmit ? 1 : 0.5}
          >
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={14}
              color="white"
            >
              {create.isPending ? 'Mengirim...' : 'Kirim'}
            </Paragraph>
          </YStack>
        </Pressable>
      </Sheet.Frame>
    </Sheet>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

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
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  } catch {
    return ''
  }
}
