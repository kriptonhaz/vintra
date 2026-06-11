/**
 * WhatsApp instances list — overview of every WA account the tenant
 * has connected. Each row shows pairing status; tap to push the inbox
 * (or the pair flow if disconnected). Bottom CTA creates a new
 * instance (capped by subscription tier).
 */
import { useState } from 'react'
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
import { useRouter } from 'expo-router'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertTriangle,
  BarChart2,
  CheckCircle,
  ChevronRight,
  CreditCard,
  MessageCircle,
  Plus,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useCreateWaInstance,
  useDeleteWaInstance,
  useWaInstances,
  useWaSubscription,
  type WaInstance,
  type WaInstanceStatus,
} from '~/lib/whatsapp'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const STATUS_COLOR: Record<string, { fg: string; bg: string; label: string }> = {
  connected: { fg: COLORS.success, bg: '#dcfce7', label: 'Terhubung' },
  pairing: { fg: '#92400e', bg: COLORS.warningTint, label: 'Pairing…' },
  connecting: { fg: '#92400e', bg: COLORS.warningTint, label: 'Menghubungkan' },
  disconnected: { fg: COLORS.outline, bg: COLORS.surfaceContainerLow, label: 'Belum terhubung' },
}

function statusMeta(s: WaInstanceStatus) {
  return (
    STATUS_COLOR[s] ?? {
      fg: COLORS.outline,
      bg: COLORS.surfaceContainerLow,
      label: s,
    }
  )
}

