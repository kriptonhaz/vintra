/**
 * Forgot-password — Asana-style hero with cover photo + gradient,
 * white rounded-top card with the email field. Matches login.tsx for
 * a coherent auth flow.
 *
 * The reset link lands on the web (vintra.my.id/auth/reset-password)
 * since we haven't ported reset-from-email-link to mobile yet — user
 * clicks the email, sets a new password on web, then logs back in
 * here.
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
import { CheckCircle, Mail } from '~/lib/icons'
import {
  Button,
  Paragraph,
  ScrollView,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import { useAuth } from '../../lib/auth-context'
import { IconInput } from '../../components/IconInput'
import { COLORS, FONTS } from '../../lib/theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../../../assets/icon.png')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loginCover = require('../../../assets/images/login-cover.png')

export default function ForgotPasswordScreen() {
  const { resetPassword } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const canSubmit = email.trim().length > 0 && !busy

  async function handleSubmit() {
    if (!canSubmit) return
    setBusy(true)
    const { error } = await resetPassword(email.trim())
    setBusy(false)
    if (error) {
      Alert.alert('Reset gagal', error)
      return
    }
    setSent(true)
  }

  const heroPrimary = sent ? 'Cek email' : 'Lupa password?'
  const heroAccent = sent ? 'untuk reset link.' : 'Tenang aja.'
  const heroSubhead = sent
    ? `Link reset sudah kami kirim ke ${email}. Buka di browser untuk buat password baru.`
    : 'Masukkan email akunmu. Kami kirim link untuk reset password.'

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
        {/* ── HERO ────────────────────────────────────────────── */}
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
          {sent ? (
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
                Link terkirim
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={13}
                lineHeight={20}
                color={COLORS.onSurfaceVariant}
                ta="center"
                maxWidth={300}
              >
                Setelah reset password di browser, kembali ke aplikasi ini
                untuk login.
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
                  Reset Password
                </Paragraph>
                <XStack ai="center" gap="$1.5">
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={13}
                    color={COLORS.onSurfaceVariant}
                  >
                    Ingat password?
                  </Paragraph>
                  <Link href="/auth/login" asChild>
                    <Pressable hitSlop={8}>
                      <Paragraph
                        fontFamily={FONTS.bodyBold}
                        fontSize={13}
                        color={COLORS.primary}
                      >
                        Kembali Login
                      </Paragraph>
                    </Pressable>
                  </Link>
                </XStack>
              </YStack>

              <YStack gap="$3">
                <IconInput
                  leading={<Mail size={18} color={COLORS.outline} />}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder="Email"
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
                    Kirim Link Reset
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
