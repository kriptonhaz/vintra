/**
 * Feedback thread detail — chat-style conversation with the platform
 * admin. Tenant messages bubble on the right, admin messages on the
 * left. Sticky reply composer at the bottom; pressing Kirim posts the
 * new message and the list refreshes optimistically via react-query
 * invalidation (no manual cache mutation needed for the small payload).
 */
import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
} from 'react-native'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Paragraph, Spinner, XStack, YStack } from 'tamagui'
import { ChevronLeft, MessageCircle, Send } from '~/lib/icons'
import {
  useAddFeedbackMessage,
  useFeedbackThread,
  type FeedbackMessage,
  type FeedbackStatus,
} from '../../lib/feedback'
import { COLORS, FONTS, SHADOWS } from '../../lib/theme'

export default function FeedbackThreadScreen() {
  const router = useRouter()
  const { threadId } = useLocalSearchParams<{ threadId: string }>()
  const query = useFeedbackThread(threadId ?? null)
  const send = useAddFeedbackMessage()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<ScrollView>(null)

  const thread = query.data?.thread
  const messages = query.data?.messages ?? []

  // Scroll to the latest bubble whenever new messages arrive.
  useEffect(() => {
    if (messages.length === 0) return
    // Defer to next tick so layout is committed.
    const id = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true })
    }, 50)
    return () => clearTimeout(id)
  }, [messages.length])

  const canSend = draft.trim().length > 0 && !!threadId && !send.isPending

  function handleSend() {
    if (!canSend || !threadId) return
    const body = draft.trim()
    send.mutate(
      { threadId, body },
      {
        onSuccess: () => {
          setDraft('')
        },
      },
    )
  }

  const isResolved = thread?.status === 'resolved'

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <YStack flex={1} bg={COLORS.background}>
        <YStack bg={COLORS.primary} pt={60} pb="$3.5" px="$5" gap="$2">
          <XStack ai="center" jc="space-between" gap="$2">
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
                Bantuan & Saran
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.headingBold}
                fontSize={15}
                color="white"
                numberOfLines={1}
              >
                {thread?.subject ?? 'Memuat...'}
              </Paragraph>
            </YStack>
            <YStack w={36}>
              {thread && <StatusDot status={thread.status} />}
            </YStack>
          </XStack>
        </YStack>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          {query.isLoading ? (
            <YStack flex={1} ai="center" jc="center" gap="$3">
              <Spinner color={COLORS.primary} size="large" />
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={13}
                color={COLORS.onSurfaceVariant}
              >
                Memuat pesan...
              </Paragraph>
            </YStack>
          ) : query.error ? (
            <ErrorState onRetry={() => query.refetch()} />
          ) : (
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{
                padding: 16,
                gap: 10,
                paddingBottom: 24,
              }}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={query.isFetching}
                  onRefresh={() => query.refetch()}
                  tintColor={COLORS.primary}
                />
              }
            >
              {messages.map((m, idx) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  // Show the sender label only when it differs from the
                  // previous bubble's sender (chat-app convention).
                  showSenderLabel={
                    idx === 0 || messages[idx - 1].senderType !== m.senderType
                  }
                />
              ))}
              {messages.length === 0 && (
                <YStack ai="center" jc="center" py="$10" gap="$2">
                  <MessageCircle size={36} color={COLORS.outline} />
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={12}
                    color={COLORS.onSurfaceVariant}
                  >
                    Belum ada pesan.
                  </Paragraph>
                </YStack>
              )}
            </ScrollView>
          )}

          {/* Composer */}
          {!query.isLoading && !query.error && (
            <YStack
              bg={COLORS.surfaceContainerLowest}
              borderTopWidth={1}
              borderColor={COLORS.borderSubtle}
              px="$3"
              py="$2.5"
              gap="$2"
            >
              {isResolved && (
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.onSurfaceVariant}
                  ta="center"
                >
                  Percakapan ditandai selesai oleh admin. Balasanmu akan
                  membukanya kembali.
                </Paragraph>
              )}
              <XStack ai="flex-end" gap="$2">
                <YStack
                  flex={1}
                  bg={COLORS.surfaceContainerLow}
                  br={20}
                  px="$3.5"
                  py="$2"
                  borderWidth={1}
                  borderColor={COLORS.outlineVariant}
                >
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Tulis balasan..."
                    placeholderTextColor={COLORS.outline}
                    multiline
                    style={{
                      fontSize: 14,
                      fontFamily: FONTS.body,
                      color: COLORS.onSurface,
                      maxHeight: 120,
                      minHeight: 22,
                      padding: 0,
                    }}
                  />
                </YStack>
                <Pressable onPress={handleSend} disabled={!canSend}>
                  <YStack
                    w={44}
                    h={44}
                    br={22}
                    bg={canSend ? COLORS.primary : COLORS.surfaceContainerHigh}
                    ai="center"
                    jc="center"
                  >
                    {send.isPending ? (
                      <Spinner color="white" />
                    ) : (
                      <Send
                        size={18}
                        color={canSend ? 'white' : COLORS.outline}
                      />
                    )}
                  </YStack>
                </Pressable>
              </XStack>
              {send.isError && (
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.danger}
                >
                  {send.error instanceof Error
                    ? send.error.message
                    : 'Gagal mengirim balasan.'}
                </Paragraph>
              )}
            </YStack>
          )}
        </KeyboardAvoidingView>
      </YStack>
    </>
  )
}

function MessageBubble({
  message,
  showSenderLabel,
}: {
  message: FeedbackMessage
  showSenderLabel: boolean
}) {
  const isTenant = message.senderType === 'tenant'
  const senderLabel = isTenant
    ? 'Kamu'
    : message.senderType === 'admin'
      ? 'Tim Vintra'
      : 'Tamu'

  return (
    <YStack ai={isTenant ? 'flex-end' : 'flex-start'} gap={2}>
      {showSenderLabel && (
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={10}
          color={COLORS.onSurfaceVariant}
          letterSpacing={0.3}
          px="$2"
        >
          {senderLabel}
        </Paragraph>
      )}
      <YStack
        maxWidth="80%"
        bg={isTenant ? COLORS.primary : COLORS.surfaceContainerLowest}
        br={18}
        // Tail corner — flat where the bubble points at its author.
        borderTopRightRadius={isTenant ? 4 : 18}
        borderTopLeftRadius={isTenant ? 18 : 4}
        px="$3.5"
        py="$2.5"
        borderWidth={isTenant ? 0 : 1}
        borderColor={COLORS.borderSubtle}
        style={isTenant ? undefined : SHADOWS.card}
      >
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={14}
          lineHeight={20}
          color={isTenant ? 'white' : COLORS.onSurface}
        >
          {message.body}
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={10}
          color={isTenant ? 'rgba(255,255,255,0.7)' : COLORS.onSurfaceVariant}
          mt={2}
          ta={isTenant ? 'right' : 'left'}
        >
          {formatTime(message.createdAt)}
        </Paragraph>
      </YStack>
    </YStack>
  )
}

function StatusDot({ status }: { status: FeedbackStatus }) {
  const color =
    status === 'replied'
      ? COLORS.success
      : status === 'resolved'
        ? COLORS.outline
        : COLORS.warning
  return (
    <YStack
      w={36}
      h={36}
      ai="center"
      jc="center"
    >
      <YStack w={10} h={10} br={9999} bg={color} />
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

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}
