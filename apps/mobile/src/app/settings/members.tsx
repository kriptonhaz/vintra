/**
 * Tim (members) — list, invite (email or phone-only), change role,
 * assign branches, remove. HR profile (KTP/address/etc) deferred to
 * desktop for v1.
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
  AlertTriangle,
  Check,
  ChevronRight,
  Mail,
  Phone,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  X,
} from '~/lib/icons'
import {
  useInvitePhoneOnlyMember,
  useInviteTenantMember,
  useRemoveTenantMember,
  useRolesForAssignment,
  useSetTenantMemberBranches,
  useTenantBranchesForMembers,
  useTenantMembers,
  useUpdateTenantMemberRole,
  type AssignableRole,
  type TenantMember,
} from '~/lib/settings'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

function displayName(m: TenantMember): string {
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ').trim()
  return name || m.email || m.phone || '(tanpa nama)'
}

export default function MembersScreen() {
  const members = useTenantMembers()
  const remove = useRemoveTenantMember()
  const [search, setSearch] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState<TenantMember | null>(null)

  const rows = useMemo(() => {
    const all = members.data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter((m) => {
      const name = displayName(m).toLowerCase()
      return (
        name.includes(q) ||
        (m.email ?? '').toLowerCase().includes(q) ||
        (m.phone ?? '').toLowerCase().includes(q)
      )
    })
  }, [members.data, search])

  function confirmRemove(m: TenantMember) {
    Alert.alert(
      `Keluarkan ${displayName(m)}?`,
      'Akses ke usaha ini akan dicabut. Bisa di-invite ulang kapan saja.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Keluarkan',
          style: 'destructive',
          onPress: () =>
            remove.mutate(m.userId, {
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

  if (members.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Tim" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (members.error) {
    const isForbidden =
      members.error instanceof ApiError && members.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Tim" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa kelola tim.'
              : 'Gagal memuat anggota tim.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Tim"
        subtitle={`${rows.length} anggota`}
        back
        right={
          <Pressable
            onPress={() => setInviteOpen(true)}
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
              Invite
            </Paragraph>
          </Pressable>
        }
      />

      <YStack px="$4" pt="$3" pb="$2">
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
            placeholder="Cari anggota"
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
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={members.isFetching}
            onRefresh={() => members.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {rows.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Users size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
            >
              {search
                ? `Tidak ada anggota cocok dengan "${search}".`
                : 'Belum ada anggota tim.'}
            </Paragraph>
          </YStack>
        ) : (
          rows.map((m) => (
            <Pressable key={m.userId} onPress={() => setEditing(m)}>
              <XStack
                ai="center"
                gap="$3"
                bg={COLORS.surfaceContainerLowest}
                br={12}
                p="$3"
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
                opacity={m.isActive ? 1 : 0.6}
                style={SHADOWS.card}
              >
                <YStack
                  w={40}
                  h={40}
                  br={20}
                  bg={COLORS.primaryFixed}
                  ai="center"
                  jc="center"
                >
                  <User size={18} color={COLORS.primary} />
                </YStack>
                <YStack flex={1}>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {displayName(m)}
                  </Paragraph>
                  <XStack ai="center" gap="$2">
                    <YStack
                      px={6}
                      py={2}
                      br={6}
                      bg={COLORS.primaryFixed}
                    >
                      <Paragraph
                        fontFamily={FONTS.bodyBold}
                        fontSize={10}
                        color={COLORS.primary}
                      >
                        {(m.roleLabel ?? m.roleKey).toUpperCase()}
                      </Paragraph>
                    </YStack>
                    {!m.isActive && (
                      <YStack px={6} py={2} br={6} bg={COLORS.surfaceContainerLow}>
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          fontSize={10}
                          color={COLORS.onSurfaceVariant}
                        >
                          NON-AKTIF
                        </Paragraph>
                      </YStack>
                    )}
                  </XStack>
                  {(m.email || m.phone) && (
                    <XStack ai="center" gap={4}>
                      {m.email ? (
                        <>
                          <Mail size={11} color={COLORS.onSurfaceVariant} />
                          <Stat fontSize={11} color={COLORS.onSurfaceVariant} numberOfLines={1}>
                            {m.email}
                          </Stat>
                        </>
                      ) : (
                        <>
                          <Phone size={11} color={COLORS.onSurfaceVariant} />
                          <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                            {m.phone}
                          </Stat>
                        </>
                      )}
                    </XStack>
                  )}
                  {m.branches.length > 0 && (
                    <Stat fontSize={10} color={COLORS.outline}>
                      Cabang: {m.branches.map((b) => b.name).join(', ')}
                    </Stat>
                  )}
                </YStack>
                <Pressable
                  onPress={() => confirmRemove(m)}
                  hitSlop={6}
                  style={{ padding: 6 }}
                >
                  <Trash2 size={14} color={COLORS.danger} />
                </Pressable>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>
          ))
        )}
      </ScrollView>

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
      {editing && (
        <MemberEditorModal
          member={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </YStack>
  )
}

// ─── Invite modal ─────────────────────────────────────────────────

function InviteModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'email' | 'phone'>('email')
  const roles = useRolesForAssignment()
  const branches = useTenantBranchesForMembers()
  const inviteEmail = useInviteTenantMember()
  const invitePhone = useInvitePhoneOnlyMember()

  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [roleKey, setRoleKey] = useState('')
  const [branchIds, setBranchIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!roleKey && roles.data && roles.data.length > 0) {
      // Default to cashier or first role
      const cashier = roles.data.find((r) => r.key === 'cashier')
      setRoleKey((cashier ?? roles.data[0]!).key)
    }
  }, [roleKey, roles.data])

  async function submit() {
    if (!firstName.trim()) {
      Alert.alert('Nama wajib', 'Isi nama depan.')
      return
    }
    if (!roleKey) {
      Alert.alert('Pilih peran', 'Pilih peran untuk anggota baru.')
      return
    }
    const branchIdsArr = [...branchIds]
    try {
      if (tab === 'email') {
        if (!email.trim()) {
          Alert.alert('Email wajib', 'Isi alamat email.')
          return
        }
        await inviteEmail.mutateAsync({
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          roleKey,
          branchIds: branchIdsArr.length > 0 ? branchIdsArr : undefined,
        })
      } else {
        if (!phone.trim()) {
          Alert.alert('Nomor wajib', 'Isi nomor HP.')
          return
        }
        await invitePhone.mutateAsync({
          phone: phone.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          roleKey,
          branchIds: branchIdsArr.length > 0 ? branchIdsArr : undefined,
        })
      }
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal invite',
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
            Invite anggota baru
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
            {/* Tab */}
            <XStack ai="center" gap="$1" bg={COLORS.surfaceContainerLow} br={999} p={4}>
              {(['email', 'phone'] as const).map((t) => {
                const on = t === tab
                return (
                  <Pressable
                    key={t}
                    onPress={() => setTab(t)}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: on ? '#fff' : 'transparent',
                      alignItems: 'center',
                    }}
                  >
                    <Paragraph
                      fontFamily={FONTS.bodyBold}
                      fontSize={12}
                      color={on ? COLORS.onSurface : COLORS.onSurfaceVariant}
                    >
                      {t === 'email' ? 'Via Email' : 'Via WA / HP'}
                    </Paragraph>
                  </Pressable>
                )
              })}
            </XStack>

            {tab === 'email' ? (
              <>
                <FieldLabel>Email</FieldLabel>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="mis. budi@gmail.com"
                  placeholderTextColor={COLORS.outline}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={inputStyle}
                />
              </>
            ) : (
              <>
                <FieldLabel>Nomor HP</FieldLabel>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="08xx"
                  placeholderTextColor={COLORS.outline}
                  keyboardType="phone-pad"
                  style={inputStyle}
                />
                <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                  Anggota tanpa email login via WhatsApp OTP. Cocok untuk
                  staff lapangan.
                </Stat>
              </>
            )}

            <FieldLabel>Nama depan</FieldLabel>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Budi"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
            <FieldLabel>Nama belakang (opsional)</FieldLabel>
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              placeholder="Santoso"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />

            <FieldLabel>Peran</FieldLabel>
            <YStack gap="$2">
              {(roles.data ?? []).map((r) => (
                <RolePicker
                  key={r.key}
                  role={r}
                  on={r.key === roleKey}
                  onPick={() => setRoleKey(r.key)}
                />
              ))}
            </YStack>

            {branches.data && branches.data.length > 1 && (
              <>
                <FieldLabel>Cabang (kosong = semua)</FieldLabel>
                <YStack gap="$2">
                  {branches.data.map((b) => {
                    const on = branchIds.has(b.id)
                    return (
                      <Pressable
                        key={b.id}
                        onPress={() => {
                          setBranchIds((prev) => {
                            const next = new Set(prev)
                            if (next.has(b.id)) next.delete(b.id)
                            else next.add(b.id)
                            return next
                          })
                        }}
                      >
                        <XStack
                          ai="center"
                          jc="space-between"
                          p="$3"
                          br={10}
                          bg={on ? COLORS.primaryFixed : COLORS.surfaceContainerLowest}
                          borderWidth={1}
                          borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                        >
                          <Paragraph
                            fontFamily={FONTS.bodyMedium}
                            fontSize={14}
                            color={COLORS.onSurface}
                          >
                            {b.name}
                          </Paragraph>
                          {on && <Check size={16} color={COLORS.primary} />}
                        </XStack>
                      </Pressable>
                    )
                  })}
                </YStack>
              </>
            )}

            <Pressable
              onPress={submit}
              disabled={inviteEmail.isPending || invitePhone.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor:
                  inviteEmail.isPending || invitePhone.isPending
                    ? COLORS.outline
                    : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {inviteEmail.isPending || invitePhone.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Kirim undangan
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </YStack>
    </Modal>
  )
}

