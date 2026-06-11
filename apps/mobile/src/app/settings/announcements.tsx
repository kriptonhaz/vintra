/**
 * Pengumuman admin — compose / edit / delete tenant-wide broadcasts.
 * Pinned items stay at the top; expiry is optional.
 */
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  TextInput,
} from 'react-native'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertTriangle,
  Edit,
  Megaphone,
  Plus,
  Star,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useAnnouncementsAdmin,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useUpdateAnnouncement,
  type AdminAnnouncement,
} from '~/lib/settings'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function AnnouncementsAdminScreen() {
  const query = useAnnouncementsAdmin()
  const remove = useDeleteAnnouncement()
  const [editing, setEditing] = useState<AdminAnnouncement | 'new' | null>(null)

  function confirmDelete(a: AdminAnnouncement) {
    Alert.alert(`Hapus "${a.title}"?`, 'Pengumuman akan dihapus permanen.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: () =>
          remove.mutate(a.id, {
            onError: (err) =>
              Alert.alert(
                'Gagal hapus',
                err instanceof Error ? err.message : 'Coba lagi.',
              ),
          }),
      },
    ])
  }

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pengumuman" back />
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
        <ScreenHeader title="Pengumuman" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa kelola pengumuman.'
              : 'Gagal memuat pengumuman.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const items = query.data?.items ?? []
  // Pinned first, then by createdAt desc
  const sorted = [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.createdAt.localeCompare(a.createdAt)
  })

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Pengumuman"
        subtitle={`${items.length} pengumuman`}
        back
        right={
          <Pressable
            onPress={() => setEditing('new')}
            style={{
              backgroundColor: COLORS.primary,
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
              Baru
            </Paragraph>
          </Pressable>
        }
      />

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
        {sorted.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Megaphone size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              px="$4"
            >
              Belum ada pengumuman. Buat untuk broadcast info ke seluruh tim.
            </Paragraph>
          </YStack>
        ) : (
          sorted.map((a) => (
            <YStack
              key={a.id}
              bg={COLORS.surfaceContainerLowest}
              br={12}
              p="$3"
              gap="$2"
              borderWidth={1}
              borderColor={a.pinned ? COLORS.primary : COLORS.borderSubtle}
              style={SHADOWS.card}
            >
              <XStack ai="flex-start" jc="space-between" gap="$2">
                <YStack flex={1}>
                  <XStack ai="center" gap="$2">
                    {a.pinned && (
                      <YStack px={6} py={2} br={6} bg={COLORS.primary}>
                        <XStack ai="center" gap={3}>
                          <Star size={9} color="#fff" />
                          <Paragraph
                            fontFamily={FONTS.bodyBold}
                            fontSize={9}
                            color="#fff"
                          >
                            DI-PIN
                          </Paragraph>
                        </XStack>
                      </YStack>
                    )}
                    {a.expiresAt && (
                      <YStack px={6} py={2} br={6} bg={COLORS.warningTint}>
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          fontSize={9}
                          color="#92400e"
                        >
                          BERAKHIR {fmtDateTime(a.expiresAt)}
                        </Paragraph>
                      </YStack>
                    )}
                  </XStack>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                    mt={4}
                  >
                    {a.title}
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={12}
                    color={COLORS.onSurfaceVariant}
                    numberOfLines={3}
                  >
                    {a.body}
                  </Paragraph>
                  <Stat fontSize={10} color={COLORS.outline}>
                    {a.authorName ?? '-'} · {fmtDateTime(a.createdAt)}
                  </Stat>
                </YStack>
              </XStack>
              <XStack gap="$2">
                <Pressable
                  onPress={() => setEditing(a)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: COLORS.borderSubtle,
                    backgroundColor: COLORS.surface,
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 4,
                  }}
                >
                  <Edit size={12} color={COLORS.onSurface} />
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={11}
                    color={COLORS.onSurface}
                  >
                    Edit
                  </Paragraph>
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(a)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: COLORS.dangerTint,
                    backgroundColor: COLORS.dangerTint,
                  }}
                >
                  <Trash2 size={12} color={COLORS.danger} />
                </Pressable>
              </XStack>
            </YStack>
          ))
        )}
      </ScrollView>

      {editing !== null && (
        <AnnouncementEditorModal
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </YStack>
  )
}

