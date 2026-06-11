/**
 * Account settings — change password + sign-out shortcut. Push
 * notification opt-in lives elsewhere (handled by the OS-level
 * permission flow); we hint at it here.
 */
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import { Check, Lock, LogOut, Mail, User } from '~/lib/icons'
import { useChangePassword, useSetAuthPassword } from '~/lib/settings'
import { useAuth } from '~/lib/auth-context'
import { useTenant } from '~/lib/tenant-context'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

export default function AccountScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { clear } = useTenant()
  const changePw = useChangePassword()
  const setPw = useSetAuthPassword()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  // Identities array tells us if the user has an email/password
  // identity. WA-login only users use setPassword instead.
  const hasEmailIdentity =
    (user?.identities ?? []).some(
      (i: { provider?: string }) => i.provider === 'email',
    ) ?? true // Default assume yes (changePassword path is most common)

  async function handleSave() {
    if (next.length < 8) {
      Alert.alert(
        'Password baru terlalu pendek',
        'Minimal 8 karakter.',
      )
      return
    }
    if (next !== confirm) {
      Alert.alert(
        'Konfirmasi tidak cocok',
        'Pastikan password baru dan konfirmasi sama.',
      )
      return
    }
    try {
      if (hasEmailIdentity) {
        if (!current) {
          Alert.alert(
            'Isi password saat ini',
            'Untuk verifikasi sebelum ganti.',
          )
          return
        }
        await changePw.mutateAsync({
          currentPassword: current,
          newPassword: next,
          confirmPassword: confirm,
        })
      } else {
        await setPw.mutateAsync({
          newPassword: next,
          confirmPassword: confirm,
        })
      }
      setCurrent('')
      setNext('')
      setConfirm('')
      Alert.alert('Tersimpan', 'Password berhasil diperbarui.')
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  function handleSignOut() {
    Alert.alert('Keluar dari akun?', 'Kamu akan diminta login lagi.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Keluar',
        style: 'destructive',
        onPress: async () => {
          await clear()
          await signOut()
          router.replace('/auth/login' as never)
        },
      },
    ])
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader title="Akun" subtitle={user?.email ?? ''} back />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        >
          {/* Profile card */}
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
                w={48}
                h={48}
                br={24}
                bg={COLORS.primaryFixed}
                ai="center"
                jc="center"
              >
                <User size={20} color={COLORS.primary} />
              </YStack>
              <YStack flex={1}>
                <Paragraph
                  fontFamily={FONTS.bodySemi}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  {user?.email ?? '-'}
                </Paragraph>
                <XStack ai="center" gap={4}>
                  <Mail size={11} color={COLORS.onSurfaceVariant} />
                  <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                    Login email + password
                  </Stat>
                </XStack>
              </YStack>
            </XStack>
          </YStack>

          {/* Password */}
          <YStack
            bg={COLORS.surfaceContainerLowest}
            br={14}
            p="$3"
            gap="$3"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
            style={SHADOWS.card}
          >
            <XStack ai="center" gap="$2">
              <Lock size={16} color={COLORS.primary} />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={14}
                color={COLORS.onSurface}
              >
                Ganti password
              </Paragraph>
            </XStack>

            {hasEmailIdentity && (
              <Field
                label="Password saat ini"
                value={current}
                onChange={setCurrent}
                secureTextEntry
              />
            )}
            <Field
              label="Password baru (min 8 char)"
              value={next}
              onChange={setNext}
              secureTextEntry
            />
            <Field
              label="Konfirmasi password baru"
              value={confirm}
              onChange={setConfirm}
              secureTextEntry
            />

            <Pressable
              onPress={handleSave}
              disabled={changePw.isPending || setPw.isPending}
              style={{
                marginTop: 4,
                paddingVertical: 12,
                borderRadius: 10,
                backgroundColor:
                  changePw.isPending || setPw.isPending
                    ? COLORS.outline
                    : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {changePw.isPending || setPw.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Check size={14} color="#fff" />
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={13}
                    color="#fff"
                  >
                    Simpan password
                  </Paragraph>
                </>
              )}
            </Pressable>
          </YStack>

          {/* Sign out */}
          <Pressable
            onPress={handleSignOut}
            style={{
              paddingVertical: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: COLORS.danger,
              backgroundColor: COLORS.dangerTint,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <LogOut size={16} color={COLORS.danger} />
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={14}
              color={COLORS.danger}
            >
              Keluar dari akun
            </Paragraph>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </YStack>
  )
}

function Field({
  label,
  value,
  onChange,
  secureTextEntry,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  secureTextEntry?: boolean
}) {
  return (
    <YStack gap={4}>
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={11}
        color={COLORS.onSurfaceVariant}
        letterSpacing={0.4}
        textTransform="uppercase"
      >
        {label}
      </Paragraph>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 10,
          paddingHorizontal: 12,
          height: 44,
          borderWidth: 1,
          borderColor: COLORS.borderSubtle,
          fontFamily: FONTS.body,
          fontSize: 14,
          color: COLORS.onSurface,
        }}
      />
    </YStack>
  )
}