function RolePicker({
  role,
  on,
  onPick,
}: {
  role: AssignableRole
  on: boolean
  onPick: () => void
}) {
  return (
    <Pressable onPress={onPick}>
      <XStack
        ai="center"
        jc="space-between"
        p="$3"
        br={10}
        bg={on ? COLORS.primaryFixed : COLORS.surfaceContainerLowest}
        borderWidth={1}
        borderColor={on ? COLORS.primary : COLORS.borderSubtle}
      >
        <YStack>
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
          >
            {role.label}
          </Paragraph>
          {role.isSystem && (
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              Bawaan sistem
            </Stat>
          )}
        </YStack>
        {on && <Check size={16} color={COLORS.primary} />}
      </XStack>
    </Pressable>
  )
}

// ─── Edit existing member ────────────────────────────────────────

function MemberEditorModal({
  member,
  onClose,
}: {
  member: TenantMember
  onClose: () => void
}) {
  const roles = useRolesForAssignment()
  const branches = useTenantBranchesForMembers()
  const updateRole = useUpdateTenantMemberRole()
  const setBranches = useSetTenantMemberBranches()

  const [roleKey, setRoleKey] = useState(member.roleKey)
  const [branchIds, setBranchIds] = useState<Set<string>>(
    new Set(member.branches.map((b) => b.id)),
  )

  async function handleSave() {
    try {
      if (roleKey !== member.roleKey) {
        await updateRole.mutateAsync({
          userId: member.userId,
          roleKey,
        })
      }
      const orig = new Set(member.branches.map((b) => b.id))
      const changed =
        branchIds.size !== orig.size ||
        [...branchIds].some((id) => !orig.has(id))
      if (changed) {
        await setBranches.mutateAsync({
          userId: member.userId,
          branchIds: [...branchIds],
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
            {displayName(member)}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <FieldLabel>Peran</FieldLabel>
          <YStack gap="$2">
            {(roles.data ?? []).map((r) => (
              <RolePicker
                key={r.key}
                role={r}
                on={r.key === roleKey}
                onPick={() => setRoleKey(r.key)}
              />
            ))}
          </YStack>

          {branches.data && branches.data.length > 1 && (
            <>
              <FieldLabel>Cabang yang dapat diakses</FieldLabel>
              <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                Kosongkan untuk akses semua cabang.
              </Stat>
              <YStack gap="$2">
                {branches.data.map((b) => {
                  const on = branchIds.has(b.id)
                  return (
                    <Pressable
                      key={b.id}
                      onPress={() => {
                        setBranchIds((prev) => {
                          const next = new Set(prev)
                          if (next.has(b.id)) next.delete(b.id)
                          else next.add(b.id)
                          return next
                        })
                      }}
                    >
                      <XStack
                        ai="center"
                        jc="space-between"
                        p="$3"
                        br={10}
                        bg={on ? COLORS.primaryFixed : COLORS.surfaceContainerLowest}
                        borderWidth={1}
                        borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                      >
                        <Paragraph
                          fontFamily={FONTS.bodyMedium}
                          fontSize={14}
                          color={COLORS.onSurface}
                        >
                          {b.name}
                        </Paragraph>
                        {on && <Check size={16} color={COLORS.primary} />}
                      </XStack>
                    </Pressable>
                  )
                })}
              </YStack>
            </>
          )}

          <Pressable
            onPress={handleSave}
            disabled={updateRole.isPending || setBranches.isPending}
            style={{
              marginTop: 8,
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor:
                updateRole.isPending || setBranches.isPending
                  ? COLORS.outline
                  : COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {updateRole.isPending || setBranches.isPending ? (
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