function AnnouncementEditorModal({
  editing,
  onClose,
}: {
  editing: AdminAnnouncement | 'new'
  onClose: () => void
}) {
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const create = useCreateAnnouncement()
  const update = useUpdateAnnouncement()

  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [pinned, setPinned] = useState(initial?.pinned ?? false)
  const [expiresAt, setExpiresAt] = useState(
    initial?.expiresAt ? initial.expiresAt.slice(0, 10) : '',
  )

  useEffect(() => {
    if (initial) {
      setTitle(initial.title)
      setBody(initial.body)
      setPinned(initial.pinned)
      setExpiresAt(initial.expiresAt ? initial.expiresAt.slice(0, 10) : '')
    }
  }, [initial])

  async function handleSave() {
    if (!title.trim() || !body.trim()) {
      Alert.alert('Wajib diisi', 'Judul dan isi pengumuman wajib diisi.')
      return
    }
    let expiresIso: string | null = null
    if (expiresAt) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
        Alert.alert('Tanggal tidak valid', 'Gunakan format YYYY-MM-DD.')
        return
      }
      expiresIso = new Date(`${expiresAt}T23:59:59`).toISOString()
    }
    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          title: title.trim(),
          body: body.trim(),
          pinned,
          expiresAt: expiresIso,
        })
      } else {
        await create.mutateAsync({
          title: title.trim(),
          body: body.trim(),
          pinned,
          expiresAt: expiresIso,
        })
      }
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
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
            {isNew ? 'Pengumuman baru' : 'Edit pengumuman'}
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
            <FieldLabel>Judul</FieldLabel>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Mis. Libur Lebaran 2026"
              placeholderTextColor={COLORS.outline}
              maxLength={160}
              autoFocus={isNew}
              style={inputStyle}
            />
            <FieldLabel>Isi pengumuman</FieldLabel>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Tulis informasi yang ingin disampaikan…"
              placeholderTextColor={COLORS.outline}
              multiline
              maxLength={5000}
              style={{
                ...inputStyle,
                minHeight: 140,
                paddingTop: 10,
                textAlignVertical: 'top' as const,
                height: undefined,
              }}
            />
            <XStack ai="center" jc="space-between" mt="$1">
              <YStack flex={1}>
                <Paragraph
                  fontFamily={FONTS.bodySemi}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  Pin di atas
                </Paragraph>
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.onSurfaceVariant}
                >
                  Pengumuman penting muncul di home card semua staff.
                </Paragraph>
              </YStack>
              <Switch
                value={pinned}
                onValueChange={setPinned}
                trackColor={{ false: COLORS.outline, true: COLORS.primary }}
                thumbColor="#fff"
              />
            </XStack>
            <FieldLabel>Berakhir (opsional, YYYY-MM-DD)</FieldLabel>
            <TextInput
              value={expiresAt}
              onChangeText={setExpiresAt}
              placeholder="2026-12-31"
              placeholderTextColor={COLORS.outline}
              maxLength={10}
              style={inputStyle}
            />
            <Pressable
              onPress={handleSave}
              disabled={create.isPending || update.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor:
                  create.isPending || update.isPending
                    ? COLORS.outline
                    : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {create.isPending || update.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Simpan
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </YStack>
    </Modal>
  )
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Paragraph
      fontFamily={FONTS.bodyBold}
      fontSize={12}
      color={COLORS.onSurface}
      textTransform="uppercase"
      letterSpacing={0.4}
    >
      {children}
    </Paragraph>
  )
}

const inputStyle = {
  backgroundColor: COLORS.surfaceContainerLowest,
  borderRadius: 10,
  paddingHorizontal: 14,
  height: 44,
  borderWidth: 1,
  borderColor: COLORS.borderSubtle,
  fontFamily: FONTS.body,
  fontSize: 14,
  color: COLORS.onSurface,
}
