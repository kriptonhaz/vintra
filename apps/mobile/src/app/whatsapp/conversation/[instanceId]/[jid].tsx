/**
 * WA Conversation — message list (3s polling) + composer (text + image).
 * Marks the contact read on mount. Bubbles render media via on-demand
 * signed URL fetch (cached for 1h client-side; server signs for 24h).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image as RNImage,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  useWindowDimensions,
} from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle,
  Clock,
  Image as ImageIcon,
  Send,
} from '~/lib/icons'
import {
  useMarkWaContactRead,
  useSendWaImage,
  useSendWaMessage,
  useWaContacts,
  useWaInstance,
  useWaMediaUrl,
  useWaMessages,
  useUpdateContactHandoff,
  type WaMessage,
  type WaMessageStatus,
} from '~/lib/whatsapp'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS } from '~/lib/theme'

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function dayKey(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export default function ConversationScreen() {
  const { instanceId, jid } = useLocalSearchParams<{
    instanceId: string
    jid: string
  }>()
  const instance = useWaInstance(instanceId)
  const messages = useWaMessages(instanceId, jid)
  const contacts = useWaContacts(instanceId)
  const send = useSendWaMessage()
  const sendImage = useSendWaImage()
  const markRead = useMarkWaContactRead()
  const handoff = useUpdateContactHandoff()
  const [text, setText] = useState('')
  const listRef = useRef<FlatList<MessageEntry>>(null)

  const contact = (contacts.data ?? []).find((c) => c.remoteJid === jid)
  const contactName =
    contact?.masterCustomerName ||
    contact?.name ||
    contact?.pushName ||
    jid.split('@')[0] ||
    jid

  // Mark read whenever messages list changes & we have unread
  useEffect(() => {
    if (contact && contact.unreadCount > 0) {
      markRead.mutate({ instanceId, jid })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.unreadCount])

  // Inject day-separator rows into the message stream
  const entries = useMemo<MessageEntry[]>(() => {
    const rows = messages.data ?? []
    const out: MessageEntry[] = []
    let lastDay = ''
    for (const m of rows) {
      const day = dayKey(m.createdAt)
      if (day !== lastDay) {
        out.push({ kind: 'day', key: `d-${day}-${m.id}`, label: day })
        lastDay = day
      }
      out.push({ kind: 'msg', key: m.id, message: m })
    }
    return out
  }, [messages.data])

  async function handleSendText() {
    const body = text.trim()
    if (!body) return
    setText('')
    try {
      await send.mutateAsync({ instanceId, to: jid, body })
    } catch (err) {
      setText(body) // restore on failure
      Alert.alert(
        'Gagal kirim',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  async function handleSendImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(
        'Izin diperlukan',
        'Beri izin akses galeri di Pengaturan untuk kirim foto.',
      )
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    })
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    if (!asset.base64) {
      Alert.alert('Gagal baca foto', 'Tidak bisa konversi foto ke base64.')
      return
    }
    const mime = asset.mimeType ?? 'image/jpeg'
    const dataUrl = `data:${mime};base64,${asset.base64}`
    try {
      await sendImage.mutateAsync({ instanceId, to: jid, dataUrl })
    } catch (err) {
      Alert.alert(
        'Gagal kirim foto',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  function handleClearHandoff() {
    if (!contact?.needsHuman) return
    handoff.mutate(
      { instanceId, jid, needsHuman: false },
      {
        onError: (err) =>
          Alert.alert(
            'Gagal',
            err instanceof Error ? err.message : 'Coba lagi.',
          ),
      },
    )
  }

  if (instance.error || messages.error) {
    const err = instance.error ?? messages.error
    const isForbidden = err instanceof ApiError && err.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title={contactName} back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat percakapan ini.'
              : 'Gagal memuat percakapan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title={contactName}
        subtitle={contact?.remoteJid.split('@')[0] ?? ''}
        back
      />

      {contact?.needsHuman && (
        <Pressable onPress={handleClearHandoff}>
          <XStack
            ai="center"
            gap="$2"
            bg={COLORS.warningTint}
            px="$4"
            py="$2"
            borderBottomWidth={1}
            borderBottomColor="#92400e"
          >
            <AlertCircle size={14} color="#92400e" />
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={12}
              color="#92400e"
              flex={1}
            >
              Diserahkan ke admin (AI di-pause). Tap untuk hidupkan lagi.
            </Paragraph>
          </XStack>
        </Pressable>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        style={{ flex: 1 }}
      >
        <FlatList
          ref={listRef}
          data={entries}
          keyExtractor={(e) => e.key}
          contentContainerStyle={{ padding: 12, gap: 6 }}
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              <DaySeparator label={item.label} />
            ) : (
              <MessageBubble message={item.message} />
            )
          }
          ListEmptyComponent={
            messages.isLoading ? (
              <YStack flex={1} ai="center" jc="center" py="$10">
                <ActivityIndicator color={COLORS.primary} />
              </YStack>
            ) : (
              <YStack flex={1} ai="center" jc="center" py="$10" gap="$2">
                <CheckCircle size={28} color={COLORS.outline} />
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={13}
                  color={COLORS.onSurfaceVariant}
                >
                  Belum ada pesan. Mulai chat dengan kirim sapaan.
                </Paragraph>
              </YStack>
            )
          }
          onContentSizeChange={() => {
            listRef.current?.scrollToEnd({ animated: false })
          }}
        />

        <YStack
          bg={COLORS.surfaceContainerLowest}
          borderTopWidth={1}
          borderTopColor={COLORS.borderSubtle}
          px="$3"
          py="$2"
        >
          <XStack ai="flex-end" gap="$2">
            <Pressable
              onPress={handleSendImage}
              disabled={sendImage.isPending}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: sendImage.isPending
                  ? COLORS.surfaceContainerLow
                  : COLORS.surfaceContainerLow,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {sendImage.isPending ? (
                <ActivityIndicator color={COLORS.primary} />
              ) : (
                <ImageIcon size={18} color={COLORS.onSurface} />
              )}
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Tulis pesan…"
              placeholderTextColor={COLORS.outline}
              multiline
              style={{
                flex: 1,
                minHeight: 40,
                maxHeight: 120,
                backgroundColor: COLORS.surface,
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingTop: 10,
                paddingBottom: 10,
                borderWidth: 1,
                borderColor: COLORS.borderSubtle,
                fontFamily: FONTS.body,
                fontSize: 14,
                color: COLORS.onSurface,
              }}
            />
            <Pressable
              onPress={handleSendText}
              disabled={send.isPending || !text.trim()}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor:
                  !text.trim() || send.isPending
                    ? COLORS.outline
                    : COLORS.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {send.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Send size={16} color="#fff" />
              )}
            </Pressable>
          </XStack>
        </YStack>
      </KeyboardAvoidingView>
    </YStack>
  )
}

// ─── Bubble ────────────────────────────────────────────────────────

type MessageEntry =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; message: WaMessage }

function DaySeparator({ label }: { label: string }) {
  return (
    <YStack ai="center" my="$2">
      <YStack
        bg={COLORS.surfaceContainerLow}
        px={10}
        py={4}
        br={999}
      >
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={10}
          color={COLORS.onSurfaceVariant}
          letterSpacing={0.55}
        >
          {label}
        </Paragraph>
      </YStack>
    </YStack>
  )
}

function MessageBubble({ message }: { message: WaMessage }) {
  const mine = message.fromMe
  const hasMedia = !!message.mediaKey
  return (
    <XStack jc={mine ? 'flex-end' : 'flex-start'}>
      <YStack
        maxWidth="80%"
        bg={mine ? COLORS.primary : COLORS.surfaceContainerLowest}
        br={14}
        // tighter "tail" on the sender side
        borderBottomRightRadius={mine ? 4 : 14}
        borderBottomLeftRadius={mine ? 14 : 4}
        p="$2"
        gap={2}
        borderWidth={mine ? 0 : 1}
        borderColor={COLORS.borderSubtle}
      >
        {hasMedia && message.type === 'image' && (
          <MediaImageBubble messageId={message.id} mine={mine} />
        )}
        {hasMedia && message.type === 'sticker' && (
          <MediaImageBubble messageId={message.id} mine={mine} sticker />
        )}
        {hasMedia && message.type === 'document' && (
          <YStack
            bg={mine ? 'rgba(255,255,255,0.18)' : COLORS.surfaceContainerLow}
            br={8}
            p="$2"
            gap={2}
            mb={message.body ? 4 : 0}
          >
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={12}
              color={mine ? '#fff' : COLORS.onSurface}
              numberOfLines={1}
            >
              📄 Dokumen
            </Paragraph>
            <Stat fontSize={10} color={mine ? 'rgba(255,255,255,0.85)' : COLORS.onSurfaceVariant}>
              {message.mediaSizeBytes
                ? `${Math.round(message.mediaSizeBytes / 1024)} KB`
                : ''}
              {message.mediaMime ? ` · ${message.mediaMime.split('/')[1] ?? ''}` : ''}
            </Stat>
          </YStack>
        )}
        {message.body && (
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={14}
            color={mine ? '#fff' : COLORS.onSurface}
          >
            {message.body}
          </Paragraph>
        )}
        <XStack ai="center" gap={4} jc="flex-end" mt={2}>
          <Stat
            fontSize={9}
            color={mine ? 'rgba(255,255,255,0.85)' : COLORS.onSurfaceVariant}
          >
            {fmtTime(message.createdAt)}
          </Stat>
          {mine && <StatusGlyph status={message.status} />}
        </XStack>
        {message.reactions && message.reactions.length > 0 && (
          <XStack flexWrap="wrap" gap={4} mt={2}>
            {message.reactions.map((r, i) => (
              <YStack
                key={`${r.senderJid}-${i}`}
                bg={mine ? 'rgba(255,255,255,0.18)' : COLORS.surfaceContainerLow}
                br={999}
                px={6}
                py={2}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={11}
                  color={mine ? '#fff' : COLORS.onSurface}
                >
                  {r.emoji}
                </Paragraph>
              </YStack>
            ))}
          </XStack>
        )}
      </YStack>
    </XStack>
  )
}

function StatusGlyph({ status }: { status: WaMessageStatus }) {
  if (status === 'pending') return <Clock size={10} color="rgba(255,255,255,0.85)" />
  if (status === 'sent') return <Check size={10} color="rgba(255,255,255,0.85)" />
  if (status === 'delivered') {
    return (
      <XStack ml={-3}>
        <Check size={10} color="rgba(255,255,255,0.85)" />
        <Check size={10} color="rgba(255,255,255,0.85)" />
      </XStack>
    )
  }
  if (status === 'read') {
    return (
      <XStack ml={-3}>
        <Check size={10} color="#8cf9a5" />
        <Check size={10} color="#8cf9a5" />
      </XStack>
    )
  }
  if (status === 'error')
    return <AlertCircle size={10} color={COLORS.dangerTint} />
  return null
}

function MediaImageBubble({
  messageId,
  mine,
  sticker,
}: {
  messageId: string
  mine: boolean
  sticker?: boolean
}) {
  const { width } = useWindowDimensions()
  const url = useWaMediaUrl(messageId)
  const max = sticker ? 120 : Math.min(240, width * 0.55)
  return (
    <YStack
      w={max}
      h={max}
      br={sticker ? 0 : 8}
      bg={mine ? 'rgba(255,255,255,0.08)' : COLORS.surfaceContainerLow}
      ai="center"
      jc="center"
      overflow="hidden"
      mb={4}
    >
      {url.isLoading ? (
        <ActivityIndicator color={mine ? '#fff' : COLORS.primary} />
      ) : url.data?.url ? (
        <RNImage
          source={{ uri: url.data.url }}
          style={{ width: max, height: max, resizeMode: 'cover' }}
        />
      ) : (
        <ImageIcon size={20} color={mine ? '#fff' : COLORS.outline} />
      )}
    </YStack>
  )
}
