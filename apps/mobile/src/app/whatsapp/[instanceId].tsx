/**
 * WA Inbox — contact list for one instance, polled every 5s. If the
 * instance is disconnected we replace the list with the pairing flow
 * (enter phone, fetch 8-digit pair code, show w/ status polling at 2s).
 */
import { useEffect, useMemo, useState } from 'react'
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
import { useLocalSearchParams, useRouter } from 'expo-router'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle,
  ChevronRight,
  MessageCircle,
  Phone,
  QrCode,
  Search,
  Settings,
  User,
  X,
} from '~/lib/icons'
import {
  useConnectWaInstance,
  useDisconnectWaInstance,
  usePairWaInstanceWithCode,
  useUpdateWaInstance,
  useWaContacts,
  useWaInstance,
  useWaInstanceStatus,
  type WaContact,
  type WaInstance,
} from '~/lib/whatsapp'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

function displayName(c: WaContact): string {
  return (
    c.masterCustomerName ||
    c.name ||
    c.pushName ||
    c.remoteJid.split('@')[0] ||
    c.remoteJid
  )
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffH = (now.getTime() - d.getTime()) / 3_600_000
    if (diffH < 24) {
      return d.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      })
    }
    return d.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
    })
  } catch {
    return ''
  }
}

function lastMessagePreview(c: WaContact): string {
  if (!c.lastBody && !c.lastType) return ''
  if (c.lastType === 'image') return '📷 Foto'
  if (c.lastType === 'sticker') return '🌟 Stiker'
  if (c.lastType === 'document') return '📄 Dokumen'
  if (c.lastType === 'audio') return '🎵 Audio'
  if (c.lastType === 'video') return '🎬 Video'
  return c.lastBody ?? ''
}

export default function WaInboxScreen() {
  const router = useRouter()
  const { instanceId } = useLocalSearchParams<{ instanceId: string }>()
  const instance = useWaInstance(instanceId)
  const status = useWaInstanceStatus(instanceId, {
    fast: instance.data?.status !== 'connected',
  })
  const contacts = useWaContacts(
    instance.data?.status === 'connected' ? instanceId : null,
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [search, setSearch] = useState('')

  const isConnected = instance.data?.status === 'connected'

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = contacts.data ?? []
    if (!q) return rows
    return rows.filter((c) => {
      const dn = displayName(c).toLowerCase()
      return dn.includes(q) || c.remoteJid.toLowerCase().includes(q)
    })
  }, [contacts.data, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      // Unread > timestamped > everything else
      if (a.unreadCount !== b.unreadCount) {
        return b.unreadCount - a.unreadCount
      }
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return bt - at
    })
  }, [filtered])

  if (instance.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Inbox" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (instance.error || !instance.data) {
    const isForbidden =
      instance.error instanceof ApiError && instance.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Inbox" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke instance ini.'
              : 'Instance WhatsApp tidak ditemukan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title={instance.data.label}
        subtitle={
          isConnected && instance.data.phoneNumber
            ? `+${instance.data.phoneNumber}`
            : status.data?.status === 'pairing'
              ? 'Pairing…'
              : 'Belum terhubung'
        }
        back
        right={
          <Pressable
            onPress={() => setSettingsOpen(true)}
            style={{
              padding: 8,
              borderRadius: 10,
              backgroundColor: COLORS.surfaceContainerLowest,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
            }}
          >
            <Settings size={16} color={COLORS.onSurface} />
          </Pressable>
        }
      />

      {!isConnected ? (
        <PairFlow
          instance={instance.data}
          statusPolling={status.data}
          onConnected={() => {
            void instance.refetch()
            void status.refetch()
          }}
        />
      ) : (
        <>
          <YStack px="$4" pt="$3" gap="$2">
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
                placeholder="Cari kontak…"
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
            contentContainerStyle={{ padding: 16, gap: 6, paddingBottom: 48 }}
            refreshControl={
              <RefreshControl
                refreshing={contacts.isFetching}
                onRefresh={() => contacts.refetch()}
                tintColor={COLORS.primary}
              />
            }
          >
            {contacts.isLoading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : sorted.length === 0 ? (
              <YStack
                ai="center"
                py="$8"
                gap="$2"
                bg={COLORS.surfaceContainerLowest}
                br={14}
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <MessageCircle size={28} color={COLORS.outline} />
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={13}
                  color={COLORS.onSurfaceVariant}
                  ta="center"
                  px="$4"
                >
                  {search
                    ? `Tidak ada kontak cocok dengan "${search}".`
                    : 'Belum ada percakapan masuk.'}
                </Paragraph>
              </YStack>
            ) : (
              sorted.map((c) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  onPress={() =>
                    router.push({
                      pathname:
                        '/whatsapp/conversation/[instanceId]/[jid]' as never,
                      params: { instanceId, jid: c.remoteJid },
                    } as never)
                  }
                />
              ))
            )}
          </ScrollView>
        </>
      )}

      {settingsOpen && (
        <SettingsModal
          instance={instance.data}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </YStack>
  )
}

