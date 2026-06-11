/**
 * Login screen — Asana-style layout:
 *
 *   [ Tall brand-green hero with welcoming headline ]
 *      ↓ overlap
 *   [ White card, big top-rounded corners, fills the rest of the screen ]
 *      - Centered "Masuk" title with "Belum punya akun? Daftar" sub-link
 *      - Pill email input + pill password input
 *      - "Lupa password?" link
 *      - Tall pill "Masuk" primary button (brand green)
 *      - "atau lanjutkan dengan" divider
 *      - Google SSO button (placeholder for now)
 *      - WhatsApp staff login button (WA green) + helper text
 *
 * Colors locked to the brand green palette (see src/lib/theme.ts).
 * Headlines in Manrope, body in Inter, per the design system.
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
import { Eye, EyeOff, Lock, Mail, Whatsapp } from '~/lib/icons'
import {
  Button,
  Paragraph,
  ScrollView,
  Separator,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import { useAuth } from '../../lib/auth-context'
import { IconInput } from '../../components/IconInput'
import { GoogleG } from '../../components/BrandIcons'
import { COLORS, FONTS } from '../../lib/theme'

const WA_GREEN = '#25D366'
const WA_GREEN_ACTIVE = '#1DA851'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../../../assets/icon.png')
// Hero background photo, copied from the web app's
// apps/web/src/assets/images/login-cover.png — single source-of-truth
// across web + mobile. If the web's cover changes, re-copy this file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loginCover = require('../../../assets/images/login-cover.png')

export default function LoginScreen() {
  const { signIn } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy

  async function handleSubmit() {
    if (!canSubmit) return
    setBusy(true)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) Alert.alert('Login gagal', mapAuthError(error))
  }

  function handleGoogleSignIn() {
    Alert.alert(
      'Belum tersedia',
      'Login dengan Google akan tersedia di pembaruan berikutnya.',
    )
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: COLORS.primary }}
    >
      {/* ScrollView w/ contentContainerStyle.flexGrow=1 — content fills
          the viewport exactly when the keyboard is closed (no scroll
          chrome visible, the design looks "fixed-height"). When the
          keyboard opens and squeezes the available area, scrolling
          becomes possible so hidden inputs / buttons stay reachable.
          automaticallyAdjustKeyboardInsets auto-scrolls to the focused
          input on iOS so users don't have to drag manually. */}
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        {/* ── HERO ─────────────────────────────────────────────────
            Hand-positioned image (NOT ImageBackground) so we control
            exactly which slice of the portrait photo shows. Layer
            order (bottom → top):
              1. Solid brand-green base (always visible as a fallback
                 + fills any area the image doesn't cover).
              2. The photo as an absolutely-positioned <Image>. Width
                 stretches to 100%, height computed via aspect ratio
                 so the photo is never distorted. IMAGE_TOP_OFFSET
                 shifts the photo vertically — negative crops the
                 "Vintra" signboard at the top of the photo, so we
                 land on the man's torso instead.
              3. LinearGradient overlay (60% → 25% → 85% brand-green)
                 keeps headline + status bar text readable.
              4. Logo + headline content. */}
        <YStack position="relative" overflow="hidden" bg={COLORS.primary}>
          <RNImage
            source={loginCover}
            resizeMode="cover"
            style={{
              position: 'absolute',
              top: -80, // bump more negative to push photo UP (crop more sign),
                       // positive to push photo DOWN (show more sign/ceiling)
              left: 0,
              right: 0,
              width: '100%',
              aspectRatio: 400 / 543, // image's natural ratio — no stretch
            }}
          />
          <LinearGradient
            colors={[
              `${COLORS.primary}99`, // 60% at top
              `${COLORS.primary}40`, // 25% mid
              `${COLORS.brandDark}D9`, // 85% bottom — clean fade into card
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
                fontSize={30}
                lineHeight={38}
                color="white"
              >
                Kelola usahamu,{'\n'}
                <Paragraph
                  fontFamily={FONTS.headingBold}
                  fontSize={30}
                  lineHeight={38}
                  color={COLORS.primaryFixedDim}
                >
                  naik kelas!
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
                Masuk untuk lanjut kelola HPP, POS, absensi, dan laporan
                keuangan usahamu.
              </Paragraph>
            </YStack>
          </YStack>
        </YStack>

        {/* ── CARD ─────────────────────────────────────────────────
            Big-rounded white surface that overlaps the hero. flex={1}
            stretches it to fill the bottom of the screen exactly.
            Tighter gap="$4" (was $5) so all six form sections (title,
            inputs, submit, divider, Google, WhatsApp) fit without
            scroll on an iPhone-12-sized viewport. */}
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
          <YStack gap="$1" ai="center">
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={28}
              lineHeight={36}
              color={COLORS.onSurface}
            >
              Masuk
            </Paragraph>
            <XStack ai="center" gap="$1.5">
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={13}
                color={COLORS.onSurfaceVariant}
              >
                Belum punya akun?
              </Paragraph>
              <Link href="/auth/register" asChild>
                <Pressable hitSlop={8}>
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={13}
                    color={COLORS.primary}
                  >
                    Daftar
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
              autoComplete="password"
              placeholder="Password"
            />
            <Link href="/auth/forgot-password" asChild>
              <Pressable hitSlop={8} style={{ alignSelf: 'flex-end' }}>
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={13}
                  color={COLORS.primary}
                >
                  Lupa password?
                </Paragraph>
              </Pressable>
            </Link>
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
                Masuk
              </Paragraph>
            )}
          </Button>

          <XStack ai="center" gap="$3">
            <Separator flex={1} borderColor={COLORS.outlineVariant} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={COLORS.onSurfaceVariant}
            >
              atau lanjutkan dengan
            </Paragraph>
            <Separator flex={1} borderColor={COLORS.outlineVariant} />
          </XStack>

          <YStack gap="$2.5">
            <Button
              bg="white"
              borderWidth={1}
              borderColor={COLORS.outlineVariant}
              br={9999}
              h={52}
              pressStyle={{ bg: COLORS.surfaceContainerLow }}
              onPress={handleGoogleSignIn}
            >
              <GoogleG size={20} />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={15}
                color={COLORS.onSurface}
              >
                Google
              </Paragraph>
            </Button>

            <Button
              bg={WA_GREEN}
              pressStyle={{ bg: WA_GREEN_ACTIVE }}
              borderWidth={0}
              br={9999}
              h={52}
              onPress={() => router.push('/auth/wa-login')}
            >
              <Whatsapp size={20} color="white" />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={15}
                color="white"
              >
                WhatsApp — khusus Staf
              </Paragraph>
            </Button>
          </YStack>
        </YStack>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function mapAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials'))
    return 'Email atau password salah.'
  if (m.includes('email not confirmed'))
    return 'Email belum diverifikasi. Cek inbox kamu.'
  if (m.includes('too many requests'))
    return 'Terlalu banyak percobaan login. Coba lagi sebentar.'
  if (m.includes('network')) return 'Tidak ada koneksi internet.'
  return message
}