export default function WhatsappInstancesScreen() {
  const router = useRouter()
  const instances = useWaInstances()
  const sub = useWaSubscription()
  const createInstance = useCreateWaInstance()
  const deleteInstance = useDeleteWaInstance()
  const [creating, setCreating] = useState(false)

  if (instances.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="WhatsApp" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (instances.error) {
    const isForbidden =
      instances.error instanceof ApiError && instances.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="WhatsApp" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa kelola WhatsApp.'
              : 'Gagal memuat daftar akun WhatsApp.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const rows = instances.data ?? []
  const cap = sub.data?.instanceCap ?? null
  const remaining = cap !== null ? Math.max(0, cap - rows.length) : null

  function confirmDelete(inst: WaInstance) {
    Alert.alert(
      `Hapus "${inst.label}"?`,
      'Akun WhatsApp ini akan diputus dan dihapus. Riwayat chat tidak ikut hilang dari WhatsApp di HP, tapi tidak akan muncul di Vintra lagi.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () =>
            deleteInstance.mutate(inst.id, {
              onError: (err) =>
                Alert.alert(
                  'Gagal hapus',
                  err instanceof Error ? err.message : 'Coba lagi.',
                ),
            }),
        },
      ],
    )
  }

  async function handleCreate(label: string) {
    try {
      const inst = await createInstance.mutateAsync(label)
      setCreating(false)
      // Push to inbox so user can immediately start pairing
      router.push({
        pathname: '/whatsapp/[instanceId]' as never,
        params: { instanceId: inst.id },
      } as never)
    } catch (err) {
      Alert.alert(
        'Gagal buat akun',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="WhatsApp"
        subtitle={`${rows.length}${cap !== null ? `/${cap}` : ''} akun`}
        back
        right={
          <Pressable
            onPress={() => setCreating(true)}
            disabled={remaining === 0}
            style={{
              backgroundColor: remaining === 0 ? COLORS.outline : COLORS.primary,
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
              Akun
            </Paragraph>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={instances.isFetching || sub.isFetching}
            onRefresh={() => {
              void instances.refetch()
              void sub.refetch()
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        {sub.data && (
          <YStack
            bg={COLORS.primary}
            br={16}
            p="$4"
            gap="$2"
            style={SHADOWS.card}
          >
            <XStack ai="center" jc="space-between">
              <YStack>
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={11}
                  color="rgba(255,255,255,0.85)"
                  letterSpacing={0.4}
                >
                  PAKET AKTIF
                </Paragraph>
                <Paragraph
                  fontFamily={FONTS.headingBold}
                  fontSize={20}
                  color="#fff"
                >
                  {sub.data.tier.toUpperCase()}
                </Paragraph>
              </YStack>
              {sub.data.aiEnabled && (
                <YStack px={8} py={3} br={999} bg="rgba(255,255,255,0.18)">
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={10}
                    color="#fff"
                  >
                    AI AKTIF
                  </Paragraph>
                </YStack>
              )}
            </XStack>
            <XStack ai="center" gap="$3" mt="$1">
              <Pressable
                onPress={() => router.push('/whatsapp/dashboard' as never)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <BarChart2 size={14} color="#fff" />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={12}
                  color="#fff"
                >
                  Dashboard
                </Paragraph>
              </Pressable>
              <Pressable
                onPress={() => router.push('/whatsapp/billing' as never)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <CreditCard size={14} color="#fff" />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={12}
                  color="#fff"
                >
                  Paket
                </Paragraph>
              </Pressable>
            </XStack>
          </YStack>
        )}

        {rows.length === 0 ? (
          <YStack
            ai="center"
            gap="$3"
            py="$8"
            px="$5"
            bg={COLORS.surfaceContainerLowest}
            br={16}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <YStack
              w={64}
              h={64}
              br={20}
              bg={COLORS.primaryFixed}
              ai="center"
              jc="center"
            >
              <MessageCircle size={26} color={COLORS.primary} />
            </YStack>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={16}
              color={COLORS.onSurface}
            >
              Belum ada akun WhatsApp
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
            >
              Hubungkan nomor WA bisnis untuk pakai inbox + AI auto-reply.
            </Paragraph>
            <Pressable
              onPress={() => setCreating(true)}
              style={{
                marginTop: 4,
                paddingHorizontal: 16,
                paddingVertical: 10,
                backgroundColor: COLORS.primary,
                borderRadius: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Plus size={14} color="#fff" />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color="#fff"
              >
                Tambah akun WhatsApp
              </Paragraph>
            </Pressable>
          </YStack>
        ) : (
          rows.map((inst) => (
            <InstanceCard
              key={inst.id}
              instance={inst}
              onOpen={() =>
                router.push({
                  pathname: '/whatsapp/[instanceId]' as never,
                  params: { instanceId: inst.id },
                } as never)
              }
              onDelete={() => confirmDelete(inst)}
            />
          ))
        )}
      </ScrollView>

      {creating && (
        <CreateInstanceModal
          onClose={() => setCreating(false)}
          onCreate={handleCreate}
          busy={createInstance.isPending}
        />
      )}
    </YStack>
  )
}

function InstanceCard({
  instance,
  onOpen,
  onDelete,
}: {
  instance: WaInstance
  onOpen: () => void
  onDelete: () => void
}) {
  const status = statusMeta(instance.status)
  const isConnected = instance.status === 'connected'
  return (
    <Pressable onPress={onOpen}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        style={SHADOWS.card}
      >
        <XStack ai="center" gap="$3">
          <YStack
            w={44}
            h={44}
            br={14}
            bg="#dcfce7"
            ai="center"
            jc="center"
          >
            <MessageCircle size={20} color="#25D366" />
          </YStack>
          <YStack flex={1}>
            <Paragraph
              fontFamily={FONTS.bodySemi}
              fontSize={14}
              color={COLORS.onSurface}
            >
              {instance.label}
            </Paragraph>
            {instance.phoneNumber && (
              <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                +{instance.phoneNumber}
              </Stat>
            )}
            <XStack ai="center" gap="$2" mt={2}>
              <YStack px={8} py={2} br={6} bg={status.bg}>
                <XStack ai="center" gap={4}>
                  {isConnected && <CheckCircle size={10} color={status.fg} />}
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={10}
                    color={status.fg}
                  >
                    {status.label.toUpperCase()}
                  </Paragraph>
                </XStack>
              </YStack>
              {instance.aiEnabled && (
                <YStack px={8} py={2} br={6} bg={COLORS.primaryFixed}>
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={10}
                    color={COLORS.primary}
                  >
                    AI
                  </Paragraph>
                </YStack>
              )}
            </XStack>
          </YStack>
          <Pressable onPress={onDelete} hitSlop={6} style={{ padding: 6 }}>
            <Trash2 size={15} color={COLORS.outline} />
          </Pressable>
          <ChevronRight size={18} color={COLORS.outline} />
        </XStack>
      </YStack>
    </Pressable>
  )
}

function CreateInstanceModal({
  onClose,
  onCreate,
  busy,
}: {
  onClose: () => void
  onCreate: (label: string) => void
  busy: boolean
}) {
  const [label, setLabel] = useState('')
  function submit() {
    if (!label.trim()) {
      Alert.alert('Nama wajib', 'Tulis nama akun (mis. "WA Toko" atau "WA Cabang Cengkareng").')
      return
    }
    onCreate(label.trim())
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
            Akun WhatsApp baru
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
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Beri label untuk akun WA-mu. Setelah dibuat, kamu akan
              diarahkan ke layar pairing untuk hubungkan nomor.
            </Paragraph>
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
              placeholder='Mis. "WA Toko" atau "WA Cabang Cengkareng"'
              placeholderTextColor={COLORS.outline}
              maxLength={100}
              autoFocus
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
            <Pressable
              onPress={submit}
              disabled={busy}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: busy ? COLORS.outline : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Buat akun
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </YStack>
    </Modal>
  )
}