function ContactRow({
  contact,
  onPress,
}: {
  contact: WaContact
  onPress: () => void
}) {
  const name = displayName(contact)
  const preview = lastMessagePreview(contact)
  const unread = contact.unreadCount > 0
  const needsHuman = contact.needsHuman === true
  return (
    <Pressable onPress={onPress}>
      <XStack
        ai="center"
        gap="$3"
        bg={COLORS.surfaceContainerLowest}
        br={12}
        p="$3"
        borderWidth={1}
        borderColor={
          needsHuman
            ? COLORS.warning
            : unread
              ? COLORS.primary
              : COLORS.borderSubtle
        }
      >
        <YStack
          w={44}
          h={44}
          br={22}
          bg={unread ? COLORS.primaryFixed : COLORS.surfaceContainerLow}
          ai="center"
          jc="center"
        >
          <User size={20} color={unread ? COLORS.primary : COLORS.outline} />
        </YStack>
        <YStack flex={1} gap={2}>
          <XStack ai="center" jc="space-between">
            <Paragraph
              fontFamily={unread ? FONTS.bodyBold : FONTS.bodySemi}
              fontSize={14}
              color={COLORS.onSurface}
              numberOfLines={1}
              flex={1}
            >
              {name}
            </Paragraph>
            <Stat fontSize={10} color={COLORS.onSurfaceVariant}>
              {fmtTime(contact.lastMessageAt)}
            </Stat>
          </XStack>
          <XStack ai="center" gap="$2">
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={
                unread ? COLORS.onSurface : COLORS.onSurfaceVariant
              }
              numberOfLines={1}
              flex={1}
            >
              {contact.lastFromMe ? 'Kamu: ' : ''}
              {preview || '(belum ada pesan)'}
            </Paragraph>
            {needsHuman && (
              <YStack px={6} py={2} br={6} bg={COLORS.warningTint}>
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={10}
                  color="#92400e"
                >
                  HANDOFF
                </Paragraph>
              </YStack>
            )}
            {unread && (
              <YStack
                br={999}
                bg={COLORS.primary}
                px={7}
                py={2}
                minWidth={20}
                ai="center"
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={10}
                  color="#fff"
                >
                  {contact.unreadCount > 99 ? '99+' : contact.unreadCount}
                </Paragraph>
              </YStack>
            )}
          </XStack>
        </YStack>
      </XStack>
    </Pressable>
  )
}

// ─── Pair flow ─────────────────────────────────────────────────────

