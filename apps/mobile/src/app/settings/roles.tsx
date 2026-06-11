/**
 * Peran (roles) — list + custom-role builder with permission picker
 * grouped by module. System roles are read-only templates.
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
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Edit,
  Plus,
  Shield,
  Trash2,
  Users,
  X,
} from '~/lib/icons'
import {
  useAllPermissions,
  useCreateTenantRole,
  useDeleteTenantRole,
  useTenantRoles,
  useUpdateTenantRole,
  type PermissionDef,
  type TenantRoleRow,
} from '~/lib/settings'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function RolesScreen() {
  const roles = useTenantRoles()
  const remove = useDeleteTenantRole()
  const [editing, setEditing] = useState<TenantRoleRow | 'new' | null>(null)

  function confirmDelete(r: TenantRoleRow) {
    if (r.isSystem) {
      Alert.alert(
        'Peran bawaan tidak bisa dihapus',
        'Hanya peran kustom yang bisa dihapus.',
      )
      return
    }
    if (r.memberCount > 0) {
      Alert.alert(
        `Peran "${r.label}" dipakai oleh ${r.memberCount} anggota`,
        'Pindahkan anggota ke peran lain dulu sebelum hapus.',
      )
      return
    }
    Alert.alert(`Hapus "${r.label}"?`, 'Peran akan dihapus permanen.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: () =>
          remove.mutate(r.key, {
            onError: (err) =>
              Alert.alert(
                'Gagal hapus',
                err instanceof Error ? err.message : 'Coba lagi.',
              ),
          }),
      },
    ])
  }

  if (roles.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Peran" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (roles.error) {
    const isForbidden =
      roles.error instanceof ApiError && roles.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Peran" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa kelola peran.'
              : 'Gagal memuat peran.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const rows = roles.data ?? []
  // System first, then custom
  const sorted = [...rows].sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1
    return a.label.localeCompare(b.label)
  })

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Peran"
        subtitle={`${rows.length} peran`}
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
            refreshing={roles.isFetching}
            onRefresh={() => roles.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {sorted.map((r) => (
          <YStack
            key={r.key}
            bg={COLORS.surfaceContainerLowest}
            br={12}
            p="$3"
            gap="$2"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
            style={SHADOWS.card}
          >
            <XStack ai="center" gap="$3">
              <YStack
                w={36}
                h={36}
                br={10}
                bg={r.isSystem ? COLORS.surfaceContainerLow : COLORS.primaryFixed}
                ai="center"
                jc="center"
              >
                <Shield
                  size={16}
                  color={r.isSystem ? COLORS.onSurfaceVariant : COLORS.primary}
                />
              </YStack>
              <YStack flex={1}>
                <XStack ai="center" gap="$2">
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {r.label}
                  </Paragraph>
                  {r.isSystem && (
                    <YStack px={6} py={2} br={6} bg={COLORS.surfaceContainerLow}>
                      <Paragraph
                        fontFamily={FONTS.bodyBold}
                        fontSize={9}
                        color={COLORS.onSurfaceVariant}
                      >
                        BAWAAN
                      </Paragraph>
                    </YStack>
                  )}
                </XStack>
                <XStack ai="center" gap={4}>
                  <Users size={11} color={COLORS.onSurfaceVariant} />
                  <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                    {r.memberCount} anggota · {r.permissions.length} izin
                  </Stat>
                </XStack>
              </YStack>
              <Pressable
                onPress={() => setEditing(r)}
                hitSlop={6}
                style={{ padding: 6 }}
              >
                <Edit size={15} color={COLORS.outline} />
              </Pressable>
              {!r.isSystem && (
                <Pressable
                  onPress={() => confirmDelete(r)}
                  hitSlop={6}
                  style={{ padding: 6 }}
                >
                  <Trash2 size={15} color={COLORS.danger} />
                </Pressable>
              )}
            </XStack>
          </YStack>
        ))}
      </ScrollView>

      {editing !== null && (
        <RoleEditorModal
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </YStack>
  )
}

function RoleEditorModal({
  editing,
  onClose,
}: {
  editing: TenantRoleRow | 'new'
  onClose: () => void
}) {
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const isSystem = initial?.isSystem ?? false
  const perms = useAllPermissions()
  const create = useCreateTenantRole()
  const update = useUpdateTenantRole()

  const [label, setLabel] = useState(initial?.label ?? '')
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initial?.permissions ?? []),
  )

  useEffect(() => {
    if (initial) {
      setLabel(initial.label)
      setSelected(new Set(initial.permissions))
    } else {
      setLabel('')
      setSelected(new Set())
    }
  }, [initial])

  const groupedPerms = useMemo(() => {
    const m = new Map<string, PermissionDef[]>()
    for (const p of perms.data ?? []) {
      const list = m.get(p.module) ?? []
      list.push(p)
      m.set(p.module, list)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [perms.data])

  async function handleSave() {
    if (isSystem) {
      Alert.alert(
        'Peran bawaan tidak bisa diedit',
        'Salin sebagai peran kustom kalau perlu ubah.',
      )
      return
    }
    if (!label.trim()) {
      Alert.alert('Nama wajib', 'Isi nama peran.')
      return
    }
    if (selected.size === 0) {
      Alert.alert('Pilih izin', 'Minimal centang satu izin.')
      return
    }
    try {
      if (initial) {
        await update.mutateAsync({
          key: initial.key,
          label: label.trim(),
          permissions: [...selected],
        })
      } else {
        await create.mutateAsync({
          label: label.trim(),
          permissions: [...selected],
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
            {isNew
              ? 'Peran baru'
              : isSystem
                ? `${initial?.label ?? ''} (baca-saja)`
                : 'Edit peran'}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}
          >
            <FieldLabel>Nama peran</FieldLabel>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Mis. Supervisor Cabang"
              placeholderTextColor={COLORS.outline}
              editable={!isSystem}
              autoFocus={isNew}
              style={{
                ...inputStyle,
                opacity: isSystem ? 0.6 : 1,
              }}
            />

            {isSystem && (
              <XStack
                ai="flex-start"
                gap="$2"
                bg={COLORS.warningTint}
                br={10}
                p="$3"
              >
                <AlertCircle size={14} color="#92400e" />
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={12}
                  color="#92400e"
                  flex={1}
                >
                  Peran bawaan sistem hanya bisa dilihat. Buat peran kustom
                  baru kalau mau ubah set izin.
                </Paragraph>
              </XStack>
            )}

            {perms.isLoading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              groupedPerms.map(([module, list]) => (
                <YStack
                  key={module}
                  bg={COLORS.surfaceContainerLowest}
                  br={12}
                  p="$3"
                  gap="$2"
                  borderWidth={1}
                  borderColor={COLORS.borderSubtle}
                >
                  <XStack ai="center" jc="space-between">
                    <Paragraph
                      fontFamily={FONTS.bodyBold}
                      fontSize={12}
                      color={COLORS.onSurface}
                      letterSpacing={0.4}
                      textTransform="uppercase"
                    >
                      {module}
                    </Paragraph>
                    {!isSystem && (
                      <Pressable
                        onPress={() => {
                          const allKeys = list.map((p) => p.key)
                          const allOn = allKeys.every((k) => selected.has(k))
                          setSelected((prev) => {
                            const next = new Set(prev)
                            for (const k of allKeys) {
                              if (allOn) next.delete(k)
                              else next.add(k)
                            }
                            return next
                          })
                        }}
                      >
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          fontSize={11}
                          color={COLORS.primary}
                        >
                          {list.every((p) => selected.has(p.key))
                            ? 'Hapus semua'
                            : 'Pilih semua'}
                        </Paragraph>
                      </Pressable>
                    )}
                  </XStack>
                  {list.map((p) => {
                    const on = selected.has(p.key)
                    return (
                      <Pressable
                        key={p.key}
                        onPress={() => {
                          if (isSystem) return
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(p.key)) next.delete(p.key)
                            else next.add(p.key)
                            return next
                          })
                        }}
                      >
                        <XStack
                          ai="center"
                          gap="$2"
                          py="$2"
                          borderBottomWidth={1}
                          borderBottomColor={COLORS.borderSubtle}
                          opacity={isSystem ? 0.7 : 1}
                        >
                          <YStack
                            w={20}
                            h={20}
                            br={6}
                            bg={on ? COLORS.primary : COLORS.surface}
                            borderWidth={1}
                            borderColor={on ? COLORS.primary : COLORS.outline}
                            ai="center"
                            jc="center"
                          >
                            {on && <Check size={12} color="#fff" />}
                          </YStack>
                          <YStack flex={1}>
                            <Paragraph
                              fontFamily={FONTS.bodyMedium}
                              fontSize={13}
                              color={COLORS.onSurface}
                            >
                              {p.label}
                            </Paragraph>
                            <Stat fontSize={10} color={COLORS.outline}>
                              {p.key}
                            </Stat>
                          </YStack>
                        </XStack>
                      </Pressable>
                    )
                  })}
                </YStack>
              ))
            )}

            {!isSystem && (
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
                    Simpan peran
                  </Paragraph>
                )}
              </Pressable>
            )}
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
