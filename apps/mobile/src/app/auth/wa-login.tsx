/**
 * WhatsApp OTP login for staff — Asana-style layout, same shape as
 * the main login screen but with the WhatsApp-specific form.
 *
 * Two phases on one screen:
 *   1. Request — staff enters tenant slug (kode toko) + phone. Server
 *      sends a 6-digit OTP via WhatsApp to that phone.
 *   2. Verify  — staff enters the OTP. Server validates + returns
 *      Supabase tokens (set via supabase.auth.setSession). The root
 *      layout's auth guard then bounces to the tabs.
 *
 * Why this exists: many frontline staff don't have an email — the owner just
 * adds them by phone in the web admin. This is their only way in.
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
import { MessageCircle, Phone, Store, Whatsapp } from '~/lib/icons'
import {
  Button,
  Paragraph,
  ScrollView,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import { callServerFn } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { IconInput } from '../../components/IconInput'
import { COLORS, FONTS } from '../../lib/theme'

const WA_GREEN = '#25D366'
const WA_GREEN_ACTIVE = '#1DA851'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../../../assets/icon.png')
// Same hero background as the main login screen — keeps the auth
// flow visually consistent. See login.tsx for source-of-truth notes.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loginCover = require('../../../assets/images/login-cover.png')

interface VerifyResponse {
  ok: true
  accessToken: string
  refreshToken: string
}

export default function WaLoginScreen() {
  const router = useRouter()
  const [phase, setPhase] = useState<'request' | 'verify'>('request')
  const [tenantSlug, setTenantSlug] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)

  const normalizedSlug = tenantSlug.trim().toLowerCase()
  const normalizedPhone = phone.replace(/[^\d+]/g, '')
  const canRequest =
    normalizedSlug.length > 0 && normalizedPhone.length >= 8 && !busy
  const canVerify = otp.length === 6 && !busy

  async function handleRequest() {
    if (!canRequest) return
    setBusy(true)
    try {
      await callServerFn('requestWaLoginOtp', {
        tenantSlug: normalizedSlug,
        phone: normalizedPhone,
      })
      setPhase('verify')
    } catch (err) {
      Alert.alert(
        'Gagal kirim OTP',
        err instanceof Error ? mapErr(err.message) : 'Coba lagi.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleVerify() {
    if (!canVerify) return
    setBusy(true)
    try {
      const res = await callServerFn<VerifyResponse>('verifyWaLoginOtp', {
        tenantSlug: normalizedSlug,
        phone: normalizedPhone,
        otp,
      })
      const { error } = await supabase.auth.setSession({
        access_token: res.accessToken,
        refresh_token: res.refreshToken,
      })
      if (error) throw new Error(error.message)
      // No router.replace — the auth guard handles it on next tick.
    } catch (err) {
      Alert.alert(
        'Verifikasi gagal',
        err instanceof Error ? mapErr(err.message) : 'Coba lagi.',
      )
    } finally {
      setBusy(false)
    }
  }

  // Two-line headline that switches with the phase. Word emphasis
  // (second line in primaryFixedDim) mirrors the Asana reference
  // where one phrase is visually called out.
  const heroPrimary = phase === 'request' ? 'Login khusus' : 'Cek WhatsApp'
  const heroAccent = phase === 'request' ? 'untuk staf.' : 'kamu sekarang.'
  const heroSubhead =
    phase === 'request'
      ? 'Masuk pakai nomor WhatsApp yang sudah didaftarkan owner ke usahamu.'
      : `OTP 6-digit sudah kami kirim ke ${normalizedPhone}.`

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: COLORS.primary }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── HERO — same hand-positioned image treatment as login.tsx ── */}
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

        {/* ── CARD ─────────────────────────────────────────────── */}
        <YStack
          flex={1}
          bg="white"
          borderTopLeftRadius={32}
          borderTopRightRadius={32}
          mt={-44}
          px="$5"
          pt="$6"
          pb="$6"
          gap="$5"
        >
          <YStack gap="$1" ai="center">
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={26}
              lineHeight={34}
              color={COLORS.onSurface}
            >
              {phase === 'request' ? 'Login Staf' : 'Verifikasi OTP'}
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              {phase === 'request'
                ? 'Pakai nomor WhatsApp & kode toko.'
                : 'Masukkan 6 digit yang kami kirim.'}
            </Paragraph>
          </YStack>

          {phase === 'request' ? (
            <>
              <YStack gap="$3">
                <YStack gap="$1.5">
                  <IconInput
                    leading={<Store size={18} color={COLORS.outline} />}
                    value={tenantSlug}
                    onChangeText={setTenantSlug}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Kode toko (mis: warung-bu-rina)"
                  />
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                    pl="$3"
                  >
                    Tanya owner — biasanya ada di link undangan.
                  </Paragraph>
                </YStack>
                <IconInput
                  leading={<Phone size={18} color={COLORS.outline} />}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="Nomor WhatsApp (0812-…)"
                />
              </YStack>

              <Button
                bg={WA_GREEN}
                pressStyle={{ bg: WA_GREEN_ACTIVE }}
                borderWidth={0}
                br={9999}
                h={56}
                onPress={handleRequest}
                disabled={!canRequest}
                opacity={canRequest ? 1 : 0.55}
              >
                {busy ? (
                  <Spinner color="white" />
                ) : (
                  <>
                    <Whatsapp size={20} color="white" />
                    <Paragraph
                      fontFamily={FONTS.bodyBold}
                      fontSize={15}
                      color="white"
                    >
                      Kirim OTP via WhatsApp
                    </Paragraph>
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <YStack gap="$3">
                <IconInput
                  leading={<MessageCircle size={18} color={COLORS.outline} />}
                  value={otp}
                  onChangeText={(v) =>
                    setOtp(v.replace(/[^\d]/g, '').slice(0, 6))
                  }
                  keyboardType="number-pad"
                  placeholder="6-digit OTP"
                />
              </YStack>

              <Button
                bg={WA_GREEN}
                pressStyle={{ bg: WA_GREEN_ACTIVE }}
                borderWidth={0}
                br={9999}
                h={56}
                onPress={handleVerify}
                disabled={!canVerify}
                opacity={canVerify ? 1 : 0.55}
              >
                {busy ? (
                  <Spinner color="white" />
                ) : (
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={15}
                    color="white"
                  >
                    Verifikasi
                  </Paragraph>
                )}
              </Button>

              <Pressable onPress={() => setPhase('request')}>
                <XStack jc="center" ai="center" gap="$1.5">
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={13}
                    color={COLORS.onSurfaceVariant}
                  >
                    OTP tidak masuk?
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={13}
                    color={COLORS.primary}
                  >
                    Ulangi
                  </Paragraph>
                </XStack>
              </Pressable>
            </>
          )}

          {/* Footer — back to email login */}
          <YStack mt="auto" pt="$4">
            <Link href="/auth/login" asChild>
              <Pressable hitSlop={8}>
                <XStack jc="center" ai="center" gap="$1.5">
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={13}
                    color={COLORS.onSurfaceVariant}
                  >
                    Login pakai email?
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={13}
                    color={COLORS.primary}
                  >
                    Masuk
                  </Paragraph>
                </XStack>
              </Pressable>
            </Link>
          </YStack>
        </YStack>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function mapErr(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('rate') || m.includes('terlalu'))
    return 'Terlalu banyak percobaan. Coba lagi sebentar.'
  if (m.includes('not found') || m.includes('unknown'))
    return 'Kode toko atau nomor HP tidak ditemukan.'
  if (m.includes('invalid') || m.includes('salah'))
    return 'Kode OTP salah atau sudah kadaluarsa.'
  if (m.includes('network')) return 'Tidak ada koneksi internet.'
  if (m.includes('unavailable'))
    return 'Login WhatsApp belum aktif untuk usaha ini.'
  return message
}