function PairFlow({
  instance,
  statusPolling,
  onConnected,
}: {
  instance: WaInstance
  statusPolling: ReturnType<typeof useWaInstanceStatus>['data']
  onConnected: () => void
}) {
  const connect = useConnectWaInstance()
  const pair = usePairWaInstanceWithCode()
  const [phone, setPhone] = useState(instance.phoneNumber ?? '')
  const [pairingCode, setPairingCode] = useState<string | null>(null)

  // Auto-fire connect once on first mount (so user lands on this screen
  // and the Go provider immediately spins up + emits pairing state)
  useEffect(() => {
    if (instance.status === 'disconnected') {
      connect.mutate(instance.id, {
        onError: () => {
          // ignore — user can hit Mulai Pairing manually
        },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (statusPolling?.status === 'connected') {
      onConnected()
    }
    if (statusPolling?.pairingCode) {
      setPairingCode(statusPolling.pairingCode)
    }
  }, [statusPolling, onConnected])

  async function requestPairCode() {
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length < 8) {
      Alert.alert(
        'Nomor tidak valid',
        'Masukkan nomor WhatsApp lengkap termasuk kode negara (mis. 628123456789).',
      )
      return
    }
    try {
      const result = await pair.mutateAsync({ id: instance.id, phone: cleaned })
      setPairingCode(result.pairingCode)
    } catch (err) {
      Alert.alert(
        'Gagal request kode',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={16}
        p="$4"
        gap="$3"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        style={SHADOWS.card}
      >
        <XStack ai="center" gap="$3">
          <YStack
            w={48}
            h={48}
            br={16}
            bg="#dcfce7"
            ai="center"
            jc="center"
          >
            <Phone size={22} color="#25D366" />
          </YStack>
          <YStack flex={1}>
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={14}
              color={COLORS.onSurface}
            >
              Hubungkan WhatsApp
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={COLORS.onSurfaceVariant}
            >
              Dapatkan kode 8-digit untuk pairing
            </Paragraph>
          </YStack>
        </XStack>

        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={12}
          color={COLORS.onSurface}
          textTransform="uppercase"
          letterSpacing={0.4}
          mt="$2"
        >
          Nomor WhatsApp
        </Paragraph>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="628123456789"
          placeholderTextColor={COLORS.outline}
          keyboardType="phone-pad"
          editable={!pairingCode}
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 10,
            paddingHorizontal: 14,
            height: 44,
            borderWidth: 1,
            borderColor: COLORS.borderSubtle,
            fontFamily: FONTS.monoMedium,
            fontSize: 14,
            color: COLORS.onSurface,
          }}
        />
        <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
          Tulis lengkap dengan kode negara (62 untuk Indonesia).
        </Stat>

        {!pairingCode ? (
          <Pressable
            onPress={requestPairCode}
            disabled={pair.isPending}
            style={{
              marginTop: 4,
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: pair.isPending ? COLORS.outline : COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {pair.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <QrCode size={16} color="#fff" />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Minta kode pairing
                </Paragraph>
              </>
            )}
          </Pressable>
        ) : (
          <YStack gap="$3" mt="$2">
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
              letterSpacing={0.55}
              ta="center"
            >
              MASUKKAN KODE INI DI WHATSAPP
            </Paragraph>
            <YStack
              bg={COLORS.primaryFixed}
              br={16}
              py="$4"
              ai="center"
              borderWidth={2}
              borderColor={COLORS.primary}
            >
              <Paragraph
                fontFamily={FONTS.monoMedium}
                fontSize={36}
                color={COLORS.primary}
                letterSpacing={4}
              >
                {formatPairCode(pairingCode)}
              </Paragraph>
            </YStack>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={COLORS.onSurfaceVariant}
            >
              WhatsApp → Setelan → Perangkat tertaut → Tautkan
              perangkat → Tautkan dengan nomor telepon → masukkan kode di
              atas.
            </Paragraph>
            <XStack
              ai="center"
              gap="$2"
              bg={COLORS.surface}
              br={10}
              p="$3"
            >
              {statusPolling?.status === 'pairing' ||
              statusPolling?.status === 'connecting' ? (
                <>
                  <ActivityIndicator color={COLORS.primary} />
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={12}
                    color={COLORS.onSurface}
                  >
                    Menunggu kamu masukkan kode di WhatsApp…
                  </Paragraph>
                </>
              ) : (
                <>
                  <AlertCircle size={14} color={COLORS.outline} />
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={12}
                    color={COLORS.onSurfaceVariant}
                  >
                    Status: {statusPolling?.status ?? '-'}
                  </Paragraph>
                </>
              )}
            </XStack>
            <Pressable
              onPress={() => setPairingCode(null)}
              style={{
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: COLORS.borderSubtle,
                backgroundColor: COLORS.surface,
                alignItems: 'center',
              }}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Pakai nomor lain
              </Paragraph>
            </Pressable>
          </YStack>
        )}
      </YStack>

      {statusPolling?.errorMessage && (
        <XStack
          ai="flex-start"
          gap="$2"
          bg={COLORS.dangerTint}
          br={12}
          p="$3"
        >
          <AlertCircle size={16} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.danger}
            flex={1}
          >
            {statusPolling.errorMessage}
          </Paragraph>
        </XStack>
      )}
    </ScrollView>
  )
}

function formatPairCode(code: string): string {
  // Group as XXXX-XXXX for readability
  const c = code.replace(/[^A-Z0-9]/gi, '')
  if (c.length === 8) return `${c.slice(0, 4)}-${c.slice(4)}`
  return c
}

// ─── Instance settings modal ───────────────────────────────────────

function SettingsModal({
  instance,
  onClose,
}: {
  instance: WaInstance
  onClose: () => void
}) {
  const update = useUpdateWaInstance()
  const disconnect = useDisconnectWaInstance()
  const [label, setLabel] = useState(instance.label)
  const [aiEnabled, setAiEnabled] = useState(instance.aiEnabled)

  async function handleSave() {
    try {
      await update.mutateAsync({
        id: instance.id,
        label: label.trim() || instance.label,
        aiEnabled,
      })
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  function handleDisconnect() {
    Alert.alert(
      'Putuskan WhatsApp?',
      'Akun ini akan dipisahkan dari Vintra. Kamu bisa pairing ulang kapan saja.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Putuskan',
          style: 'destructive',
          onPress: () =>
            disconnect.mutate(instance.id, {
              onSuccess: onClose,
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
            Pengaturan akun
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
            <YStack gap="$2">
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.onSurface}
                textTransform="uppercase"
                letterSpacing={0.4}
              >
                Nama akun
              </Paragraph>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder={instance.label}
                placeholderTextColor={COLORS.outline}
                maxLength={100}
                style={{
                  backgroundColor: COLORS.surfaceContainerLowest,
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  height: 44,
                  borderWidth: 1,
                  borderColor: COLORS.borderSubtle,
                  fontFamily: FONTS.body,
                  fontSize: 14,
                  color: COLORS.onSurface,
                }}
              />
            </YStack>

            <Pressable onPress={() => setAiEnabled((v) => !v)}>
              <XStack
                ai="center"
                jc="space-between"
                bg={COLORS.surfaceContainerLowest}
                br={10}
                p="$3"
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <YStack flex={1}>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    AI Auto-Reply
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    Bot balas pesan masuk otomatis (butuh paket Komplit)
                  </Paragraph>
                </YStack>
                <YStack
                  w={48}
                  h={28}
                  br={999}
                  bg={aiEnabled ? COLORS.primary : COLORS.outline}
                  ai={aiEnabled ? 'flex-end' : 'flex-start'}
                  jc="center"
                  px={2}
                >
                  <YStack w={24} h={24} br={999} bg="#fff" />
                </YStack>
              </XStack>
            </Pressable>

            <Pressable
              onPress={handleSave}
              disabled={update.isPending}
              style={{
                marginTop: 4,
                paddingVertical: 12,
                borderRadius: 10,
                backgroundColor: update.isPending
                  ? COLORS.outline
                  : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {update.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Check size={14} color="#fff" />
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={13}
                    color="#fff"
                  >
                    Simpan
                  </Paragraph>
                </>
              )}
            </Pressable>

            {instance.status === 'connected' && (
              <Pressable
                onPress={handleDisconnect}
                disabled={disconnect.isPending}
                style={{
                  marginTop: 4,
                  paddingVertical: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: COLORS.danger,
                  backgroundColor: COLORS.dangerTint,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={13}
                  color={COLORS.danger}
                >
                  Putuskan akun
                </Paragraph>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </YStack>
    </Modal>
  )
}

// CheckCircle is imported for future "verified" badge on contact rows.
const _CheckCircle = CheckCircle
