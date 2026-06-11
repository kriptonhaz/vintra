/**
 * Inline registration — Asana-style hero with cover photo + gradient,
 * white rounded-top card with the form. Same shape as login.tsx so the
 * whole auth flow is visually consistent.
 *
 * Form fields (4): full name, business name, email, password.
 * Submits to the existing `registerWithEmail` server fn via the
 * mobile API gateway. After submit Supabase emails a verification
 * link; until clicked, login is blocked with "email not confirmed",
 * so the success state tells the user to check inbox.
 *
 * ScrollView is kept (unlike login) because 4 stacked inputs +
 * keyboard on a small device WILL overflow the viewport — we need
 * the safety net.
 */
import { useState } from 'react'
import { Image as RNImage } from 'react-native'
import { Link, useRouter } from 'expo-router'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import {
  Briefcase,
  CheckCircle,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
} from '~/lib/icons'
import {
  Button,
  Paragraph,
  ScrollView,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import { callServerFn } from '../../lib/api'
import { IconInput } from '../../components/IconInput'
import { COLORS, FONTS } from '../../lib/theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../../../assets/icon.png')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loginCover = require('../../../assets/images/login-cover.png')

export default function RegisterScreen() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const canSubmit =
    fullName.trim().length > 0 &&
    businessName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 6 &&
    !busy

  async function handleSubmit() {
    if (!canSubmit) return
    setBusy(true)
    try {
      await callServerFn('registerWithEmail', {
        fullName: fullName.trim(),
        businessName: businessName.trim(),
        email: email.trim(),
        password,
      })
      setDone(true)
    } catch (err) {
      Alert.alert(
        'Daftar gagal',
        err instanceof Error ? mapAuthError(err.message) : 'Coba lagi.',
      )
    } finally {
      setBusy(false)
    }
  }

  const heroPrimary = done ? 'Cek email' : 'Daftar usahamu,'
  const heroAccent = done ? 'buat verifikasi.' : 'mulai sekarang!'
  const heroSubhead = done
    ? `Link verifikasi sudah kami kirim ke ${email}.`
    : 'Buat akun + usaha baru — cuma butuh 30 detik.'

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: 'white' }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── HERO — same image+gradient pattern as login.tsx ──── */}
        <YStack position="relative" overflow="hidden" bg={COLORS.primary}>
          <RNImage
            source={loginCover}
            resizeMode="cover"
            style={{
              position: 'absolute',
              top: -80,
              left: 0,
              right: 0,
              width: '100%',
              aspectRatio: 400 / 543,
            }}
          />
          <LinearGradient
            colors={[
              `${COLORS.primary}99`,
              `${COLORS.primary}40`,
              `${COLORS.brandDark}D9`,
            ]}
            locations={[0, 0.5, 1]}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          <YStack pt={72} pb={72} px={20} gap="$5">
            <XStack ai="center" gap="$3">
              <YStack
                w={44}
                h={44}
                br={12}
                ai="center"
                jc="center"
                overflow="hidden"
                bg="white"
              >
                <RNImage
                  source={logo}
                  style={{ width: 52, height: 52 }}
                  resizeMode="cover"
                />
              </YStack>
              <Paragraph
                fontFamily={FONTS.headingSemi}
                fontSize={16}
                color="white"
                opacity={0.95}
              >
                Vintra
              </Paragraph>
            </XStack>

            <YStack gap="$2">
              <Paragraph
                fontFamily={FONTS.headingBold}
                fontSize={28}
                lineHeight={36}
                color="white"
              >
                {heroPrimary}
                {'\n'}
                <Paragraph
                  fontFamily={FONTS.headingBold}
                  fontSize={28}
                  lineHeight={36}
                  color={COLORS.primaryFixedDim}
                >
                  {heroAccent}
                </Paragraph>
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={14}
                lineHeight={20}
                color="white"
                opacity={0.85}
                maxWidth={320}
              >
                {heroSubhead}
              </Paragraph>
            </YStack>
          </YStack>
        </YStack>

        {/* ── CARD ────────────────────────────────────────────── */}
        <YStack
          flex={1}
          bg="white"
          borderTopLeftRadius={32}
          borderTopRightRadius={32}
          mt={-32}
          px="$5"
          pt="$5"
          pb="$5"
          gap="$4"
        >
          {done ? (
            <YStack gap="$3" ai="center" py="$3">
              <YStack
                w={64}
                h={64}
                br={32}
                bg={COLORS.primaryFixed}
                ai="center"
                jc="center"
              >
                <CheckCircle size={32} color={COLORS.primary} />
              </YStack>
              <Paragraph
                fontFamily={FONTS.headingBold}
                fontSize={22}
                color={COLORS.onSurface}
                ta="center"
              >
                Akun siap diverifikasi
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={13}
                lineHeight={20}
                color={COLORS.onSurfaceVariant}
                ta="center"
                maxWidth={300}
              >
                Setelah klik link verifikasi di email, kembali ke aplikasi
                ini dan login untuk mulai pakai Vintra.
              </Paragraph>
              <Button
                bg={COLORS.primary}
                pressStyle={{ bg: COLORS.brandActive }}
                borderWidth={0}
                br={9999}
                h={56}
                width="100%"
                mt="$3"
                onPress={() => router.replace('/auth/login')}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={16}
                  color="white"
                >
                  Kembali ke Login
                </Paragraph>
              </Button>
            </YStack>
          ) : (
            <>
              <YStack gap="$1" ai="center">
                <Paragraph
                  fontFamily={FONTS.headingBold}
                  fontSize={26}
                  lineHeight={34}
                  color={COLORS.onSurface}
                >
                  Daftar
                </Paragraph>
                <XStack ai="center" gap="$1.5">
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={13}
                    color={COLORS.onSurfaceVariant}
                  >
                    Sudah punya akun?
                  </Paragraph>
                  <Link href="/auth/login" asChild>
                    <Pressable hitSlop={8}>
                      <Paragraph
                        fontFamily={FONTS.bodyBold}
                        fontSize={13}
                        color={COLORS.primary}
                      >
                        Masuk
                      </Paragraph>
                    </Pressable>
                  </Link>
                </XStack>
              </YStack>

              <YStack gap="$3">
                <IconInput
                  leading={<User size={18} color={COLORS.outline} />}
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                  placeholder="Nama lengkap"
                />
                <IconInput
                  leading={<Briefcase size={18} color={COLORS.outline} />}
                  value={businessName}
                  onChangeText={setBusinessName}
                  autoCapitalize="words"
                  placeholder="Nama usaha (mis: Warung Pak Budi)"
                />
                <IconInput
                  leading={<Mail size={18} color={COLORS.outline} />}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder="Email"
                />
                <IconInput
                  leading={<Lock size={18} color={COLORS.outline} />}
                  trailing={
                    <Pressable
                      hitSlop={8}
                      onPress={() => setShowPassword((s) => !s)}
                    >
                      {showPassword ? (
                        <EyeOff size={18} color={COLORS.outline} />
                      ) : (
                        <Eye size={18} color={COLORS.outline} />
                      )}
                    </Pressable>
                  }
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholder="Password (min. 6 karakter)"
                />
              </YStack>

              <Button
                bg={COLORS.primary}
                pressStyle={{ bg: COLORS.brandActive }}
                borderWidth={0}
                br={9999}
                h={56}
                onPress={handleSubmit}
                disabled={!canSubmit}
                opacity={canSubmit ? 1 : 0.55}
              >
                {busy ? (
                  <Spinner color="white" />
                ) : (
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={16}
                    color="white"
                  >
                    Daftar
                  </Paragraph>
                )}
              </Button>
            </>
          )}
        </YStack>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function mapAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('already') || m.includes('sudah terdaftar'))
    return 'Email ini sudah terdaftar. Coba login.'
  if (m.includes('weak') || m.includes('password'))
    return 'Password terlalu pendek atau lemah.'
  if (m.includes('network')) return 'Tidak ada koneksi internet.'
  return message
}
